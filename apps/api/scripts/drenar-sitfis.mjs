// Drena a fila do SITFIS: consome, via /Emitir, os protocolos que já temos guardados.
//
// O PROBLEMA QUE ISTO RESOLVE
// O limite AV02 do SERPRO ("limite de solicitações em processamento atingido") é por CONTRATANTE —
// o CNPJ do escritório —, e conta solicitações ABERTAS. Cada `/Apoiar` abre uma; cada `/Emitir`
// consome a sua e libera o lugar.
//
// Quando uma consulta em lote abre dezenas de solicitações e nenhuma é concluída, a fila fica cheia
// e NENHUMA empresa consegue consultar. Esperar não resolve sozinho: o que ocupa o lugar é a
// solicitação aberta, não um cronômetro. Quem libera é o /Emitir.
//
// Este script pega TODA empresa que tem `CompanyFiscalStatus.protocolo` guardado e chama o /Emitir.
// Não chama /Apoiar em lugar nenhum — ou seja, não abre nenhuma solicitação nova. É a única
// operação que ANDA quando a fila está cheia.
//
//   node scripts/drenar-sitfis.mjs            → mostra o que seria feito
//   node scripts/drenar-sitfis.mjs --aplicar  → chama o /Emitir e grava o relatório obtido
//   ... --cnpj=<cnpj>                         → uma empresa só
//
// ⚠ Consome chamadas pagas ao SERPRO — uma por empresa com protocolo.

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { obterRelatorio } from "../src/application/fiscal/serpro/SerproSitfisService.js";

const aplicar = process.argv.includes("--aplicar");
function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}
const onlyDigits = (v) => String(v || "").replace(/\D+/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pausa entre empresas: o /Emitir também tem limite, e martelar não acelera nada.
const PAUSA_MS = 3000;

try {
  const cnpjFiltro = arg("cnpj");
  const status = await prisma.companyFiscalStatus.findMany({
    where: { protocolo: { not: null } },
    select: {
      portalClientId: true, protocolo: true, situacao: true,
      checkedAt: true, ultimoRelatorioEm: true,
    },
  });

  const portais = await prisma.portalClient.findMany({
    where: {
      id: { in: status.map((s) => s.portalClientId) },
      ...(cnpjFiltro ? { cnpj: { in: [cnpjFiltro, onlyDigits(cnpjFiltro)] } } : {}),
    },
    select: { id: true, cnpj: true, razao: true },
  });
  const porId = new Map(portais.map((p) => [p.id, p]));

  const alvos = status
    .filter((s) => porId.has(s.portalClientId))
    .map((s) => ({ ...s, portal: porId.get(s.portalClientId) }))
    .sort((a, b) => String(a.portal.razao || "").localeCompare(String(b.portal.razao || "")));

  console.log(`${alvos.length} empresa(s) com protocolo guardado${aplicar ? "" : "  (simulação — use --aplicar)"}`);
  console.log("Cada /Emitir concluído libera um lugar na fila do escritório.\n");

  if (!alvos.length) {
    console.log("Nenhum protocolo guardado — não há o que drenar por aqui.");
    console.log("");
    console.log("Se a fila continua cheia, as solicitações abertas foram feitas por chamadas cujo");
    console.log("protocolo NÃO ficou salvo. Nesse caso não há como consumi-las do nosso lado: só");
    console.log("expiram no SERPRO. Evite novas tentativas até lá — e veja `probe-sitfis-apoiar.mjs`");
    console.log("para confirmar o estado direto na API.");
    process.exit(0);
  }

  let concluidos = 0, processando = 0, falhas = 0;

  for (const alvo of alvos) {
    const nome = (alvo.portal.razao || "").slice(0, 34).padEnd(34);
    if (!aplicar) {
      console.log(`  ${nome} ${alvo.portal.cnpj}  protocolo de ${alvo.checkedAt?.toISOString?.().slice(0, 10) || "?"}`);
      continue;
    }

    try {
      // `protocoloExistente` faz o serviço PULAR o /Apoiar e ir direto ao /Emitir — é justamente
      // o que queremos: consumir sem abrir nada novo.
      const r = await obterRelatorio({
        contribuinteCnpj: alvo.portal.cnpj,
        tipo: 2,
        protocoloExistente: alvo.protocolo,
        logger: null,
      });

      if (r?.relatorioPdfBuffer?.length) {
        concluidos += 1;
        console.log(`  ✓ ${nome} relatório obtido — lugar liberado`);
      } else if (r?.processando) {
        processando += 1;
        console.log(`  … ${nome} ainda processando${r.tempoEsperaSegundos ? ` (~${r.tempoEsperaSegundos}s)` : ""}`);
      } else {
        falhas += 1;
        console.log(`  ? ${nome} sem relatório e sem "processando" — ${r?.mensagem || "resposta inesperada"}`);
      }
    } catch (err) {
      falhas += 1;
      console.log(`  ✗ ${nome} ${err?.code || ""} ${err?.message || err}`);
    }
    await sleep(PAUSA_MS);
  }

  if (aplicar) {
    console.log("\n" + "─".repeat(64));
    console.log(`Relatórios concluídos (lugares liberados) : ${concluidos}`);
    console.log(`Ainda processando ........................: ${processando}`);
    console.log(`Falhas ...................................: ${falhas}`);
    if (concluidos) {
      console.log("\nCom lugares livres, a consulta das demais empresas volta a funcionar.");
      console.log("Este script NÃO grava a situação fiscal — rode a consulta pela tela para");
      console.log("persistir o relatório de cada empresa.");
    }
  } else {
    console.log("\nRode de novo com --aplicar para consumir os protocolos.");
  }
} catch (err) {
  console.error("Erro:", err?.message || err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

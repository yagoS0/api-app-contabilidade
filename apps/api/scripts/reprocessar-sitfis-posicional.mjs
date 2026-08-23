// REPROCESSA O ACERVO DE RELATÓRIOS SITFIS PELA LEITURA POSICIONAL — sem gastar chamada.
//
//   ENSAIO (padrão, NÃO ESCREVE NADA):
//     railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/reprocessar-sitfis-posicional.mjs'
//
//   APLICAR (⚠ ESCREVE EM PRODUÇÃO — quem executa é o dono/orquestrador, nunca o agente):
//     … node apps/api/scripts/reprocessar-sitfis-posicional.mjs --aplicar
//
// ⚠⚠ **ZERO CHAMADA AO SERPRO.** O PDF de cada relatório já está guardado em
// `CompanyFiscalStatus.rawPayload.dados.pdf` (24 de 24, medido). Reler é local: o script manda o
// PDF ao serviço `pdf-reader` (`POST /sitfis/posicional`) pelo MESMO caminho HTTP que a API usa.
// A consulta SITFIS é PAGA e o limite AV02 é por CONTRATANTE — este script não a toca.
//
// ⚠ **O QUE ELE ESCREVE, e só isso:** a chave `leituraPosicional` dentro de
// `CompanyFiscalStatus.rawPayload`, que já é `JSONB`. **Nenhuma DDL.** O envelope do SERPRO fica
// intacto ao lado; `texto`, `situacao`, `relatorioPdfFileId`, `protocolo`, `checkedAt` e
// `ultimoRelatorioEm` **não são tocados** — nada aqui reescreve o relatório salvo.
//
// ── O CRITÉRIO DE ACEITE, QUE É DO DONO E É VERIFICADO A CADA EXECUÇÃO ──────────────────────────
//
// Todo bloco que HOJE sai como TABELA pelo parser de texto tem de sair IDÊNTICO na leitura
// posicional (título, descrição, colunas, registros, anotações, linhas cruas). **Um só diferente e
// o script ABORTA a escrita inteira** — inclusive com `--aplicar` —, imprime a divergência e sai
// com código 1. Ajustar o critério para "quase todos" é o que este bloco existe para impedir.
//
// Mesma disciplina de `scripts/limpar-memoria-valor-apuracao.mjs`: ensaio por padrão, comparação
// ANTES × DEPOIS impressa, e a escrita abortada quando a comparação não fecha.

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { parseSitfisRelatorio } from "../src/application/fiscal/serpro/parseSitfisRelatorio.js";
import {
  lerSitfisPosicional,
  montarRawPayloadComLeitura,
} from "../src/application/fiscal/serpro/lerRelatorioSitfis.js";

const APLICAR = process.argv.includes("--aplicar");

const CAMPOS_COMPARADOS = ["titulo", "descricao", "colunas", "registros", "anotacoes", "naoInterpretado"];

const j = (bloco, campo) =>
  JSON.stringify(bloco?.[campo] ?? (campo === "titulo" ? null : []), null, 0);

/** O estado do bloco na tela: TABELA · LINHAS CRUAS · SÓ DESCRIÇÃO. */
function estado(bloco) {
  if ((bloco?.colunas || []).length && (bloco?.registros || []).length) return "TABELA";
  if ((bloco?.naoInterpretado || []).length) return "LINHAS CRUAS";
  return "SÓ DESCRIÇÃO";
}

function pdfDoRawPayload(rawPayload) {
  try {
    const dados = typeof rawPayload?.dados === "string" ? JSON.parse(rawPayload.dados) : rawPayload?.dados;
    return dados?.pdf ? Buffer.from(dados.pdf, "base64") : null;
  } catch {
    return null;
  }
}

try {
  const linhas = await prisma.companyFiscalStatus.findMany({
    select: {
      portalClientId: true,
      texto: true,
      rawPayload: true,
      portalClient: { select: { razao: true, cnpj: true } },
    },
    orderBy: { portalClientId: "asc" },
  });

  const aGravar = [];
  const divergencias = [];
  const ganhos = [];
  let semPdf = 0;
  let falhouLeitura = 0;
  let identicos = 0;
  let inalterados = 0;

  for (const linha of linhas) {
    const cnpj = String(linha.portalClient?.cnpj || "sem-cnpj");
    const pdf = pdfDoRawPayload(linha.rawPayload);
    if (!pdf?.length) {
      semPdf += 1;
      console.log(`  [${cnpj}] SEM PDF no rawPayload — nada a reprocessar`);
      continue;
    }

    const { relatorio: posicional, erro } = await lerSitfisPosicional({
      pdfBuffer: pdf,
      filename: `sitfis-${linha.portalClientId}.pdf`,
    });
    if (!posicional) {
      falhouLeitura += 1;
      console.log(`  [${cnpj}] leitura posicional não fechou: ${erro}`);
      continue;
    }

    // ── O CONFRONTO, bloco a bloco, exatamente como na prova ──
    const doTexto = linha.texto?.trim() ? parseSitfisRelatorio(linha.texto) : null;
    if (doTexto?.temTexto) {
      const porChave = new Map(posicional.diagnosticos.map((d) => [d.chave, d]));
      for (const d of doTexto.diagnosticos) {
        const antes = d.blocos || [];
        const depois = (porChave.get(d.chave) || {}).blocos || [];
        if (antes.length !== depois.length) {
          divergencias.push(
            `[${cnpj}] ${d.chave}: ${antes.length} bloco(s) no texto × ${depois.length} na posição`
          );
          continue;
        }
        for (let i = 0; i < antes.length; i += 1) {
          const a = antes[i];
          const b = depois[i];
          const rotulo = `[${cnpj}] ${d.chave} · ${a.titulo}`;
          if (estado(a) === "TABELA") {
            const dif = CAMPOS_COMPARADOS.filter((c) => j(a, c) !== j(b, c));
            if (dif.length) {
              divergencias.push(`${rotulo}: DIVERGE em ${dif.join(", ")}`);
              for (const c of dif) {
                divergencias.push(`      texto  : ${j(a, c).slice(0, 400)}`);
                divergencias.push(`      posição: ${j(b, c).slice(0, 400)}`);
              }
            } else {
              identicos += 1;
            }
          } else if (estado(b) === "TABELA") {
            ganhos.push(`${rotulo}: ${b.registros.length} registro(s) · colunas ${b.colunas.join(" · ")}`);
          } else {
            inalterados += 1;
          }
        }
      }
    }

    aGravar.push({ portalClientId: linha.portalClientId, cnpj, rawPayload: linha.rawPayload, posicional });
  }

  console.log(`\n=== SITFIS · REPROCESSAMENTO POSICIONAL ${APLICAR ? "(APLICANDO)" : "(ENSAIO — nada é gravado)"} ===\n`);
  console.log(`  relatórios no banco ............ ${linhas.length}`);
  console.log(`  sem PDF guardado ............... ${semPdf}`);
  console.log(`  leitura posicional falhou ...... ${falhouLeitura}`);
  console.log(`  prontos para gravar ............ ${aGravar.length}`);
  console.log(`\n  --- CRITÉRIO DE ACEITE (blocos que HOJE saem como tabela) ---`);
  console.log(`  IDÊNTICOS ...................... ${identicos}`);
  console.log(`  DIVERGENTES .................... ${divergencias.length}   <== um só já aborta`);
  console.log(`\n  blocos que PASSAM a virar tabela ${ganhos.length}`);
  for (const g of ganhos) console.log(`      ${g}`);
  console.log(`  blocos que continuam como estão  ${inalterados}`);

  if (divergencias.length) {
    console.error(`\n⚠⚠ ESCRITA ABORTADA — o critério de aceite não fechou:`);
    for (const d of divergencias) console.error(`  ${d}`);
    console.error(`\nNada foi gravado. Não ajuste o critério: leve a divergência ao dono.`);
    process.exitCode = 1;
  } else if (!APLICAR) {
    console.log(`\n  ENSAIO. Nada foi gravado. Para gravar: --aplicar`);
  } else {
    let gravados = 0;
    for (const item of aGravar) {
      await prisma.companyFiscalStatus.update({
        where: { portalClientId: item.portalClientId },
        // ⚠ SÓ `rawPayload`. Nenhuma outra coluna entra neste `data` — o relatório salvo (texto,
        // PDF, situação, datas) é a única cópia que temos e não se reescreve aqui.
        data: { rawPayload: montarRawPayloadComLeitura(item.rawPayload, item.posicional) },
      });
      gravados += 1;
    }
    console.log(`\n  GRAVADOS ....................... ${gravados}`);
  }
} catch (err) {
  console.error("Erro:", err?.message || err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

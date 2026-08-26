// OS CÓDIGOS QUE FALTAM, CONTRA AS REGRAS QUE JÁ EXISTEM.
//
// `diag-classificacao-cobertura.mjs` mediu que 16.476 itens nunca foram tocados pelo classificador,
// e que esses itens usam **55 códigos de serviço distintos**. Este script pergunta a única coisa
// que decide se falta de-para: **quantos desses 55 as regras JÁ CADASTRADAS resolveriam?**
//
// ⚠ Ele NÃO classifica nada e NÃO escreve nada — reproduz, em memória, a mesma resolução do
// `ClassificadorService` (cTribNac → LC116 → item específico → capítulo) contra as
// `regras_classificacao` que estão no banco, e conta.

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";

// ⚠ MESMA derivação do ClassificadorService — copiada de propósito para o script não depender de
// exportação interna; se ela divergir, o número aqui deixa de descrever o classificador real.
function cTribNacToLc116(codigo) {
  const d = String(codigo || "").replace(/\D+/g, "");
  if (d.length !== 6) return null;
  const cap = parseInt(d.slice(0, 2), 10);
  const item = parseInt(d.slice(2, 4), 10);
  if (!cap || !item) return null;
  return `${cap}.${String(item).padStart(2, "0")}`;
}
function extractCapitulo(codigo) {
  const s = String(codigo || "");
  if (s.includes(".")) return s.split(".")[0];
  const d = s.replace(/\D+/g, "");
  return d.length >= 2 ? String(parseInt(d.slice(0, 2), 10)) : null;
}

async function main() {
  const linhas = await prisma.$queryRaw`
    SELECT "codigoServico" AS codigo, COUNT(*)::int AS itens
    FROM "nota_itens" WHERE "tipoReceita" IS NULL
    GROUP BY 1 ORDER BY 2 DESC
  `;
  const regras = await prisma.regraClassificacao.findMany({
    where: { escopo: "GLOBAL" },
    select: { codigo: true, tipoCodigo: true, tipoReceita: true },
  });
  const porCodigo = new Map(regras.map((r) => [String(r.codigo), r.tipoReceita]));

  console.log(`\n═══ OS ${linhas.length} CÓDIGOS NÃO CLASSIFICADOS × AS ${regras.length} REGRAS GLOBAIS ═══\n`);

  let resolvidos = 0, porItem = 0, semCodigo = 0, itensResolvidos = 0, itensTotal = 0;
  let precisos = 0, porCapitulo = 0;
  const viaCapitulo = [];
  const semRegra = [];
  for (const l of linhas) {
    itensTotal += l.itens;
    if (!l.codigo) { semCodigo += l.itens; continue; }
    const lc = cTribNacToLc116(l.codigo) || (String(l.codigo).includes(".") ? String(l.codigo) : null);
    const cap = extractCapitulo(lc || l.codigo);
    // ⚠ A ORDEM IMPORTA e é a do ClassificadorService: código exato, depois item LC116, depois
    // CAPÍTULO. Só a terceira é fallback, e é a única que pode estar errada para o subitem.
    const exato = porCodigo.get(String(l.codigo));
    const doItem = lc ? porCodigo.get(lc) : undefined;
    const doCap = cap ? porCodigo.get(cap) : undefined;
    const achou = exato || doItem || doCap;
    if (achou) {
      resolvidos += 1; itensResolvidos += l.itens;
      if (exato || doItem) { porItem += 1; precisos += l.itens; }
      else { viaCapitulo.push({ ...l, lc, cap, tr: doCap }); porCapitulo += l.itens; }
    } else semRegra.push(l);
  }

  console.log(`códigos com regra ......... ${resolvidos} de ${linhas.length}`);
  console.log(`  por REGRA PRECISA ....... ${porItem} códigos · ${precisos.toLocaleString("pt-BR")} itens`);
  console.log(`  por FALLBACK DE CAPÍTULO  ${viaCapitulo.length} códigos · ${porCapitulo.toLocaleString("pt-BR")} itens   ⚠ é AQUI que o anexo pode sair errado`);
  if (viaCapitulo.length) {
    console.log("");
    console.log("⚠⚠ O QUE RESOLVE SO PELO CAPITULO — capitulo que mistura anexos");
    console.log("   (7: engenharia x obra · 17: consultoria x advocacia · 4: saude)");
    console.log("   responde o subitem pelo vizinho, EM SILENCIO:");
    console.log("");
    for (const v of viaCapitulo.sort((a, b) => b.itens - a.itens).slice(0, 25)) {
      console.log(`   ${String(v.codigo).padEnd(10)} LC116 ${String(v.lc).padEnd(7)} cap ${String(v.cap).padEnd(3)} ${String(v.itens).padStart(7)} itens  → ${v.tr}`);
    }
  }
  console.log(`  itens que isso cobre .... ${itensResolvidos.toLocaleString("pt-BR")} de ${itensTotal.toLocaleString("pt-BR")}`);
  console.log(`itens SEM código de serviço ${semCodigo.toLocaleString("pt-BR")}   ⚠ não é falta de regra: é falta de DADO na nota`);
  if (semRegra.length) {
    console.log(`\n⚠ CÓDIGOS SEM REGRA (${semRegra.length}) — é ISTO que um de-para novo teria de responder:\n`);
    for (const l of semRegra.slice(0, 40)) {
      console.log(`   ${String(l.codigo).padEnd(14)} ${String(l.itens).padStart(7)} itens   → LC116 ${cTribNacToLc116(l.codigo) || "?"}`);
    }
  } else {
    console.log("\n✓ TODOS os códigos já têm regra. Não falta de-para — falta EXECUTAR o classificador.");
  }
  console.log("\n═══ fim — nada foi escrito ═══\n");
}
main().catch((e) => { console.error("⚠", e?.message || e); process.exitCode = 1; }).finally(() => prisma.$disconnect());

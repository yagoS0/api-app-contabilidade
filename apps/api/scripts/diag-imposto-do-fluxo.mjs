// ⚠⚠ SOMENTE LEITURA. Zero chamada externa. Nenhum `create`/`update`/`delete`.
//
// PERGUNTA DO DONO (30/08/2026): *"o imposto que aparece para ERISANGELA em agosto está
// completamente errado — não está de acordo com o valor das guias do portal contábil, muito menos
// com os lançamentos."*
//
// Este script põe as TRÊS fontes lado a lado para a competência pedida:
//   1. o que a coluna IMPOSTOS do fluxo mostra (GUIA + IMPOSTO_PROJETADO), pelo MESMO serviço que a
//      tela chama — nada é reimplementado aqui, senão o diagnóstico mediria outra coisa;
//   2. as GUIAS daquela empresa (o que o portal do contador lista);
//   3. os LANÇAMENTOS de imposto (provisão/pagamento) no razão.
//
// Uso:  node scripts/diag-imposto-do-fluxo.mjs "<parte do nome>" [AAAA-MM]

import { PrismaClient } from "@prisma/client";
import { montarFluxoDeCaixa } from "../src/application/fluxo/FluxoDeCaixaService.js";

const p = new PrismaClient();
const ALVO = (process.argv[2] || "ERISANGELA").toUpperCase();
const COMP = process.argv[3] || "2026-08";

const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const mesDaData = (d) => (d ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` : null);

const empresas = await p.portalClient.findMany({
  select: { id: true, razao: true, companyId: true, cnpj: true },
});
const alvo = empresas.find((e) => String(e.razao || "").toUpperCase().includes(ALVO));
if (!alvo) {
  console.log(`Nenhuma empresa com "${ALVO}" no nome. Existem ${empresas.length}.`);
  await p.$disconnect();
  process.exit(0);
}
console.log(`EMPRESA: ${alvo.razao}  (portalClientId=${alvo.id})`);
console.log(`COMPETENCIA: ${COMP}\n`);

// ── 1. O QUE A TELA MOSTRA ────────────────────────────────────────────────────────────────────
// ⚠ Pelo serviço de verdade. Uma soma reimplementada aqui poderia "bater" com um fluxo que está
// errado, e o diagnóstico diria que está tudo bem.
const fluxo = await montarFluxoDeCaixa({ portalClientId: alvo.id, cicloAtual: COMP, client: p });
const mes = (fluxo.meses || []).find((m) => m.competencia === COMP);
const IMPOSTO = ["GUIA", "IMPOSTO_PROJETADO"];
const doFluxo = (mes?.linhas || []).filter((l) => l.direcao === "SAIDA" && IMPOSTO.includes(l.fonte));

console.log("=== 1. A COLUNA IMPOSTOS DO FLUXO ===");
if (!doFluxo.length) console.log("  (nenhuma linha)");
for (const l of doFluxo) {
  console.log(
    `  ${String(l.fonte).padEnd(18)} ${String(l.procedencia).padEnd(12)} `
    + `dia=${String(l.dia ?? "-").padStart(2)}  ${brl(l.valor).padStart(14)}  ${l.rotulo}`,
  );
  if (l.base?.frase) console.log(`      └ ${l.base.frase}`);
  if (l.diaDesconhecido) console.log(`      └ sem dia: ${l.diaDesconhecido.motivo}`);
}
console.log(`  SOMA DA COLUNA: ${brl(doFluxo.reduce((s, l) => s + Number(l.valor || 0), 0))}`);
if (fluxo.semImposto) console.log(`  semImposto: ${fluxo.semImposto.motivo}`);

// ── 2. AS GUIAS ───────────────────────────────────────────────────────────────────────────────
// ⚠ Sem filtro de competência: o que interessa é o que VENCE ou foi PAGO no mês, e as duas coisas
// podem vir de competências diferentes (a guia de 07 vence em 08).
const guias = await p.guide.findMany({
  where: { portalClientId: alvo.id },
  select: {
    id: true, tipo: true, competencia: true, valor: true, vencimento: true,
    paymentStatus: true, paymentConfirmedAt: true, liberadaCliente: true, status: true, parcelamentoId: true,
  },
  orderBy: { vencimento: "asc" },
});
const noMes = guias.filter((g) => mesDaData(g.vencimento) === COMP || mesDaData(g.paymentConfirmedAt) === COMP);
console.log("\n=== 2. AS GUIAS (vencendo OU pagas no mes) ===");
if (!noMes.length) console.log("  (nenhuma)");
for (const g of noMes) {
  console.log(
    `  ${String(g.tipo).padEnd(10)} comp=${String(g.competencia).padEnd(8)} `
    + `venc=${mesDaData(g.vencimento) === COMP ? String(g.vencimento?.toISOString().slice(0, 10)) : "-"} `
    + `pgto=${String(g.paymentStatus).padEnd(8)} liberada=${g.liberadaCliente ? "sim" : "NAO"} `
    + `${g.parcelamentoId ? "[PARCELA] " : ""}${brl(g.valor).padStart(14)}`,
  );
}
console.log(`  SOMA: ${brl(noMes.reduce((s, g) => s + Number(g.valor || 0), 0))}`);
console.log(`  (a empresa tem ${guias.length} guias no total)`);

// ── 3. OS LANCAMENTOS ─────────────────────────────────────────────────────────────────────────
const entries = await p.accountingEntry.findMany({
  where: { portalClientId: alvo.id, competencia: COMP },
  select: { id: true, tipo: true, subtipo: true, historico: true, data: true },
});
console.log("\n=== 3. OS LANCAMENTOS DA COMPETENCIA ===");
if (!entries.length) console.log("  (nenhum)");
const linhas = await p.accountingEntryLine.findMany({
  where: { entryId: { in: entries.map((e) => e.id) } },
  select: { entryId: true, debito: true, credito: true, valor: true, contaDebito: true, contaCredito: true },
}).catch(() => []);
const porEntry = new Map();
for (const l of linhas) porEntry.set(l.entryId, (porEntry.get(l.entryId) || 0) + Number(l.valor || 0));
for (const e of entries) {
  const total = porEntry.has(e.id) ? porEntry.get(e.id) / 2 : null;
  console.log(
    `  ${String(e.tipo).padEnd(12)} ${String(e.subtipo || "-").padEnd(16)} `
    + `${e.data?.toISOString().slice(0, 10)} ${(total == null ? "?" : brl(total)).padStart(14)}  ${String(e.historico || "").slice(0, 44)}`,
  );
}

// ── 4. O QUE ALIMENTA O IMPOSTO PROJETADO ─────────────────────────────────────────────────────
// ⚠ É aqui que a divergencia costuma morar: a projecao e `receita prevista x aliquota do ultimo mes
// APURADO`, e nenhuma das duas pontas e a guia.
const projetado = doFluxo.find((l) => l.fonte === "IMPOSTO_PROJETADO");
console.log("\n=== 4. DE ONDE SAI O IMPOSTO PROJETADO ===");
if (!projetado) {
  console.log("  (nao ha linha projetada neste mes)");
} else {
  const b = projetado.base || {};
  console.log(`  receita prevista no mes : ${brl(b.receitaPrevista)}`);
  console.log(`  aliquota                : ${((Number(b.aliquota) || 0) * 100).toFixed(4)}%`);
  console.log(`  competencia da aliquota : ${b.competenciaDaAliquota}`);
  console.log(`  procedencia da aliquota : ${b.procedenciaDaAliquota}`);
  console.log(`  => ${brl(b.receitaPrevista)} x ${((Number(b.aliquota) || 0) * 100).toFixed(4)}% = ${brl(projetado.valor)}`);
}

// ⚠ E as notas que produziram essa receita: a entrada de AGOSTO sai das notas de JULHO (a receita
// entra no mes seguinte, dia 1).
const entradas = (mes?.linhas || []).filter((l) => l.direcao === "ENTRADA");
console.log(`\n  entradas do mes (a base da projecao): ${brl(entradas.reduce((s, l) => s + Number(l.valor || 0), 0))}`);
for (const l of entradas) console.log(`    dia=${String(l.dia ?? "-").padStart(2)} ${brl(l.valor).padStart(14)}  ${l.rotulo}`);

await p.$disconnect();

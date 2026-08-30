// ⚠⚠ SOMENTE LEITURA. Zero chamada externa, nenhuma escrita.
//
// Duas afirmações do dono (30/08/2026), para medir antes de mexer:
//   1. *"você me coloca pró-labore com o INSS junto, valor de 1.621,00 na ERISANGELA, quando são
//      coisas separadas: pró-lab é 1.442,69 e INSS 178,31."*
//   2. *"se eu provisiono isso em julho PROVISÃO, eu vou pagar em agosto — deve aparecer em agosto,
//      e confirmado em agosto quando foi pago; se o último pagamento foi feito dia 16, eu
//      PROVISIONO em agosto para dia 16."*
//
// Uso: node scripts/diag-folha-e-datas.mjs "<parte do nome>"

import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const ALVO = (process.argv[2] || "ERISANGELA").toUpperCase();
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (d) => (d ? d.toISOString().slice(0, 10) : "—");

const empresas = await p.portalClient.findMany({ select: { id: true, razao: true } });
const alvo = empresas.find((e) => String(e.razao || "").toUpperCase().includes(ALVO));
if (!alvo) { console.log("nao achei"); await p.$disconnect(); process.exit(0); }
console.log(`EMPRESA: ${alvo.razao}\n`);

// ── OS LANÇAMENTOS DE FOLHA, LINHA A LINHA ────────────────────────────────────────────────────
// ⚠ É por aqui que `derivarFolha12m` soma. Se ele estiver somando pró-labore COM o INSS, é aqui
// que aparece.
const entries = await p.accountingEntry.findMany({
  where: { portalClientId: alvo.id, tipo: "FOLHA" },
  select: { id: true, competencia: true, subtipo: true, historico: true, data: true },
  orderBy: { data: "asc" },
});
const linhas = await p.accountingEntryLine.findMany({
  where: { entryId: { in: entries.map((e) => e.id) } },
  select: { entryId: true, valor: true, contaDebito: true, contaCredito: true },
}).catch((e) => { console.log("linhas: " + String(e.message).slice(0, 80)); return []; });
const porEntry = new Map();
for (const l of linhas) {
  if (!porEntry.has(l.entryId)) porEntry.set(l.entryId, []);
  porEntry.get(l.entryId).push(l);
}

console.log("=== LANCAMENTOS `tipo: FOLHA` ===");
console.log("  comp     data        subtipo          D / C            valor  historico");
for (const e of entries) {
  const ls = porEntry.get(e.id) || [];
  for (const l of ls) {
    console.log(
      `  ${String(e.competencia).padEnd(8)} ${dia(e.data).padEnd(11)} ${String(e.subtipo || "-").padEnd(16)} `
      + `${String(l.contaDebito || "?").padStart(5)} / ${String(l.contaCredito || "?").padEnd(5)} `
      + `${brl(l.valor).padStart(13)}  ${String(e.historico || "").slice(0, 40)}`,
    );
  }
  if (!ls.length) console.log(`  ${String(e.competencia).padEnd(8)} ${dia(e.data).padEnd(11)} ${String(e.subtipo || "-").padEnd(16)} (sem linhas)  ${String(e.historico || "").slice(0, 40)}`);
}

// ── O QUE `derivarFolha12m` SOMA ──────────────────────────────────────────────────────────────
const { derivarFolha12m } = await import("../src/application/notas/apuracao/v2/FolhaDerivadaService.js");
const d = await derivarFolha12m({ portalClientId: alvo.id, competencia: "2026-09", client: p });
console.log(`\n=== O QUE A COLUNA FOLHA MOSTRA (derivarFolha12m) ===`);
console.log(`  disponivel=${d?.disponivel}  contasConsideradas=${JSON.stringify(d?.contasConsideradas)}`);
for (const m of (d?.porMes || [])) {
  console.log(`  ${m.competencia}  ${brl(m.valor).padStart(13)}  (${m.lancamentos} lançamento(s))`);
}

// ── AS DATAS DO ÚLTIMO PAGAMENTO, POR ESPÉCIE ─────────────────────────────────────────────────
// ⚠ É o que o dono pediu para virar a data da PREVISÃO: *"se o último pagamento foi feito dia 16,
// eu PROVISIONO em agosto para dia 16."*
const pagas = await p.guide.findMany({
  where: { portalClientId: alvo.id, paymentStatus: "PAID", paymentConfirmedAt: { not: null } },
  select: { tipo: true, competencia: true, valor: true, paymentConfirmedAt: true, parcelamentoId: true },
  orderBy: { paymentConfirmedAt: "desc" },
});
console.log(`\n=== O ULTIMO PAGAMENTO DE CADA ESPECIE (a data que a previsao deve usar) ===`);
const vistos = new Set();
for (const g of pagas) {
  const chave = `${g.tipo}${g.parcelamentoId ? "/PARCELA" : ""}`;
  if (vistos.has(chave)) continue;
  vistos.add(chave);
  console.log(
    `  ${chave.padEnd(18)} comp=${String(g.competencia).padEnd(8)} pago em ${dia(g.paymentConfirmedAt)} `
    + `(dia ${String(g.paymentConfirmedAt.getUTCDate()).padStart(2)})  ${brl(g.valor).padStart(13)}`,
  );
}

// ⚠ E o dia do último pagamento de FOLHA, que sai do razão (não há guia de folha).
const pagFolha = entries.filter((e) => /PAGO/i.test(String(e.historico || "")));
console.log(`\n=== O ULTIMO PAGAMENTO DE FOLHA (pelo historico do razao) ===`);
for (const e of pagFolha.slice(-4)) {
  console.log(`  ${e.competencia}  ${dia(e.data)} (dia ${String(e.data?.getUTCDate()).padStart(2)})  ${String(e.historico || "").slice(0, 46)}`);
}

await p.$disconnect();

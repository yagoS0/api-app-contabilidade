// ⚠⚠ SOMENTE LEITURA. Zero chamada externa, nenhuma escrita.
//
// A CONFERÊNCIA QUE O DONO PEDIU (30/08/2026): *"confira também o fluxo (…) com nossa base de
// pagamentos de uma empresa de verdade, veja se faz sentido o que foi feito."*
//
// Ele põe, mês a mês, o que a TELA mostra em cada coluna ao lado do que a BASE tem. A tela sai do
// serviço de verdade (`montarFluxoDeCaixa`) — reimplementar a soma aqui faria o diagnóstico
// concordar com um fluxo errado.
//
// Uso: node scripts/conferir-fluxo-contra-a-base.mjs "<parte do nome>" [AAAA-MM do ciclo]

import { PrismaClient } from "@prisma/client";
import { montarFluxoDeCaixa } from "../src/application/fluxo/FluxoDeCaixaService.js";

const p = new PrismaClient();
const ALVO = (process.argv[2] || "ERISANGELA").toUpperCase();
const CICLO = process.argv[3] || "2026-08";

const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const cel = (v) => (v == null ? "—" : brl(v));
const mesDe = (d) => (d ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` : null);

const empresas = await p.portalClient.findMany({ select: { id: true, razao: true } });
const alvo = empresas.find((e) => String(e.razao || "").toUpperCase().includes(ALVO));
if (!alvo) { console.log("nao achei"); await p.$disconnect(); process.exit(0); }

const fluxo = await montarFluxoDeCaixa({ portalClientId: alvo.id, cicloAtual: CICLO, client: p });

// ⚠ A MESMA regra de balde da TELA. Se ela divergir daqui, a conferência mede outra coisa.
const IMPOSTO = new Set(["GUIA", "IMPOSTO_PROJETADO"]);
const FOLHA = new Set(["FOLHA"]);
const balde = (l) => {
  if (l.direcao === "ENTRADA") return "entrada";
  if (IMPOSTO.has(l.fonte)) return "impostos";
  if (FOLHA.has(l.fonte)) return "folha";
  return "saida";
};
const soma = (linhas, b) => {
  const ls = linhas.filter((l) => balde(l) === b && l.procedencia !== "DESCONHECIDO");
  return ls.length ? ls.reduce((s, l) => s + Number(l.valor || 0), 0) : null;
};

console.log(`EMPRESA: ${alvo.razao}   ciclo=${CICLO}\n`);
console.log("=== O QUE A TELA MOSTRA ===");
console.log("  mes      entrada          saida        impostos          folha       resultado");
for (const m of fluxo.meses) {
  const e = soma(m.linhas, "entrada");
  const s = soma(m.linhas, "saida");
  const i = soma(m.linhas, "impostos");
  const f = soma(m.linhas, "folha");
  const saidas = [s, i, f].filter((x) => x != null).reduce((a, b2) => a + b2, 0);
  const r = e == null && !saidas ? null : (e || 0) - saidas;
  console.log(
    `  ${m.competencia}  ${cel(e).padStart(14)} ${cel(s).padStart(14)} ${cel(i).padStart(14)} `
    + `${cel(f).padStart(14)} ${cel(r).padStart(14)}`,
  );
}

// ── A BASE ────────────────────────────────────────────────────────────────────────────────────
const [notas, guias, folhaEntries] = await Promise.all([
  p.portalInvoice.findMany({
    where: { clientId: alvo.id, papel: "EMIT", statusEfetivo: "autorizada", competencia: { not: null } },
    select: { competencia: true, total: true },
  }),
  p.guide.findMany({
    where: { portalClientId: alvo.id },
    select: { tipo: true, competencia: true, valor: true, vencimento: true, paymentStatus: true, paymentConfirmedAt: true, parcelamentoId: true },
  }),
  p.accountingEntry.findMany({
    where: { portalClientId: alvo.id, tipo: "FOLHA" },
    select: { competencia: true, historico: true, data: true },
  }),
]);

const porComp = new Map();
const põe = (c, k, v) => {
  if (!c) return;
  if (!porComp.has(c)) porComp.set(c, { notas: 0, guiasPagas: 0, guiasAbertas: 0, parcelas: 0 });
  porComp.get(c)[k] += v;
};
for (const n of notas) põe(mesDe(n.competencia), "notas", Number(n.total || 0));
for (const g of guias) {
  const v = Number(g.valor || 0);
  if (!(v > 0)) continue;
  if (g.paymentStatus === "PAID") põe(mesDe(g.paymentConfirmedAt), g.parcelamentoId ? "parcelas" : "guiasPagas", v);
  else põe(mesDe(g.vencimento) || g.competencia, g.parcelamentoId ? "parcelas" : "guiasAbertas", v);
}

console.log("\n=== O QUE A BASE TEM (por mes) ===");
console.log("  mes      notas emitidas   guias PAGAS   guias ABERTAS      parcelas");
for (const c of [...porComp.keys()].sort()) {
  const x = porComp.get(c);
  console.log(
    `  ${c}  ${brl(x.notas).padStart(14)} ${brl(x.guiasPagas).padStart(13)} `
    + `${brl(x.guiasAbertas).padStart(15)} ${brl(x.parcelas).padStart(13)}`,
  );
}

// ── AS PERGUNTAS QUE O DONO FEZ ───────────────────────────────────────────────────────────────
console.log("\n=== AS PERGUNTAS ===");

// 1 · A entrada do mês X é o faturamento do mês X-1?
const fat = new Map([...porComp.entries()].map(([c, x]) => [c, x.notas]));
const anterior = (c) => {
  const [y, m] = c.split("-").map(Number);
  return `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;
};
console.log("\n1 · A ENTRADA de cada mes bate com o FATURAMENTO do mes anterior?");
for (const m of fluxo.meses) {
  const e = soma(m.linhas, "entrada");
  const esperado = fat.get(anterior(m.competencia));
  if (e == null && !esperado) continue;
  const bate = Math.abs((e || 0) - (esperado || 0)) < 0.01;
  console.log(`  ${m.competencia}  tela=${cel(e).padStart(14)}  notas de ${anterior(m.competencia)}=${brl(esperado).padStart(14)}  ${bate ? "OK" : "⚠ DIVERGE"}`);
}

// 2 · Em que DIA cada linha caiu — é o que o dono cobrou ("data nenhuma").
console.log("\n2 · CADA LINHA TEM DIA? (o dono: *as datas deveriam ser iguais as do ultimo pagamento*)");
for (const m of fluxo.meses) {
  for (const l of m.linhas) {
    if (l.dia == null) {
      console.log(`  ⚠ ${m.competencia} SEM DIA  ${String(l.fonte).padEnd(18)} ${brl(l.valor).padStart(13)}  ${l.rotulo}`);
    }
  }
}

// 3 · A folha soma pró-labore COM o INSS?
console.log("\n3 · A COLUNA FOLHA — o que ela soma");
for (const m of fluxo.meses) {
  const f = (m.linhas || []).filter((l) => l.fonte === "FOLHA");
  for (const l of f) console.log(`  ${m.competencia}  ${brl(l.valor).padStart(13)}  ${l.base?.frase || ""}`);
}
const hist = folhaEntries.filter((e) => /INSS/i.test(String(e.historico || "")));
console.log(`  ⚠ lançamentos de folha cujo histórico cita INSS: ${hist.length} (se a coluna os soma, o INSS está contado DUAS vezes — ele também é guia)`);

await p.$disconnect();

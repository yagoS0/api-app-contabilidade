// O QUE O MODAL DE BAIXA DO DAS VÊ — por empresa, na competência pedida.
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhum DDL, nenhuma chamada externa.
//
// O modal (`renderBaixaModal.jsx`) monta a baixa a partir de TRÊS fontes, nesta ordem:
//   1. o COMPROVANTE do SERPRO (`guide.extracted.comprovante`), quando `confiavel` — ele manda na
//      DATA (e portanto na competência que a trava de mês fechado vai ler) e no principal/juros/multa;
//   2. o `acrescimo` da circular (`acrescimos.DAS`) — juros e multa;
//   3. o `saldoInfo.saldo` da provisão — o principal.
// Este script imprime as três, lado a lado, mais a competência que a trava leria.
//
// USO:
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-baixa-das-detalhe.mjs 2026-06'

import { prisma } from "../src/infrastructure/db/prisma.js";

const COMPETENCIA = String(process.argv[2] || "2026-06");
const money = (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 }));

const provisoes = await prisma.accountingEntry.findMany({
  where: { competencia: COMPETENCIA, tipo: "PROVISAO", eventType: "DAS_SIMPLES" },
  include: { lines: true, baixas: { include: { lines: true } } },
});
const ids = [...new Set(provisoes.map((p) => p.portalClientId))];
const empresas = await prisma.portalClient.findMany({ where: { id: { in: ids } }, select: { id: true, razao: true } });
const nome = new Map(empresas.map((e) => [e.id, e.razao]));
const circs = await prisma.companyMonthlyCircular.findMany({
  where: { competencia: COMPETENCIA, portalClientId: { in: ids } },
  select: { portalClientId: true, dasTotal: true, acrescimos: true, fechadoContabilEm: true },
});
const circPor = new Map(circs.map((c) => [c.portalClientId, c]));
const guias = await prisma.guide.findMany({
  where: { competencia: COMPETENCIA, tipo: "SIMPLES", status: "PROCESSED", parcelamentoId: null, portalClientId: { in: ids } },
  select: { portalClientId: true, valor: true, valorOriginal: true, paymentStatus: true, extracted: true, vencimento: true },
});
const guiaPor = new Map(guias.map((g) => [g.portalClientId, g]));

// Todos os fechamentos, para responder "a competência da data do pagamento está fechada?".
const todosFech = await prisma.companyMonthlyCircular.findMany({
  where: { portalClientId: { in: ids }, fechadoContabilEm: { not: null } },
  select: { portalClientId: true, competencia: true },
});
const fechado = new Set(todosFech.map((f) => `${f.portalClientId}|${f.competencia}`));

const hoje = new Date();
const compHoje = `${hoje.getUTCFullYear()}-${String(hoje.getUTCMonth() + 1).padStart(2, "0")}`;

console.log("═".repeat(100));
console.log(`O QUE O MODAL DE BAIXA DO DAS VÊ — ${COMPETENCIA} (hoje: ${compHoje})`);
console.log("═".repeat(100));

for (const p of provisoes) {
  const c = circPor.get(p.portalClientId);
  const g = guiaPor.get(p.portalClientId);
  const comp = g?.extracted && typeof g.extracted === "object" ? g.extracted.comprovante : null;
  const acr = c?.acrescimos && typeof c.acrescimos === "object" ? c.acrescimos.DAS : null;
  const principalLinhas = (p.lines || []).filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor), 0);

  // A data que o modal propõe: a do comprovante confiável, senão HOJE.
  const m = String(comp?.dataArrecadacao || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const dataProposta = comp?.confiavel && m ? `${m[3]}-${m[2]}-${m[1]}` : hoje.toISOString().slice(0, 10);
  const compPagamento = dataProposta.slice(0, 7);
  const travaria = fechado.has(`${p.portalClientId}|${compPagamento}`);

  console.log(`\n• ${nome.get(p.portalClientId)} — status ${p.statusPagamento}`);
  console.log(`  provisão: linhas D = ${money(principalLinhas)} · circular.dasTotal = ${money(c?.dasTotal)}`);
  console.log(`  acrescimos.DAS = ${acr ? JSON.stringify(acr) : "—"}`);
  console.log(`  guia: valor ${money(g?.valor)} · original ${money(g?.valorOriginal)} · pagamento ${g?.paymentStatus || "—"}`);
  console.log(`  comprovante = ${comp ? JSON.stringify(comp) : "—"}`);
  console.log(`  data proposta pelo modal: ${dataProposta} → competência ${compPagamento}`
    + `  ${travaria ? "🔒 FECHADA → 409 MES_FECHADO" : "aberta"}`);
}

console.log("\nNada foi alterado.");
await prisma.$disconnect();

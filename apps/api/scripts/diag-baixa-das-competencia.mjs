// POR QUE A BAIXA DO DAS DE UMA COMPETÊNCIA NÃO ACONTECE — uma linha por empresa, com o motivo.
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhum DDL, nenhuma chamada externa.
//
// POR QUE ELE EXISTE
// O dono: "a circular, a baixa da junho do Simples não está funcionando, já é um bug".
// A recusa da rota `POST /entries/:id/baixa` tem QUATRO portas, e a tela da Circular não distingue
// nenhuma delas — o modal fecha e a célula continua igual. Este script diz, por empresa, QUAL das
// quatro morderia:
//
//   1. MES_FECHADO            → 409, pela competência da DATA DO PAGAMENTO (mês fechado contábil).
//   2. lancamento_nao_esta_aberto → 400, `statusPagamento` já PAGO/NA.
//   3. baixa_excede_saldo     → 400, quando o principal digitado passa do SALDO da provisão.
//                               ⚠ é aqui que o `enrichDasProvisao` importa: a CÉLULA mostra
//                               `circular.dasTotal`, e o saldo sai das LINHAS do lançamento. Quando
//                               os dois divergem, o número da tela é maior que o que a rota aceita.
//   4. (sem provisão)         → não há o que baixar; a linha do DAS é sintética.
//
// USO (Windows, sem `bash -c`):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-baixa-das-competencia.mjs 2026-06'

import { prisma } from "../src/infrastructure/db/prisma.js";

const COMPETENCIA = String(process.argv[2] || "2026-06");
const money = (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
const dia = (v) => (v ? new Date(v).toISOString().slice(0, 10) : "—");
const linha = () => console.log("─".repeat(100));

// Mesmas contas de acréscimo da rota (`CONTAS_ACRESCIMO`): juros 501 / multa 506 não amortizam.
const CONTAS_ACRESCIMO = new Set(["501", "506"]);
const r2 = (v) => Math.round(Number(v || 0) * 100) / 100;

console.log("═".repeat(100));
console.log(`BAIXA DO DAS — competência ${COMPETENCIA}`);
console.log("═".repeat(100));

// ─── As empresas do Simples ────────────────────────────────────────────────────────────────
const empresas = await prisma.$queryRaw`
  SELECT pc.id, pc.razao, pc.cnpj, co."regimeTributario"
    FROM "PortalClient" pc
    LEFT JOIN "Company" co ON co."clientId" = pc.id
   ORDER BY pc.razao`;

const doSimples = empresas.filter((e) => String(e.regimeTributario || "").toUpperCase().includes("SIMPLES"));
console.log(`\nEmpresas: ${empresas.length} · do Simples Nacional: ${doSimples.length}\n`);

// ─── Fechamento contábil da competência ────────────────────────────────────────────────────
const circulares = await prisma.companyMonthlyCircular.findMany({
  where: { competencia: COMPETENCIA },
  select: {
    portalClientId: true, competencia: true, dasTotal: true, acrescimos: true,
    fechadoContabilEm: true, fechadoContabilPor: true, semFaturamento: true,
  },
});
const circPorEmpresa = new Map(circulares.map((c) => [c.portalClientId, c]));
const fechadas = circulares.filter((c) => c.fechadoContabilEm);
console.log(`Circulares de ${COMPETENCIA}: ${circulares.length} · FECHADAS contabilmente: ${fechadas.length}`);
for (const c of fechadas) {
  const e = empresas.find((x) => x.id === c.portalClientId);
  console.log(`   🔒 ${e?.razao || c.portalClientId} — fechada em ${dia(c.fechadoContabilEm)}`);
}

// ⚠ A trava lê a competência da DATA DO PAGAMENTO, não a da provisão. Hoje é o mês corrente.
const hoje = new Date();
const compDeHoje = `${hoje.getUTCFullYear()}-${String(hoje.getUTCMonth() + 1).padStart(2, "0")}`;
const circHoje = await prisma.companyMonthlyCircular.findMany({
  where: { competencia: compDeHoje, fechadoContabilEm: { not: null } },
  select: { portalClientId: true, fechadoContabilEm: true },
});
console.log(`\nCompetência de HOJE (${compDeHoje}) fechada em ${circHoje.length} empresa(s)`);
console.log(`⚠ É ESTA que a trava lê quando a data do pagamento é hoje — a de ${COMPETENCIA} só morde`);
console.log(`  se o contador datar o pagamento dentro do próprio mês da competência.`);

// ─── As provisões de DAS da competência ────────────────────────────────────────────────────
linha();
const provisoes = await prisma.accountingEntry.findMany({
  where: { competencia: COMPETENCIA, tipo: "PROVISAO", eventType: "DAS_SIMPLES" },
  include: {
    lines: { orderBy: { ordem: "asc" } },
    baixas: { include: { lines: { orderBy: { ordem: "asc" } } } },
  },
});
console.log(`\nProvisões de DAS (eventType=DAS_SIMPLES) em ${COMPETENCIA}: ${provisoes.length}\n`);

function saldoDaProvisao(entry) {
  const principal = r2((entry.lines || []).filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor), 0));
  const abatido = r2((entry.baixas || [])
    .filter((b) => b.tipo === "BAIXA")
    .flatMap((b) => b.lines || [])
    .filter((l) => l.tipo === "D" && !CONTAS_ACRESCIMO.has(String(l.conta).trim()))
    .reduce((s, l) => s + Number(l.valor), 0));
  return { principal, abatido, saldo: r2(principal - abatido) };
}

const resumo = new Map();
for (const p of provisoes) {
  const emp = empresas.find((x) => x.id === p.portalClientId);
  const circ = circPorEmpresa.get(p.portalClientId);
  const s = saldoDaProvisao(p);
  const dasTotal = circ?.dasTotal != null ? Number(circ.dasTotal) : null;
  // O que a CÉLULA da Circular mostra (`enrichDasProvisao`) × o que a ROTA aceita (`saldo`).
  const telaMostra = dasTotal != null ? dasTotal : s.principal;
  const divergeDaTela = Math.abs(telaMostra - s.saldo) > 0.01;

  let motivo;
  if (!["ABERTO", "PARCIAL"].includes(p.statusPagamento)) {
    motivo = `LANCAMENTO_NAO_ESTA_ABERTO (statusPagamento=${p.statusPagamento})`;
  } else if (circ?.fechadoContabilEm && COMPETENCIA === compDeHoje) {
    motivo = `MES_FECHADO (a data do pagamento cairia em ${COMPETENCIA}, fechada)`;
  } else if (divergeDaTela && telaMostra - s.saldo > 0.01) {
    motivo = `BAIXA_EXCEDE_SALDO se o contador aceitar o número da TELA (${money(telaMostra)} > saldo ${money(s.saldo)})`;
  } else {
    motivo = "nada bloqueia";
  }
  resumo.set(motivo, (resumo.get(motivo) || 0) + 1);

  console.log(`   • ${emp?.razao || p.portalClientId} (${emp?.cnpj || "—"})`);
  console.log(`     entry ${p.id} · status ${p.statusPagamento} · ${p.baixas?.length || 0} baixa(s)`);
  console.log(`     linhas D = ${money(s.principal)} · abatido = ${money(s.abatido)} · SALDO = ${money(s.saldo)}`);
  console.log(`     circular.dasTotal = ${money(dasTotal)}${divergeDaTela ? "   ⚠ DIVERGE do saldo — a tela mostra um número que a rota recusa" : ""}`);
  console.log(`     fechamento contábil de ${COMPETENCIA}: ${circ?.fechadoContabilEm ? `🔒 ${dia(circ.fechadoContabilEm)}` : "aberto"}`);
  console.log(`     → ${motivo}\n`);
}

// ─── Guias de DAS sem provisão (a linha SINTÉTICA — não tem entryId para baixar) ────────────
linha();
const guiasDas = await prisma.guide.findMany({
  where: { competencia: COMPETENCIA, tipo: "SIMPLES", status: "PROCESSED", parcelamentoId: null },
  select: { id: true, portalClientId: true, valor: true, valorOriginal: true, paymentStatus: true, vencimento: true, source: true },
});
const comProvisao = new Set(provisoes.map((p) => p.portalClientId));
const semProvisao = guiasDas.filter((g) => !comProvisao.has(g.portalClientId));
console.log(`\nGuias de DAS em ${COMPETENCIA}: ${guiasDas.length} · SEM provisão contábil: ${semProvisao.length}`);
for (const g of semProvisao) {
  const emp = empresas.find((x) => x.id === g.portalClientId);
  console.log(`   ⚠ ${emp?.razao || g.portalClientId} — guia ${g.id} (${g.source || "—"}), R$ ${money(g.valor)}, pagamento ${g.paymentStatus}`);
  console.log(`     a Circular mostra a linha SINTÉTICA (dasSynthetic): não há entryId, "Dar baixa" não tem alvo real`);
}

linha();
console.log("\nRESUMO DAS PROVISÕES:\n");
for (const [m, q] of [...resumo].sort((a, b) => b[1] - a[1])) console.log(`   ${String(q).padStart(4)} × ${m}`);

console.log("\nNada foi alterado.");
await prisma.$disconnect();

// ⚠⚠ SOMENTE LEITURA. Zero chamada externa, nenhuma escrita.
//
// Relato do dono (30/08/2026): *"o painel informa que a última alíquota foi de 1,41%, isso é
// impossível, se tratando de 07/2026."*
//
// O card lê `GET /client/companies/:id/aliquotas` e, no Simples, usa `efetiva` —
// `impostosPagos / faturamento`, onde `impostosPagos` é a SOMA das guias `paymentStatus: PAID`
// daquela competência. Este script reproduz a conta da rota, linha a linha, para mostrar QUAL guia
// entrou no numerador.
//
// Uso: node scripts/diag-aliquota-do-painel.mjs "<parte do nome>" [AAAA-MM]

import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const ALVO = (process.argv[2] || "ERISANGELA").toUpperCase();
const COMP = process.argv[3] || "2026-07";
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const empresas = await p.portalClient.findMany({ select: { id: true, razao: true } });
const alvo = empresas.find((e) => String(e.razao || "").toUpperCase().includes(ALVO));
if (!alvo) { console.log("nao achei"); await p.$disconnect(); process.exit(0); }
console.log(`EMPRESA: ${alvo.razao}\nCOMPETENCIA: ${COMP}\n`);

const [y, m] = COMP.split("-").map(Number);
const notas = await p.portalInvoice.aggregate({
  where: {
    clientId: alvo.id, papel: "EMIT", statusEfetivo: "autorizada",
    competencia: { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) },
  },
  _sum: { total: true },
});
const faturamento = Number(notas._sum?.total || 0);

// ⚠ A MESMA query da rota: todas as guias PAGAS daquela competência, sem distinguir nada.
const pagas = await p.guide.findMany({
  where: { portalClientId: alvo.id, competencia: COMP, paymentStatus: "PAID" },
  select: { tipo: true, valor: true, parcelamentoId: true, numeroParcela: true, paymentConfirmedAt: true },
});

console.log("=== O NUMERADOR DE `efetiva` (guias PAGAS desta competencia) ===");
for (const g of pagas) {
  console.log(
    `  ${String(g.tipo).padEnd(10)} ${(g.parcelamentoId ? `PARCELA #${g.numeroParcela ?? "?"}` : "imposto do mes").padEnd(16)} `
    + `pago em ${g.paymentConfirmedAt?.toISOString().slice(0, 10) || "—"}  ${brl(g.valor).padStart(13)}`,
  );
}
const somaTudo = pagas.reduce((s, g) => s + Number(g.valor || 0), 0);
// ⚠⚠ A MESMA SOMA, SEM AS PARCELAS — é o recorte que `guideCompliance` já aplica no dashboard
// (`parcelamentoId: null`), e que esta rota não aplica.
const semParcela = pagas.filter((g) => !g.parcelamentoId).reduce((s, g) => s + Number(g.valor || 0), 0);

const pct = (n2, d) => (d > 0 ? ((n2 / d) * 100).toFixed(2) : "—");
console.log(`\n  faturamento da competencia .......... ${brl(faturamento)}`);
console.log(`  soma COM parcelas (a conta de hoje) . ${brl(somaTudo)}  ⇒ efetiva = ${pct(somaTudo, faturamento)}%`);
console.log(`  soma SEM parcelas ................... ${brl(semParcela)}  ⇒ efetiva = ${pct(semParcela, faturamento)}%`);

// ── A OUTRA CONTA: `deReceita` = dasExtrato / faturamento ────────────────────────────────────
const circ = await p.companyMonthlyCircular.findFirst({
  where: { portalClientId: alvo.id, competencia: COMP },
  select: { competencia: true, dasTotal: true },
}).catch(() => null);
console.log(`\n=== A OUTRA CONTA (deReceita) ===`);
console.log(`  CompanyMonthlyCircular.dasTotal ..... ${circ ? brl(circ.dasTotal) : "(sem circular)"}`);
if (circ) console.log(`  ⇒ deReceita = ${pct(Number(circ.dasTotal || 0), faturamento)}%`);

// ── A VERDADE: a apuração transmitida ─────────────────────────────────────────────────────────
const snap = await p.apuracaoSnapshot.findFirst({
  where: { portalClientId: alvo.id, competencia: COMP },
  select: { estado: true, receitaInterna: true, receitaExterna: true, dasRetornadoSerpro: true, dasSimuladoSerpro: true },
});
console.log(`\n=== A APURACAO (o numero que a RFB calculou) ===`);
if (!snap) console.log("  (nenhuma)");
else {
  const rec = (Number(snap.receitaInterna) || 0) + (Number(snap.receitaExterna) || 0);
  const das = Number(snap.dasRetornadoSerpro) || Number(snap.dasSimuladoSerpro) || 0;
  console.log(`  estado=${snap.estado}  receita=${brl(rec)}  DAS=${brl(das)}  ⇒ ${pct(das, rec)}%`);
}

await p.$disconnect();

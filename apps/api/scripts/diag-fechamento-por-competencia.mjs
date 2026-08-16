// QUAIS COMPETÊNCIAS ESTÃO FECHADAS CONTABILMENTE — e quantas empresas em cada.
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhum DDL, nenhuma chamada externa.
//
// POR QUE ELE EXISTE
// Toda trava de `MES_FECHADO` de baixa lê a competência da **DATA DO PAGAMENTO**, não a da
// provisão. O DAS de junho vence em 20/07 e é pago em julho — então quem decide se a baixa da
// competência 2026-06 passa é o fechamento de **2026-07** (ou o do mês do clique, quando o
// contador data o pagamento em "hoje"). Confundir as duas leva a investigar a competência errada.
//
// USO:
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-fechamento-por-competencia.mjs'

import { prisma } from "../src/infrastructure/db/prisma.js";

// ⚠ Via client do Prisma, não SQL cru: o nome físico da tabela não é o do model.
const circulares = await prisma.companyMonthlyCircular.findMany({
  where: { competencia: { gte: "2026-01" } },
  select: { competencia: true, fechadoContabilEm: true },
});
const porComp = new Map();
for (const c of circulares) {
  if (!porComp.has(c.competencia)) porComp.set(c.competencia, { competencia: c.competencia, total: 0, fechadas: 0, datas: [] });
  const g = porComp.get(c.competencia);
  g.total += 1;
  if (c.fechadoContabilEm) { g.fechadas += 1; g.datas.push(c.fechadoContabilEm); }
}
const linhas = [...porComp.values()]
  .sort((a, b) => a.competencia.localeCompare(b.competencia))
  .map((g) => ({
    ...g,
    primeira: g.datas.length ? new Date(Math.min(...g.datas.map((d) => +d))) : null,
    ultima: g.datas.length ? new Date(Math.max(...g.datas.map((d) => +d))) : null,
  }));

console.log("═".repeat(88));
console.log("FECHAMENTO CONTÁBIL POR COMPETÊNCIA");
console.log("═".repeat(88));
console.log("\ncompet.   circulares  FECHADAS   fechada de … até");
for (const l of linhas) {
  const d = (v) => (v ? new Date(v).toISOString().slice(0, 10) : "—");
  console.log(
    `${l.competencia}   ${String(Number(l.total)).padStart(9)}  ${String(Number(l.fechadas)).padStart(8)}   ${d(l.primeira)} … ${d(l.ultima)}`,
  );
}

// O que a baixa do DAS de uma competência enxerga: quem paga no mês do vencimento (mês seguinte).
console.log("\nO QUE A TRAVA DA BAIXA LÊ (competência da DATA DO PAGAMENTO):\n");
for (const l of linhas) {
  const [a, m] = l.competencia.split("-").map(Number);
  const prox = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
  const alvo = linhas.find((x) => x.competencia === prox);
  if (!alvo) continue;
  const bloqueia = Number(alvo.fechadas);
  console.log(
    `   DAS de ${l.competencia} pago em ${prox} → ${bloqueia} empresa(s) receberiam 409 MES_FECHADO` +
      (bloqueia ? "   ⚠" : ""),
  );
}

console.log("\nNada foi alterado.");
await prisma.$disconnect();

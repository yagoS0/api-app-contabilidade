// ⚠⚠ SOMENTE LEITURA. Relato do dono (30/08/2026): *"apareceram impostos que estão pagos na
// circular e lançados em lançamentos como aberto"*.
//
// A guia tem `paymentStatus`; a PROVISÃO contábil dela tem `statusPagamento`. A Circular e a aba
// Lançamentos leem o SEGUNDO. Este script mede onde os dois discordam e por quê.
//
// ⚠ Ele NÃO julga: a discordância pode ser a regra (confirmação do CLIENTE não alcança o contábil,
// por decisão do dono em 27/08/2026). O que importa é separar as duas populações.
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

const pagas = await p.guide.findMany({
  where: { paymentStatus: "PAID" },
  select: {
    id: true, competencia: true, tipo: true, valor: true, paymentStatusSource: true,
    paymentConfirmedAt: true, baixada: true, parcelamentoId: true,
    portalClient: { select: { razao: true } },
  },
});
console.log(`${pagas.length} guias PAGAS\n`);

const provisoes = await p.accountingEntry.findMany({
  where: { tipo: "PROVISAO", sourceGuideId: { in: pagas.map((g) => g.id) } },
  select: { id: true, sourceGuideId: true, statusPagamento: true, eventType: true, competencia: true, baixas: { select: { id: true } } },
});
const porGuia = new Map();
for (const e of provisoes) {
  const l = porGuia.get(e.sourceGuideId) || [];
  l.push(e); porGuia.set(e.sourceGuideId, l);
}

let semProvisao = 0, todasPagas = 0;
const discordam = [];
for (const g of pagas) {
  const ps = porGuia.get(g.id) || [];
  if (!ps.length) { semProvisao += 1; continue; }
  const abertas = ps.filter((e) => e.statusPagamento !== "PAGO");
  if (!abertas.length) { todasPagas += 1; continue; }
  discordam.push({ g, abertas, total: ps.length });
}
console.log(`guia paga SEM provisão nenhuma: ${semProvisao}`);
console.log(`guia paga com TODAS as provisões PAGO: ${todasPagas}`);
console.log(`⚠ guia paga com provisão AINDA ABERTA: ${discordam.length}\n`);

console.log("empresa".padEnd(27), "tipo".padEnd(8), "comp".padEnd(8), "valor".padStart(13), "fonte".padEnd(8), "pago em".padEnd(11), "baixada", "provisões abertas");
for (const d of discordam) {
  console.log(
    String(d.g.portalClient?.razao || "").slice(0, 26).padEnd(27),
    String(d.g.tipo).padEnd(8), String(d.g.competencia).padEnd(8), brl(d.g.valor).padStart(13),
    String(d.g.paymentStatusSource || "—").padEnd(8), dia(d.g.paymentConfirmedAt).padEnd(11),
    String(Boolean(d.g.baixada)).padEnd(7),
    `${d.abertas.length}/${d.total}`,
    d.abertas.map((a) => `${a.eventType}:${a.statusPagamento}${a.baixas.length ? "(tem baixa)" : ""}`).join(" ")
  );
}

// A distribuição por procedência é o que separa "é a regra" de "é defeito".
const porFonte = new Map();
for (const d of discordam) {
  const k = d.g.paymentStatusSource || "(sem)";
  porFonte.set(k, (porFonte.get(k) || 0) + 1);
}
console.log("\ndiscordam, por procedência do pagamento:", [...porFonte].map(([k, v]) => `${k} = ${v}`).join(" · "));
console.log("⚠ CLIENTE discordar é a REGRA (a confirmação do cliente não alcança o contábil).");
console.log("⚠ SERPRO e MANUAL discordarem NÃO é: esses deveriam ter promovido a provisão.");
await p.$disconnect();

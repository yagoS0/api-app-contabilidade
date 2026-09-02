// ⚠⚠ SOMENTE LEITURA. Relato do dono (30/08/2026): *"ao clicar em confirmar pagamento, o pagamento
// foi posto no dia 30 de agosto mesmo não sendo verdade"*.
//
// `Guide.paymentConfirmedAt` é o campo que o FLUXO usa como **o dia em que o dinheiro saiu**
// (`FluxoDeCaixaService.linhasDasGuias`: mês e dia saem dele). Três caminhos o gravam com
// `new Date()` — o instante do CLIQUE, não o do pagamento. Este script mede o estrago e diz onde
// existe a data VERDADEIRA guardada ao lado.
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

const pagas = await p.guide.findMany({
  where: { paymentStatus: "PAID" },
  select: {
    id: true, competencia: true, tipo: true, valor: true, vencimento: true,
    paymentConfirmedAt: true, paymentStatusSource: true, clienteConfirmouEm: true, extracted: true,
    portalClient: { select: { razao: true } },
  },
  orderBy: { paymentConfirmedAt: "desc" },
});
console.log(`${pagas.length} guias PAGAS na base\n`);

let semData = 0, comComprovante = 0, divergem = 0;
const porFonte = new Map();
for (const g of pagas) {
  porFonte.set(g.paymentStatusSource, (porFonte.get(g.paymentStatusSource) || 0) + 1);
  if (!g.paymentConfirmedAt) semData += 1;
  const arre = g.extracted?.comprovante?.dataArrecadacao || null;
  if (arre) {
    comComprovante += 1;
    // dataArrecadacao vem em dd/mm/aaaa (BR). Compara só o DIA.
    const [d, m, y] = String(arre).split("/");
    const iso = y && m && d ? `${y}-${m}-${d}` : null;
    if (iso && g.paymentConfirmedAt && iso !== dia(g.paymentConfirmedAt)) divergem += 1;
  }
}
console.log("por procedência:", [...porFonte].map(([k, v]) => `${k} = ${v}`).join(" · "));
console.log(`sem data nenhuma: ${semData}`);
console.log(`com comprovante SERPRO guardado (dataArrecadacao): ${comComprovante}`);
console.log(`⚠ e onde o comprovante DISCORDA do paymentConfirmedAt: ${divergem}\n`);

console.log("=== AS QUE TÊM COMPROVANTE: a data gravada × a data REAL da arrecadação ===");
for (const g of pagas) {
  const arre = g.extracted?.comprovante?.dataArrecadacao;
  if (!arre) continue;
  console.log(
    String(g.portalClient?.razao || "").slice(0, 26).padEnd(27),
    String(g.tipo).padEnd(8), String(g.competencia).padEnd(8), brl(g.valor).padStart(13),
    "gravado", dia(g.paymentConfirmedAt), " arrecadação", String(arre).padEnd(11),
    String(g.paymentStatusSource)
  );
}

console.log("\n=== AS 12 MAIS RECENTES, por data GRAVADA ===");
for (const g of pagas.slice(0, 12)) {
  console.log(
    String(g.portalClient?.razao || "").slice(0, 26).padEnd(27),
    String(g.tipo).padEnd(8), String(g.competencia).padEnd(8), brl(g.valor).padStart(13),
    "gravado", dia(g.paymentConfirmedAt),
    "venc", dia(g.vencimento),
    String(g.paymentStatusSource).padEnd(8),
    g.clienteConfirmouEm ? `cliente clicou ${dia(g.clienteConfirmouEm)}` : ""
  );
}
await p.$disconnect();

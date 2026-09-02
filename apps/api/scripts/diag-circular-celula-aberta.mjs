// ⚠⚠ SOMENTE LEITURA. *"impostos que estão pagos ... aparecem como aberto"* (dono, 30/08/2026).
//
// Reproduz o RAMO que a Circular usa para decidir a cor da célula, que é diferente por linha:
//
//  • DAS  → se existe PROVISÃO real (`DAS_SIMPLES`/subtipo DAS) naquele mês, é ELA que manda, e ela
//           fica PAGO quando tem baixa (ligada por `openEntryId`). Só quando NÃO existe provisão a
//           Circular sintetiza a partir da GUIA — e a sintética só fica PAGA com uma BAIXA ligada
//           por `sourceGuideId`.
//  • INSS → é SEMPRE sintética (não há provisão automática de INSS), logo SEMPRE depende de uma
//           BAIXA com `sourceGuideId`.
//
// ⚠ As duas primeiras versões deste diagnóstico erraram o pareamento (uma comparou a competência do
// LANÇAMENTO com a da GUIA; a outra ignorou que a baixa da provisão liga por `openEntryId`). Fica
// escrito porque o erro é fácil de repetir: nesta base há TRÊS vínculos diferentes em jogo.
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

const guias = await p.guide.findMany({
  where: { paymentStatus: "PAID", tipo: { in: ["INSS", "SIMPLES"] }, status: "PROCESSED", parcelamentoId: null },
  select: { id: true, tipo: true, competencia: true, valor: true, portalClientId: true,
            paymentStatusSource: true, paymentConfirmedAt: true, portalClient: { select: { razao: true } } },
});
const provisoes = await p.accountingEntry.findMany({
  where: { tipo: "PROVISAO", OR: [{ eventType: "DAS_SIMPLES" }, { subtipo: "DAS" }] },
  select: { id: true, portalClientId: true, competencia: true, statusPagamento: true },
});
const baixasLigadas = await p.accountingEntry.findMany({
  where: { tipo: "BAIXA", sourceGuideId: { not: null } },
  select: { sourceGuideId: true },
});
const temBaixaDaGuia = new Set(baixasLigadas.map((b) => b.sourceGuideId));
const provPorChave = new Map();
for (const e of provisoes) provPorChave.set(`${e.portalClientId}|${e.competencia}`, e);

const abertas = [];
const pagas = [];
for (const g of guias) {
  let ramo, status;
  if (g.tipo === "SIMPLES") {
    const prov = provPorChave.get(`${g.portalClientId}|${g.competencia}`);
    if (prov) { ramo = "provisão real"; status = prov.statusPagamento; }
    else { ramo = "sintética (sem provisão)"; status = temBaixaDaGuia.has(g.id) ? "PAGO" : "ABERTO"; }
  } else {
    ramo = "sintética (INSS sempre)";
    status = temBaixaDaGuia.has(g.id) ? "PAGO" : "ABERTO";
  }
  (status === "PAGO" ? pagas : abertas).push({ g, ramo, status });
}
console.log(`${guias.length} guias INSS/SIMPLES pagas (fora parcelamento)\n`);
console.log(`célula PAGA:   ${pagas.length}`);
console.log(`célula ABERTA: ${abertas.length}  ⚠ pagas na guia, abertas na Circular\n`);

const porRamo = new Map();
for (const a of abertas) porRamo.set(a.ramo, (porRamo.get(a.ramo) || 0) + 1);
console.log("as abertas, por RAMO:", [...porRamo].map(([k, v]) => `${k} = ${v}`).join(" · "), "\n");

console.log("empresa".padEnd(27), "tipo".padEnd(8), "comp".padEnd(9), "valor".padStart(13), "fonte".padEnd(8), "pago em".padEnd(11), "ramo");
for (const a of abertas) {
  console.log(
    String(a.g.portalClient?.razao || "").slice(0, 26).padEnd(27),
    String(a.g.tipo).padEnd(8), String(a.g.competencia).padEnd(9), brl(a.g.valor).padStart(13),
    String(a.g.paymentStatusSource || "—").padEnd(8), dia(a.g.paymentConfirmedAt).padEnd(11), a.ramo
  );
}
await p.$disconnect();

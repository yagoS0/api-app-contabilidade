// ⚠⚠ ESTE SCRIPT ESCREVE. POR PADRÃO ELE NÃO ESCREVE NADA — só mostra o que faria.
//
// Conserta o PASSADO de *"impostos que estão pagos na circular e lançados em lançamentos como
// aberto"* (dono, 30/08/2026). O código já foi corrigido: a rota de baixa passou a quitar a guia.
// Isto é o histórico, das baixas lançadas ANTES do conserto.
//
// ⚠ Usa a MESMA regra pura da rota (`guides/lib/guiaQuitadaPelaBaixa.js`) — não uma segunda
// leitura. Duas regras para a mesma decisão divergem na primeira correção.
//
// ## As travas
//  1. **DRY-RUN por padrão** (sem `--aplicar` nada muda).
//  2. Só provisão com `statusPagamento: "PAGO"` — parcial não quita.
//  3. **Nunca rebaixa**: guia já `PAID` não é tocada.
//  4. A data do pagamento é a **da baixa** (o dia que foi para o razão), nunca o relógio de agora.
//  5. Parcela de parcelamento fica de fora (a regra pura já a exclui).
//
// Uso:  node scripts/quitar-guias-com-baixa-lancada.mjs [--aplicar]

import { PrismaClient } from "@prisma/client";
import { guiaQuitadaPelaBaixa } from "../src/application/guides/lib/guiaQuitadaPelaBaixa.js";

const p = new PrismaClient();
const APLICAR = process.argv.includes("--aplicar");
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

const provisoes = await p.accountingEntry.findMany({
  where: { tipo: "PROVISAO", statusPagamento: "PAGO" },
  select: {
    id: true, portalClientId: true, competencia: true, eventType: true, subtipo: true,
    sourceGuideId: true, portalClient: { select: { razao: true } },
    baixas: { select: { id: true, data: true, historico: true }, orderBy: { data: "asc" } },
  },
});
console.log(APLICAR ? "MODO: APLICANDO\n" : "MODO: só mostrando (use --aplicar para gravar)\n");

let semAlvo = 0, jaPagas = 0, semBaixa = 0, gravadas = 0;
const aQuitar = [];
for (const e of provisoes) {
  const { alvo } = guiaQuitadaPelaBaixa({ provisao: e, novoStatus: "PAGO" });
  if (!alvo) { semAlvo += 1; continue; }
  // ⚠ Sem baixa não há data de pagamento a usar — e sem data não se quita. A provisão pode estar
  // PAGO por outro caminho (parcelamento, INSS), e ali a guia tem dono próprio.
  if (!e.baixas.length) { semBaixa += 1; continue; }
  const guia = await p.guide.findFirst({
    where: alvo.guideId ? { id: alvo.guideId } : { ...alvo, status: "PROCESSED" },
    select: { id: true, tipo: true, competencia: true, valor: true, paymentStatus: true, liberadaCliente: true },
  });
  if (!guia) { semAlvo += 1; continue; }
  if (guia.paymentStatus === "PAID") { jaPagas += 1; continue; }
  aQuitar.push({ e, guia, quando: e.baixas[0].data });
}

console.log("empresa".padEnd(27), "tipo".padEnd(8), "comp".padEnd(9), "valor".padStart(13), "de".padEnd(7), "pago em", "  cliente vê");
for (const { e, guia, quando } of aQuitar) {
  console.log(
    String(e.portalClient?.razao || "").slice(0, 26).padEnd(27),
    String(guia.tipo).padEnd(8), String(guia.competencia).padEnd(9), brl(guia.valor).padStart(13),
    String(guia.paymentStatus).padEnd(7), dia(quando), "  ", guia.liberadaCliente ? "SIM" : "não"
  );
  if (APLICAR) {
    await p.guide.update({
      where: { id: guia.id },
      data: {
        paymentStatus: "PAID",
        paymentStatusSource: "MANUAL",
        paymentConfirmedAt: quando,
        serproLastCheckResult: "MANUAL_CONFIRMED",
      },
    });
    gravadas += 1;
  }
}
console.log(`\na quitar: ${aQuitar.length} · guia já paga: ${jaPagas} · sem guia/alvo: ${semAlvo} · provisão sem baixa: ${semBaixa}`);
console.log(APLICAR ? `GRAVADAS: ${gravadas}` : "nada foi gravado.");
await p.$disconnect();

// Gera AccountingEntry (tipo=PROVISAO) a partir de uma Guide processada.
// Decisões alinhadas com o usuário:
//  - INSS continua manual (skip).
//  - SIMPLES tem fluxo próprio via PGDAS (skip).
//  - DARF com composição (PIS+COFINS etc): cria N entries (1 por tributo), idempotente
//    por (sourceGuideId, eventType). Cada entry com eventType específico permite memorizar
//    D/C por tributo via AccountingHistorico.
//  - DARF simples (sem composição) ou tipos específicos (PIS, COFINS, IRPJ, CSLL, ISS): 1 entry.

import { prisma } from "../../infrastructure/db/prisma.js";
import { lookupAccountsFromHistorico } from "./AccountingEntryGeneratorService.js";

// Mapeia o tipo do Guide (campo guide.tipo) para o eventType padrão quando não há composição.
const TIPO_GUIDE_TO_EVENT = Object.freeze({
  DARF: "DARF_OUTROS",
  PIS: "DARF_PIS",
  COFINS: "DARF_COFINS",
  IRPJ: "DARF_IRPJ",
  CSLL: "DARF_CSLL",
  ISS: "DARF_ISS",
});

// Códigos de receita federal (DARF) → eventType específico
export const CODIGO_RECEITA_TO_EVENT = Object.freeze({
  "2089": "DARF_IRPJ", "2362": "DARF_IRPJ", "2456": "DARF_IRPJ", "0220": "DARF_IRPJ",
  "2372": "DARF_CSLL", "2484": "DARF_CSLL", "6012": "DARF_CSLL",
  "8109": "DARF_PIS",
  "2172": "DARF_COFINS",
});

// Mapeia eventType DARF_* → subtipo da matriz Circular
export const EVENT_TO_SUBTIPO = Object.freeze({
  DARF_PIS: "PIS_COFINS",
  DARF_COFINS: "PIS_COFINS",
  DARF_IRPJ: "IRPJ",
  DARF_CSLL: "CSLL",
  DARF_ISS: "ISS",
  DARF_OUTROS: "OUTROS_TRIBUTOS",
});

function pickEventType(tipoUpper, codigo) {
  if (codigo && CODIGO_RECEITA_TO_EVENT[codigo]) return CODIGO_RECEITA_TO_EVENT[codigo];
  return TIPO_GUIDE_TO_EVENT[tipoUpper] || "DARF_OUTROS";
}

/**
 * Gera AccountingEntry(s) a partir de uma Guide.
 * Idempotente: usa upsert por unique (sourceGuideId, eventType).
 * Best-effort: chamadores devem envolver com try/catch (não derrubar fluxo principal).
 */
export async function generateProvisionsFromGuide({ guideId, tx = null }) {
  const client = tx || prisma;
  const guide = await client.guide.findUnique({ where: { id: String(guideId) } });
  if (!guide) return { ok: false, reason: "guide_not_found" };
  if (guide.status !== "PROCESSED") return { ok: false, reason: "not_processed" };
  if (!guide.portalClientId) return { ok: false, reason: "no_company" };
  if (!guide.competencia) return { ok: false, reason: "no_competencia" };

  const tipoUpper = String(guide.tipo || "").toUpperCase();

  // Decisões do usuário: INSS manual + SIMPLES via PGDAS
  if (tipoUpper === "INSS") return { ok: true, skipped: "inss_manual_rule", entries: [] };
  if (tipoUpper === "SIMPLES") return { ok: true, skipped: "simples_via_pgdas", entries: [] };

  const composicao = Array.isArray(guide.extracted?.composicao) ? guide.extracted.composicao : [];

  const linhas = composicao.length > 0
    ? composicao
        .filter((c) => Number(c?.total) > 0)
        .map((c) => ({
          eventType: pickEventType(tipoUpper, c.codigo),
          valor: Number(c.total),
          codigo: c.codigo || null,
          denominacao: c.denominacao || null,
        }))
    : (Number(guide.valor) > 0 ? [{
        eventType: pickEventType(tipoUpper, null),
        valor: Number(guide.valor),
        codigo: null,
        denominacao: null,
      }] : []);

  if (linhas.length === 0) return { ok: true, skipped: "no_value", entries: [] };

  // Data padrão = vencimento da guia, ou último dia da competência
  const defaultDate = (() => {
    if (guide.vencimento) return new Date(guide.vencimento);
    const [yyyy, mm] = String(guide.competencia).split("-").map(Number);
    return new Date(Date.UTC(yyyy, mm, 0, 23, 59, 59, 999));
  })();

  const isPaid = String(guide.paymentStatus || "").toUpperCase() === "PAID";
  const origem = String(guide.source || "").toUpperCase() === "SERPRO" ? "SERPRO" : "UPLOAD";
  const loteImportacao = `GUIDE-${String(guide.id).slice(0, 8)}`;

  // Executa em transação (se chamador não passou tx)
  async function run(ctx) {
    const created = [];
    for (const l of linhas) {
      const subtipo = EVENT_TO_SUBTIPO[l.eventType] || "OUTROS_TRIBUTOS";
      const historico = l.codigo
        ? `${subtipo} - ${guide.competencia} (cód ${l.codigo})`
        : `${subtipo} - ${guide.competencia}`;

      // Lookup contas memorizadas (vazio se nunca foi preenchido)
      const memorized = await lookupAccountsFromHistorico(ctx, {
        portalClientId: guide.portalClientId,
        eventType: l.eventType,
      });
      const debitConta = memorized.debitAccountCode || "";
      const creditConta = memorized.creditAccountCode || "";

      // Tenta encontrar entry existente (idempotência por sourceGuideId+eventType).
      const existing = await ctx.accountingEntry.findUnique({
        where: { uniq_entry_per_guide_event: { sourceGuideId: guide.id, eventType: l.eventType } },
        include: { lines: true },
      });

      if (!existing) {
        const entry = await ctx.accountingEntry.create({
          data: {
            portalClientId: guide.portalClientId,
            sourceGuideId: guide.id,
            eventType: l.eventType,
            data: defaultDate,
            competencia: guide.competencia,
            historico,
            tipo: "PROVISAO",
            subtipo,
            origem,
            loteImportacao,
            status: "RASCUNHO",
            statusPagamento: isPaid ? "PAGO" : "ABERTO",
            lines: {
              createMany: {
                data: [
                  { conta: debitConta, tipo: "D", valor: l.valor, ordem: 0 },
                  { conta: creditConta, tipo: "C", valor: l.valor, ordem: 1 },
                ],
              },
            },
          },
          include: { lines: true },
        });
        created.push({ entryId: entry.id, eventType: l.eventType, valor: l.valor, action: "created" });
        continue;
      }

      // Existente: só atualiza valor/lines se ainda RASCUNHO e o valor mudou.
      if (existing.status === "EXPORTADO") {
        created.push({ entryId: existing.id, eventType: l.eventType, valor: l.valor, action: "skipped_exported" });
        continue;
      }

      const prevD = existing.lines.find((ln) => ln.tipo === "D");
      const prevC = existing.lines.find((ln) => ln.tipo === "C");
      const prevValor = Number(prevD?.valor || 0);
      const valorChanged = Math.abs(prevValor - l.valor) > 0.01;

      if (valorChanged) {
        // Preserva contas já preenchidas; senão usa memorizadas (debitConta/creditConta acima).
        const finalDebit = (prevD?.conta && String(prevD.conta).trim()) ? prevD.conta : debitConta;
        const finalCredit = (prevC?.conta && String(prevC.conta).trim()) ? prevC.conta : creditConta;

        await ctx.accountingEntryLine.deleteMany({ where: { entryId: existing.id } });
        await ctx.accountingEntryLine.createMany({
          data: [
            { entryId: existing.id, conta: finalDebit, tipo: "D", valor: l.valor, ordem: 0 },
            { entryId: existing.id, conta: finalCredit, tipo: "C", valor: l.valor, ordem: 1 },
          ],
        });
        await ctx.accountingEntry.update({
          where: { id: existing.id },
          data: {
            data: defaultDate,
            competencia: guide.competencia,
            recalculatedAt: new Date(),
            recalculatedFromValor: prevValor,
            recalculatedToValor: l.valor,
            recalculatedNotes: "Guia atualizada — valor recalculado.",
            statusPagamento: isPaid ? "PAGO" : existing.statusPagamento,
          },
        });
        created.push({ entryId: existing.id, eventType: l.eventType, valor: l.valor, action: "updated" });
      } else {
        // Mantém o paymentStatus em sincronia
        if (isPaid && existing.statusPagamento !== "PAGO") {
          await ctx.accountingEntry.update({
            where: { id: existing.id },
            data: { statusPagamento: "PAGO" },
          });
        }
        created.push({ entryId: existing.id, eventType: l.eventType, valor: l.valor, action: "noop" });
      }
    }
    return created;
  }

  const entries = tx ? await run(tx) : await prisma.$transaction((t) => run(t));
  return { ok: true, entries };
}

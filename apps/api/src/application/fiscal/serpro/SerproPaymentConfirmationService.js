import { prisma } from "../../../infrastructure/db/prisma.js";
import { GuideStorageService } from "../../guides/GuideStorageService.js";
import {
  isGuidePaid,
  markGuidePaidByComprovante,
  markGuideOpenBySerpro,
} from "../../guides/GuidePaymentStatusService.js";
import { gerarPagamentoInssFromGuide } from "../../accounting/InssPagamentoService.js";
import { gerarPagamentoParcelaFromGuide } from "../../accounting/parcelamento/ParcelamentoV2Service.js";
import { confirmarPagamento } from "./SerproPagtoWebService.js";

// Q40 Fase A/B: confirmação de pagamento de guias via comprovante oficial (PAGTOWEB).
// O número do documento (DAS/DARF/INSS) fica em guide.extracted.numeroDocumento (não é coluna).

function getGuideNumeroDocumento(guide) {
  const extracted = guide?.extracted && typeof guide.extracted === "object" ? guide.extracted : {};
  const raw = extracted.numeroDocumento ?? extracted.numeroDoc ?? extracted.numeroDas ?? null;
  const doc = String(raw || "").trim();
  return doc || null;
}

function maskCnpj(cnpj) {
  const d = String(cnpj || "").replace(/\D+/g, "");
  if (d.length !== 14) return "***";
  return `**.***.***/${d.slice(8, 12)}-**`;
}

/**
 * Confirma o pagamento de uma guia consultando o comprovante no SERPRO (PAGTOWEB).
 * - pago → marca PAID + grava o comprovante (PDF) + dispara a baixa contábil (best-effort, idempotente).
 * - não pago → marca OPEN (mantém em aberto).
 * Idempotente: guia já PAID → skip. Guia sem numeroDocumento → skip.
 */
export async function confirmarPagamentoGuia({ guideId, userId = null, logger = null }) {
  const guide = await prisma.guide.findUnique({
    where: { id: String(guideId) },
    include: { portalClient: { select: { id: true, cnpj: true } } },
  });
  if (!guide) return { ok: false, skipped: "guide_not_found" };
  if (isGuidePaid(guide)) return { ok: true, skipped: "already_paid", guideId: guide.id };

  const numeroDocumento = getGuideNumeroDocumento(guide);
  if (!numeroDocumento) return { ok: true, skipped: "sem_numero_documento", guideId: guide.id };

  const contribuinteCnpj = guide.portalClient?.cnpj || guide.cnpj;
  if (!contribuinteCnpj) return { ok: false, skipped: "sem_cnpj", guideId: guide.id };

  let result;
  try {
    result = await confirmarPagamento({ contribuinteCnpj, numeroDocumento });
  } catch (err) {
    logger?.warn?.(
      { code: err?.code, cnpj: maskCnpj(contribuinteCnpj), guideId: guide.id },
      "PAGTOWEB: falha ao consultar comprovante",
    );
    throw err;
  }

  if (!result.pago) {
    await markGuideOpenBySerpro({ guideId: guide.id });
    return { ok: true, pago: false, guideId: guide.id, mensagem: result.mensagem };
  }

  // Grava o comprovante (PDF) quando veio.
  let comprovantePdfFileId = null;
  if (result.comprovantePdfBuffer?.length) {
    try {
      const storage = GuideStorageService.create();
      const key = `serpro/comprovante/${guide.portalClientId || "sem-empresa"}/${guide.competencia || "sem-comp"}/${Date.now()}.pdf`;
      const uploaded = await storage.upload({ key, buffer: result.comprovantePdfBuffer, contentType: "application/pdf" });
      comprovantePdfFileId = uploaded.key;
    } catch (err) {
      logger?.warn?.({ err: err?.message, guideId: guide.id }, "PAGTOWEB: falha ao salvar comprovante (segue)");
    }
  }

  await markGuidePaidByComprovante({ guideId: guide.id, comprovantePdfFileId });

  // Baixa contábil (best-effort, idempotente): INSS e parcelas geram lançamento de pagamento —
  // mesmo comportamento do "pago" manual, agora automático via cron.
  const tipoUpper = String(guide.tipo || "").toUpperCase();
  try {
    if (guide.parcelamentoId) {
      await gerarPagamentoParcelaFromGuide({ portalClientId: guide.portalClientId, guideId: guide.id, userId });
    } else if (tipoUpper === "INSS") {
      await gerarPagamentoInssFromGuide({ portalClientId: guide.portalClientId, guideId: guide.id, userId });
    }
  } catch (err) {
    logger?.warn?.({ err: err?.message, guideId: guide.id }, "PAGTOWEB: baixa contábil não gerada (segue)");
  }

  return { ok: true, pago: true, guideId: guide.id, comprovantePdfFileId };
}

/**
 * Lista as guias SERPRO ainda em aberto (com numeroDocumento) e confirma o pagamento de cada uma.
 * Usado pelo worker (cron próprio) e pelo disparo manual (run-now / botão por empresa).
 * @param {object} opts
 * @param {string} [opts.portalClientId] limita a uma empresa (botão por empresa)
 * @param {string} [opts.competencia] limita a uma competência
 */
export async function runPaymentConfirmationOnce({ portalClientId = null, competencia = null, userId = null, logger = null } = {}) {
  const where = {
    source: "SERPRO",
    status: "PROCESSED",
    paymentStatus: { in: ["OPEN", "OVERDUE"] },
    tipo: { in: ["SIMPLES", "INSS"] },
    ...(portalClientId ? { portalClientId: String(portalClientId) } : {}),
    ...(competencia ? { competencia: String(competencia) } : {}),
  };

  const guides = await prisma.guide.findMany({
    where,
    select: { id: true, tipo: true, competencia: true, extracted: true, portalClientId: true },
    orderBy: { updatedAt: "asc" },
    take: 500,
  });

  const results = [];
  let firstError = null; // Q43: 1º código de erro — para o chamador sinalizar falha (não reportar OK falso)
  for (const g of guides) {
    // Só guias com numeroDocumento (extracted JSON) — pula as demais sem custo de chamada SERPRO.
    const numeroDocumento = getGuideNumeroDocumento(g);
    if (!numeroDocumento) {
      results.push({ guideId: g.id, status: "sem_numero_documento" });
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await confirmarPagamentoGuia({ guideId: g.id, userId, logger });
      results.push({ guideId: g.id, status: r.skipped || (r.pago ? "paid" : "open") });
    } catch (err) {
      const code = err?.code || err?.message || "ERRO";
      if (!firstError) firstError = code;
      results.push({ guideId: g.id, status: "error", error: code });
    }
  }

  return {
    total: guides.length,
    paid: results.filter((r) => r.status === "paid").length,
    open: results.filter((r) => r.status === "open").length,
    errors: results.filter((r) => r.status === "error").length,
    firstError,
    results,
  };
}

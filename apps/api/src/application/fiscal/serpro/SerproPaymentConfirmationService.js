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
import { consultarDasIndexPorCompetencia } from "./SerproPgdasDeclaracaoService.js";
import { INTEGRACAO_SERPRO_PAGTOWEB } from "../../../config.js";

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

  const contribuinteCnpj = guide.portalClient?.cnpj || guide.cnpj;
  if (!contribuinteCnpj) return { ok: false, skipped: "sem_cnpj", guideId: guide.id };

  const tipoUpper = String(guide.tipo || "").toUpperCase();

  // Q46: DAS (Simples) — sinal de pago AUTORITATIVO vem do `dasPago` (CONSDECLARACAO13), não do PAGTOWEB.
  if (tipoUpper === "SIMPLES") {
    return confirmarPagamentoDas({ guide, contribuinteCnpj, userId, logger });
  }

  // Q46: INSS (e demais) — confirma via PAGTOWEB pelo numeroDocumento do DARF (GERARGUIA31).
  const numeroDocumento = getGuideNumeroDocumento(guide);
  if (!numeroDocumento) return { ok: true, skipped: "sem_numero_documento", guideId: guide.id };

  let result;
  try {
    result = await confirmarPagamento({ contribuinteCnpj, numeroDocumento, logger });
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

  const comprovantePdfFileId = await salvarComprovante({ guide, result, logger });
  await markGuidePaidByComprovante({ guideId: guide.id, comprovantePdfFileId });
  await gerarBaixaSePreciso({ guide, userId, logger });
  return { ok: true, pago: true, guideId: guide.id, comprovantePdfFileId };
}

/**
 * Q46: confirma o pagamento do DAS (Simples). O sinal de pago é o `dasPago` do índice PGDAS-D
 * (CONSDECLARACAO13) — prefere o valor já gravado na CompanyMonthlyCircular (Q17, sem custo); se
 * faltar, consulta on-demand. O PAGTOWEB só é chamado (se ligado) para BUSCAR O COMPROVANTE, com o
 * numeroDocumento CORRETO (dasNumeroDocumento), não o heurístico do GERARDAS.
 */
async function confirmarPagamentoDas({ guide, contribuinteCnpj, userId, logger }) {
  let numeroDocumento = null;
  let dasPago = null;

  const circ = (guide.competencia && guide.portalClientId)
    ? await prisma.companyMonthlyCircular.findFirst({
        where: { portalClientId: guide.portalClientId, competencia: guide.competencia },
        select: { dasNumeroDocumento: true, dasPago: true },
      }).catch(() => null)
    : null;
  if (circ && (circ.dasNumeroDocumento || circ.dasPago != null)) {
    numeroDocumento = circ.dasNumeroDocumento || null;
    dasPago = circ.dasPago;
  }

  // Sem sinal na circular → consulta o índice do DAS on-demand (barato; /Consultar).
  if (dasPago == null && guide.competencia) {
    try {
      const idx = await consultarDasIndexPorCompetencia({
        portalClientId: guide.portalClientId, competencia: guide.competencia, contribuinteCnpj,
      });
      if (idx) { numeroDocumento = numeroDocumento || idx.numeroDocumento; dasPago = idx.dasPago; }
    } catch (err) {
      logger?.warn?.({ code: err?.code || err?.message, guideId: guide.id }, "DAS: falha ao consultar índice (CONSDECLARACAO13)");
    }
  }
  numeroDocumento = numeroDocumento || getGuideNumeroDocumento(guide);

  if (dasPago == null) {
    return { ok: true, pago: false, guideId: guide.id, mensagem: "Não foi possível consultar o pagamento do DAS (índice indisponível)." };
  }
  if (dasPago !== true) {
    await markGuideOpenBySerpro({ guideId: guide.id });
    return { ok: true, pago: false, guideId: guide.id, mensagem: "DAS ainda não consta pago na Receita." };
  }

  // DAS pago (autoritativo). Busca o comprovante via PAGTOWEB se ligado + número disponível (best-effort).
  let comprovantePdfFileId = null;
  if (INTEGRACAO_SERPRO_PAGTOWEB && numeroDocumento) {
    try {
      const result = await confirmarPagamento({ contribuinteCnpj, numeroDocumento, logger });
      if (result?.pago && result.comprovantePdfBuffer?.length) {
        comprovantePdfFileId = await salvarComprovante({ guide, result, logger });
      }
    } catch (err) {
      logger?.warn?.({ code: err?.code, guideId: guide.id }, "PAGTOWEB: comprovante do DAS não obtido (segue como pago)");
    }
  }
  await markGuidePaidByComprovante({ guideId: guide.id, comprovantePdfFileId });
  // DAS não gera baixa contábil automática (o contador dá baixa se quiser); a Circular reflete o pago (Q45).
  return { ok: true, pago: true, guideId: guide.id, comprovantePdfFileId };
}

/** Salva o comprovante (PDF) do PAGTOWEB no storage e devolve o fileId (ou null). Best-effort. */
async function salvarComprovante({ guide, result, logger }) {
  if (!result?.comprovantePdfBuffer?.length) return null;
  try {
    const storage = GuideStorageService.create();
    const key = `serpro/comprovante/${guide.portalClientId || "sem-empresa"}/${guide.competencia || "sem-comp"}/${Date.now()}.pdf`;
    const uploaded = await storage.upload({ key, buffer: result.comprovantePdfBuffer, contentType: "application/pdf" });
    return uploaded.key;
  } catch (err) {
    logger?.warn?.({ err: err?.message, guideId: guide.id }, "PAGTOWEB: falha ao salvar comprovante (segue)");
    return null;
  }
}

/** Baixa contábil (best-effort, idempotente): INSS e parcelas geram lançamento de pagamento. */
async function gerarBaixaSePreciso({ guide, userId, logger }) {
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
    // Q46: o DAS (SIMPLES) confirma pelo `dasPago` (índice PGDAS-D) — não depende do numeroDocumento
    // da guia. Só pré-filtramos as NÃO-Simples sem número (INSS precisa do nº do DARF pro PAGTOWEB).
    const tipoUpper = String(g.tipo || "").toUpperCase();
    if (tipoUpper !== "SIMPLES" && !getGuideNumeroDocumento(g)) {
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

  const total = guides.length;
  const paid = results.filter((r) => r.status === "paid").length;
  const naoLocalizado = results.filter((r) => r.status === "open").length; // consultou, mas não achou comprovante
  const semDoc = results.filter((r) => r.status === "sem_numero_documento").length;
  const jaPago = results.filter((r) => r.status === "already_paid").length;
  const errors = results.filter((r) => r.status === "error").length;
  const pagtowebDisabled = firstError === "SERPRO_PAGTOWEB_DISABLED";

  // Q45: resultado auto-descritivo — em vez de "ok" genérico, diz o que aconteceu.
  let mensagem;
  if (pagtowebDisabled) {
    mensagem = "Confirmação de pagamento (PAGTOWEB) desabilitada — nenhuma guia foi consultada no SERPRO. Ligue INTEGRACAO_SERPRO_PAGTOWEB após validar no trial.";
  } else if (total === 0) {
    mensagem = `Nenhuma guia SERPRO em aberto para confirmar${competencia ? ` (competência ${competencia})` : ""}.`;
  } else {
    const partes = [`${paid} paga(s)`];
    if (naoLocalizado) partes.push(`${naoLocalizado} não localizada(s)`);
    if (jaPago) partes.push(`${jaPago} já constava(m) paga(s)`);
    if (semDoc) partes.push(`${semDoc} sem nº do documento`);
    if (errors) partes.push(`${errors} com erro${firstError ? ` (${firstError})` : ""}`);
    mensagem = `${total} guia(s) verificada(s): ${partes.join(", ")}.`;
  }

  return {
    total, paid, open: naoLocalizado, naoLocalizado, semDoc, jaPago, errors,
    pagtowebDisabled, firstError, mensagem, results,
  };
}

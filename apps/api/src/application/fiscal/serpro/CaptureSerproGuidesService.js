import { prisma } from "../../../infrastructure/db/prisma.js";
import {
  createOrUpdateGuideFromProcessing,
  hashPdf,
  toGuideResponse,
} from "../../guides/GuideService.js";
import { normalizeCompetencia } from "../../guides/guideContract.js";
import { getResolvedSerproCredentials } from "./SerproRuntimeSettings.js";
import { SerproPgdasdService } from "./SerproPgdasdService.js";

function onlyDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

function searchValueDeep(input, matcher) {
  if (input == null) return null;
  if (Array.isArray(input)) {
    for (const item of input) {
      const found = searchValueDeep(item, matcher);
      if (found != null) return found;
    }
    return null;
  }
  if (typeof input !== "object") return null;

  for (const [key, value] of Object.entries(input)) {
    if (matcher(key, value)) return value;
    const found = searchValueDeep(value, matcher);
    if (found != null) return found;
  }
  return null;
}

function extractPdfBase64(payload) {
  const raw = searchValueDeep(payload, (key, value) => {
    const normalized = String(key || "").toLowerCase();
    if (!/pdf|arquivo|documento/.test(normalized)) return false;
    return typeof value === "string" && value.length > 100;
  });
  return raw ? String(raw).trim() : null;
}

function extractProviderMessages(payload) {
  if (!Array.isArray(payload?.mensagens)) return [];
  return payload.mensagens.map((item) => String(item?.texto || "").trim()).filter(Boolean);
}

function extractDateValue(payload) {
  const raw = searchValueDeep(payload, (key, value) => {
    const normalized = String(key || "").toLowerCase();
    return /venc/.test(normalized) && typeof value === "string";
  });
  return raw ? String(raw).trim() : null;
}

function extractDocumentNumber(payload) {
  const raw = searchValueDeep(payload, (key, value) => {
    const normalized = String(key || "").toLowerCase();
    return /(numero.*documento|numerodocumento|nosso.*numero|numerodar|numero)/.test(normalized) && typeof value !== "object";
  });
  return raw == null ? null : String(raw).trim() || null;
}

function extractAmount(payload) {
  const raw = searchValueDeep(payload, (key, value) => {
    const normalized = String(key || "").toLowerCase();
    return /(valor.*total|valortotal|valor)/.test(normalized) && (typeof value === "number" || typeof value === "string");
  });
  if (raw == null) return null;
  const normalized = Number(String(raw).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(normalized) ? normalized : null;
}

function parsePossibleDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return new Date(raw);
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return new Date(`${br[3]}-${br[2]}-${br[1]}T00:00:00.000Z`);
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildPgdasGuidePayload({ response, contribuinteCnpj, competencia }) {
  const pdfBase64 = extractPdfBase64(response);
  if (!pdfBase64) {
    const providerMessages = extractProviderMessages(response);
    const noDebtMessage = providerMessages.find((message) => /nao foram encontrados debitos/i.test(message));
    if (noDebtMessage) {
      const err = new Error(noDebtMessage);
      err.code = "SERPRO_PGDASD_NO_DEBTS_FOUND";
      err.details = response;
      throw err;
    }

    const err = new Error("serpro_pgdasd_pdf_not_found");
    err.code = "SERPRO_PGDASD_PDF_NOT_FOUND";
    throw err;
  }

  const pdfBuffer = Buffer.from(pdfBase64, "base64");
  if (!pdfBuffer.length) {
    const err = new Error("serpro_pgdasd_pdf_invalid");
    err.code = "SERPRO_PGDASD_PDF_INVALID";
    throw err;
  }

  const numeroDocumento = extractDocumentNumber(response);
  const valor = extractAmount(response);
  const vencimento = parsePossibleDate(extractDateValue(response));

  return {
    parsed: {
      cnpj: contribuinteCnpj,
      competencia,
      tipo: "SIMPLES",
      valor,
      vencimento: vencimento ? vencimento.toISOString() : null,
    },
    pdfBuffer,
    numeroDocumento,
    rawPayload: response,
  };
}

function buildSerproSourceFileId({ cnpj, competencia, numeroDocumento }) {
  const doc = String(numeroDocumento || "sem-documento").replace(/[^a-zA-Z0-9_-]+/g, "");
  return `serpro:pgdasd:${onlyDigits(cnpj)}:${competencia}:${doc}`;
}

export async function capturePgdasGuideForCompany({ portalClientId, competencia, contratanteCnpj }) {
  const normalizedCompanyId = String(portalClientId || "").trim();
  const normalizedCompetencia = normalizeCompetencia(competencia);
  if (!normalizedCompanyId) {
    const err = new Error("portal_company_id_required");
    err.code = "PORTAL_COMPANY_ID_REQUIRED";
    throw err;
  }
  if (!normalizedCompetencia) {
    const err = new Error("competencia_required");
    err.code = "SERPRO_INVALID_COMPETENCIA";
    throw err;
  }

  const portalClient = await prisma.portalClient.findUnique({
    where: { id: normalizedCompanyId },
    select: { id: true, cnpj: true, razao: true, companyId: true },
  });
  if (!portalClient) {
    const err = new Error("portal_company_not_found");
    err.code = "PORTAL_COMPANY_NOT_FOUND";
    throw err;
  }

  const runtime = await getResolvedSerproCredentials();
  const procuradorCnpj = onlyDigits(contratanteCnpj || runtime.certificate.document);
  if (!procuradorCnpj || procuradorCnpj.length !== 14) {
    const err = new Error("serpro_procurador_cnpj_not_configured");
    err.code = "SERPRO_PROCURADOR_CNPJ_NOT_CONFIGURED";
    throw err;
  }

  const service = new SerproPgdasdService();
  const response = await service.emitirDasCobranca({
    contratanteCnpj: procuradorCnpj,
    contribuinteCnpj: portalClient.cnpj,
    periodoApuracao: normalizedCompetencia,
  });

  const mapped = buildPgdasGuidePayload({
    response,
    contribuinteCnpj: portalClient.cnpj,
    competencia: normalizedCompetencia,
  });

  const sourceFileId = buildSerproSourceFileId({
    cnpj: portalClient.cnpj,
    competencia: normalizedCompetencia,
    numeroDocumento: mapped.numeroDocumento,
  });

  const existingGuide = await prisma.guide.findFirst({
    where: { sourceFileId },
    select: { id: true },
  });

  const guide = await createOrUpdateGuideFromProcessing({
    existingGuideId: existingGuide?.id || null,
    portalClientId: portalClient.id,
    legacyCompanyId: portalClient.companyId || null,
    parsed: mapped.parsed,
    source: "SERPRO",
    sourceFileId,
    sourcePath: `SERPRO PGDAS-D ${normalizedCompetencia}`,
    driveInboxFolderId: null,
    driveFinalFolderId: null,
    driveFinalFileId: null,
    pdfBytes: mapped.pdfBuffer,
    hash: hashPdf(mapped.pdfBuffer),
    status: "PROCESSED",
    errors: [],
    extracted: {
      integrationSource: "SERPRO_PGDASD",
      sistema: "PGDASD",
      servico: "GERARDASCOBRANCA17",
      numeroDocumento: mapped.numeroDocumento,
      contratanteCnpj: procuradorCnpj,
      contribuinteCnpj: portalClient.cnpj,
      referencia: normalizedCompetencia,
      rawPayload: mapped.rawPayload,
    },
  });

  await prisma.guide.deleteMany({
    where: {
      portalClientId: portalClient.id,
      competencia: normalizedCompetencia,
      tipo: "SIMPLES",
      source: "SERPRO",
      status: "PROCESSED",
      NOT: { id: guide.id },
    },
  });

  return {
    company: {
      id: portalClient.id,
      razao: portalClient.razao,
      cnpj: portalClient.cnpj,
    },
    guide: toGuideResponse(guide),
    integration: {
      sistema: "PGDASD",
      servico: "GERARDASCOBRANCA17",
      contratanteCnpj: procuradorCnpj,
      numeroDocumento: mapped.numeroDocumento,
    },
  };
}

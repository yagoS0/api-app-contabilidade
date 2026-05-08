import { Buffer } from "node:buffer";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { GuideStorageService } from "../../guides/GuideStorageService.js";
import { createOrUpdateGuideFromProcessing, hashPdf, toGuideResponse } from "../../guides/GuideService.js";
import { normalizeCompetencia } from "../../guides/guideContract.js";
import { getResolvedSerproCredentials } from "./SerproRuntimeSettings.js";
import { SerproHttpClient } from "./SerproHttpClient.js";

const SERPRO_DCTFWEB_SYSTEM = "DCTFWEB";
const SERPRO_DCTFWEB_SERVICE_RECEIPT = "CONSRECIBO32";
const SERPRO_DCTFWEB_SERVICE_GUIDE = "GERARGUIA31";

function onlyDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

function parseNestedJsonString(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (!(raw.startsWith("{") || raw.startsWith("["))) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
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
  if (typeof input === "string") {
    const parsed = parseNestedJsonString(input);
    if (parsed) return searchValueDeep(parsed, matcher);
    return null;
  }
  if (typeof input !== "object") return null;

  for (const [key, value] of Object.entries(input)) {
    if (matcher(key, value)) return value;
    if (typeof value === "string") {
      const parsed = parseNestedJsonString(value);
      if (parsed != null) {
        const nestedFound = searchValueDeep(parsed, matcher);
        if (nestedFound != null) return nestedFound;
      }
    }
    const found = searchValueDeep(value, matcher);
    if (found != null) return found;
  }
  return null;
}

function parseDecimal(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.includes(",") ? Number(raw.replace(/\./g, "").replace(",", ".")) : Number(raw);
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

function extractPdfBase64(payload) {
  const raw = searchValueDeep(payload, (key, value) => {
    const normalized = String(key || "").toLowerCase();
    if (!/pdf|arquivo|documento/.test(normalized)) return false;
    return typeof value === "string" && value.length > 100;
  });
  return raw ? String(raw).trim() : null;
}

function isDefinitelyNotTransmitted(payload) {
  const value = searchValueDeep(payload, (key, val) => {
    const normalized = String(key || "").toLowerCase();
    if (!/(recib|protoc|transmiss|declar)/.test(normalized)) return false;
    return typeof val === "string" || typeof val === "number";
  });
  if (value == null) return false;
  return /nao|não|inexist|ausente|pendente|nao transmit|não transmit/i.test(String(value));
}

function extractAmount(payload) {
  const raw = searchValueDeep(payload, (key, value) => {
    const normalized = String(key || "").toLowerCase();
    return /(valor.*total|valortotal|total|vlr|valor)/.test(normalized) && parseDecimal(value) != null;
  });
  return parseDecimal(raw);
}

function extractDueDate(payload) {
  const raw = searchValueDeep(payload, (key, value) => {
    const normalized = String(key || "").toLowerCase();
    return /venc/.test(normalized) && typeof value === "string";
  });
  return parsePossibleDate(raw);
}

function buildDctfwebPayload({ competencia, idServico }) {
  const normalized = normalizeCompetencia(competencia);
  if (!normalized) {
    const err = new Error("competencia_invalida");
    err.code = "SERPRO_INVALID_COMPETENCIA";
    throw err;
  }
  const [year, month] = normalized.split("-");
  return {
    pedidoDados: {
      idSistema: SERPRO_DCTFWEB_SYSTEM,
      idServico,
      versaoSistema: "1.0",
      dados: JSON.stringify({ categoria: "GERAL_MENSAL", anoPA: year, mesPA: month }),
    },
  };
}

async function parsePdfResponse(response) {
  const pdfBase64 = extractPdfBase64(response);
  if (!pdfBase64) {
    const err = new Error("serpro_dctfweb_pdf_not_found");
    err.code = "SERPRO_DCTFWEB_PDF_NOT_FOUND";
    err.details = response;
    throw err;
  }

  const pdfBuffer = Buffer.from(pdfBase64, "base64");
  if (!pdfBuffer.length) {
    const err = new Error("serpro_dctfweb_pdf_invalid");
    err.code = "SERPRO_DCTFWEB_PDF_INVALID";
    err.details = response;
    throw err;
  }

  const pdfParse = (await import("pdf-parse")).default;
  const pdfData = await pdfParse(pdfBuffer);
  const rawText = String(pdfData?.text || "");

  const amountCandidates = [
    rawText.match(/(?:valor\s+total|total\s+a\s+pagar|valor\s+do\s+documento|valor)\D{0,20}(\d+[\d.]*,\d{2})/i)?.[1],
    rawText.match(/(?:r\$\s*)?(\d+[\d.]*,\d{2})/i)?.[1],
  ].filter(Boolean);

  const dueCandidates = [
    rawText.match(/(?:vencimento|data\s+de\s+vencimento)\D{0,20}(\d{2}\/\d{2}\/\d{4})/i)?.[1],
    rawText.match(/(\d{4}-\d{2}-\d{2})/i)?.[1],
  ].filter(Boolean);

  const inssTotal = extractAmount(response) ?? parseDecimal(amountCandidates[0]) ?? 0;
  const inssVencimento = extractDueDate(response) || parsePossibleDate(dueCandidates[0]);

  return {
    pdfBuffer,
    rawText,
    parsed: {
      inssTotal,
      inssVencimento: inssVencimento ? inssVencimento.toISOString() : null,
    },
    rawPayload: response,
  };
}

export async function syncSerproInssForCompany({ portalClientId, competencia, contratanteCnpj, emailStatusOverride }) {
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

  const client = new SerproHttpClient();
  const receiptResponse = await client.post("/Consultar", {
    contratante: { numero: procuradorCnpj, tipo: 2 },
    autorPedidoDados: { numero: procuradorCnpj, tipo: 2 },
    contribuinte: { numero: portalClient.cnpj, tipo: 2 },
    ...buildDctfwebPayload({ competencia: normalizedCompetencia, idServico: SERPRO_DCTFWEB_SERVICE_RECEIPT }),
  });

  if (isDefinitelyNotTransmitted(receiptResponse)) {
    const circular = await prisma.companyMonthlyCircular.upsert({
      where: {
        portalClientId_competencia: {
          portalClientId: portalClient.id,
          competencia: normalizedCompetencia,
        },
      },
      create: {
        portalClientId: portalClient.id,
        competencia: normalizedCompetencia,
        receitaBruta: 0,
        receitaServicos: 0,
        receitaVendas: 0,
        dasTotal: 0,
        inssTotal: 0,
        inssStatus: "NOT_TRANSMITTED",
        metadata: {
          integrationSource: "SERPRO_DCTFWEB",
          sistema: SERPRO_DCTFWEB_SYSTEM,
          servico: SERPRO_DCTFWEB_SERVICE_RECEIPT,
          contratanteCnpj: procuradorCnpj,
          contribuinteCnpj: portalClient.cnpj,
          rawPayload: receiptResponse,
        },
      },
      update: {
        inssStatus: "NOT_TRANSMITTED",
        metadata: {
          integrationSource: "SERPRO_DCTFWEB",
          sistema: SERPRO_DCTFWEB_SYSTEM,
          servico: SERPRO_DCTFWEB_SERVICE_RECEIPT,
          contratanteCnpj: procuradorCnpj,
          contribuinteCnpj: portalClient.cnpj,
          rawPayload: receiptResponse,
        },
      },
    });

    return {
      company: { id: portalClient.id, razao: portalClient.razao, cnpj: portalClient.cnpj },
      circular,
      accounting: { ok: true, generatedEntries: [] },
      inss: { status: "NOT_TRANSMITTED", competencia: normalizedCompetencia },
      receiptResponse,
    };
  }

  const guideResponse = await client.post("/Emitir", {
    contratante: { numero: procuradorCnpj, tipo: 2 },
    autorPedidoDados: { numero: procuradorCnpj, tipo: 2 },
    contribuinte: { numero: portalClient.cnpj, tipo: 2 },
    ...buildDctfwebPayload({ competencia: normalizedCompetencia, idServico: SERPRO_DCTFWEB_SERVICE_GUIDE }),
  });

  const mapped = await parsePdfResponse(guideResponse);
  const storage = GuideStorageService.create();
  const storageKey = `serpro/inss/${portalClient.id}/${normalizedCompetencia}/${Date.now()}.pdf`;
  const uploaded = await storage.upload({ key: storageKey, buffer: mapped.pdfBuffer, contentType: "application/pdf" });
  const now = new Date();

  const circular = await prisma.companyMonthlyCircular.upsert({
    where: {
      portalClientId_competencia: {
        portalClientId: portalClient.id,
        competencia: normalizedCompetencia,
      },
    },
    create: {
      portalClientId: portalClient.id,
      competencia: normalizedCompetencia,
      receitaBruta: 0,
      receitaServicos: 0,
      receitaVendas: 0,
      dasTotal: 0,
      inssTotal: mapped.parsed.inssTotal,
      inssVencimento: mapped.parsed.inssVencimento ? new Date(mapped.parsed.inssVencimento) : null,
      inssPdfFileId: uploaded.key,
      inssPdfUrl: uploaded.url,
      inssStatus: "EMITTED",
      metadata: {
        integrationSource: "SERPRO_DCTFWEB",
        sistema: SERPRO_DCTFWEB_SYSTEM,
        servico: SERPRO_DCTFWEB_SERVICE_GUIDE,
        contratanteCnpj: procuradorCnpj,
        contribuinteCnpj: portalClient.cnpj,
        rawPayload: mapped.rawPayload,
        rawText: mapped.rawText,
        capturedAt: now.toISOString(),
      },
    },
    update: {
      inssTotal: mapped.parsed.inssTotal,
      inssVencimento: mapped.parsed.inssVencimento ? new Date(mapped.parsed.inssVencimento) : null,
      inssPdfFileId: uploaded.key,
      inssPdfUrl: uploaded.url,
      inssStatus: "EMITTED",
      metadata: {
        integrationSource: "SERPRO_DCTFWEB",
        sistema: SERPRO_DCTFWEB_SYSTEM,
        servico: SERPRO_DCTFWEB_SERVICE_GUIDE,
        contratanteCnpj: procuradorCnpj,
        contribuinteCnpj: portalClient.cnpj,
        rawPayload: mapped.rawPayload,
        rawText: mapped.rawText,
        capturedAt: now.toISOString(),
      },
    },
  });

  const inssSourceFileId = `serpro:dctfweb:${onlyDigits(portalClient.cnpj)}:${normalizedCompetencia}`;
  const existingInssGuide = await prisma.guide.findFirst({
    where: { sourceFileId: inssSourceFileId },
    select: { id: true, paymentStatus: true, paymentStatusSource: true, paymentConfirmedAt: true },
  });

  // Preserve existing payment status — emitir a guia no SERPRO não confirma pagamento
  const preservedPayment = existingInssGuide
    ? {
        paymentStatus: existingInssGuide.paymentStatus,
        paymentStatusSource: existingInssGuide.paymentStatusSource,
        paymentConfirmedAt: existingInssGuide.paymentConfirmedAt,
      }
    : { paymentStatus: "OPEN" };

  const guide = await createOrUpdateGuideFromProcessing({
    existingGuideId: existingInssGuide?.id || null,
    portalClientId: portalClient.id,
    legacyCompanyId: portalClient.companyId || null,
    parsed: {
      cnpj: portalClient.cnpj,
      competencia: normalizedCompetencia,
      tipo: "INSS",
      valor: mapped.parsed.inssTotal,
      vencimento: mapped.parsed.inssVencimento,
    },
    source: "SERPRO",
    sourceFileId: inssSourceFileId,
    sourcePath: `SERPRO DCTFWEB ${normalizedCompetencia}`,
    driveInboxFolderId: null,
    driveFinalFolderId: null,
    driveFinalFileId: null,
    pdfBytes: mapped.pdfBuffer,
    hash: hashPdf(mapped.pdfBuffer),
    status: "PROCESSED",
    errors: [],
    ...preservedPayment,
    emailStatusOverride,
    serproLastCheckedAt: now,
    serproLastCheckResult: "FOUND_INSS",
    serproLastSeenAt: now,
    serproService: SERPRO_DCTFWEB_SERVICE_GUIDE,
    extracted: {
      integrationSource: "SERPRO_DCTFWEB",
      sistema: SERPRO_DCTFWEB_SYSTEM,
      servico: SERPRO_DCTFWEB_SERVICE_GUIDE,
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
      tipo: "INSS",
      source: "SERPRO",
      status: "PROCESSED",
      NOT: { id: guide.id },
    },
  });

  return {
    company: { id: portalClient.id, razao: portalClient.razao, cnpj: portalClient.cnpj },
    guide: toGuideResponse(guide),
    circular,
    accounting: { ok: true, generatedEntries: [] },
    inss: {
      status: "EMITTED",
      competencia: normalizedCompetencia,
      inssTotal: mapped.parsed.inssTotal,
      inssVencimento: mapped.parsed.inssVencimento,
      pdfFileId: uploaded.key,
      pdfUrl: uploaded.url,
    },
    receiptResponse,
    guideResponse,
  };
}

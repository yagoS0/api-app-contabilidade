import { prisma } from "../../../infrastructure/db/prisma.js";
import {
  createOrUpdateGuideFromProcessing,
  hashPdf,
  toGuideResponse,
} from "../../guides/GuideService.js";
import { generateEntriesFromCircular } from "../../accounting/AccountingEntryGeneratorService.js";
import { normalizeCompetencia } from "../../guides/guideContract.js";
import { getResolvedSerproCredentials } from "./SerproRuntimeSettings.js";
import {
  SerproPgdasdService,
  SERPRO_PGDASD_SERVICE_COBRANCA,
  SERPRO_PGDASD_SERVICE_NORMAL,
} from "./SerproPgdasdService.js";

function getCompetenciaDueDate(competencia) {
  const normalized = normalizeCompetencia(competencia);
  if (!normalized) return null;
  const match = normalized.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex)) return null;
  return new Date(Date.UTC(year, monthIndex + 1, 20, 23, 59, 59, 999));
}

function resolvePgdasdServiceId({ competencia, serviceId, now = new Date() }) {
  const explicit = String(serviceId || "").trim().toUpperCase();
  if (explicit) return explicit;
  const dueDate = getCompetenciaDueDate(competencia);
  if (dueDate && now.getTime() > dueDate.getTime()) {
    return SERPRO_PGDASD_SERVICE_COBRANCA;
  }
  return SERPRO_PGDASD_SERVICE_NORMAL;
}

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

function parseMoneyValue(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = String(raw).trim();
  if (!s) return null;
  // Detecta separador decimal: o último '.' ou ',' é o decimal
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let normalized;
  if (lastDot === -1 && lastComma === -1) normalized = s;
  else if (lastDot > lastComma) normalized = s.replace(/,/g, ""); // formato US: 1,234.56
  else normalized = s.replace(/\./g, "").replace(",", "."); // formato BR: 1.234,56
  const parsed = Number(normalized.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

// Extrai o valor da DAS percorrendo o payload por prioridade de chaves.
// Pula valores zero/null em níveis menos específicos para não pegar campos como "valorMulta=0".
function extractAmount(payload) {
  const PRIORITY_PATTERNS = [
    /valor.*total.*documento/i,
    /vlr.*total.*documento/i,
    /valor.*total.*pagar/i,
    /valor.*pagar.*total/i,
    /valor.*do.*documento/i,
    /^vlrtotaldocumento$/i,
    /^valortotaldocumento$/i,
    /^valortotal$/i,
    /^vlrtotal$/i,
    /^valor.*pagar$/i,
    /^valor.*principal$/i,
    /^vlrprincipal$/i,
    /^valor$/i,
  ];
  for (const pattern of PRIORITY_PATTERNS) {
    const raw = searchValueDeep(payload, (key, value) => {
      const normalized = String(key || "").toLowerCase().replace(/_/g, "");
      if (!pattern.test(normalized)) return false;
      const parsed = parseMoneyValue(value);
      return parsed != null && parsed > 0; // ignora zeros
    });
    if (raw != null) {
      const parsed = parseMoneyValue(raw);
      if (parsed != null && parsed > 0) return parsed;
    }
  }
  // Fallback: aceita zero se nenhum positivo encontrado
  const fallback = searchValueDeep(payload, (key, value) => {
    const normalized = String(key || "").toLowerCase();
    return /(valor.*total|valortotal|valor)/.test(normalized) && (typeof value === "number" || typeof value === "string");
  });
  return parseMoneyValue(fallback);
}

function extractAmountByKeys(payload, patterns) {
  const raw = searchValueDeep(payload, (key, value) => {
    const normalized = String(key || "").toLowerCase();
    return patterns.some((pattern) => pattern.test(normalized)) && (typeof value === "number" || typeof value === "string");
  });
  return parseMoneyValue(raw);
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

function parseBrMoney(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const parsed = Number(normalized.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

// Lê o PDF da DAS e tenta achar o "Valor Total do Documento".
// Usado como fallback quando o JSON do GERARDAS12 (Normal) não traz valor.
async function extractDasValueFromPdf(pdfBuffer) {
  if (!pdfBuffer || !pdfBuffer.length) return null;
  const pdfParse = (await import("pdf-parse")).default;
  const pdfData = await pdfParse(pdfBuffer);
  const text = String(pdfData?.text || "");
  const patterns = [
    /Valor\s+Total\s+do\s+Documento\s*\n\s*(\d+[\d.]*,\d{2})/i,
    /Valor\s+Total\s+do\s+Documento\s+(\d+[\d.]*,\d{2})/i,
    /Valor\s+Total\s+do\s+Documento[^\d]{0,40}(\d+[\d.]*,\d{2})/i,
  ];
  for (const p of patterns) {
    const match = p.exec(text);
    if (match?.[1]) {
      const v = parseBrMoney(match[1]);
      if (v != null && v > 0) return v;
    }
  }
  // Fallback: linha "Totais X,XX X,XX" — pega o último valor (coluna Total)
  const totaisMatch = text.match(/^Totais\s+([\d.,]+)/im);
  if (totaisMatch?.[1]) {
    const values = totaisMatch[1].match(/\d+(?:\.\d{3})*,\d{2}/g);
    if (values && values.length > 0) {
      const v = parseBrMoney(values[values.length - 1]);
      if (v != null && v > 0) return v;
    }
  }
  // Fallback: "Principal X,XX Multa X,XX Juros X,XX Total X,XX"
  const totalMatch = text.match(/Principal[^\n]*?Total\s+(\d+[\d.]*,\d{2})/i);
  if (totalMatch?.[1]) {
    const v = parseBrMoney(totalMatch[1]);
    if (v != null && v > 0) return v;
  }
  return null;
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

    const noAmountDueMessage = providerMessages.find((message) => /nao foi gerado das por nao haver valor devido/i.test(message));
    if (noAmountDueMessage) {
      const err = new Error(noAmountDueMessage);
      err.code = "SERPRO_PGDASD_NO_AMOUNT_DUE";
      err.details = response;
      throw err;
    }

    const noDeclarationMessage = providerMessages.find((message) => /nao ha declaracao transmitida para o periodo informado/i.test(message));
    if (noDeclarationMessage) {
      const err = new Error(noDeclarationMessage);
      err.code = "SERPRO_PGDASD_DECLARATION_NOT_TRANSMITTED";
      err.details = response;
      throw err;
    }

    const err = new Error("serpro_pgdasd_pdf_not_found");
    err.code = "SERPRO_PGDASD_PDF_NOT_FOUND";
    err.details = response;
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
  const receitaBruta = extractAmountByKeys(response, [/receita.*bruta/, /receita_bruta/, /receitabruta/]);
  const inssTotal = extractAmountByKeys(response, [/inss/, /dctf.*web/, /dctfweb/]);
  const vencimento = parsePossibleDate(extractDateValue(response));

  return {
    parsed: {
      cnpj: contribuinteCnpj,
      competencia,
      tipo: "SIMPLES",
      valor,
      receitaBruta,
      inssTotal,
      vencimento: vencimento ? vencimento.toISOString() : null,
    },
    pdfBuffer,
    numeroDocumento,
    rawPayload: response,
  };
}

function buildGuideSourceFileId({ cnpj, competencia, numeroDocumento, serviceId }) {
  const doc = String(numeroDocumento || "sem-documento").replace(/[^a-zA-Z0-9_-]+/g, "");
  const service = String(serviceId || "sem-servico").replace(/[^a-zA-Z0-9_-]+/g, "");
  return `serpro:pgdasd:${service}:${onlyDigits(cnpj)}:${competencia}:${doc}`;
}

function mapGuideLabels(serviceId) {
  if (serviceId === SERPRO_PGDASD_SERVICE_COBRANCA) {
    return {
      sourcePath: "SERPRO PGDAS-D COBRANCA",
      checkResult: "FOUND_COBRANCA",
    };
  }
  return {
    sourcePath: "SERPRO PGDAS-D",
    checkResult: "FOUND_NORMAL",
  };
}

export async function capturePgdasGuideForCompany({
  portalClientId,
  competencia,
  contratanteCnpj,
  existingGuideId = null,
  serviceId = null,
  dataConsolidacao,
  emailStatusOverride, // "PRESERVE" | "PENDING" | undefined (default = comportamento legado)
}) {
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
  const resolvedServiceId = resolvePgdasdServiceId({
    competencia: normalizedCompetencia,
    serviceId,
  });
  const response =
    resolvedServiceId === SERPRO_PGDASD_SERVICE_COBRANCA
      ? await service.emitirDasCobranca({
          contratanteCnpj: procuradorCnpj,
          contribuinteCnpj: portalClient.cnpj,
          periodoApuracao: normalizedCompetencia,
          dataConsolidacao,
        })
      : await service.emitirDasNormal({
          contratanteCnpj: procuradorCnpj,
          contribuinteCnpj: portalClient.cnpj,
          periodoApuracao: normalizedCompetencia,
          dataConsolidacao,
        });

  const mapped = buildPgdasGuidePayload({
    response,
    contribuinteCnpj: portalClient.cnpj,
    competencia: normalizedCompetencia,
  });

  // GERARDAS12 (Normal) só devolve o PDF base64 — não há valor estruturado no JSON.
  // Quando o Emitir não traz valor, leio direto do PDF da DAS ("Valor Total do Documento").
  if (mapped.parsed.valor == null || mapped.parsed.valor === 0) {
    try {
      const valorFromPdf = await extractDasValueFromPdf(mapped.pdfBuffer);
      if (valorFromPdf != null && valorFromPdf > 0) {
        mapped.parsed.valor = valorFromPdf;
      }
    } catch {
      // Não crítico: se a leitura do PDF falhar, mantém o valor extraído do JSON
    }
  }

  const sourceFileId = buildGuideSourceFileId({
    cnpj: portalClient.cnpj,
    competencia: normalizedCompetencia,
    numeroDocumento: mapped.numeroDocumento,
    serviceId: resolvedServiceId,
  });

  const labels = mapGuideLabels(resolvedServiceId);

  const existingGuide = await prisma.guide.findFirst({
    where: { sourceFileId },
    select: {
      id: true,
      paymentStatus: true,
      paymentStatusSource: true,
      paymentConfirmedAt: true,
    },
  });

  const now = new Date();

  // Preservar paymentStatus existente: emitir guia no SERPRO não confirma pagamento
  const preservedPayment = existingGuide
    ? {
        paymentStatus: existingGuide.paymentStatus,
        paymentStatusSource: existingGuide.paymentStatusSource,
        paymentConfirmedAt: existingGuide.paymentConfirmedAt,
      }
    : { paymentStatus: "OPEN" };

  const guide = await createOrUpdateGuideFromProcessing({
    existingGuideId: existingGuideId || existingGuide?.id || null,
    portalClientId: portalClient.id,
    legacyCompanyId: portalClient.companyId || null,
    parsed: mapped.parsed,
    source: "SERPRO",
    sourceFileId,
    sourcePath: `${labels.sourcePath} ${normalizedCompetencia}`,
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
    serproLastCheckResult: labels.checkResult,
    serproLastSeenAt: now,
    serproService: resolvedServiceId,
    extracted: {
      integrationSource: "SERPRO_PGDASD",
      sistema: "PGDASD",
      servico: resolvedServiceId,
      numeroDocumento: mapped.numeroDocumento,
      contratanteCnpj: procuradorCnpj,
      contribuinteCnpj: portalClient.cnpj,
      referencia: normalizedCompetencia,
      rawPayload: mapped.rawPayload,
    },
  });

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
      receitaBruta: mapped.parsed.receitaBruta != null ? mapped.parsed.receitaBruta : null,
      dasTotal: mapped.parsed.valor != null ? mapped.parsed.valor : null,
      inssTotal: mapped.parsed.inssTotal != null ? mapped.parsed.inssTotal : null,
      metadata: {
        integrationSource: "SERPRO_PGDASD",
        sistema: "PGDASD",
        servico: resolvedServiceId,
        numeroDocumento: mapped.numeroDocumento,
        contratanteCnpj: procuradorCnpj,
        contribuinteCnpj: portalClient.cnpj,
        referencia: normalizedCompetencia,
        rawPayload: mapped.rawPayload,
        capturedAt: now.toISOString(),
      },
    },
    update: {
      ...(mapped.parsed.receitaBruta != null ? { receitaBruta: mapped.parsed.receitaBruta } : {}),
      ...(mapped.parsed.valor != null ? { dasTotal: mapped.parsed.valor } : {}),
      ...(mapped.parsed.inssTotal != null ? { inssTotal: mapped.parsed.inssTotal } : {}),
      metadata: {
        integrationSource: "SERPRO_PGDASD",
        sistema: "PGDASD",
        servico: resolvedServiceId,
        numeroDocumento: mapped.numeroDocumento,
        contratanteCnpj: procuradorCnpj,
        contribuinteCnpj: portalClient.cnpj,
        referencia: normalizedCompetencia,
        rawPayload: mapped.rawPayload,
        capturedAt: now.toISOString(),
      },
    },
  });

  let accounting = null;
  try {
    accounting = await generateEntriesFromCircular({
      portalClientId: portalClient.id,
      competencia: normalizedCompetencia,
      now,
    });
  } catch (err) {
    accounting = {
      ok: false,
      error: err?.code || "ACCOUNTING_GENERATION_FAILED",
      reason: err?.message || "Falha ao gerar lançamentos a partir da Circular.",
    };
  }

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
    circular,
    accounting,
    integration: {
      sistema: "PGDASD",
      servico: resolvedServiceId,
      contratanteCnpj: procuradorCnpj,
      numeroDocumento: mapped.numeroDocumento,
    },
  };
}

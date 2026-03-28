import crypto from "node:crypto";
import { prisma } from "../../infrastructure/db/prisma.js";
import { fileNameForGuide, normalizeCompetencia, normalizeGuideType } from "./guideContract.js";

function normalizeCnpj(value) {
  return String(value || "").replace(/\D+/g, "");
}

export function hashPdf(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function buildStorageKey({ portalClientId, competencia, tipo, originalName }) {
  const comp = normalizeCompetencia(competencia) || "sem-competencia";
  const ext = String(originalName || "").toLowerCase().endsWith(".pdf") ? ".pdf" : ".pdf";
  return `guides/${portalClientId}/${comp}/${normalizeGuideType(tipo)}${ext}`;
}

export function buildUploadSourceFileId(hash) {
  const normalized = String(hash || "").trim();
  return normalized ? `upload:${normalized}` : null;
}

export function buildPendingGuideStorageKey({ hash, originalName }) {
  const safeHash = String(hash || "sem-hash").trim();
  const safeName = String(originalName || "guia.pdf")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ");
  return `guides/pending/${safeHash}/${safeName}`;
}

export function getFriendlyGuideMessage({ code, reason }) {
  const normalizedCode = String(code || "").trim().toUpperCase();
  const normalizedReason = String(reason || "").trim().toLowerCase();

  if (normalizedCode === "GUIDE_DUPLICATE_HASH" || normalizedReason === "duplicate_hash") {
    return "Esta guia já foi enviada anteriormente e foi identificada como duplicada.";
  }
  if (normalizedReason.includes("company_not_found_by_cnpj")) {
    return "Não encontramos uma empresa cadastrada para o CNPJ extraído desta guia.";
  }
  if (normalizedReason.includes("missing_required_parsed_fields")) {
    return "Não foi possível identificar todos os dados obrigatórios da guia, como competência, valor ou CNPJ.";
  }
  if (normalizedCode === "GUIDE_PARSER_NOT_CONFIGURED") {
    return "O parser de guias não está configurado no momento.";
  }
  if (normalizedCode === "GUIDE_STORAGE_KEY_REQUIRED" || normalizedCode === "GUIDE_STORAGE_BUFFER_REQUIRED") {
    return "A guia foi lida, mas houve uma falha ao preparar o arquivo para armazenamento.";
  }
  if (normalizedCode === "GUIDE_STORAGE_BUCKET_REQUIRED" || normalizedCode === "GUIDE_STORAGE_CREDENTIALS_REQUIRED") {
    return "A guia foi identificada, mas houve falha ao salvar o arquivo no storage.";
  }
  if (normalizedCode === "GUIDE_EMAIL_RECIPIENT_NOT_FOUND" || normalizedReason.includes("guide_email_recipient_not_found")) {
    return "A guia foi processada, mas não encontramos um e-mail válido para envio.";
  }
  if (normalizedCode === "GUIDE_EMAIL_SEND_ERROR" || normalizedReason.includes("smtp")) {
    return "A guia foi processada, mas o e-mail não pôde ser enviado.";
  }
  if (normalizedCode === "GUIDE_NOT_PROCESSED" || normalizedReason === "guide_not_processed") {
    return "A guia foi recebida, mas não conseguimos processá-la automaticamente.";
  }
  if (normalizedCode === "GUIDE_PROCESSING_ERROR") {
    return "Não foi possível concluir o processamento desta guia neste momento.";
  }
  return "Não foi possível identificar esta guia automaticamente.";
}

function getExtractedHash(extracted) {
  if (!extracted || typeof extracted !== "object") return null;
  return String(extracted.uploadHash || extracted.hash || "").trim() || null;
}

export function buildCompanyFolderName({ razao, cnpj }) {
  const cleanRazao = String(razao || "EMPRESA")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ");
  const digits = normalizeCnpj(cnpj);
  return `${cleanRazao} - ${digits}`;
}

export async function findPortalClientByCnpj(cnpj) {
  const digits = normalizeCnpj(cnpj);
  if (!digits) return null;
  return prisma.portalClient.findFirst({
    where: { cnpj: digits },
    select: { id: true, razao: true, cnpj: true, companyId: true },
  });
}

export async function listGuidesByCompany({
  portalClientId,
  competencia,
  status,
  page = 1,
  limit = 25,
}) {
  const take = Math.min(Math.max(Number(limit) || 25, 1), 200);
  const pageNum = Math.max(Number(page) || 1, 1);
  const skip = (pageNum - 1) * take;
  const where = {
    portalClientId: String(portalClientId),
    ...(competencia ? { competencia: normalizeCompetencia(competencia) } : {}),
    ...(status ? { status: String(status).toUpperCase() } : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.guide.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
      take,
    }),
    prisma.guide.count({ where }),
  ]);
  return { items, total, page: pageNum, limit: take };
}

export async function listPendingGuidesReport({
  portalClientId,
  portalClientIds,
  competencia,
  emailStatus,
  page = 1,
  limit = 25,
}) {
  const take = Math.min(Math.max(Number(limit) || 25, 1), 200);
  const pageNum = Math.max(Number(page) || 1, 1);
  const skip = (pageNum - 1) * take;
  const normalizedCompetencia = normalizeCompetencia(competencia);
  const normalizedEmailStatus = emailStatus ? String(emailStatus).toUpperCase() : null;
  const pendingEmailFilter = normalizedEmailStatus
    ? { emailStatus: normalizedEmailStatus }
    : { OR: [{ emailStatus: "PENDING" }, { emailStatus: "ERROR" }, { emailStatus: "SENDING" }] };
  const where = {
    status: "PROCESSED",
    ...(portalClientId ? { portalClientId: String(portalClientId) } : {}),
    ...(Array.isArray(portalClientIds) && portalClientIds.length
      ? { portalClientId: { in: portalClientIds.map((id) => String(id)) } }
      : {}),
    ...(normalizedCompetencia ? { competencia: normalizedCompetencia } : {}),
    ...pendingEmailFilter,
  };
  const [items, total] = await prisma.$transaction([
    prisma.guide.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
      take,
      include: {
        portalClient: {
          select: {
            id: true,
            razao: true,
            cnpj: true,
          },
        },
      },
    }),
    prisma.guide.count({ where }),
  ]);
  return { items, total, page: pageNum, limit: take };
}

export function toGuideResponse(item) {
  return {
    guideId: item.id,
    companyId: item.portalClientId,
    competencia: item.competencia || null,
    tipo: item.tipo,
    valor: item.valor ? Number(item.valor) : null,
    vencimento: item.vencimento ? new Date(item.vencimento).toISOString() : null,
    status: item.status,
    emailStatus: item.emailStatus || null,
    emailLastError: item.emailLastError || null,
    createdAt: item.createdAt?.toISOString?.() || null,
    updatedAt: item.updatedAt?.toISOString?.() || null,
  };
}

export function toPendingGuideReportItem(item) {
  return {
    guideId: item.id,
    companyId: item.portalClientId || null,
    companyName: item.portalClient?.razao || null,
    cnpj: item.portalClient?.cnpj || item.cnpj || null,
    tipo: item.tipo || null,
    competencia: item.competencia || null,
    valor: item.valor ? Number(item.valor) : null,
    vencimento: item.vencimento ? new Date(item.vencimento).toISOString() : null,
    status: item.status || null,
    emailStatus: item.emailStatus || null,
    emailAttempts: Number(item.emailAttempts || 0),
    emailLastError: item.emailLastError || null,
    updatedAt: item.updatedAt?.toISOString?.() || null,
  };
}

export function toUnidentifiedGuideResponse(item) {
  const extracted = item?.extracted && typeof item.extracted === "object" ? item.extracted : {};
  const firstError =
    Array.isArray(item?.errors) && item.errors.length && item.errors[0] && typeof item.errors[0] === "object"
      ? item.errors[0]
      : null;
  const code = firstError?.code || "GUIDE_NOT_PROCESSED";
  const reason = firstError?.reason || item?.status || "guide_not_processed";
  return {
    guideId: item.id,
    fileName: item.sourcePath || null,
    hash: getExtractedHash(extracted),
    cnpj: item.cnpj || null,
    competencia: item.competencia || null,
    tipo: item.tipo || null,
    valor: item.valor ? Number(item.valor) : null,
    vencimento: item.vencimento ? new Date(item.vencimento).toISOString() : null,
    status: item.status || null,
    code,
    reason,
    message: firstError?.message || getFriendlyGuideMessage({ code, reason }),
    rawTextSample: extracted.rawTextSample || null,
    fields: extracted.fields && typeof extracted.fields === "object" ? extracted.fields : {},
    createdAt: item.createdAt?.toISOString?.() || null,
    updatedAt: item.updatedAt?.toISOString?.() || null,
  };
}

export async function createOrUpdateGuideFromProcessing({
  existingGuideId = null,
  portalClientId,
  legacyCompanyId,
  parsed,
  source,
  sourceFileId,
  sourcePath,
  driveInboxFolderId,
  driveFinalFolderId,
  driveFinalFileId,
  storageProvider,
  storageKey,
  storageUrl,
  hash,
  status,
  errors,
  extracted,
}) {
  const data = {
    portalClientId: portalClientId ? String(portalClientId) : null,
    legacyCompanyId: legacyCompanyId ? String(legacyCompanyId) : null,
    competencia: normalizeCompetencia(parsed?.competencia),
    tipo: normalizeGuideType(parsed?.tipo),
    valor: Number.isFinite(Number(parsed?.valor)) ? Number(parsed.valor) : null,
    vencimento: parsed?.vencimento ? new Date(parsed.vencimento) : null,
    cnpj: normalizeCnpj(parsed?.cnpj),
    source: source || "DRIVE",
    sourceFileId: sourceFileId || null,
    sourcePath: sourcePath || null,
    driveInboxFolderId: driveInboxFolderId || null,
    driveFinalFolderId: driveFinalFolderId || null,
    driveFinalFileId: driveFinalFileId || null,
    storageProvider: storageProvider || null,
    storageKey: storageKey || null,
    storageUrl: storageUrl || null,
    // Hash só é persistido para guias finalizadas em PROCESSED.
    hash: status === "PROCESSED" ? hash || null : null,
    status: status || "PENDING",
    emailStatus: status === "PROCESSED" ? "PENDING" : null,
    emailAttempts: status === "PROCESSED" ? 0 : 0,
    emailLastError: null,
    emailSentAt: null,
    emailNextRetryAt: null,
    errors: errors || [],
    extracted: extracted || parsed || {},
  };

  if (existingGuideId) {
    return prisma.guide.update({
      where: { id: String(existingGuideId) },
      data,
    });
  }
  return prisma.guide.create({ data });
}

export function buildGuideFinalFileName(parsed) {
  return fileNameForGuide({
    tipo: parsed?.tipo,
    competencia: normalizeCompetencia(parsed?.competencia),
  });
}


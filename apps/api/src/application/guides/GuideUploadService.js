import { randomUUID } from "node:crypto";
import { prisma } from "../../infrastructure/db/prisma.js";
import { GuideParserClient } from "./GuideParserClient.js";
import { getGuideRuntimeSettings } from "./GuideRuntimeSettings.js";
import { GuideStorageService } from "./GuideStorageService.js";
import {
  buildPendingGuideStorageKey,
  buildStorageKey,
  buildUploadSourceFileId,
  createOrUpdateGuideFromProcessing,
  findPortalClientByCnpj,
  getFriendlyGuideMessage,
  hashPdf,
  toUnidentifiedGuideResponse,
} from "./GuideService.js";

function hasRequiredParsedData(parsed) {
  return Boolean(parsed?.cnpj && parsed?.competencia && Number.isFinite(Number(parsed?.valor)));
}

function normalizeUploadFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.filter((file) => file?.buffer && Buffer.isBuffer(file.buffer));
}

function buildErrorEntry({ code, reason, message }) {
  return {
    code: code || "GUIDE_PROCESSING_ERROR",
    reason: reason || "unknown_error",
    message: message || getFriendlyGuideMessage({ code, reason }),
  };
}

function buildExtractedPayload({ parsed, hash, fileName }) {
  const base = parsed && typeof parsed === "object" ? parsed : {};
  return {
    ...base,
    uploadHash: hash,
    sourceFileName: fileName || null,
  };
}

async function createTaxDocumentAudit({
  requestId,
  hash,
  fileName,
  parserSource,
  success,
  parsedData,
  parseError,
}) {
  const metadata =
    parseError && !success
      ? {
          code: parseError.code,
          message: String(parseError.message || ""),
        }
      : {};
  return prisma.taxDocument.create({
    data: {
      requestId,
      contentHash: hash,
      sourceFileName: fileName,
      extractions: {
        create: {
          success,
          parserSource,
          documentType: parsedData?.tipo ?? null,
          payload: success && parsedData ? { ...parsedData } : {},
          confidence: parsedData?.confidence ?? null,
          warnings: [],
          rawText: parsedData?.rawTextSample ?? null,
        },
      },
      logs: {
        create: [
          {
            step: "EXTRACT",
            message: success ? "success" : "failed",
            metadata,
          },
          {
            step: "ROUTING",
            message: "evaluating",
            metadata: {},
          },
        ],
      },
    },
  });
}

async function finalizeTaxDocumentLinks(documentId, { guideId, portalClientId }) {
  const data = {};
  if (guideId != null) data.guideId = guideId;
  if (portalClientId != null) data.portalClientId = portalClientId;
  if (Object.keys(data).length > 0) {
    await prisma.taxDocument.update({
      where: { id: documentId },
      data,
    });
  }
  await prisma.taxDocumentProcessingLog.create({
    data: {
      documentId,
      step: "GUIDE",
      message: "linked",
      metadata: {
        guideId: guideId ?? null,
        portalClientId: portalClientId ?? null,
      },
    },
  });
}

async function savePendingGuide({
  existingGuideId,
  fileName,
  parsed,
  hash,
  storageService,
  errorEntry,
}) {
  const storageKey = buildPendingGuideStorageKey({ hash, originalName: fileName });
  const uploaded = await storageService.upload({
    key: storageKey,
    buffer: parsed.buffer,
    contentType: "application/pdf",
  });
  const guide = await createOrUpdateGuideFromProcessing({
    existingGuideId,
    portalClientId: null,
    legacyCompanyId: null,
    parsed: parsed.data,
    source: "UPLOAD",
    sourceFileId: buildUploadSourceFileId(hash),
    sourcePath: fileName,
    driveInboxFolderId: null,
    driveFinalFolderId: null,
    driveFinalFileId: null,
    storageProvider: uploaded.provider,
    storageKey: uploaded.key,
    storageUrl: uploaded.url,
    hash: null,
    status: "ERROR",
    errors: [errorEntry],
    extracted: buildExtractedPayload({
      parsed: parsed.data,
      hash,
      fileName,
    }),
  });
  return guide;
}

async function processUploadedFile({ file, parserClient, storageService, requestId: headerRequestId }) {
  const fileName = String(file.originalname || file.name || "guia.pdf");
  const fileBuffer = file.buffer;
  const hash = hashPdf(fileBuffer);
  const sourceFileId = buildUploadSourceFileId(hash);
  const requestId = randomUUID();
  const parseTraceId = headerRequestId || requestId;

  const duplicate = await prisma.guide.findFirst({
    where: { hash, status: "PROCESSED" },
    select: { id: true },
  });
  if (duplicate) {
    const code = "GUIDE_DUPLICATE_HASH";
    const reason = "duplicate_hash";
    return {
      status: "SKIPPED",
      code,
      reason,
      message: getFriendlyGuideMessage({ code, reason }),
      fileName,
      extracted: { uploadHash: hash },
    };
  }

  let parsedData;
  try {
    parsedData = await parserClient.parsePdf({
      buffer: fileBuffer,
      filename: fileName,
      requestId: parseTraceId,
    });
  } catch (parseErr) {
    const errorEntry = buildErrorEntry({
      code: parseErr?.code || "GUIDE_PROCESSING_ERROR",
      reason: parseErr?.message || "guide_processing_error",
    });
    const taxDoc = await createTaxDocumentAudit({
      requestId,
      hash,
      fileName,
      parserSource: parserClient.getParserSource(),
      success: false,
      parsedData: null,
      parseError: parseErr,
    });
    const existingGuideErr = sourceFileId
      ? await prisma.guide.findFirst({
          where: { sourceFileId },
          select: { id: true },
        })
      : null;
    const pendingGuide = await savePendingGuide({
      existingGuideId: existingGuideErr?.id || null,
      fileName,
      parsed: { data: {}, buffer: fileBuffer },
      hash,
      storageService,
      errorEntry,
    });
    await finalizeTaxDocumentLinks(taxDoc.id, {
      guideId: pendingGuide.id,
      portalClientId: null,
    });
    return {
      status: "ERROR",
      guideId: pendingGuide.id,
      code: errorEntry.code,
      reason: errorEntry.reason,
      message: errorEntry.message,
      fileName,
      extracted: { uploadHash: hash },
    };
  }

  const taxDoc = await createTaxDocumentAudit({
    requestId,
    hash,
    fileName,
    parserSource: parserClient.getParserSource(),
    success: true,
    parsedData,
    parseError: null,
  });

  const parsed = {
    data: parsedData,
    buffer: fileBuffer,
  };
  const portalClient = await findPortalClientByCnpj(parsedData.cnpj);
  const hasRequired = hasRequiredParsedData(parsedData);
  const existingGuide = sourceFileId
    ? await prisma.guide.findFirst({
        where: { sourceFileId },
        select: { id: true },
      })
    : null;

  if (!hasRequired || !portalClient) {
    const reasons = [
      ...(!portalClient ? ["company_not_found_by_cnpj"] : []),
      ...(!hasRequired ? ["missing_required_parsed_fields"] : []),
    ];
    const reason = reasons.join(",");
    const code = "GUIDE_NOT_PROCESSED";
    const errorEntry = buildErrorEntry({ code, reason });
    const pendingGuide = await savePendingGuide({
      existingGuideId: existingGuide?.id || null,
      fileName,
      parsed,
      hash,
      storageService,
      errorEntry,
    });
    await finalizeTaxDocumentLinks(taxDoc.id, {
      guideId: pendingGuide.id,
      portalClientId: null,
    });
    return {
      status: "ERROR",
      guideId: pendingGuide.id,
      code,
      reason,
      message: errorEntry.message,
      fileName,
      extracted: buildExtractedPayload({ parsed: parsedData, hash, fileName }),
    };
  }

  const storageKey = buildStorageKey({
    portalClientId: portalClient.id,
    competencia: parsedData.competencia,
    tipo: parsedData.tipo,
    originalName: fileName,
  });
  const uploaded = await storageService.upload({
    key: storageKey,
    buffer: fileBuffer,
    contentType: "application/pdf",
  });

  const guide = await createOrUpdateGuideFromProcessing({
    existingGuideId: existingGuide?.id || null,
    portalClientId: portalClient.id,
    legacyCompanyId: portalClient.companyId || null,
    parsed: parsedData,
    source: "UPLOAD",
    sourceFileId,
    sourcePath: fileName,
    driveInboxFolderId: null,
    driveFinalFolderId: null,
    driveFinalFileId: null,
    storageProvider: uploaded.provider,
    storageKey: uploaded.key,
    storageUrl: uploaded.url,
    hash,
    status: "PROCESSED",
    errors: [],
    extracted: buildExtractedPayload({ parsed: parsedData, hash, fileName }),
  });

  await prisma.guide.deleteMany({
    where: {
      portalClientId: portalClient.id,
      competencia: parsedData.competencia,
      tipo: parsedData.tipo,
      status: "PROCESSED",
      NOT: { id: guide.id },
    },
  });

  await finalizeTaxDocumentLinks(taxDoc.id, {
    guideId: guide.id,
    portalClientId: portalClient.id,
  });

  return {
    status: "PROCESSED",
    guideId: guide.id,
    companyId: portalClient.id,
    fileName,
    message: "Guia processada e salva com sucesso.",
    extracted: buildExtractedPayload({ parsed: parsedData, hash, fileName }),
  };
}

export async function processUploadedGuides({ files, requestId: uploadRequestId }) {
  const normalizedFiles = normalizeUploadFiles(files);
  const runtime = await getGuideRuntimeSettings();
  if (!runtime.pdfReaderUrl) {
    const err = new Error("pdf_reader_not_configured");
    err.code = "PDF_READER_NOT_CONFIGURED";
    throw err;
  }
  const parserClient = GuideParserClient.create({
    pdfReaderUrl: runtime.pdfReaderUrl,
  });
  const storageService = GuideStorageService.create();
  const results = [];

  for (const file of normalizedFiles) {
    try {
      // eslint-disable-next-line no-await-in-loop
      results.push(
        await processUploadedFile({
          file,
          parserClient,
          storageService,
          requestId: uploadRequestId,
        })
      );
    } catch (err) {
      const fileName = String(file.originalname || file.name || "guia.pdf");
      const code = err?.code || "GUIDE_PROCESSING_ERROR";
      const reason = err?.message || "guide_processing_error";
      const errorEntry = buildErrorEntry({ code, reason });
      const hash = hashPdf(file.buffer);
      const existingGuide = await prisma.guide.findFirst({
        where: { sourceFileId: buildUploadSourceFileId(hash) },
        select: { id: true },
      });
      const pendingGuide = await savePendingGuide({
        existingGuideId: existingGuide?.id || null,
        fileName,
        parsed: {
          data: {},
          buffer: file.buffer,
        },
        hash,
        storageService,
        errorEntry,
      });
      results.push({
        status: "ERROR",
        guideId: pendingGuide.id,
        code,
        reason,
        message: errorEntry.message,
        fileName,
        extracted: {
          uploadHash: hash,
        },
      });
    }
  }

  const processedGuideIds = results
    .filter((item) => item.status === "PROCESSED" && item.guideId)
    .map((item) => String(item.guideId));

  return {
    total: normalizedFiles.length,
    processed: results.filter((item) => item.status === "PROCESSED").length,
    errors: results.filter((item) => item.status === "ERROR").length,
    skipped: results.filter((item) => item.status === "SKIPPED").length,
    processedGuideIds,
    results,
  };
}

export async function listUnidentifiedGuides({ page = 1, limit = 25 }) {
  const take = Math.min(Math.max(Number(limit) || 25, 1), 200);
  const pageNum = Math.max(Number(page) || 1, 1);
  const skip = (pageNum - 1) * take;
  const where = {
    source: "UPLOAD",
    status: "ERROR",
    portalClientId: null,
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

  return {
    items: items.map(toUnidentifiedGuideResponse),
    total,
    page: pageNum,
    limit: take,
  };
}

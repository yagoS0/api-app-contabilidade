import { randomUUID } from "node:crypto";
import { GUIDE_WORKER_ENABLED, GUIDE_WORKER_INTERVAL_SECONDS, log } from "../config.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { GuideDriveService } from "../application/guides/GuideDriveService.js";
import { GuideParserClient } from "../application/guides/GuideParserClient.js";
import { GuideStorageService } from "../application/guides/GuideStorageService.js";
import { getGuideRuntimeSettings } from "../application/guides/GuideRuntimeSettings.js";
import { releaseGuideLock, tryAcquireGuideLock } from "../application/guides/GuideLockService.js";
import {
  buildCompanyFolderName,
  buildGuideFinalFileName,
  buildStorageKey,
  createOrUpdateGuideFromProcessing,
  findPortalClientByCnpj,
  hashPdf,
} from "../application/guides/GuideService.js";

const LOCK_ID = "guides_inbox_lock";
const LOCK_TTL_MS = 5 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;
const DEFAULT_MAX_DURATION_MS = 25000;
const MIN_MAX_DURATION_MS = 5000;
const MAX_MAX_DURATION_MS = 120000;

function hasRequiredParsedData(parsed) {
  return Boolean(parsed?.cnpj && parsed?.competencia && Number.isFinite(Number(parsed?.valor)));
}

async function acquireLock() {
  return tryAcquireGuideLock(LOCK_ID, LOCK_TTL_MS);
}

async function releaseLock() {
  await releaseGuideLock(LOCK_ID);
}

async function ensureProcessingJob(file) {
  const existing = await prisma.guideIngestionJob.findUnique({
    where: { sourceFileId: String(file.id) },
  });
  if (existing?.status === "DONE" || existing?.status === "SKIPPED") {
    return { skip: true, reason: "already_processed", job: existing };
  }
  if (existing?.status === "PROCESSING") {
    return { skip: true, reason: "already_processing", job: existing };
  }
  const job = await prisma.guideIngestionJob.upsert({
    where: { sourceFileId: String(file.id) },
    create: {
      source: "DRIVE",
      sourceFileId: String(file.id),
      sourceName: file.name || null,
      status: "PROCESSING",
      attempts: 1,
    },
    update: {
      status: "PROCESSING",
      attempts: { increment: 1 },
      errorReason: null,
      finishedAt: null,
    },
  });
  return { skip: false, job };
}

async function moveIfConfigured(driveService, fileId, folderId) {
  if (!folderId) return;
  await driveService.moveFile(fileId, folderId);
}

async function processOneFile({ file, driveService, parserClient, storageService, runtime }) {
  const gate = await ensureProcessingJob(file);
  if (gate.skip) {
    return {
      status: "SKIPPED",
      reason: gate.reason,
      code:
        gate.reason === "already_processing"
          ? "GUIDE_ALREADY_PROCESSING"
          : "GUIDE_ALREADY_PROCESSED",
    };
  }
  const job = gate.job;
  try {
    const buffer = await driveService.downloadFileBuffer(file.id);
    const hash = hashPdf(buffer);

    const duplicate = await prisma.guide.findFirst({
      where: { hash, status: "PROCESSED" },
      select: { id: true },
    });
    if (duplicate) {
      await moveIfConfigured(driveService, file.id, runtime.guideDriveDuplicatesId);
      await prisma.guideIngestionJob.update({
        where: { id: job.id },
        data: {
          status: "SKIPPED",
          errorReason: "duplicate_hash",
          finishedAt: new Date(),
        },
      });
      return { status: "SKIPPED", reason: "duplicate_hash", code: "GUIDE_DUPLICATE_HASH" };
    }

    const parsed = await parserClient.parsePdf({
      buffer,
      filename: file.name,
      requestId: randomUUID(),
    });
    const portalClient = await findPortalClientByCnpj(parsed.cnpj);
    const hasRequired = hasRequiredParsedData(parsed);
    if (!hasRequired || !portalClient) {
      const reasons = [
        ...(!portalClient ? ["company_not_found_by_cnpj"] : []),
        ...(!hasRequired ? ["missing_required_parsed_fields"] : []),
      ];
      const err = new Error("guide_not_processed");
      err.code = "GUIDE_NOT_PROCESSED";
      err.details = reasons;
      throw err;
    }

    const competencia = parsed.competencia;
    const companyFolder = buildCompanyFolderName({
      razao: portalClient.razao,
      cnpj: portalClient.cnpj,
    });
    const destinationFolderId = await driveService.ensureNestedFolders(runtime.guideDriveRootId, [
      companyFolder,
      competencia,
    ]);

    const finalName = buildGuideFinalFileName(parsed);
    await driveService.renameFile(file.id, finalName);
    await driveService.moveFile(file.id, destinationFolderId);

    const storageKey = buildStorageKey({
      portalClientId: portalClient.id,
      competencia,
      tipo: parsed.tipo,
      originalName: finalName,
    });
    const uploaded = await storageService.upload({
      key: storageKey,
      buffer,
      contentType: "application/pdf",
    });

    const existingByHash = await prisma.guide.findFirst({
      where: { hash, NOT: { status: "PROCESSED" } },
      select: { id: true },
    });

    const guide = await createOrUpdateGuideFromProcessing({
      existingGuideId: existingByHash?.id || null,
      portalClientId: portalClient.id,
      legacyCompanyId: portalClient.companyId || null,
      parsed,
      source: "DRIVE",
      sourceFileId: String(file.id),
      sourcePath: file.name || null,
      driveInboxFolderId: runtime.guideDriveInboxId || null,
      driveFinalFolderId: destinationFolderId,
      driveFinalFileId: String(file.id),
      storageProvider: uploaded.provider,
      storageKey: uploaded.key,
      storageUrl: uploaded.url,
      hash,
      status: "PROCESSED",
      errors: [],
      extracted: parsed,
    });

    // Regra de negócio: para empresa + competência + tipo, manter apenas a última PROCESSED.
    await prisma.guide.deleteMany({
      where: {
        portalClientId: portalClient.id,
        competencia,
        tipo: parsed.tipo,
        status: "PROCESSED",
        NOT: { id: guide.id },
      },
    });

    await prisma.guideIngestionJob.update({
      where: { id: job.id },
      data: {
        status: "DONE",
        createdGuideId: guide.id,
        parserPayload: parsed,
        finishedAt: new Date(),
      },
    });
    return {
      status: "PROCESSED",
      guideId: guide.id,
      name: finalName,
      emailStatus: guide.emailStatus || null,
      emailSentAt: guide.emailSentAt || null,
      emailQueued: guide.emailStatus === "PENDING",
    };
  } catch (err) {
    const reasonDetails = Array.isArray(err?.details) && err.details.length ? err.details.join(",") : null;
    const reasonText = reasonDetails || err?.message || "unknown_error";
    await prisma.guideIngestionJob
      .update({
        where: { id: job.id },
        data: {
          status: "ERROR",
          errorReason: reasonText,
          finishedAt: new Date(),
        },
      })
      .catch(() => {});
    log.error(
      { err: err?.message || err, fileId: file.id, fileName: file.name },
      "Falha no processamento de guia"
    );
    return {
      status: "ERROR",
      error: true,
      reason: reasonText,
      code: err?.code || "GUIDE_PROCESSING_ERROR",
    };
  }
}

export async function runGuideInboxWorkerOnce(options = {}) {
  const batchSize = Math.min(
    MAX_BATCH_SIZE,
    Math.max(1, Number(options.batchSize) || DEFAULT_BATCH_SIZE)
  );
  const maxDurationMs = Math.min(
    MAX_MAX_DURATION_MS,
    Math.max(MIN_MAX_DURATION_MS, Number(options.maxDurationMs) || DEFAULT_MAX_DURATION_MS)
  );
  const runtime = await getGuideRuntimeSettings();
  if (!runtime.guideDriveInboxId) {
    throw new Error("GUIDE_DRIVE_INBOX_ID_not_configured");
  }
  if (!runtime.guideDriveOutputRootId) {
    throw new Error("GUIDE_DRIVE_OUTPUT_ROOT_ID_not_configured");
  }
  if (!runtime.pdfReaderUrl) {
    throw new Error("PDF_READER_URL_not_configured");
  }

  const locked = await acquireLock();
  if (!locked) {
    return { skipped: true, reason: "lock_active" };
  }
  try {
    log.info(
      {
        batchSize,
        maxDurationMs,
        hasInboxId: Boolean(runtime.guideDriveInboxId),
        hasOutputRootId: Boolean(runtime.guideDriveOutputRootId),
        pdfReaderUrl: runtime.pdfReaderUrl || null,
      },
      "Iniciando ingestão manual de guias"
    );
    const driveService = await GuideDriveService.create();
    const folders = await driveService.ensureGuideOutputFolders(runtime.guideDriveOutputRootId);
    const runtimeWithFolders = {
      ...runtime,
      guideDriveRootId: folders?.guiasRootId,
      guideDriveDuplicatesId: folders?.duplicatesId,
    };
    const parserClient = GuideParserClient.create({
      pdfReaderUrl: runtime.pdfReaderUrl,
    });
    const storageService = GuideStorageService.create();
    const files = await driveService.listInboxPdfs(runtime.guideDriveInboxId);
    log.info({ totalFoundInInbox: files.length }, "Arquivos PDF encontrados no inbox");
    const startedAt = Date.now();

    const results = [];
    for (const file of files) {
      if (results.length >= batchSize) break;
      if (Date.now() - startedAt >= maxDurationMs) break;
      const result = await processOneFile({
        file,
        driveService,
        parserClient,
        storageService,
        runtime: runtimeWithFolders,
      });
      results.push({ fileId: file.id, name: file.name, ...result });
    }
    const consumedInBatch = results.length;
    const remainingInInbox = Math.max(files.length - consumedInBatch, 0);
    const processedInBatch = results.filter((r) => r.status === "PROCESSED").length;
    const errorsInBatch = results.filter((r) => r.status === "ERROR").length;
    const skippedInBatch = results.filter((r) => r.status === "SKIPPED").length;
    const hasMore = remainingInInbox > 0;
    return {
      skipped: false,
      total: consumedInBatch,
      totalFoundInInbox: files.length,
      processed: processedInBatch,
      needsReview: 0,
      errors: errorsInBatch,
      skippedItems: skippedInBatch,
      remainingInInbox,
      hasMore,
      nextRecommendedDelayMs: hasMore ? 500 : 0,
      batch: {
        batchSize,
        maxDurationMs,
        consumedInBatch,
        processedInBatch,
        errorsInBatch,
        skippedInBatch,
      },
      results,
    };
  } finally {
    await releaseLock();
  }
}

export async function runGuideInboxWorkerLoop() {
  const intervalMs = GUIDE_WORKER_INTERVAL_SECONDS * 1000;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const result = await runGuideInboxWorkerOnce();
      log.info({ result }, "Ciclo do guideInboxWorker concluído");
    } catch (err) {
      log.error({ err: err?.message || err }, "Erro no ciclo do guideInboxWorker");
    }
    // aguarda próximo ciclo
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

if (process.argv[1] && process.argv[1].endsWith("guideInboxWorker.js")) {
  const isOnce = process.argv.includes("--once");
  if (isOnce || !GUIDE_WORKER_ENABLED) {
    runGuideInboxWorkerOnce()
      .then((result) => {
        log.info({ result }, "guideInboxWorker --once finalizado");
        process.exit(0);
      })
      .catch((err) => {
        log.error({ err: err?.message || err }, "guideInboxWorker --once falhou");
        process.exit(1);
      });
  } else {
    runGuideInboxWorkerLoop().catch((err) => {
      log.error({ err: err?.message || err }, "guideInboxWorker loop fatal");
      process.exit(1);
    });
  }
}


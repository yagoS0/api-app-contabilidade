import { log } from "../config.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { getGuidePdfBuffer } from "../application/guides/GuideService.js";
import { EmailService } from "../infrastructure/mail/EmailService.js";
import { releaseGuideLock, tryAcquireGuideLock } from "../application/guides/GuideLockService.js";
import { resolveCompanyNotificationEmail } from "../application/guides/GuideScheduledEmailService.js";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import fssync from "node:fs";

const LOCK_ID = "guides_email_lock";
const LOCK_TTL_MS = 5 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;
const BASE_BACKOFF_MINUTES = 5;
const MAX_BACKOFF_MINUTES = 24 * 60;
const MAX_ATTEMPTS = 8;

function calcNextRetryAt(attempts) {
  const minutes = Math.min(
    MAX_BACKOFF_MINUTES,
    BASE_BACKOFF_MINUTES * 2 ** Math.max(0, attempts - 1)
  );
  return new Date(Date.now() + minutes * 60 * 1000);
}

async function acquireLock() {
  return tryAcquireGuideLock(LOCK_ID, LOCK_TTL_MS);
}

async function releaseLock() {
  await releaseGuideLock(LOCK_ID);
}

async function resolveRecipientEmail(guide) {
  if (!guide?.portalClientId) return null;
  const email = await resolveCompanyNotificationEmail(guide.portalClientId);
  return email ? String(email).trim() : null;
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function processOneGuide({ guide, emailService }) {
  const attempts = Number(guide.emailAttempts || 0) + 1;
  const source = await prisma.guide.update({
    where: { id: guide.id },
    data: {
      emailStatus: "SENDING",
      emailAttempts: attempts,
      emailLastError: null,
      emailNextRetryAt: null,
    },
  });
  try {
    const to = await resolveRecipientEmail(source);
    if (!to) {
      const err = new Error("guide_email_recipient_not_found");
      err.code = "GUIDE_EMAIL_RECIPIENT_NOT_FOUND";
      throw err;
    }
    const fileBuffer = await getGuidePdfBuffer(source);
    if (!fileBuffer?.length) {
      const err = new Error("guide_file_not_available");
      err.code = "GUIDE_FILE_NOT_AVAILABLE";
      throw err;
    }

    const portal = source.portalClientId
      ? await prisma.portalClient.findUnique({
          where: { id: source.portalClientId },
          select: { razao: true },
        })
      : null;
    const empresa = portal?.razao ? escapeHtml(portal.razao) : null;
    const competenciaLabel = escapeHtml(source.competencia || "—");
    const tipoLabel = escapeHtml(source.tipo || "Guia de pagamento");
    const valorFmt =
      source.valor != null
        ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(source.valor))
        : null;
    const vencFmt = source.vencimento
      ? new Date(source.vencimento).toLocaleDateString("pt-BR")
      : null;

    const subject = `Guia de pagamento — competência ${source.competencia || "—"}`;
    const fileName = `${source.tipo || "GUIA"}-${source.competencia || "sem-competencia"}.pdf`;
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "guide-pending-email-"));
    const tmpPath = path.join(tmpDir, fileName);
    await fs.writeFile(tmpPath, fileBuffer);
    const html = `
      <!doctype html>
      <html><body style="font-family:Georgia,'Segoe UI',Arial,sans-serif;color:#1a1a1a;line-height:1.55;max-width:560px">
      <p>Olá${empresa ? `, <strong>${empresa}</strong>` : ""},</p>
      <p>Segue em anexo o <strong>PDF da sua guia de pagamento</strong> para o seu arquivo e para pagamento dentro do prazo.</p>
      <p style="margin:1.25em 0"><strong>Resumo do documento</strong></p>
      <ul style="margin:0;padding-left:1.25em">
        <li><strong>Tipo:</strong> ${tipoLabel}</li>
        <li><strong>Competência:</strong> ${competenciaLabel}</li>
        <li><strong>Valor:</strong> ${valorFmt || "—"}</li>
        <li><strong>Vencimento:</strong> ${vencFmt || "—"}</li>
      </ul>
      <p>Se tiver qualquer dúvida sobre valores ou datas, é só responder este e-mail ou falar com o seu contato aqui no escritório.</p>
      <p style="margin-top:1.75em">Um abraço,<br><strong>Equipe Belgen Contabilidade</strong></p>
      </body></html>
    `;
    try {
      await emailService.send({
        to,
        subject,
        html,
        attachments: [{ path: tmpPath, filename: fileName }],
      });
    } finally {
      if (fssync.existsSync(tmpPath)) {
        await fs.unlink(tmpPath).catch(() => {});
      }
      if (fssync.existsSync(tmpDir)) {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    }

    await prisma.guide.update({
      where: { id: source.id },
      data: {
        emailStatus: "SENT",
        emailSentAt: new Date(),
        emailLastError: null,
        emailNextRetryAt: null,
      },
    });
    return { guideId: source.id, status: "SENT", to };
  } catch (err) {
    const canRetry = attempts < MAX_ATTEMPTS;
    await prisma.guide.update({
      where: { id: source.id },
      data: {
        emailStatus: "ERROR",
        emailLastError: err?.message || "unknown_error",
        emailNextRetryAt: canRetry ? calcNextRetryAt(attempts) : null,
      },
    });
    return {
      guideId: source.id,
      status: "ERROR",
      reason: err?.message || "unknown_error",
      code: err?.code || "GUIDE_EMAIL_SEND_ERROR",
      willRetry: canRetry,
      attempts,
    };
  }
}

export async function runGuideEmailWorkerOnce(options = {}) {
  const batchSize = Math.min(
    MAX_BATCH_SIZE,
    Math.max(1, Number(options.batchSize) || DEFAULT_BATCH_SIZE)
  );
  const locked = await acquireLock();
  if (!locked) return { skipped: true, reason: "lock_active" };
  try {
    const now = new Date();
    const guides = await prisma.guide.findMany({
      where: {
        status: "PROCESSED",
        OR: [
          { emailStatus: null },
          { emailStatus: "PENDING" },
          { emailStatus: "ERROR", emailNextRetryAt: { lte: now } },
        ],
      },
      orderBy: { updatedAt: "asc" },
      take: batchSize,
    });

    const emailService = new EmailService();
    const results = [];
    for (const guide of guides) {
      // processa em série para evitar burst no provedor
      // eslint-disable-next-line no-await-in-loop
      results.push(await processOneGuide({ guide, emailService }));
    }

    return {
      skipped: false,
      total: guides.length,
      sent: results.filter((r) => r.status === "SENT").length,
      errors: results.filter((r) => r.status === "ERROR").length,
      results,
    };
  } finally {
    await releaseLock();
  }
}

export async function runGuideEmailWorkerSelected({ guideIds }) {
  const normalizedIds = Array.isArray(guideIds)
    ? [...new Set(guideIds.map((id) => String(id || "").trim()).filter(Boolean))]
    : [];
  if (!normalizedIds.length) {
    return {
      skipped: false,
      total: 0,
      sent: 0,
      errors: 0,
      results: [],
    };
  }
  const locked = await acquireLock();
  if (!locked) return { skipped: true, reason: "lock_active" };
  try {
    const guides = await prisma.guide.findMany({
      where: {
        id: { in: normalizedIds },
        status: "PROCESSED",
      },
      orderBy: { updatedAt: "asc" },
    });
    const guideById = new Map(guides.map((guide) => [guide.id, guide]));
    const emailService = new EmailService();
    const results = [];
    for (const guideId of normalizedIds) {
      const guide = guideById.get(guideId);
      if (!guide) {
        results.push({
          guideId,
          status: "ERROR",
          reason: "guide_not_found_or_not_processed",
          code: "GUIDE_NOT_FOUND_OR_NOT_PROCESSED",
          willRetry: false,
        });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      results.push(await processOneGuide({ guide, emailService }));
    }
    return {
      skipped: false,
      total: normalizedIds.length,
      sent: results.filter((r) => r.status === "SENT").length,
      errors: results.filter((r) => r.status === "ERROR").length,
      results,
    };
  } finally {
    await releaseLock();
  }
}

export async function runGuideEmailWorkerLoop() {
  // ciclo curto para "drain" sem bloquear
  const intervalMs = 60 * 1000;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const result = await runGuideEmailWorkerOnce();
      log.info({ result }, "Ciclo do guideEmailWorker concluído");
    } catch (err) {
      log.error({ err: err?.message || err }, "Erro no ciclo do guideEmailWorker");
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

if (process.argv[1] && process.argv[1].endsWith("guideEmailWorker.js")) {
  const isOnce = process.argv.includes("--once");
  if (isOnce) {
    runGuideEmailWorkerOnce()
      .then((result) => {
        log.info({ result }, "guideEmailWorker --once finalizado");
        process.exit(0);
      })
      .catch((err) => {
        log.error({ err: err?.message || err }, "guideEmailWorker --once falhou");
        process.exit(1);
      });
  } else {
    runGuideEmailWorkerLoop().catch((err) => {
      log.error({ err: err?.message || err }, "guideEmailWorker loop fatal");
      process.exit(1);
    });
  }
}


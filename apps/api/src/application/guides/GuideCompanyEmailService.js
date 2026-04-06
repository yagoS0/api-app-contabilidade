import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import fssync from "node:fs";
import { prisma } from "../../infrastructure/db/prisma.js";
import { EmailService } from "../../infrastructure/mail/EmailService.js";
import { getGuidePdfBuffer } from "./GuideService.js";
import { guideTypeEmailLabel } from "./guideEmailCopy.js";

function safeTempName(name) {
  return String(name || "guia.pdf").replace(/[\\/]+/g, "-");
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildEmailHtml({ razao, competencia, typeLabels }) {
  const razaoSafe = escapeHtml(razao);
  const compSafe = escapeHtml(competencia);
  const unique = [...new Set(typeLabels)];
  const labelsSafe = unique.map((l) => escapeHtml(l)).join(", ");
  const intro =
    unique.length === 1
      ? `<p>Aqui está sua guia de <strong>${escapeHtml(unique[0])}</strong> (competência <strong>${compSafe}</strong>).</p>`
      : `<p>Seguem em anexo as guias: <strong>${labelsSafe}</strong> — competência <strong>${compSafe}</strong>.</p>`;
  return `
    <!doctype html>
    <html><body style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#1a1a1a;line-height:1.5;max-width:560px">
    <p>Olá, <strong>${razaoSafe}</strong>,</p>
    ${intro}
    <p>Os PDFs estão em anexo.</p>
    <p style="margin-top:1.5em">Um abraço,<br><strong>Equipe Belgen Contabilidade</strong></p>
    </body></html>
  `;
}

export async function sendLatestGuidesEmailByCompany({ portalClientId, to, maxFilesPerRun: maxFiles }) {
  const maxFilesPerRunRaw = Number(maxFiles || 0);
  const maxFilesPerRun =
    Number.isFinite(maxFilesPerRunRaw) && maxFilesPerRunRaw > 0
      ? Math.min(Math.floor(maxFilesPerRunRaw), 100)
      : null;
  const startedAt = Date.now();
  const portal = await prisma.portalClient.findUnique({
    where: { id: String(portalClientId) },
    select: { id: true, razao: true, cnpj: true },
  });
  if (!portal?.id) {
    const err = new Error("portal_company_not_found");
    err.code = "PORTAL_COMPANY_NOT_FOUND";
    throw err;
  }
  if (!to) {
    const err = new Error("company_email_not_found");
    err.code = "COMPANY_EMAIL_NOT_FOUND";
    throw err;
  }

  const pendingAll = await prisma.guide.findMany({
    where: {
      portalClientId: portal.id,
      status: "PROCESSED",
      NOT: {
        OR: [{ emailStatus: "SENT" }, { emailStatus: "SENDING" }],
      },
    },
    orderBy: [{ competencia: "desc" }, { updatedAt: "desc" }],
    take: 500,
  });

  if (!pendingAll.length) {
    return {
      companyId: portal.id,
      to,
      competencia: null,
      totalFound: 0,
      sentNow: 0,
      alreadySent: 0,
      status: "nothing_to_send",
      durationMs: Date.now() - startedAt,
    };
  }

  const latestCompetencia = pendingAll[0]?.competencia || null;
  const pendingGuides = latestCompetencia
    ? pendingAll.filter((g) => g.competencia === latestCompetencia)
    : pendingAll;
  const toSend = maxFilesPerRun ? pendingGuides.slice(0, maxFilesPerRun) : pendingGuides;
  const toSendIds = toSend.map((g) => g.id);

  await prisma.guide.updateMany({
    where: { id: { in: toSendIds } },
    data: {
      emailStatus: "SENDING",
      emailLastError: null,
      emailNextRetryAt: null,
      emailAttempts: { increment: 1 },
    },
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "guides-email-"));
  const attachments = [];
  let attachmentsBytes = 0;
  const email = new EmailService();

  try {
    for (const guide of toSend) {
      // eslint-disable-next-line no-await-in-loop
      const buffer = await getGuidePdfBuffer(guide);
      if (!buffer?.length) {
        throw new Error(`guide_pdf_missing:${guide.id}`);
      }
      attachmentsBytes += Number(buffer.length || 0);
      const name = safeTempName(guide.sourcePath || `${guide.tipo}-${guide.competencia}.pdf`);
      const tmpPath = path.join(tmpDir, `${guide.id}-${name}`);
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(tmpPath, buffer);
      attachments.push({ path: tmpPath, filename: name });
    }

    const typeLabels = toSend.map((g) => guideTypeEmailLabel(g.tipo));
    const uniqueLabels = [...new Set(typeLabels)];
    const subject =
      uniqueLabels.length === 1
        ? `Sua guia de ${uniqueLabels[0]} — ${latestCompetencia || "—"}`
        : `Suas guias — ${latestCompetencia || "—"}`;
    const html = buildEmailHtml({
      razao: portal.razao,
      competencia: latestCompetencia || "—",
      typeLabels,
    });
    await email.send({ to, subject, html, attachments });

    const sentAt = new Date();
    await prisma.guide.updateMany({
      where: { id: { in: toSendIds } },
      data: {
        emailStatus: "SENT",
        emailSentAt: sentAt,
        emailLastError: null,
        emailNextRetryAt: null,
      },
    });

    return {
      companyId: portal.id,
      to,
      competencia: latestCompetencia,
      totalFound: pendingGuides.length,
      sentNow: toSend.length,
      alreadySent: 0,
      pendingToSend: pendingGuides.length,
      remainingAfterRun: Math.max(pendingGuides.length - toSend.length, 0),
      maxFilesPerRun: maxFilesPerRun || null,
      attachmentsCount: toSend.length,
      attachmentsBytes,
      durationMs: Date.now() - startedAt,
      status: "sent",
    };
  } catch (err) {
    await prisma.guide.updateMany({
      where: { id: { in: toSendIds } },
      data: {
        emailStatus: "ERROR",
        emailLastError: err?.message || "guide_email_send_failed",
      },
    });
    const sendErr = new Error(err?.message || "guide_email_send_failed");
    sendErr.code = err?.code || "GUIDE_EMAIL_SEND_FAILED";
    sendErr.meta = {
      companyId: portal.id,
      to,
      maxFilesPerRun: maxFilesPerRun || null,
      attachmentsCount: toSend.length,
      attachmentsBytes,
      durationMs: Date.now() - startedAt,
    };
    throw sendErr;
  } finally {
    try {
      await Promise.all(
        attachments.map(async (item) => {
          if (item?.path && fssync.existsSync(item.path)) {
            await fs.unlink(item.path);
          }
        })
      );
      if (tmpDir && fssync.existsSync(tmpDir)) {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    } catch {
      // noop
    }
  }
}

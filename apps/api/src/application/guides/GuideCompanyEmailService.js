import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import fssync from "node:fs";
import { prisma } from "../../infrastructure/db/prisma.js";
import { EmailService } from "../../infrastructure/mail/EmailService.js";
import { getGuidePdfBuffer } from "./GuideService.js";

function safeTempName(name) {
  return String(name || "guia.pdf").replace(/[\\/]+/g, "-");
}

function buildEmailHtml({ razao, competencia, files }) {
  const listItems = files.map((file) => `<li>${file.name}</li>`).join("");
  return `
    <!doctype html>
    <html><body style="font-family:Arial,sans-serif;color:#2C3E50">
    <p>Olá, <b>${razao}</b></p>
    <p>Segue em anexo a(s) guia(s) da competência <b>${competencia}</b>.</p>
    <ul>${listItems}</ul>
    <p>Atenciosamente,<br>Belgen Contabilidade</p>
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

    const subject = `Guias de pagamento - ${latestCompetencia || "—"}`;
    const html = buildEmailHtml({
      razao: portal.razao,
      competencia: latestCompetencia || "—",
      files: toSend.map((g) => ({ name: g.sourcePath || `${g.tipo}-${g.competencia}.pdf` })),
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

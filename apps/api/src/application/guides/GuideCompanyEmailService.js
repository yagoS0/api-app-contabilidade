import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import fssync from "node:fs";
import { prisma } from "../../infrastructure/db/prisma.js";
import { EmailService } from "../../infrastructure/mail/EmailService.js";
import { GuideDriveService } from "./GuideDriveService.js";
import { buildCompanyFolderName } from "./GuideService.js";
import { getGuideRuntimeSettings } from "./GuideRuntimeSettings.js";
import { normalizeCompetencia } from "./guideContract.js";

const FOLDER_MIME = "application/vnd.google-apps.folder";

function safeTempName(name) {
  return String(name || "guia.pdf").replace(/[\\/]+/g, "-");
}

function pickLatestCompetenciaFolder(folders) {
  const withComp = (folders || [])
    .map((item) => ({
      folder: item,
      competencia: normalizeCompetencia(item?.name),
    }))
    .filter((item) => Boolean(item.competencia))
    .sort((a, b) => (a.competencia < b.competencia ? 1 : -1));
  return withComp.length ? withComp[0] : null;
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

  const runtime = await getGuideRuntimeSettings();
  if (!runtime?.guideDriveOutputRootId) {
    const err = new Error("guide_drive_output_root_id_not_configured");
    err.code = "GUIDE_OUTPUT_ROOT_NOT_CONFIGURED";
    throw err;
  }

  const drive = await GuideDriveService.create();
  const email = new EmailService();
  const folders = await drive.ensureGuideOutputFolders(runtime.guideDriveOutputRootId);
  if (!folders?.guiasRootId) {
    const err = new Error("guide_output_folders_unavailable");
    err.code = "GUIDE_OUTPUT_FOLDERS_UNAVAILABLE";
    throw err;
  }

  const companyFolderName = buildCompanyFolderName({ razao: portal.razao, cnpj: portal.cnpj });
  const companyFolder = await drive.findExactSubfolderByName(folders.guiasRootId, companyFolderName);
  if (!companyFolder?.id) {
    return {
      companyId: portal.id,
      to,
      folder: companyFolderName,
      totalFound: 0,
      sentNow: 0,
      alreadySent: 0,
      status: "no_company_folder",
    };
  }

  const subfolders = (await drive.listChildren(companyFolder.id)).filter(
    (item) => item.mimeType === FOLDER_MIME
  );
  const latest = pickLatestCompetenciaFolder(subfolders);
  if (!latest?.folder?.id) {
    return {
      companyId: portal.id,
      to,
      folder: companyFolder.name,
      totalFound: 0,
      sentNow: 0,
      alreadySent: 0,
      status: "no_competencia_folder",
    };
  }

  const allPdfs = await drive.listPdfsInFolder(latest.folder.id);
  const allFileIds = allPdfs.map((item) => String(item.id));
  const dbSent = allFileIds.length
    ? await prisma.guide.findMany({
        where: {
          portalClientId: portal.id,
          driveFinalFileId: { in: allFileIds },
          emailStatus: "SENT",
        },
        select: { driveFinalFileId: true },
      })
    : [];
  const dbSentIds = new Set(dbSent.map((item) => String(item.driveFinalFileId)));
  const pending = allPdfs.filter(
    (file) => !drive.isGuideEmailSent(file) && !dbSentIds.has(String(file.id))
  );
  const toSend = maxFilesPerRun ? pending.slice(0, maxFilesPerRun) : pending;
  const alreadySent = allPdfs.length - pending.length;
  if (!toSend.length) {
    return {
      companyId: portal.id,
      to,
      competencia: latest.competencia,
      folder: latest.folder.name,
      totalFound: allPdfs.length,
      sentNow: 0,
      alreadySent,
      pendingToSend: pending.length,
      remainingAfterRun: 0,
      durationMs: Date.now() - startedAt,
      status: "nothing_to_send",
    };
  }

  const toSendIds = toSend.map((item) => String(item.id));
  await prisma.guide.updateMany({
    where: {
      portalClientId: portal.id,
      driveFinalFileId: { in: toSendIds },
      status: "PROCESSED",
    },
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
  try {
    for (const file of toSend) {
      // eslint-disable-next-line no-await-in-loop
      const buffer = await drive.downloadFileBuffer(file.id);
      attachmentsBytes += Number(buffer.length || 0);
      const tmpPath = path.join(tmpDir, safeTempName(file.name));
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(tmpPath, buffer);
      attachments.push({ path: tmpPath, filename: file.name });
    }

    const subject = `Guias de pagamento - ${latest.competencia}`;
    const html = buildEmailHtml({
      razao: portal.razao,
      competencia: latest.competencia,
      files: toSend,
    });
    await email.send({ to, subject, html, attachments });

    const sentAt = new Date();
    await prisma.guide.updateMany({
      where: {
        portalClientId: portal.id,
        driveFinalFileId: { in: toSendIds },
        status: "PROCESSED",
      },
      data: {
        emailStatus: "SENT",
        emailSentAt: sentAt,
        emailLastError: null,
        emailNextRetryAt: null,
      },
    });

    const markerErrors = [];
    for (const file of toSend) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await drive.markGuideEmailSent(file);
      } catch (err) {
        markerErrors.push({
          fileId: file.id,
          name: file.name,
          reason: err?.message || "drive_mark_failed",
        });
      }
    }

    return {
      companyId: portal.id,
      to,
      competencia: latest.competencia,
      folder: latest.folder.name,
      totalFound: allPdfs.length,
      sentNow: toSend.length,
      alreadySent,
      pendingToSend: pending.length,
      remainingAfterRun: Math.max(pending.length - toSend.length, 0),
      maxFilesPerRun: maxFilesPerRun || null,
      attachmentsCount: toSend.length,
      attachmentsBytes,
      durationMs: Date.now() - startedAt,
      markerErrors,
      status: markerErrors.length ? "sent_with_marker_warnings" : "sent",
    };
  } catch (err) {
    await prisma.guide.updateMany({
      where: {
        portalClientId: portal.id,
        driveFinalFileId: { in: toSendIds },
        status: "PROCESSED",
      },
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


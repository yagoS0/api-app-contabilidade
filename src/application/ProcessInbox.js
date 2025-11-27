import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import fssync from "node:fs";
import { DRIVE_FOLDER_ID_INBOX, DRIVE_FOLDER_ID_CLIENTES, log } from "../config.js";
import { DriveService } from "../infrastructure/drive/DriveService.js";
import { PdfTextExtractor } from "../infrastructure/ocr/PdfTextExtractor.js";
import { ExtractorService } from "../domain/ExtractorService.js";

function isSorted(file) {
  const v = file?.appProperties?.belgen_sorted;
  return v === "1" || v === "true";
}

async function markSorted(driveService, file) {
  const current = (file && file.appProperties) || {};
  const appProperties = { ...current, belgen_sorted: "1" };
  await driveService.drive.files.update({
    fileId: file.id,
    requestBody: { appProperties },
    supportsAllDrives: true,
  });
}

export async function runInbox() {
  if (!DRIVE_FOLDER_ID_INBOX) {
    log.error("DRIVE_FOLDER_ID_INBOX não configurado");
    return;
  }
  if (!DRIVE_FOLDER_ID_CLIENTES) {
    log.error("DRIVE_FOLDER_ID_CLIENTES não configurado");
    return;
  }

  const drive = await DriveService.create();
  const inboxId = DRIVE_FOLDER_ID_INBOX;
  const clientsRootId = DRIVE_FOLDER_ID_CLIENTES;
  const textExtractor = new PdfTextExtractor();
  const extractor = new ExtractorService();

  const files = await drive.listPdfsInFolder(inboxId);
  const toProcess = files.filter((f) => !isSorted(f));
  log.info({ total: files.length, pendentes: toProcess.length }, "Arquivos na caixa de entrada");

  for (const file of toProcess) {
    log.info({ id: file.id, name: file.name }, "Processando guia");
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "inbox-"));
    const localPath = path.join(tmpDir, file.name);
    try {
      await drive.downloadPdfTo(file.id, localPath);
      const text = await textExtractor.extract(localPath);
      const fields = extractor.extractFieldsFromText(text);
      log.debug({ fields }, "Campos extraídos");

      if (!fields.empresa || !fields.competencia) {
        log.warn(
          { id: file.id, name: file.name, fields },
          "Empresa ou competência não identificadas — arquivo permanecerá na Inbox"
        );
        continue;
      }

      const clientFolder = await drive.findOrCreateSubfolder(clientsRootId, fields.empresa);
      const monthFolder = await drive.findOrCreateSubfolder(clientFolder.id, fields.competencia);
      await drive.moveFileToFolder(file.id, monthFolder.id, inboxId);
      await markSorted(drive, file);
      log.info(
        { id: file.id, name: file.name, cliente: clientFolder.name, competencia: monthFolder.name },
        "Guia movida para a pasta de cliente/competência"
      );
    } catch (err) {
      log.error({ err, id: file.id, name: file.name }, "Falha ao processar guia");
    } finally {
      try {
        if (fssync.existsSync(localPath)) await fs.unlink(localPath);
        if (fssync.existsSync(tmpDir)) await fs.rmdir(tmpDir);
      } catch {
        // ignore
      }
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith("ProcessInbox.js")) {
  runInbox().catch((err) => {
    log.error({ err }, "Falha geral (inbox)");
    process.exitCode = 1;
  });
}



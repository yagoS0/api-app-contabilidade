import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import fssync from "node:fs";

import { DRIVE_FOLDER_ID_CLIENTES, FORCE_SEND, log } from "../config.js";
import { DriveService } from "../infrastructure/drive/DriveService.js";
import { SheetService } from "../infrastructure/sheets/SheetService.js";
import { EmailService } from "../infrastructure/mail/EmailService.js";
import { RunLogStore } from "../infrastructure/status/RunLogStore.js";

function getNowYearMonthInTZ(tz) {
  const timeZone = tz || process.env.TZ || "America/Sao_Paulo";
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const parts = dtf.formatToParts(new Date());
  const year = Number(parts.find((p) => p.type === "year")?.value || new Date().getFullYear());
  const month = Number(parts.find((p) => p.type === "month")?.value || new Date().getMonth() + 1);
  return { year, month };
}

function getExpectedPreviousMonthName() {
  const { year, month } = getNowYearMonthInTZ();
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const mm = String(prevMonth).padStart(2, "0");
  return `${mm}-${prevYear}`;
}

export async function run() {
  const drive = await DriveService.create();
  const sheets = await SheetService.create();
  const email = new EmailService();

  // 1) Validação da pasta raiz "Clientes"
  try {
    await drive.listChildren(DRIVE_FOLDER_ID_CLIENTES);
    log.info({ id: DRIVE_FOLDER_ID_CLIENTES, name: "Clientes" }, 'Pasta "Clientes" OK');
  } catch (e) {
    log.error({ err: e }, 'Falha ao acessar a pasta "Clientes" (confira DRIVE_FOLDER_ID_CLIENTES no .env)');
    process.exitCode = 1;
    return;
  }

  // 2) Planilha
  const clients = await sheets.getClientsNoHeader();
  log.info({ count: clients.length }, "Clientes na planilha");

  let enviados = 0;
  const expectedMonthName = getExpectedPreviousMonthName();
  log.info({ mesEsperado: expectedMonthName }, "Pasta de competência esperada (mês anterior)");

  for (const { nome: cliente, email: to } of clients) {
    if (!cliente || !to) {
      log.warn({ cliente, email: to }, "Linha ignorada (cliente/email vazio)");
      continue;
    }
    const clientFolder = await drive.findClientFolder(DRIVE_FOLDER_ID_CLIENTES, cliente);
    if (!clientFolder) {
      log.error({ cliente }, 'Pasta do cliente não encontrada em "Clientes"');
      try {
        await RunLogStore.appendEntry({
          type: "email",
          status: "error",
          reason: "client_folder_not_found",
          cliente,
          to,
          mes: expectedMonthName,
        });
      } catch {}
      continue;
    }
    const monthFolder = await drive.findExactSubfolderByName(clientFolder.id, expectedMonthName);
    if (!monthFolder) {
      log.warn({ cliente, mesEsperado: expectedMonthName }, "Pasta do mês esperado não encontrada; nenhum e-mail será enviado para este cliente");
      try {
        await RunLogStore.appendEntry({
          type: "email",
          status: "skip",
          reason: "month_folder_not_found",
          cliente,
          to,
          mes: expectedMonthName,
        });
      } catch {}
      continue;
    }
    const allFiles = await drive.listPdfsInFolder(monthFolder.id);
    const pdfs = allFiles.filter(
      (f) => f.mimeType === "application/pdf" || (f.name || "").toLowerCase().endsWith(".pdf")
    );
    if (pdfs.length === 0) {
      log.warn({ cliente, mes: monthFolder.name }, "Nenhum PDF encontrado na pasta do mês");
      try {
        await RunLogStore.appendEntry({
          type: "email",
          status: "skip",
          reason: "no_pdfs",
          cliente,
          to,
          mes: monthFolder.name,
        });
      } catch {}
      continue;
    }
    const toSend = FORCE_SEND ? pdfs : pdfs.filter((f) => !drive.isDriveProcessed(f));
    if (toSend.length === 0) {
      log.info({ cliente, mes: monthFolder.name }, "Todos os PDFs desta pasta já foram processados — nada a fazer");
      try {
        await RunLogStore.appendEntry({
          type: "email",
          status: "skip",
          reason: "already_processed",
          cliente,
          to,
          mes: monthFolder.name,
        });
      } catch {}
      continue;
    }
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "belgen-"));
    const attachments = [];
    try {
      for (const f of toSend) {
        const localPath = await drive.downloadPdfTo(f.id, path.join(tmpDir, f.name));
        attachments.push({ path: localPath, filename: f.name });
      }
      const subject = `Guias de pagamento – ${monthFolder.name}`;
      const html = `
        <!doctype html>
        <html><body style="font-family:Arial,sans-serif;color:#2C3E50">
        <p>Olá, <b>${cliente}</b></p>
        <p>Segue em anexo a(s) guia(s) referente(s) a <b>${monthFolder.name}</b>
        <p>Atenciosamente,<br>Belgen Contabilidade</p>
        <hr style="border:none;border-top:1px solid #ECF0F1">
        <small style="color:#7f8c8d">Mensagem automática. Em caso de dúvida, responda este e-mail.</small>
        </body></html>
      `;
      await email.send({ to, subject, html, attachments });
      try {
        await RunLogStore.appendSend({ to, cliente, mes: monthFolder.name, subject });
      } catch {
        // não deve falhar o fluxo por causa do log
      }
      for (const f of toSend) {
        try {
          await drive.markDriveProcessed(f);
        } catch (e) {
          log.warn({ fileId: f.id, name: f.name, err: e }, "Falha ao marcar appProperties no Drive");
        }
      }
      enviados += 1;
    } catch (err) {
      log.error({ cliente, mes: monthFolder.name, err }, "Falha ao enviar e-mail único — nada foi marcado como processado");
      try {
        await RunLogStore.appendEntry({
          type: "email",
          status: "error",
          reason: "send_failed",
          cliente,
          to,
          mes: monthFolder.name,
        });
      } catch {}
    } finally {
      try {
        await Promise.all(
          attachments.map(async (a) => {
            if (a?.path && fssync.existsSync(a.path)) {
              await fs.unlink(a.path);
            }
          })
        );
        if (tmpDir && fssync.existsSync(tmpDir)) {
          await fs.rmdir(tmpDir);
        }
      } catch {
        // ignore
      }
    }
  }
  log.info({ enviados }, "Concluído");
}

if (process.argv[1] && process.argv[1].endsWith("SendGuides.js")) {
  run().catch((err) => {
    log.error({ err }, "Falha geral");
    process.exitCode = 1;
  });
}



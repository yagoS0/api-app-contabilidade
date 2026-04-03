import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import { google } from "googleapis";
import {
  USE_GMAIL_API,
  FROM,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  GMAIL_DELEGATED_USER,
  GOOGLE_APPLICATION_CREDENTIALS,
  GOOGLE_APPLICATION_CREDENTIALS_JSON,
  log,
} from "../../config.js";

function encodeHeaderUtf8(value) {
  const s = String(value ?? "");
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  const b64 = Buffer.from(s, "utf8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

async function loadServiceAccountJson() {
  const inline = String(GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim();
  if (inline) {
    return JSON.parse(inline);
  }
  const credPath = String(GOOGLE_APPLICATION_CREDENTIALS || "").trim();
  if (!credPath) {
    const err = new Error("google_application_credentials_missing");
    err.code = "GOOGLE_CREDENTIALS_MISSING";
    throw err;
  }
  const resolved = path.resolve(credPath);
  const st = await fsp.stat(resolved).catch(() => null);
  if (!st) {
    const err = new Error("google_application_credentials_file_not_found");
    err.code = "GOOGLE_CREDENTIALS_NOT_FOUND";
    throw err;
  }
  if (st.isDirectory()) {
    const err = new Error(
      "GOOGLE_APPLICATION_CREDENTIALS aponta para um diretório. Use um arquivo .json ou defina GOOGLE_APPLICATION_CREDENTIALS_JSON com o JSON da service account."
    );
    err.code = "GOOGLE_CREDENTIALS_EISDIR";
    throw err;
  }
  const raw = await fsp.readFile(resolved, "utf8");
  return JSON.parse(raw);
}

async function getGmailService() {
  const { client_email, private_key } = await loadServiceAccountJson();
  const auth = new google.auth.JWT({
    email: client_email,
    key: private_key,
    scopes: ["https://www.googleapis.com/auth/gmail.send"],
    subject: GMAIL_DELEGATED_USER,
  });
  await auth.authorize();
  return google.gmail({ version: "v1", auth });
}

function buildMimeMessage({ from, to, subject, html, attachments }) {
  const boundary = "===belgen-" + Date.now();
  const encodedSubject = encodeHeaderUtf8(subject);
  let head =
    `From: ${from}\r\n` +
    `To: ${to}\r\n` +
    `Subject: ${encodedSubject}\r\n` +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;
  let body = "";
  body += `--${boundary}\r\n`;
  body += 'Content-Type: text/html; charset="UTF-8"\r\n\r\n';
  body += `${html}\r\n`;
  for (const a of attachments || []) {
    const fileContent = fs.readFileSync(a.path);
    const base64Data = fileContent.toString("base64");
    const filename = a.filename || path.basename(a.path);
    body += `--${boundary}\r\n`;
    body += `Content-Type: application/pdf; name="${filename}"\r\n`;
    body += "Content-Transfer-Encoding: base64\r\n";
    body += `Content-Disposition: attachment; filename="${filename}"\r\n\r\n`;
    body += `${base64Data}\r\n`;
  }
  body += `--${boundary}--`;
  return head + body;
}

export class EmailService {
  async send({ to, subject, html, attachments }) {
    if (USE_GMAIL_API) {
      return this.sendViaGmailApi({ to, subject, html, attachments });
    }
    return this.sendViaSmtp({ to, subject, html, attachments });
  }

  async sendViaGmailApi({ to, subject, html, attachments }) {
    const gmail = await getGmailService();
    const mime = buildMimeMessage({ from: FROM, to, subject, html, attachments });
    const raw = Buffer.from(mime).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
    await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
    log.info({ to, from: FROM }, "E-mail enviado (Gmail API)");
  }

  async sendViaSmtp({ to, subject, html, attachments }) {
    const port = Number(SMTP_PORT || 587);
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure: port === 465, // TLS implícito em 465
      auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
    const mail = {
      from: FROM,
      to,
      subject,
      html,
      attachments: (attachments || []).map((a) => ({
        filename: a.filename || path.basename(a.path),
        path: a.path,
        contentType: "application/pdf",
      })),
    };
    await transporter.sendMail(mail);
    log.info({ to, from: FROM }, "E-mail enviado (SMTP)");
  }
}



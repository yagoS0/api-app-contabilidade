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
  MAIL_REPLY_TO,
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

/**
 * ⚠ O NOME DE EXIBIÇÃO do remetente — o que a caixa de entrada mostra em negrito (30/08/2026)
 *
 * > Dono: *"o email aparece na caixa de entrada como: envio, conseguimos mudar isso?"*
 *
 * O `From` saía como endereço puro (`envio@altan.company`) e o Gmail mostrava a parte antes
 * do `@`. Com `SMTP_FROM="Altan Contabilidade <envio@altan.company>"` ele passa a mostrar o nome.
 *
 * ⚠⚠ Esta função existe porque o cabeçalho NÃO é texto livre. Dois modos de quebrar, os dois
 * silenciosos — o e-mail SAI, e sai errado:
 *   1. **acento** (`Contabilidade Ltda · Endereço`) vai cru e vira mojibake no cliente de e-mail;
 *   2. **vírgula ou ponto** (`Altan Contabilidade, Ltda.`) são `specials` do RFC 5322 dentro de um
 *      `phrase` — o parser lê a vírgula como SEPARADOR e o `From` vira DOIS remetentes.
 *
 * ⚠ `encoded-word` (`=?UTF-8?B?…?=`) NUNCA pode ir entre aspas: entre aspas ele deixa de ser
 * decodificado e o cliente mostra a base64 literal. Por isso os dois ramos são exclusivos.
 */
const ESPECIAIS_DO_PHRASE = /[()<>@,;:\\".[\]]/;

export function montarRemetente(from) {
  const bruto = String(from ?? "").trim();
  const m = bruto.match(/^(.*)<([^>]+)>\s*$/);
  // Endereço puro (o formato de hoje) segue intocado — é o caminho de quem não configurou nome.
  if (!m) return bruto;
  const nome = m[1].trim().replace(/^"(.*)"$/, "$1");
  const endereco = m[2].trim();
  if (!nome) return endereco;
  const codificado = encodeHeaderUtf8(nome);
  if (codificado !== nome) return `${codificado} <${endereco}>`;
  if (ESPECIAIS_DO_PHRASE.test(nome)) return `"${nome.replace(/"/g, '\\"')}" <${endereco}>`;
  return `${nome} <${endereco}>`;
}

// Normaliza a private_key vinda de env var. Em painéis como Railway/Heroku, ao colar
// o JSON inteiro como string, as quebras de linha reais às vezes viram `\\n` literais
// (2 caracteres). Sem isso, o JWT é assinado com chave inválida → invalid_grant.
function normalizeServiceAccount(sa) {
  if (!sa || typeof sa !== "object") return sa;
  if (typeof sa.private_key === "string") {
    sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  }
  return sa;
}

async function loadServiceAccountJson() {
  const inline = String(GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim();
  if (inline) {
    return normalizeServiceAccount(JSON.parse(inline));
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
  return normalizeServiceAccount(JSON.parse(raw));
}

async function getGmailService() {
  const { client_email, private_key } = await loadServiceAccountJson();
  // O subject (usuário impersonado) precisa ser uma caixa REAL do Google Workspace.
  // Normaliza pra minúsculas+trim — endereços de Workspace são case-insensitive e
  // espaços/caixa alta costumam causar "invalid_grant: Not a valid email or user ID".
  const delegatedUser = String(GMAIL_DELEGATED_USER || "").trim().toLowerCase();
  if (!delegatedUser) {
    const err = new Error(
      "GMAIL_DELEGATED_USER ausente — defina a caixa do Workspace a ser impersonada (ex: envio@altan.company)."
    );
    err.code = "GMAIL_DELEGATED_USER_MISSING";
    throw err;
  }
  const auth = new google.auth.JWT({
    email: client_email,
    key: private_key,
    scopes: ["https://www.googleapis.com/auth/gmail.send"],
    subject: delegatedUser,
  });
  try {
    await auth.authorize();
  } catch (err) {
    // invalid_grant aqui = delegação domain-wide não autorizada OU o subject não é um
    // usuário válido do Workspace. Enriquece a mensagem com o que precisa ser conferido.
    const detail = err?.response?.data?.error_description || err?.message || String(err);
    const wrapped = new Error(
      `Falha na autorização do Gmail API (delegação). subject=${delegatedUser}, `
      + `service_account=${client_email}. Verifique: (1) a caixa existe no Workspace; `
      + `(2) Domain-wide delegation autoriza o Client ID da service account para o escopo `
      + `gmail.send. Detalhe Google: ${detail}`
    );
    wrapped.code = "GMAIL_AUTHORIZE_FAILED";
    throw wrapped;
  }
  return google.gmail({ version: "v1", auth });
}

function buildMimeMessage({ from, to, subject, html, attachments }) {
  // ⚠ Separador MIME. É técnico e invisível — só precisa ser único e não aparecer no conteúdo.
  const boundary = "===altan-" + Date.now();
  const encodedSubject = encodeHeaderUtf8(subject);
  // Extrai domínio do "from" pra usar no Message-ID (boa prática anti-spam).
  const fromEmail = (String(from).match(/<([^>]+)>/) || [, String(from).trim()])[1];
  /**
   * ⚠ O domínio do `Message-ID` — e o fallback é o ÚLTIMO recurso, não o normal.
   *
   * Ele só morde se o `From` vier sem `@`, o que significa `SMTP_FROM`/`GMAIL_DELEGATED_USER`
   * mal configurados. ⚠⚠ **Ele TEM de acompanhar o domínio do remetente**: `Message-ID` de um
   * domínio que não é o de quem assina é sinal de spoof para filtro de spam — e este e-mail leva
   * PDF de guia em anexo, o perfil que mais cai em spam.
   * ⚠ Migrado de `belgencontabilidade.com` em 30/08/2026, junto com o Workspace.
   */
  const fromDomain = fromEmail.split("@")[1] || "altan.company";
  const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2, 10)}@${fromDomain}>`;
  /**
   * ⚠ Reply-To: o contador, nunca a service account (o bounce voltaria para uma caixa que não
   * existe). `MAIL_REPLY_TO` vazia mantém o comportamento de sempre — responde para o remetente.
   * ⚠ Ela existe porque a caixa que assina passou a ser `envio@`, um nome de caixa de SAÍDA, e a
   * resposta do cliente a um e-mail de guia ("paguei", "o PDF não abriu") precisa chegar em alguém.
   */
  const replyTo = MAIL_REPLY_TO || fromEmail;
  let head =
    `From: ${montarRemetente(from)}\r\n` +
    `To: ${to}\r\n` +
    `Reply-To: ${replyTo}\r\n` +
    `Subject: ${encodedSubject}\r\n` +
    `Message-ID: ${messageId}\r\n` +
    `Date: ${new Date().toUTCString()}\r\n` +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;
  let body = "";
  body += `--${boundary}\r\n`;
  body += 'Content-Type: text/html; charset="UTF-8"\r\n\r\n';
  body += `${html}\r\n`;
  for (const a of attachments || []) {
    const fileContent = fs.readFileSync(a.path);
    const base64Data = fileContent.toString("base64");
    // RFC 2045: o base64 PRECISA ser dobrado em linhas de até 76 chars. Sem isso vira uma linha
    // única gigante que estoura o limite de 998 octetos/linha do SMTP (RFC 5321) — relays quebram
    // a linha e corrompem o anexo → PDF que não abre ("folha branca"). O nodemailer (via SMTP)
    // dobra sozinho; aqui (MIME manual da via Gmail API) precisamos dobrar explicitamente.
    const base64Folded = base64Data.match(/.{1,76}/g)?.join("\r\n") || base64Data;
    const filename = a.filename || path.basename(a.path);
    body += `--${boundary}\r\n`;
    body += `Content-Type: application/pdf; name="${filename}"\r\n`;
    body += "Content-Transfer-Encoding: base64\r\n";
    body += `Content-Disposition: attachment; filename="${filename}"\r\n\r\n`;
    body += `${base64Folded}\r\n`;
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



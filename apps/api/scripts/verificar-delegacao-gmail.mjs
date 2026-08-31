// ⚠⚠ VERIFICA A DELEGAÇÃO DO GMAIL — sem tocar em produção, sem enviar nada por padrão.
//
// Ele exercita o MESMO caminho de `infrastructure/mail/EmailService.js`: `google.auth.JWT` com
// `subject` (impersonação) e o escopo `gmail.send`. Se passar aqui, passa lá.
//
// ⚠ POR QUE ISTO EXISTE: trocar `GMAIL_DELEGATED_USER`/`SMTP_FROM` no Railway antes de a delegação
// funcionar DERRUBA o envio de guias — e o sintoma chega como e-mail que não sai, horas depois.
// Este script move a descoberta para antes da troca.
//
// ⚠ A CHAVE PRIVADA NUNCA É IMPRESSA. O script lê o arquivo, usa e descarta.
//
// Uso:
//   node scripts/verificar-delegacao-gmail.mjs <caminho-do.json> envio@altan.company
//   node scripts/verificar-delegacao-gmail.mjs <caminho-do.json> envio@altan.company --enviar-para you@exemplo.com
//
// ⚠ `--enviar-para` MANDA UM E-MAIL DE VERDADE, pela caixa impersonada. Sem ele, o script só
// autoriza (nada sai da máquina em direção a ninguém).

import { readFileSync } from "node:fs";
import { google } from "googleapis";

const [caminho, subject] = process.argv.slice(2);
const iEnviar = process.argv.indexOf("--enviar-para");
const destino = iEnviar > -1 ? process.argv[iEnviar + 1] : null;

if (!caminho || !subject) {
  console.log("uso: node scripts/verificar-delegacao-gmail.mjs <chave.json> <caixa@dominio> [--enviar-para alguem@dominio]");
  process.exit(1);
}

let cred;
try {
  cred = JSON.parse(readFileSync(caminho, "utf8"));
} catch (e) {
  console.log(`✖ não consegui ler o JSON em "${caminho}": ${e.message}`);
  process.exit(1);
}

// ⚠ SÓ identidade. `private_key` é usada e nunca impressa.
console.log("credencial lida:");
console.log("  project_id  :", cred.project_id);
console.log("  client_email:", cred.client_email);
console.log("  client_id   :", cred.client_id, " ⟵ é ESTE o número que a delegação pede");
console.log("  private_key :", cred.private_key ? "presente" : "AUSENTE ⚠");
console.log("  subject     :", subject, "(a caixa que vai assinar)\n");

const auth = new google.auth.JWT({
  email: cred.client_email,
  key: cred.private_key,
  scopes: ["https://www.googleapis.com/auth/gmail.send"],
  subject,
});

try {
  await auth.authorize();
  console.log("✔ DELEGAÇÃO OK — a service account conseguiu impersonar", subject);
} catch (err) {
  const detalhe = err?.response?.data?.error_description || err?.message || String(err);
  console.log("✖ FALHOU:", detalhe, "\n");
  console.log("o que conferir, na ordem:");
  console.log("  1. o Client ID autorizado no Workspace é", cred.client_id, "? (não o e-mail da conta)");
  console.log("  2. o escopo é exatamente https://www.googleapis.com/auth/gmail.send ?");
  console.log("  3. a caixa", subject, "existe no Workspace altan.company ?");
  console.log("  4. a Gmail API está ATIVADA no projeto", cred.project_id, "?");
  console.log("  5. a autorização foi feita no Workspace NOVO (altan.company), não no antigo?");
  process.exit(1);
}

if (!destino) {
  console.log("\n(nada foi enviado — use --enviar-para <email> para mandar um teste de verdade)");
  process.exit(0);
}

// ⚠ A partir daqui SAI E-MAIL DE VERDADE, pela caixa impersonada.
const gmail = google.gmail({ version: "v1", auth });
const mime = [
  `From: ${subject}`,
  `To: ${destino}`,
  `Reply-To: ${subject}`,
  "Subject: =?UTF-8?B?" + Buffer.from("Teste de delegacao - Altan").toString("base64") + "?=",
  "MIME-Version: 1.0",
  'Content-Type: text/html; charset="UTF-8"',
  "",
  "<p>Se você está lendo isto, a delegação do Workspace <strong>altan.company</strong> está funcionando.</p>",
].join("\r\n");

const raw = Buffer.from(mime).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const r = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
console.log("✔ ENVIADO para", destino, "— id:", r.data.id);
console.log("  confira no cabeçalho do e-mail recebido: dkim=pass e spf=pass");

// src/config.js
import "dotenv/config";
import pino from "pino";

export const log = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.NODE_ENV === "production"
      ? undefined
      : { target: "pino-pretty", options: { colorize: true } },
});

// === Flags de execução ===
export const FORCE_SEND = process.env.FORCE_SEND === "1" || false; // reenviar mesmo já processado

// === Google ===
export const GOOGLE_APPLICATION_CREDENTIALS =
  process.env.GOOGLE_APPLICATION_CREDENTIALS || "";
export const DRIVE_FOLDER_ID_CLIENTES =
  process.env.DRIVE_FOLDER_ID_CLIENTES || "";
export const SHEET_ID = process.env.SHEET_ID || "";
export const TARGET_MONTH = process.env.TARGET_MONTH || ""; // opcional: "09-2025"

// Gmail API (delegated / DWD)
export const USE_GMAIL_API = process.env.USE_GMAIL_API === "1" || false;
export const GMAIL_DELEGATED_USER = process.env.GMAIL_DELEGATED_USER || ""; // e.g. "yago@belgencontabilidade.com"

// SMTP (fallback)
export const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
export const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
export const SMTP_USER = process.env.SMTP_USER || "";
export const SMTP_PASS = process.env.SMTP_PASS || "";

// REMETENTE padrão (usado no cabeçalho do e-mail)
// prioridade: SMTP_FROM > GMAIL_DELEGATED_USER
export const FROM = (
  process.env.SMTP_FROM ||
  GMAIL_DELEGATED_USER ||
  ""
).trim();

// === API Keys ===
const rawApiKeys = process.env.API_KEYS || "";
export const API_KEYS = rawApiKeys
  .split(",")
  .map((key) => key.trim())
  .filter((key) => key.length > 0);

// SCOPES Google (Drive + Sheets; adiciona Gmail se habilitado)
export const SCOPES = [
  "https://www.googleapis.com/auth/drive", // precisamos escrever appProperties para persistir estado
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  ...(USE_GMAIL_API ? ["https://www.googleapis.com/auth/gmail.send"] : []),
];

// Sanidade básica (só loga; quem quiser pode “throw”)
if (!GOOGLE_APPLICATION_CREDENTIALS)
  log.warn("GOOGLE_APPLICATION_CREDENTIALS ausente no .env");
if (!DRIVE_FOLDER_ID_CLIENTES)
  log.warn("DRIVE_FOLDER_ID_CLIENTES ausente no .env");
if (!SHEET_ID) log.warn("SHEET_ID ausente no .env");
if (!FROM)
  log.warn("Remetente (FROM) vazio: defina SMTP_FROM ou GMAIL_DELEGATED_USER");
if (!API_KEYS.length)
  log.warn("API_KEYS vazio: defina pelo menos uma chave para proteger a API");

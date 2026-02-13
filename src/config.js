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

// === NFSe (Padrão Nacional) ===
export const NFSE_CERT_PFX_PATH = (process.env.NFSE_CERT_PFX_PATH || "").trim();
export const NFSE_CERT_PFX_PASSWORD = (process.env.NFSE_CERT_PFX_PASSWORD || "").trim();
// Suporte a nome legado (NFSE_RJ_BASE_URL) para compatibilidade
export const NFSE_BASE_URL = (
  process.env.NFSE_BASE_URL ||
  process.env.NFSE_RJ_BASE_URL ||
  ""
).trim(); // endpoint do provedor NFS-e Nacional
const nfseEnvRaw = (
  process.env.NFSE_ENV ||
  process.env.NFSE_RJ_ENV ||
  "producao"
)
  .toString()
  .trim()
  .toLowerCase();

// Normaliza nomes comuns para evitar erro de ambiente
export const NFSE_ENV =
  nfseEnvRaw === "homolog" ||
  nfseEnvRaw === "homologacao" ||
  nfseEnvRaw === "homologação" ||
  nfseEnvRaw === "test" ||
  nfseEnvRaw === "sandbox"
    ? "homolog"
    : "producao"; // default: produção
// Padrão nacional usa /nfse para DPS síncrona; ajuste via env se o provedor tiver outro path.
export const NFSE_PATH = (process.env.NFSE_PATH || "/nfse").trim();
// Endpoints de consulta.
export const NFSE_CONSULT_PATH = (process.env.NFSE_CONSULT_PATH || "/nfse/consulta").trim();
export const NFSE_DPS_PATH = (process.env.NFSE_DPS_PATH || "/dps").trim();
export const NFSE_NFSE_PATH = (process.env.NFSE_NFSE_PATH || "/nfse").trim();
export const NFSE_COD_MUNICIPIO = (process.env.NFSE_COD_MUNICIPIO || "").trim(); // cLocEmi (IBGE, 7 dígitos)
export const NFSE_EVENT_FIELD = (process.env.NFSE_EVENT_FIELD || "pedidoRegistroEventoXmlGZipB64").trim();
export const NFSE_EVENT_FORMAT = (process.env.NFSE_EVENT_FORMAT || "gzipB64").trim(); // "xml" | "gzipB64"

// === ADN (Ambiente Nacional de Dados) ===
export const ADN_BASE_URL = (process.env.ADN_BASE_URL || "").trim();
export const ADN_CERT_PATH = (process.env.ADN_CERT_PATH || "").trim();
export const ADN_KEY_PATH = (process.env.ADN_KEY_PATH || "").trim();
export const ADN_DFE_PATH = (process.env.ADN_DFE_PATH || "").trim();
export const ADN_CNPJ_CONSULTA = (process.env.ADN_CNPJ_CONSULTA || "").trim();
export const ADN_SYNC_CRON = (process.env.ADN_SYNC_CRON || "").trim();

// === Certificados por empresa (PFX) ===
export const CERT_STORAGE_PATH = (process.env.CERT_STORAGE_PATH || "").trim();
export const CERT_SECRET_KEY = (process.env.CERT_SECRET_KEY || "").trim();

// === API Keys ===
const rawApiKeys = process.env.API_KEYS || "";
export const API_KEYS = rawApiKeys
  .split(",")
  .map((key) => key.trim())
  .filter((key) => key.length > 0);

// === Auth (JWT) ===
function parseAuthUsers(rawUsers) {
  if (!rawUsers || !rawUsers.trim()) return [];
  try {
    const parsed = JSON.parse(rawUsers);
    if (!Array.isArray(parsed)) {
      log.warn("AUTH_USERS deve ser um array JSON de objetos");
      return [];
    }
    return parsed
      .map((user) => {
        if (!user || typeof user !== "object") return null;
        const username = String(user.username || "").trim();
        if (!username) return null;
        const password = user.password ? String(user.password) : undefined;
        const passwordHash = user.passwordHash
          ? String(user.passwordHash)
          : undefined;
        const role = user.role ? String(user.role) : "user";
        if (!password && !passwordHash) return null;
        return { username, password, passwordHash, role };
      })
      .filter(Boolean);
  } catch (err) {
    log.error({ err }, "Falha ao interpretar AUTH_USERS");
    return [];
  }
}

export const AUTH_USERS = parseAuthUsers(process.env.AUTH_USERS || "");
export const JWT_SECRET = (process.env.JWT_SECRET || "").trim();
export const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || "1h").trim();
export const REFRESH_TOKEN_EXPIRES_IN = (
  process.env.REFRESH_TOKEN_EXPIRES_IN || "7d"
).trim();

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
if (!AUTH_USERS.length)
  log.warn("AUTH_USERS vazio: configure pelo menos um usuário para login/password");
if (!JWT_SECRET)
  log.warn("JWT_SECRET vazio: tokens JWT não serão emitidos");
if (!NFSE_CERT_PFX_PATH)
  log.warn("NFSE_CERT_PFX_PATH ausente: emissão NFS-e ficará pendente");
if (!NFSE_CERT_PFX_PASSWORD)
  log.warn("NFSE_CERT_PFX_PASSWORD ausente: emissão NFS-e ficará pendente");
if (!NFSE_BASE_URL)
  log.warn("NFSE_BASE_URL ausente: configure o endpoint do provedor NFS-e Nacional");
if (NFSE_PATH === "/nfse/v1/rps")
  log.info("NFSE_PATH padrão (/nfse/v1/rps); ajuste se o provedor usar outro recurso");
if (!ADN_BASE_URL)
  log.warn("ADN_BASE_URL ausente: consulta ADN estará desabilitada");
if (!ADN_CERT_PATH)
  log.warn("ADN_CERT_PATH ausente: consulta ADN estará desabilitada");
if (!ADN_KEY_PATH)
  log.warn("ADN_KEY_PATH ausente: consulta ADN estará desabilitada");
if (!CERT_STORAGE_PATH)
  log.warn("CERT_STORAGE_PATH ausente: upload de certificados por empresa indisponível");
if (!CERT_SECRET_KEY)
  log.warn("CERT_SECRET_KEY ausente: criptografia de senha do certificado indisponível");
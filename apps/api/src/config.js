// src/config.js
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import pino from "pino";

const defaultEnvPath = path.resolve(process.cwd(), ".env");
const monorepoEnvPath = path.resolve(process.cwd(), "../../.env");
const resolvedEnvPath = process.env.DOTENV_CONFIG_PATH
  ? path.resolve(process.env.DOTENV_CONFIG_PATH)
  : fs.existsSync(defaultEnvPath)
    ? defaultEnvPath
    : monorepoEnvPath;

dotenv.config({ path: resolvedEnvPath });

export const log = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.NODE_ENV === "production"
      ? undefined
      : { target: "pino-pretty", options: { colorize: true } },
});

// === Google ===
export const GOOGLE_APPLICATION_CREDENTIALS =
  process.env.GOOGLE_APPLICATION_CREDENTIALS || "";
export const GOOGLE_APPLICATION_CREDENTIALS_JSON =
  process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "";

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
// Q8.B: removido suporte a NFSE_RJ_BASE_URL/NFSE_RJ_ENV legados (Padrão Nacional).
export const NFSE_BASE_URL = (process.env.NFSE_BASE_URL || "").trim();
const nfseEnvRaw = (process.env.NFSE_ENV || "producao")
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

// === Certificados por empresa (PFX) ===
export const CERT_STORAGE_PATH = (
  process.env.CERT_STORAGE_PATH || "./storage/certificates"
).trim();
// Q30 Fase 1: chave-mestra dos certificados — SEM fallback pro JWT_SECRET (era inseguro: o JWT muda
// ao invalidar sessões e podia tornar os certificados ilegíveis). Agora é obrigatória e dedicada.
// Gere com: openssl rand -base64 48
export const CERT_SECRET_KEY = (process.env.CERT_SECRET_KEY || "").trim();
export const CERT_SECRET_KEY_MIN_LENGTH = 32;

// Q35 Fase 2: cofre AWS KMS (envelope encryption). Quando AWS_KMS_CERT_KEY_ID está setado, novos
// certificados nascem cifrados por DEK (Data Encryption Key) gerada pelo KMS e cifrada pela master
// no HSM da AWS. Região/credenciais DEDICADAS (não reusa AWS_REGION do S3 de guias). Se as vars do
// KMS não vierem, cai nas AWS_* compartilhadas. CERT_SECRET_KEY permanece (legado + fallback local).
export const AWS_KMS_CERT_KEY_ID = (process.env.AWS_KMS_CERT_KEY_ID || "").trim();
export const AWS_KMS_REGION = (process.env.AWS_KMS_REGION || "sa-east-1").trim();
export const AWS_KMS_ACCESS_KEY_ID = (
  process.env.AWS_KMS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || ""
).trim();
export const AWS_KMS_SECRET_ACCESS_KEY =
  process.env.AWS_KMS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || "";

// === Ingestão de Guias ===
// PDFs entram por upload no portal e são gravados em `Guide.pdfBytes` (PostgreSQL).
export const GUIDE_WORKER_ENABLED = process.env.GUIDE_WORKER_ENABLED === "1";
export const GUIDE_WORKER_INTERVAL_SECONDS = Math.max(
  30,
  Number(process.env.GUIDE_WORKER_INTERVAL_SECONDS || 120)
);
export const GUIDE_EMAIL_WORKER_ENABLED = process.env.GUIDE_EMAIL_WORKER_ENABLED === "1";
export const SERPRO_PGDASD_WORKER_ENABLED = process.env.SERPRO_PGDASD_WORKER_ENABLED === "1";
export const SERPRO_DCTFWEB_WORKER_ENABLED = process.env.SERPRO_DCTFWEB_WORKER_ENABLED === "1";
// Q40: cron próprio de confirmação de pagamento (PAGTOWEB). Agenda vem do SerproRuntimeSettings.
export const SERPRO_PAYMENT_CONFIRMATION_WORKER_ENABLED = process.env.SERPRO_PAYMENT_CONFIRMATION_WORKER_ENABLED === "1";
// Q15.6: worker da fila de transmissão de apurações ao SERPRO (opt-in).
export const APURACAO_BATCH_WORKER_ENABLED = process.env.APURACAO_BATCH_WORKER_ENABLED === "1";
// Q12.B+++.5: worker automático de captura de NF-e (SEFAZ) e NFS-e (gov.br/nfse).
// Intervalo mínimo entre ciclos por CNPJ — respeita NT 2014.002 v1.10 (Consumo Indevido).
export const DFE_NOTAS_WORKER_ENABLED = process.env.DFE_NOTAS_WORKER_ENABLED === "1";
export const DFE_NOTAS_WORKER_INTERVAL_MIN = Number(process.env.DFE_NOTAS_WORKER_INTERVAL_MIN) || 60;
// Confere as NFS-e da competência contra o ADN nacional no dia 1 do mês seguinte, antes do
// fechamento. Agenda vem do SerproRuntimeSettings (rotina "conferencia").
export const CONFERENCIA_ADN_WORKER_ENABLED = process.env.CONFERENCIA_ADN_WORKER_ENABLED === "1";
// Q12.B+++.6: heartbeat — CNPJs com >N dias sem sync entram em prioridade alta
// (ignoram intervalo de 1h). Protege contra perder geração de NSU (regra 60 dias).
// Default 7 dias — bem abaixo do limite de 60 pra dar margem de erro.
export const DFE_NOTAS_HEARTBEAT_DAYS = Number(process.env.DFE_NOTAS_HEARTBEAT_DAYS) || 7;
/** Opcional: fixa YYYY-MM para alertas de guia (homolog). Vazio = mês civil anterior. */
export const GUIDE_COMPLIANCE_COMPETENCIA = (process.env.GUIDE_COMPLIANCE_COMPETENCIA || "").trim();
export const GUIDE_SCHEDULE_MAX_FILES_PER_COMPANY = Math.min(
  100,
  Math.max(1, Number(process.env.GUIDE_SCHEDULE_MAX_FILES_PER_COMPANY || 15))
);
export const GUIDE_STORAGE_PROVIDER = (
  process.env.GUIDE_STORAGE_PROVIDER ||
  process.env.STORAGE_PROVIDER ||
  "LOCAL"
)
  .trim()
  .toUpperCase();
export const GUIDE_STORAGE_BUCKET =
  (process.env.GUIDE_STORAGE_BUCKET || process.env.AWS_S3_BUCKET_NAME || "").trim();
export const GUIDE_STORAGE_REGION = (
  process.env.GUIDE_STORAGE_REGION ||
  process.env.AWS_REGION ||
  "auto"
).trim();
export const GUIDE_STORAGE_ENDPOINT = (
  process.env.GUIDE_STORAGE_ENDPOINT ||
  process.env.S3_ENDPOINT ||
  ""
).trim();
export const GUIDE_STORAGE_ACCESS_KEY_ID = (
  process.env.GUIDE_STORAGE_ACCESS_KEY_ID ||
  process.env.AWS_ACCESS_KEY_ID ||
  ""
).trim();
export const GUIDE_STORAGE_SECRET_ACCESS_KEY = (
  process.env.GUIDE_STORAGE_SECRET_ACCESS_KEY ||
  process.env.AWS_SECRET_ACCESS_KEY ||
  ""
).trim();
export const GUIDE_STORAGE_FORCE_PATH_STYLE =
  process.env.GUIDE_STORAGE_FORCE_PATH_STYLE === "1";
// ⚠ PERSISTÊNCIA: com provider LOCAL os PDFs (guias + relatório SITFIS) vivem NO DISCO do
// container. No Railway o filesystem é efêmero — sem um Volume montado, TODO DEPLOY APAGA os
// arquivos (foi o que causou o ENOENT ao ler um SITFIS gravado dias antes).
//
// ⚠⚠ CUIDADO COM O CAMINHO RELATIVO: o default é relativo ao CWD, e o processo NÃO roda em /app.
// O start é `npm run start:prod -w @contabilidade/api`, e o npm executa o script com o CWD do
// WORKSPACE → o default resolve para **/app/apps/api/storage/guides**, não /app/storage/guides.
// Volume montado em /app/storage não captura nada (erro cometido na 1ª configuração).
//
// Produção — escolha uma:
//   a) Volume montado em `/app/apps/api/storage`; ou
//   b) Volume em `/app/storage` + `GUIDE_LOCAL_STORAGE_DIR=/app/storage/guides` (absoluto,
//      imune a mudança de CWD — recomendado).
// Alternativa sem volume: GUIDE_STORAGE_PROVIDER=S3|R2 com bucket + credenciais.
// Resolução em 3 níveis, do mais explícito ao mais seguro:
//   1) GUIDE_LOCAL_STORAGE_DIR — manda sempre (use caminho ABSOLUTO em produção);
//   2) volume detectado — se existe /app/storage (o mount do Railway), grava lá. Isso conserta
//      sozinho o caso que nos custou todos os PDFs: o CWD é /app/apps/api (npm workspace), então
//      o default relativo caía em /app/apps/api/storage, FORA do volume, e sumia a cada deploy;
//   3) relativo ao CWD — desenvolvimento local.
function resolveStorageDir() {
  const doEnv = String(process.env.GUIDE_LOCAL_STORAGE_DIR || "").trim();
  if (doEnv) return doEnv;
  try {
    // Só aceita como volume se der pra ESCREVER — diretório existente porém read-only não serve.
    if (fs.existsSync("/app/storage")) {
      fs.accessSync("/app/storage", fs.constants.W_OK);
      return "/app/storage/guides";
    }
  } catch { /* sem volume acessível: cai no relativo */ }
  return "./storage/guides";
}
export const GUIDE_LOCAL_STORAGE_DIR = resolveStorageDir();
// Absoluto e visível: o problema anterior passou despercebido porque ninguém sabia ONDE estava
// gravando. Quem lê o log agora vê o caminho real.
export const GUIDE_LOCAL_STORAGE_DIR_ABS = path.resolve(GUIDE_LOCAL_STORAGE_DIR);

// === SERPRO / Integra Contador ===
export const SERPRO_ENABLE_PGDASD = process.env.SERPRO_ENABLE_PGDASD === "1";
// Q21: ingestão de parcelamento via SERPRO (OBTERPARC164/DETPAGTOPARC165). Default OFF.
// Só ligar após o teste de contrato passar verde no sandbox (nomes de campo confirmados).
export const INTEGRACAO_SERPRO_PARCELAMENTO = process.env.INTEGRACAO_SERPRO_PARCELAMENTO === "1";
export const SERPRO_BASE_URL = (process.env.SERPRO_BASE_URL || "").trim();
export const SERPRO_AUTH_URL = (process.env.SERPRO_AUTH_URL || "").trim();
export const SERPRO_TOKEN_PATH = (process.env.SERPRO_TOKEN_PATH || "/token").trim();
export const SERPRO_INTEGRA_CONTADOR_PATH = (
  process.env.SERPRO_INTEGRA_CONTADOR_PATH || "/integra-contador/v1"
).trim();
export const SERPRO_CONSUMER_KEY = (process.env.SERPRO_CONSUMER_KEY || "").trim();
export const SERPRO_CONSUMER_SECRET = (process.env.SERPRO_CONSUMER_SECRET || "").trim();
export const SERPRO_SCOPE = (process.env.SERPRO_SCOPE || "").trim();
export const SERPRO_ENV = (process.env.SERPRO_ENV || "homolog").trim().toLowerCase();
export const SERPRO_TIMEOUT_MS = Math.max(1000, Number(process.env.SERPRO_TIMEOUT_MS || 30000));
export const SERPRO_CERT_COMPANY_ID = (process.env.SERPRO_CERT_COMPANY_ID || "").trim();

// Módulo Fiscal M2 (spike): probe read-only da Consultar Declaração Completa DCTFWeb.
// OFF por padrão. Serviço /Consultar (leitura, sem ato fiscal), mas contrato NÃO validado —
// ligar só pra rodar o spike e desligar depois. Não persiste nada.
export const SERPRO_DCTFWEB_LP_PROBE_ENABLED = process.env.SERPRO_DCTFWEB_LP_PROBE_ENABLED === "1";

// Busca dos tributos do Lucro Presumido (CONSDECCOMPLETA33 + GERARGUIA31) pela aba Lançamentos.
// OFF por padrão pelo mesmo motivo do PAGTOWEB: o contrato do CONSDECCOMPLETA33 é `verificadoTrial:
// false` — veio da spec, não foi exercido contra empresa real, e o parse dos débitos sai por regex
// do texto do PDF. Pôr o botão na frente do contador promove isso a ferramenta diária; a flag
// existe para essa promoção ser uma decisão, não um efeito colateral. São 2 chamadas PAGAS por
// clique (a declaração e o DARF).
export const INTEGRACAO_SERPRO_DCTFWEB_LP = process.env.INTEGRACAO_SERPRO_DCTFWEB_LP === "1";

// Q40: PAGTOWEB (confirmação de pagamento por comprovante de arrecadação) — flag OFF por padrão.
// ⚠ NÃO INVENTAR: idServiço/payload precisam ser confirmados no catálogo oficial + validados no
// sandbox antes de ligar a flag. Defaults abaixo são o palpite da spec (verificadoTrial:false).
export const INTEGRACAO_SERPRO_PAGTOWEB = process.env.INTEGRACAO_SERPRO_PAGTOWEB === "1";
export const SERPRO_PAGTOWEB_SYSTEM = (process.env.SERPRO_PAGTOWEB_SYSTEM || "PAGTOWEB").trim();
export const SERPRO_PAGTOWEB_SERVICE_COMPROVANTE = (
  process.env.SERPRO_PAGTOWEB_SERVICE_COMPROVANTE || "COMPARRECADACAO72"
).trim();

// Q40: SITFIS (relatório de situação fiscal, assíncrono em 2 etapas) — flag OFF por padrão.
// ⚠ NÃO INVENTAR: idServiço/payload/polling confirmar no catálogo oficial + sandbox antes de ligar.
export const INTEGRACAO_SERPRO_SITFIS = process.env.INTEGRACAO_SERPRO_SITFIS === "1";
export const SERPRO_SITFIS_SYSTEM = (process.env.SERPRO_SITFIS_SYSTEM || "SITFIS").trim();
export const SERPRO_SITFIS_SERVICE_PROTOCOLO = (
  process.env.SERPRO_SITFIS_SERVICE_PROTOCOLO || "SOLICITARPROTOCOLO91"
).trim();
export const SERPRO_SITFIS_SERVICE_RELATORIO = (
  process.env.SERPRO_SITFIS_SERVICE_RELATORIO || "RELATORIOSITFIS92"
).trim();
// Catálogo oficial confirma versaoSistema "2.0" para o SITFIS (páginas de serviço atuais);
// a página de cenários trial ainda mostra "1.0" — por isso deixamos env-overridável (confirmar no trial/homolog).
export const SERPRO_SITFIS_VERSAO = (process.env.SERPRO_SITFIS_VERSAO || "2.0").trim();

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
// Portal Cliente (Contrato #1): audiência dos tokens da superfície INTERNA (portal do contador).
// O portal emite este `aud` e rejeita tokens de outra superfície (ex.: "portal-cliente").
export const PORTAL_AUDIENCE = (process.env.PORTAL_AUDIENCE || "portal-contador").trim();
export const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || "1h").trim();
export const REFRESH_TOKEN_EXPIRES_IN = (
  process.env.REFRESH_TOKEN_EXPIRES_IN || "7d"
).trim();

// Sanidade básica (só loga; quem quiser pode “throw”)
if (!GOOGLE_APPLICATION_CREDENTIALS && !GOOGLE_APPLICATION_CREDENTIALS_JSON)
  log.warn("GOOGLE_APPLICATION_CREDENTIALS/GOOGLE_APPLICATION_CREDENTIALS_JSON ausente no .env");
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
if (!process.env.CERT_STORAGE_PATH)
  log.warn("CERT_STORAGE_PATH ausente: usando fallback local ./storage/certificates");

// PDFs (guias + relatório SITFIS): diz ONDE está gravando e AVISA se for efêmero.
// A perda anterior passou despercebida justamente por não haver nenhum sinal disso no arranque.
if (GUIDE_STORAGE_PROVIDER === "LOCAL") {
  const dentroDeVolume = GUIDE_LOCAL_STORAGE_DIR_ABS.startsWith("/app/storage");
  const noContainer = fs.existsSync("/app");
  log.info(`PDFs em: ${GUIDE_LOCAL_STORAGE_DIR_ABS}${dentroDeVolume ? " (volume persistente)" : ""}`);
  if (noContainer && !dentroDeVolume) {
    log.warn(
      `⚠ ARMAZENAMENTO EFÊMERO: ${GUIDE_LOCAL_STORAGE_DIR_ABS} está FORA do volume — todo deploy apaga os PDFs. `
      + "Monte um Volume em /app/storage ou defina GUIDE_LOCAL_STORAGE_DIR=/app/storage/guides.",
    );
  }
}
// Q30 Fase 1: sem mais fallback pro JWT. A API recusa subir sem CERT_SECRET_KEY (fail-fast no server.js).
if (!CERT_SECRET_KEY)
  log.warn("CERT_SECRET_KEY ausente: defina uma chave dedicada (openssl rand -base64 48). A API não sobe sem ela.");
else if (CERT_SECRET_KEY.length < CERT_SECRET_KEY_MIN_LENGTH)
  log.warn(`CERT_SECRET_KEY curta (< ${CERT_SECRET_KEY_MIN_LENGTH} chars): use uma chave mais forte.`);
export const PDF_READER_URL = (process.env.PDF_READER_URL || "").trim();
export const PDF_READER_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.PDF_READER_TIMEOUT_MS || 30000)
);
if (!PDF_READER_URL)
  log.warn(
    "PDF_READER_URL ausente: configure a URL do serviço FastAPI pdf-reader (ex.: http://pdf-reader:8000 na rede interna)."
  );
if (SERPRO_ENABLE_PGDASD && !SERPRO_AUTH_URL && /\/integra-contador\//.test(SERPRO_BASE_URL))
  log.warn("SERPRO_AUTH_URL ausente: com SERPRO_BASE_URL completo da API, configure a URL de autenticacao separadamente");
if (SERPRO_ENABLE_PGDASD && !SERPRO_BASE_URL)
  log.warn("SERPRO_BASE_URL ausente: integracao SERPRO/PGDAS-D ficara desabilitada");
if (SERPRO_ENABLE_PGDASD && !SERPRO_CONSUMER_KEY)
  log.warn("SERPRO_CONSUMER_KEY ausente: integracao SERPRO/PGDAS-D ficara desabilitada");
if (SERPRO_ENABLE_PGDASD && !SERPRO_CONSUMER_SECRET)
  log.warn("SERPRO_CONSUMER_SECRET ausente: integracao SERPRO/PGDAS-D ficara desabilitada");
if (SERPRO_ENABLE_PGDASD && !SERPRO_CERT_COMPANY_ID)
  log.warn("SERPRO_CERT_COMPANY_ID ausente: configure a Company legada que armazena o certificado do escritorio/procurador");

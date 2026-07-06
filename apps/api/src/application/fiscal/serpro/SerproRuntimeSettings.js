import forge from "node-forge";
import { prisma } from "../../../infrastructure/db/prisma.js";
import {
  deleteCompanyPfx,
  isDatabaseCertificateStorageKey,
} from "../../../infrastructure/storage/CertStorage.js";
import { decryptSecret, encryptSecret, encryptBytes } from "../../../utils/crypto.js";
import { auditCertAccess } from "../../security/CertAccessAudit.js";
import { getSerproConfig } from "./SerproConfig.js";

const APP_SETTING_KEY = "serpro_runtime_settings";
const SERPRO_DB_CERT_STORAGE_KEY = "db:serpro-pfx";

function normalizeCron(value) {
  const raw = String(value || "").trim();
  return raw || "0 7 5 * *";
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

// Extrai dia do mês de uma cron expression (campo 3). Default 5.
function parseDayFromCron(cronStr) {
  const parts = String(cronStr || "").trim().split(/\s+/);
  if (parts.length < 5) return 5;
  const dayField = parts[2];
  const n = Number(dayField);
  return Number.isFinite(n) ? clampInt(n, 1, 31, 5) : 5;
}

// Extrai hora de uma cron expression (campo 2). Default 7.
function parseHourFromCron(cronStr) {
  const parts = String(cronStr || "").trim().split(/\s+/);
  if (parts.length < 5) return 7;
  const hourField = parts[1];
  const n = Number(hourField);
  return Number.isFinite(n) ? clampInt(n, 0, 23, 7) : 7;
}

function resolveFetchDay(stored) {
  if (stored.fetchDay != null) return clampInt(stored.fetchDay, 1, 31, 5);
  return parseDayFromCron(stored.fetchCron);
}

function resolveFetchHour(stored) {
  if (stored.fetchHour != null) return clampInt(stored.fetchHour, 0, 23, 7);
  return parseHourFromCron(stored.fetchCron);
}

// Q40: cron próprio de confirmação de pagamento (PAGTOWEB). Independente da captura (fetch*).
function resolvePaymentConfirmationEnabled(stored) {
  return stored.paymentConfirmationEnabled === true;
}

function resolvePaymentConfirmationDay(stored) {
  return clampInt(stored.paymentConfirmationDay, 1, 31, 10);
}

function resolvePaymentConfirmationHour(stored) {
  return clampInt(stored.paymentConfirmationHour, 0, 23, 8);
}

// Q54: janela de retry — o cron dispara do dia D até D+FETCH_RETRY_DAYS (ex.: dia 10 → 10,11,12).
// Não é re-fetch: as travas de idempotência (Stage 1 `!existente`, Stage 3 `serproSyncStatus="SUCCESS"`)
// fazem a captura acontecer UMA vez; os dias seguintes só re-tentam SE a captura do dia D falhou.
const FETCH_RETRY_DAYS = 2;

// Q54: fetchCron derivado = MENSAL a partir do dia+hora escolhidos ("0 H D-Dend * *"). No dia
// configurado (ex.: dia 10) o worker busca a ÚLTIMA competência (mês anterior) de DAS/INSS/extrato,
// com uma pequena janela de retry nos dias seguintes. Antes era diário; recálculo pontual é manual.
function deriveMonthlyCron(day, hour) {
  const d = clampInt(day, 1, 31, 5);
  const h = clampInt(hour, 0, 23, 7);
  const end = Math.min(d + FETCH_RETRY_DAYS, 31);
  const dayField = end > d ? `${d}-${end}` : `${d}`;
  return `0 ${h} ${dayField} * *`;
}

function normalizeTimeout(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1000, parsed);
}

function getStoredValue(setting) {
  return setting?.value && typeof setting.value === "object" ? setting.value : {};
}

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function joinUrl(base, path) {
  const normalizedBase = normalizeUrl(base);
  const normalizedPath = String(path || "").trim();
  if (!normalizedBase) return "";
  if (!normalizedPath) return normalizedBase;
  if (/^https?:\/\//i.test(normalizedPath)) return normalizeUrl(normalizedPath);
  return `${normalizedBase}/${normalizedPath.replace(/^\/+/, "")}`;
}

function resolveStoredAuthUrl(stored, config) {
  if (stored.authUrl) return normalizeUrl(stored.authUrl);
  if (config.authUrl) return normalizeUrl(config.authUrl);
  const normalizedStoredBase = normalizeUrl(stored.baseUrl);
  const normalizedLegacyApiPath = String(stored.integraContadorPath || "").trim().replace(/^\/+/, "");
  if (!normalizedStoredBase) return "";
  if (normalizedLegacyApiPath && normalizedStoredBase.includes(normalizedLegacyApiPath)) return "";
  return joinUrl(normalizedStoredBase, stored.tokenPath || "");
}

function resolveStoredApiBaseUrl(stored, config) {
  if (stored.baseUrl) {
    const normalizedStoredBase = normalizeUrl(stored.baseUrl);
    const normalizedLegacyPath = String(stored.integraContadorPath || "").trim().replace(/^\/+/, "");
    if (normalizedLegacyPath && !normalizedStoredBase.includes(normalizedLegacyPath)) {
      return joinUrl(normalizedStoredBase, normalizedLegacyPath);
    }
    return normalizedStoredBase;
  }
  return normalizeUrl(config.baseUrl);
}

function parsePfxExpiry(pfxBuffer, password) {
  try {
    const p12Asn1 = forge.asn1.fromDer(pfxBuffer.toString("binary"));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);
    const certBag = p12.getBags({ bagType: forge.pki.oids.certBag })?.[forge.pki.oids.certBag]?.[0];
    const cert = certBag?.cert;
    if (!cert || !cert.validity?.notAfter) return null;
    return cert.validity.notAfter;
  } catch {
    return null;
  }
}

function parsePfxDocument(pfxBuffer, password) {
  try {
    const p12Asn1 = forge.asn1.fromDer(pfxBuffer.toString("binary"));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);
    const certBag = p12.getBags({ bagType: forge.pki.oids.certBag })?.[forge.pki.oids.certBag]?.[0];
    const cert = certBag?.cert;
    const attributes = Array.isArray(cert?.subject?.attributes) ? cert.subject.attributes : [];
    const candidates = [
      ...attributes
        .filter((item) => item?.name === "serialNumber" || item?.type === "2.5.4.5")
        .map((item) => item?.value),
      ...attributes
        .filter((item) => item?.name === "commonName" || item?.shortName === "CN")
        .map((item) => item?.value),
      ...attributes
        .filter((item) => item?.name === "organizationalUnitName" || item?.shortName === "OU")
        .map((item) => item?.value),
    ];

    for (const candidate of candidates) {
      const matches = String(candidate || "").match(/\d{14}/g);
      const raw = matches?.[matches.length - 1] || "";
      if (raw.length === 14) return raw;
    }

    return null;
  } catch {
    return null;
  }
}

export async function getSerproRuntimeSettings() {
  const config = getSerproConfig();
  const setting = await prisma.appSetting.findUnique({ where: { key: APP_SETTING_KEY } });
  const stored = getStoredValue(setting);
  const consumerSecret = stored.consumerSecretEnc
    ? await decryptSecret(stored.consumerSecretEnc)
    : String(config.consumerSecret || "");

  return {
    enabled: stored.enabled ?? config.enabled,
    environment: String(stored.environment || config.environment || "homolog"),
    authUrl: resolveStoredAuthUrl(stored, config),
    baseUrl: resolveStoredApiBaseUrl(stored, config),
    consumerKey: String(stored.consumerKey || config.consumerKey || ""),
    consumerSecret,
    consumerSecretConfigured: Boolean(stored.consumerSecretEnc || config.consumerSecret),
    scope: String(stored.scope || config.scope || ""),
    timeoutMs: normalizeTimeout(stored.timeoutMs, config.timeoutMs),
    fetchDay: resolveFetchDay(stored),
    fetchHour: resolveFetchHour(stored),
    fetchCron: deriveMonthlyCron(resolveFetchDay(stored), resolveFetchHour(stored)),
    // Q40: cron próprio de confirmação de pagamento (dia/hora configuráveis + on/off).
    paymentConfirmationEnabled: resolvePaymentConfirmationEnabled(stored),
    paymentConfirmationDay: resolvePaymentConfirmationDay(stored),
    paymentConfirmationHour: resolvePaymentConfirmationHour(stored),
    paymentConfirmationCron: deriveMonthlyCron(resolvePaymentConfirmationDay(stored), resolvePaymentConfirmationHour(stored)),
    certificate: {
      hasCertificate: Boolean(stored.certPfxBase64 || stored.certStorageKey),
      storageKey: stored.certStorageKey || (stored.certPfxBase64 ? SERPRO_DB_CERT_STORAGE_KEY : null),
      originalName: stored.certOriginalName || null,
      uploadedAt: stored.certUploadedAt || null,
      expiresAt: stored.certExpiresAt || null,
      document: stored.certDocument || null,
      passwordConfigured: Boolean(stored.certPasswordEnc),
    },
    source: {
      usingEnvAuthUrl: !stored.authUrl && Boolean(config.authUrl),
      usingEnvBaseUrl: !stored.baseUrl && Boolean(config.baseUrl),
      usingEnvConsumerKey: !stored.consumerKey && Boolean(config.consumerKey),
      usingEnvConsumerSecret: !stored.consumerSecretEnc && Boolean(config.consumerSecret),
    },
  };
}

export async function getResolvedSerproCredentials() {
  const setting = await prisma.appSetting.findUnique({ where: { key: APP_SETTING_KEY } });
  const stored = getStoredValue(setting);
  const settings = await getSerproRuntimeSettings();
  const certPassword = settings.certificate.passwordConfigured
    ? await decryptSecret(stored.certPasswordEnc)
    : null;
  const credentials = {
    enabled: Boolean(settings.enabled),
    environment: settings.environment,
    authUrl: settings.authUrl,
    baseUrl: settings.baseUrl,
    consumerKey: settings.consumerKey,
    consumerSecret: settings.consumerSecret,
    scope: settings.scope,
    timeoutMs: settings.timeoutMs,
    fetchDay: settings.fetchDay,
    fetchHour: settings.fetchHour,
    fetchCron: settings.fetchCron,
    certificate: {
      ...settings.certificate,
      pfxBase64: stored.certPfxBase64 || null,
      password: certPassword,
    },
  };

  if (!credentials.enabled) {
    const err = new Error("serpro_pgdasd_disabled");
    err.code = "SERPRO_PGDASD_DISABLED";
    throw err;
  }
  if (!credentials.baseUrl) {
    const err = new Error("serpro_base_url_not_configured");
    err.code = "SERPRO_BASE_URL_NOT_CONFIGURED";
    throw err;
  }
  if (!credentials.authUrl) {
    const err = new Error("serpro_auth_url_not_configured");
    err.code = "SERPRO_AUTH_URL_NOT_CONFIGURED";
    throw err;
  }
  if (!credentials.consumerKey) {
    const err = new Error("serpro_consumer_key_not_configured");
    err.code = "SERPRO_CONSUMER_KEY_NOT_CONFIGURED";
    throw err;
  }
  if (!credentials.consumerSecret) {
    const err = new Error("serpro_consumer_secret_not_configured");
    err.code = "SERPRO_CONSUMER_SECRET_NOT_CONFIGURED";
    throw err;
  }

  // Q30: trilha de auditoria (best-effort) quando a senha do cert do escritório foi descriptografada.
  if (credentials.certificate?.passwordConfigured) {
    await auditCertAccess({ certKind: "OFFICE_SERPRO", action: "DECRYPT", consumer: "getResolvedSerproCredentials" });
  }

  return credentials;
}

export async function updateSerproRuntimeSettings(input = {}) {
  const setting = await prisma.appSetting.findUnique({ where: { key: APP_SETTING_KEY } });
  const stored = getStoredValue(setting);
  const config = getSerproConfig();

  // Resolve fetchDay/fetchHour priorizando entrada explícita; cai pra stored, e por
  // último deriva do fetchCron salvo (compat com bancos antigos).
  const nextFetchDay = input.fetchDay !== undefined
    ? clampInt(input.fetchDay, 1, 31, 5)
    : resolveFetchDay(stored);
  const nextFetchHour = input.fetchHour !== undefined
    ? clampInt(input.fetchHour, 0, 23, 7)
    : resolveFetchHour(stored);

  // Q40: cron de confirmação de pagamento (independente do fetch*).
  const nextPaymentEnabled = input.paymentConfirmationEnabled !== undefined
    ? Boolean(input.paymentConfirmationEnabled)
    : resolvePaymentConfirmationEnabled(stored);
  const nextPaymentDay = input.paymentConfirmationDay !== undefined
    ? clampInt(input.paymentConfirmationDay, 1, 31, 10)
    : resolvePaymentConfirmationDay(stored);
  const nextPaymentHour = input.paymentConfirmationHour !== undefined
    ? clampInt(input.paymentConfirmationHour, 0, 23, 8)
    : resolvePaymentConfirmationHour(stored);

  const next = {
    ...stored,
    enabled: input.enabled === undefined ? stored.enabled ?? config.enabled ?? false : Boolean(input.enabled),
    environment: input.environment === undefined ? stored.environment || "homolog" : String(input.environment || "homolog").trim().toLowerCase(),
    authUrl: input.authUrl === undefined ? resolveStoredAuthUrl(stored, { authUrl: "", baseUrl: "" }) : normalizeUrl(input.authUrl),
    baseUrl: input.baseUrl === undefined ? resolveStoredApiBaseUrl(stored, { baseUrl: "" }) : normalizeUrl(input.baseUrl),
    consumerKey: input.consumerKey === undefined ? stored.consumerKey || "" : String(input.consumerKey || "").trim(),
    scope: input.scope === undefined ? stored.scope || "" : String(input.scope || "").trim(),
    timeoutMs: input.timeoutMs === undefined ? normalizeTimeout(stored.timeoutMs, 30000) : normalizeTimeout(input.timeoutMs, 30000),
    fetchDay: nextFetchDay,
    fetchHour: nextFetchHour,
    // Q54: fetchCron derivado = mensal no dia+hora escolhidos — não armazena cron arbitrário.
    fetchCron: deriveMonthlyCron(nextFetchDay, nextFetchHour),
    // Q40: cron próprio de confirmação de pagamento.
    paymentConfirmationEnabled: nextPaymentEnabled,
    paymentConfirmationDay: nextPaymentDay,
    paymentConfirmationHour: nextPaymentHour,
  };

  if (input.consumerSecret !== undefined) {
    const nextSecret = String(input.consumerSecret || "").trim();
    if (nextSecret) {
      next.consumerSecretEnc = await encryptSecret(nextSecret);
    }
  }

  await prisma.appSetting.upsert({
    where: { key: APP_SETTING_KEY },
    create: { key: APP_SETTING_KEY, value: next },
    update: { value: next },
  });

  return getSerproRuntimeSettings();
}

export async function uploadSerproCertificate({ file, password }) {
  if (!file?.buffer) {
    const err = new Error("pfx_required");
    err.code = "PFX_REQUIRED";
    throw err;
  }
  if (!password) {
    const err = new Error("password_required");
    err.code = "PASSWORD_REQUIRED";
    throw err;
  }

  const setting = await prisma.appSetting.findUnique({ where: { key: APP_SETTING_KEY } });
  const stored = getStoredValue(setting);
  const previousStorageKey = stored.certStorageKey || null;
  const expiresAt = parsePfxExpiry(file.buffer, password);
  const now = new Date();

  const next = {
    ...stored,
    // First-time setup usually starts with the certificate upload. If the office
    // has not explicitly disabled the integration, enable it automatically.
    enabled: stored.enabled ?? true,
    certStorageKey: SERPRO_DB_CERT_STORAGE_KEY,
    certPfxBase64: (await encryptBytes(file.buffer)).toString("base64"), // Q30/Q35: PFX cifrado em repouso

    certOriginalName: String(file.originalname || "certificado-serpro.pfx"),
    certPasswordEnc: await encryptSecret(password),
    certUploadedAt: now.toISOString(),
    certExpiresAt: expiresAt ? expiresAt.toISOString() : null,
    certDocument: parsePfxDocument(file.buffer, password),
  };

  await prisma.appSetting.upsert({
    where: { key: APP_SETTING_KEY },
    create: { key: APP_SETTING_KEY, value: next },
    update: { value: next },
  });

  if (previousStorageKey && !isDatabaseCertificateStorageKey(previousStorageKey)) {
    try {
      deleteCompanyPfx(previousStorageKey);
    } catch {
      // best effort
    }
  }

  await auditCertAccess({ certKind: "OFFICE_SERPRO", action: "UPLOAD", consumer: "uploadSerproCertificate" });
  return getSerproRuntimeSettings();
}

export async function deleteSerproCertificate() {
  const setting = await prisma.appSetting.findUnique({ where: { key: APP_SETTING_KEY } });
  const stored = getStoredValue(setting);
  const previousStorageKey = stored.certStorageKey || null;
  const next = {
    ...stored,
    certStorageKey: null,
    certPfxBase64: null,
    certOriginalName: null,
    certPasswordEnc: null,
    certUploadedAt: null,
    certExpiresAt: null,
    certDocument: null,
  };

  await prisma.appSetting.upsert({
    where: { key: APP_SETTING_KEY },
    create: { key: APP_SETTING_KEY, value: next },
    update: { value: next },
  });

  let deletedFile = false;
  if (previousStorageKey && !isDatabaseCertificateStorageKey(previousStorageKey)) {
    try {
      deletedFile = deleteCompanyPfx(previousStorageKey);
    } catch {
      deletedFile = false;
    }
  }

  await auditCertAccess({ certKind: "OFFICE_SERPRO", action: "DELETE", consumer: "deleteSerproCertificate" });
  return {
    deletedFile,
    settings: await getSerproRuntimeSettings(),
  };
}

import forge from "node-forge";
import { prisma } from "../../../infrastructure/db/prisma.js";
import {
  deleteCompanyPfx,
  isDatabaseCertificateStorageKey,
} from "../../../infrastructure/storage/CertStorage.js";
import { decryptSecret, encryptSecret } from "../../../utils/crypto.js";
import { getSerproConfig } from "./SerproConfig.js";

const APP_SETTING_KEY = "serpro_runtime_settings";
const SERPRO_DB_CERT_STORAGE_KEY = "db:serpro-pfx";

function normalizeCron(value) {
  const raw = String(value || "").trim();
  return raw || "0 7 5 * *";
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

  return {
    enabled: stored.enabled ?? config.enabled,
    environment: String(stored.environment || config.environment || "homolog"),
    authUrl: resolveStoredAuthUrl(stored, config),
    baseUrl: resolveStoredApiBaseUrl(stored, config),
    consumerKey: String(stored.consumerKey || config.consumerKey || ""),
    consumerSecret: stored.consumerSecretEnc ? decryptSecret(stored.consumerSecretEnc) : String(config.consumerSecret || ""),
    consumerSecretConfigured: Boolean(stored.consumerSecretEnc || config.consumerSecret),
    scope: String(stored.scope || config.scope || ""),
    timeoutMs: normalizeTimeout(stored.timeoutMs, config.timeoutMs),
    fetchCron: normalizeCron(stored.fetchCron),
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
  const credentials = {
    enabled: Boolean(settings.enabled),
    environment: settings.environment,
    authUrl: settings.authUrl,
    baseUrl: settings.baseUrl,
    consumerKey: settings.consumerKey,
    consumerSecret: settings.consumerSecret,
    scope: settings.scope,
    timeoutMs: settings.timeoutMs,
    fetchCron: settings.fetchCron,
    certificate: {
      ...settings.certificate,
      pfxBase64: stored.certPfxBase64 || null,
      password: settings.certificate.passwordConfigured ? decryptSecret(stored.certPasswordEnc) : null,
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

  return credentials;
}

export async function updateSerproRuntimeSettings(input = {}) {
  const setting = await prisma.appSetting.findUnique({ where: { key: APP_SETTING_KEY } });
  const stored = getStoredValue(setting);
  const config = getSerproConfig();

  const next = {
    ...stored,
    enabled: input.enabled === undefined ? stored.enabled ?? config.enabled ?? false : Boolean(input.enabled),
    environment: input.environment === undefined ? stored.environment || "homolog" : String(input.environment || "homolog").trim().toLowerCase(),
    authUrl: input.authUrl === undefined ? resolveStoredAuthUrl(stored, { authUrl: "", baseUrl: "" }) : normalizeUrl(input.authUrl),
    baseUrl: input.baseUrl === undefined ? resolveStoredApiBaseUrl(stored, { baseUrl: "" }) : normalizeUrl(input.baseUrl),
    consumerKey: input.consumerKey === undefined ? stored.consumerKey || "" : String(input.consumerKey || "").trim(),
    scope: input.scope === undefined ? stored.scope || "" : String(input.scope || "").trim(),
    timeoutMs: input.timeoutMs === undefined ? normalizeTimeout(stored.timeoutMs, 30000) : normalizeTimeout(input.timeoutMs, 30000),
    fetchCron: input.fetchCron === undefined ? normalizeCron(stored.fetchCron) : normalizeCron(input.fetchCron),
  };

  if (input.consumerSecret !== undefined) {
    const nextSecret = String(input.consumerSecret || "").trim();
    if (nextSecret) {
      next.consumerSecretEnc = encryptSecret(nextSecret);
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
    certPfxBase64: file.buffer.toString("base64"),
    certOriginalName: String(file.originalname || "certificado-serpro.pfx"),
    certPasswordEnc: encryptSecret(password),
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

  return {
    deletedFile,
    settings: await getSerproRuntimeSettings(),
  };
}

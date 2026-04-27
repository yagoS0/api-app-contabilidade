import {
  SERPRO_AUTH_URL,
  SERPRO_BASE_URL,
  SERPRO_CONSUMER_KEY,
  SERPRO_CONSUMER_SECRET,
  SERPRO_ENABLE_PGDASD,
  SERPRO_ENV,
  SERPRO_INTEGRA_CONTADOR_PATH,
  SERPRO_SCOPE,
  SERPRO_TIMEOUT_MS,
  SERPRO_TOKEN_PATH,
} from "../../../config.js";

function joinUrl(base, path) {
  const normalizedBase = String(base || "").trim().replace(/\/+$/, "");
  const normalizedPath = String(path || "").trim();
  if (!normalizedBase) return "";
  if (!normalizedPath) return normalizedBase;
  if (/^https?:\/\//i.test(normalizedPath)) return normalizedPath;
  return `${normalizedBase}/${normalizedPath.replace(/^\/+/, "")}`;
}

function resolveApiBaseUrl() {
  const normalizedBaseUrl = String(SERPRO_BASE_URL || "").trim().replace(/\/+$/, "");
  const normalizedLegacyPath = String(SERPRO_INTEGRA_CONTADOR_PATH || "").trim().replace(/^\/+/, "");
  if (!normalizedBaseUrl) return "";
  if (normalizedLegacyPath && !normalizedBaseUrl.includes(normalizedLegacyPath)) {
    return joinUrl(normalizedBaseUrl, normalizedLegacyPath);
  }
  return normalizedBaseUrl;
}

function resolveAuthUrl() {
  if (SERPRO_AUTH_URL) return String(SERPRO_AUTH_URL).trim().replace(/\/+$/, "");
  const normalizedBaseUrl = String(SERPRO_BASE_URL || "").trim().replace(/\/+$/, "");
  const normalizedLegacyApiPath = String(SERPRO_INTEGRA_CONTADOR_PATH || "").trim().replace(/^\/+/, "");
  if (!normalizedBaseUrl) return "";
  if (normalizedLegacyApiPath && normalizedBaseUrl.includes(normalizedLegacyApiPath)) return "";
  return joinUrl(normalizedBaseUrl, SERPRO_TOKEN_PATH);
}

export function getSerproConfig() {
  return {
    enabled: SERPRO_ENABLE_PGDASD,
    environment: SERPRO_ENV,
    authUrl: resolveAuthUrl(),
    baseUrl: resolveApiBaseUrl(),
    consumerKey: SERPRO_CONSUMER_KEY,
    consumerSecret: SERPRO_CONSUMER_SECRET,
    scope: SERPRO_SCOPE,
    timeoutMs: SERPRO_TIMEOUT_MS,
  };
}

export function assertSerproConfig(config = getSerproConfig()) {
  if (!config.enabled) {
    const err = new Error("serpro_pgdasd_disabled");
    err.code = "SERPRO_PGDASD_DISABLED";
    throw err;
  }
  return config;
}

import fs from "node:fs";
import path from "node:path";
import { CERT_STORAGE_PATH } from "../../config.js";

export const COMPANY_DB_CERT_STORAGE_KEY = "db:company-pfx";

function ensureConfigured() {
  if (!CERT_STORAGE_PATH) {
    const err = new Error("cert_storage_not_configured");
    err.code = "CERT_STORAGE_NOT_CONFIGURED";
    throw err;
  }
}

export function ensureCertStorageDir() {
  ensureConfigured();
  fs.mkdirSync(CERT_STORAGE_PATH, { recursive: true });
  return CERT_STORAGE_PATH;
}

export function isDatabaseCertificateStorageKey(storageKey) {
  return String(storageKey || "").startsWith("db:");
}

export function resolveCertificatePath(storageKey) {
  ensureConfigured();
  if (!storageKey) return null;
  const safe = String(storageKey).replace(/\\/g, "/").replace(/\.\./g, "");
  const full = path.resolve(CERT_STORAGE_PATH, safe);
  const root = path.resolve(CERT_STORAGE_PATH);
  if (!full.startsWith(root)) {
    const err = new Error("invalid_storage_key");
    err.code = "CERT_INVALID_STORAGE_KEY";
    throw err;
  }
  return full;
}

export function saveCompanyPfx({ companyId, originalName, buffer }) {
  ensureCertStorageDir();
  if (!companyId) {
    const err = new Error("company_id_required");
    err.code = "COMPANY_ID_REQUIRED";
    throw err;
  }
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    const err = new Error("pfx_required");
    err.code = "PFX_REQUIRED";
    throw err;
  }
  const ext = (originalName || "").toLowerCase().endsWith(".pfx") ? ".pfx" : ".pfx";
  const filename = `${String(companyId)}-${Date.now()}${ext}`;
  const fullPath = resolveCertificatePath(filename);
  fs.writeFileSync(fullPath, buffer);
  return filename;
}

export function readStoredCompanyPfx(company) {
  if (company?.certPfxBytes) {
    return Buffer.isBuffer(company.certPfxBytes)
      ? company.certPfxBytes
      : Buffer.from(company.certPfxBytes);
  }
  if (!company?.certStorageKey || isDatabaseCertificateStorageKey(company.certStorageKey)) {
    return null;
  }
  const fullPath = resolveCertificatePath(company.certStorageKey);
  if (!fullPath || !fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath);
}

export function deleteCompanyPfx(storageKey) {
  if (!storageKey) return false;
  if (isDatabaseCertificateStorageKey(storageKey)) return false;
  ensureConfigured();
  const fullPath = resolveCertificatePath(storageKey);
  if (!fullPath) return false;
  try {
    fs.unlinkSync(fullPath);
    return true;
  } catch (err) {
    if (err?.code === "ENOENT") return false;
    throw err;
  }
}

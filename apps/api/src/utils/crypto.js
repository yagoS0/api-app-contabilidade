import crypto from "node:crypto";
import { CERT_SECRET_KEY } from "../config.js";

function getKey32() {
  if (!CERT_SECRET_KEY || CERT_SECRET_KEY.length < 16) {
    const err = new Error("cert_secret_key_not_configured");
    err.code = "CERT_SECRET_KEY_NOT_CONFIGURED";
    throw err;
  }
  // Deriva uma chave 32 bytes estável a partir do secret (SHA-256).
  return crypto.createHash("sha256").update(CERT_SECRET_KEY, "utf8").digest();
}

export function encryptSecret(plainText) {
  if (plainText === undefined || plainText === null) return null;
  const value = String(plainText);
  const key = getKey32();
  const iv = crypto.randomBytes(12); // GCM recomenda 12 bytes
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString(
    "base64"
  )}`;
}

export function decryptSecret(encrypted) {
  if (!encrypted) return null;
  const raw = String(encrypted);
  const parts = raw.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    // compat: retorna o valor "como está" (não ideal), mas evita quebrar dados antigos.
    return raw;
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const key = getKey32();
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  return plain.toString("utf8");
}


import crypto from "node:crypto";
import { CERT_SECRET_KEY } from "../config.js";
import { isKmsEnabled, generateDataKey, decryptDataKey } from "../infrastructure/security/KmsCertVault.js";

// Q35 Fase 2: cofre AWS KMS (envelope encryption). Quando o KMS está habilitado, NOVOS segredos/certs
// nascem cifrados por uma DEK gerada pelo KMS (formato `kms-v1:` / `PFXKMSv1:`), e a DEK cifrada viaja
// embutida no próprio blob (sem mudar schema). Sem KMS, mantém o formato local (`v1:` / `PFXENCv1:`)
// derivado do CERT_SECRET_KEY. A leitura detecta o formato pelo prefixo → migração LAZY (certs antigos
// seguem funcionando; só uploads novos viram kms-v1). As 4 funções são ASSÍNCRONAS (KMS é async).

function getKey32() {
  if (!CERT_SECRET_KEY) {
    const err = new Error("cert_secret_key_not_configured");
    err.code = "CERT_SECRET_KEY_NOT_CONFIGURED";
    throw err;
  }
  // Deriva uma chave 32 bytes estável a partir do secret (SHA-256).
  return crypto.createHash("sha256").update(CERT_SECRET_KEY, "utf8").digest();
}

function gcmDecryptToBuffer(key, ivB64, tagB64, dataB64) {
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

export async function encryptSecret(plainText) {
  if (plainText === undefined || plainText === null) return null;
  const value = String(plainText);
  const iv = crypto.randomBytes(12); // GCM recomenda 12 bytes
  if (isKmsEnabled()) {
    const { plaintextDek, dekCiphertext } = await generateDataKey();
    const cipher = crypto.createCipheriv("aes-256-gcm", plaintextDek, iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `kms-v1:${dekCiphertext.toString("base64")}:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
  }
  const key = getKey32();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export async function decryptSecret(encrypted) {
  if (!encrypted) return null;
  const raw = String(encrypted);
  const parts = raw.split(":");
  if (parts[0] === "kms-v1" && parts.length === 5) {
    try {
      const [, dekB64, ivB64, tagB64, dataB64] = parts;
      const dek = await decryptDataKey(Buffer.from(dekB64, "base64"));
      return gcmDecryptToBuffer(dek, ivB64, tagB64, dataB64).toString("utf8");
    } catch {
      // KMS indisponível / chave revogada / corrompido → trata como ausente (não derruba o app).
      return null;
    }
  }
  if (parts[0] === "v1" && parts.length === 4) {
    try {
      const [, ivB64, tagB64, dataB64] = parts;
      return gcmDecryptToBuffer(getKey32(), ivB64, tagB64, dataB64).toString("utf8");
    } catch {
      return null;
    }
  }
  // compat: valor legado em claro — devolve como está.
  return raw;
}

// ── Criptografia do PRÓPRIO arquivo .pfx (Bytes). Formato auto-descritivo dentro do Buffer (sem mudar
// schema). Um PFX em claro começa com 0x30 0x82 (DER), nunca com um MAGIC — então a leitura distingue
// cifrado (local/KMS) de legado e migra de forma suave. ──
const PFX_ENC_MAGIC = Buffer.from("PFXENCv1:", "utf8"); // 9 bytes — local (CERT_SECRET_KEY)
const PFX_KMS_MAGIC = Buffer.from("PFXKMSv1:", "utf8"); // 9 bytes — envelope KMS

function hasMagic(buf, magic) {
  return Buffer.isBuffer(buf) && buf.length >= magic.length && buf.subarray(0, magic.length).equals(magic);
}

export function isEncryptedBytes(buf) {
  return hasMagic(buf, PFX_ENC_MAGIC) || hasMagic(buf, PFX_KMS_MAGIC);
}

/** Cifra um Buffer (ex.: o PFX). Retorna Buffer cifrado (MAGIC ++ [DEK cifrada]? ++ iv ++ tag ++ cipher). */
export async function encryptBytes(buffer) {
  if (!Buffer.isBuffer(buffer)) return buffer;
  const iv = crypto.randomBytes(12);
  if (isKmsEnabled()) {
    const { plaintextDek, dekCiphertext } = await generateDataKey();
    const cipher = crypto.createCipheriv("aes-256-gcm", plaintextDek, iv);
    const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const tag = cipher.getAuthTag();
    const dekLen = Buffer.alloc(2);
    dekLen.writeUInt16BE(dekCiphertext.length, 0);
    return Buffer.concat([PFX_KMS_MAGIC, dekLen, dekCiphertext, iv, tag, ciphertext]);
  }
  const key = getKey32();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([PFX_ENC_MAGIC, iv, tag, ciphertext]);
}

/** Decifra um Buffer cifrado por encryptBytes. Se não estiver cifrado (legado), devolve como está. */
export async function decryptBytes(buffer) {
  if (!Buffer.isBuffer(buffer)) return buffer;
  if (hasMagic(buffer, PFX_KMS_MAGIC)) {
    try {
      let off = PFX_KMS_MAGIC.length;
      const dekLen = buffer.readUInt16BE(off); off += 2;
      const dekCiphertext = buffer.subarray(off, off + dekLen); off += dekLen;
      const iv = buffer.subarray(off, off + 12); off += 12;
      const tag = buffer.subarray(off, off + 16); off += 16;
      const data = buffer.subarray(off);
      const dek = await decryptDataKey(dekCiphertext);
      const decipher = crypto.createDecipheriv("aes-256-gcm", dek, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]);
    } catch {
      return null;
    }
  }
  if (hasMagic(buffer, PFX_ENC_MAGIC)) {
    try {
      const key = getKey32();
      let off = PFX_ENC_MAGIC.length;
      const iv = buffer.subarray(off, off + 12); off += 12;
      const tag = buffer.subarray(off, off + 16); off += 16;
      const data = buffer.subarray(off);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]);
    } catch {
      return null;
    }
  }
  return buffer; // legado em claro — compat
}

// Q35 Fase 2 — Cofre AWS KMS (envelope encryption) para os certificados.
// A master key vive no HSM da AWS. Para cada cert geramos uma DEK (AES-256) via GenerateDataKey;
// guardamos só a DEK CIFRADA (CiphertextBlob) embutida no próprio blob do cert. Para ler, pedimos
// kms:Decrypt da DEK (com cache de 5 min) e deciframos o cert localmente com a DEK em claro.
//
// O SDK (@aws-sdk/client-kms) é importado SOB DEMANDA: se o KMS não estiver configurado, este módulo
// não carrega o SDK e o app roda normal no modo local (Fase 1).

import crypto from "node:crypto";
import {
  AWS_KMS_CERT_KEY_ID,
  AWS_KMS_REGION,
  AWS_KMS_ACCESS_KEY_ID,
  AWS_KMS_SECRET_ACCESS_KEY,
} from "../../config.js";

export function isKmsEnabled() {
  return Boolean(AWS_KMS_CERT_KEY_ID);
}

let _clientPromise = null;
async function getClient() {
  if (_clientPromise) return _clientPromise;
  _clientPromise = (async () => {
    const { KMSClient } = await import("@aws-sdk/client-kms");
    const opts = { region: AWS_KMS_REGION };
    if (AWS_KMS_ACCESS_KEY_ID && AWS_KMS_SECRET_ACCESS_KEY) {
      opts.credentials = {
        accessKeyId: AWS_KMS_ACCESS_KEY_ID,
        secretAccessKey: AWS_KMS_SECRET_ACCESS_KEY,
      };
    }
    return new KMSClient(opts);
  })();
  return _clientPromise;
}

/**
 * Gera uma DEK nova. Retorna { plaintextDek: Buffer(32), dekCiphertext: Buffer }.
 * plaintextDek cifra o cert localmente (AES-256-GCM); só dekCiphertext é persistido.
 */
export async function generateDataKey() {
  if (!isKmsEnabled()) {
    const err = new Error("kms_not_configured");
    err.code = "KMS_NOT_CONFIGURED";
    throw err;
  }
  const client = await getClient();
  const { GenerateDataKeyCommand } = await import("@aws-sdk/client-kms");
  const out = await client.send(
    new GenerateDataKeyCommand({ KeyId: AWS_KMS_CERT_KEY_ID, KeySpec: "AES_256" })
  );
  return {
    plaintextDek: Buffer.from(out.Plaintext),
    dekCiphertext: Buffer.from(out.CiphertextBlob),
  };
}

// Cache da DEK em claro por hash do ciphertext (TTL 5 min) — corta custo/latência do kms:Decrypt
// em leituras repetidas do mesmo cert (workers 24/7). Limpa no restart do processo.
const DEK_TTL_MS = 5 * 60 * 1000;
const dekCache = new Map(); // sha256(dekCiphertext) -> { dek: Buffer, exp: number }

/** Decifra a DEK cifrada via kms:Decrypt. Retorna Buffer(32) em claro. */
export async function decryptDataKey(dekCiphertext) {
  if (!isKmsEnabled()) {
    const err = new Error("kms_not_configured");
    err.code = "KMS_NOT_CONFIGURED";
    throw err;
  }
  const cacheKey = crypto.createHash("sha256").update(dekCiphertext).digest("hex");
  const cached = dekCache.get(cacheKey);
  const nowMs = Date.now();
  if (cached && cached.exp > nowMs) return cached.dek;

  const client = await getClient();
  const { DecryptCommand } = await import("@aws-sdk/client-kms");
  const out = await client.send(
    new DecryptCommand({ CiphertextBlob: dekCiphertext, KeyId: AWS_KMS_CERT_KEY_ID })
  );
  const dek = Buffer.from(out.Plaintext);
  dekCache.set(cacheKey, { dek, exp: nowMs + DEK_TTL_MS });
  return dek;
}

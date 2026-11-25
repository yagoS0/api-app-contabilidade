import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export const LIMITE_CORPO_FS12 = 16 * 1024 * 1024;
export function erroCustodia(code, cause) {
  return Object.assign(new Error(code, cause ? { cause } : undefined), { code });
}
export const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
const ids = ['respostaId', 'comandoId', 'tentativaId', 'reservaId', 'portalClientId', 'companyId', 'custodianteId', 'capacidadeId'];
const hashes = ['envelopeHash', 'marcadorHash', 'corpoHash'];
const campos = [...ids, ...hashes, 'cnpj', 'competencia', 'revisaoFs12', 'intencao', 'httpStatus', 'recebidoEm'];
const texto = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f]/.test(value);
function exato(obj, keys) {
  return obj && Object.getPrototypeOf(obj) === Object.prototype
    && Object.keys(obj).length === keys.length && keys.every(k => Object.hasOwn(obj, k));
}
// Trusted caller reconstructs this context from command/reservation and observation.
// This check authenticates neither the caller nor the official source.
export function contextoCustodia(entrada) {
  if (!exato(entrada, campos) || ids.some(k => !texto(entrada[k]))
    || hashes.some(k => !/^[a-f0-9]{64}$/.test(entrada[k]))
    || typeof entrada.cnpj !== 'string' || !/^\d{14}$/.test(entrada.cnpj)
    || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(entrada.competencia)
    || !Number.isInteger(entrada.revisaoFs12) || entrada.revisaoFs12 < 1
    || !['SIMULAR', 'TRANSMITIR', 'RETIFICAR'].includes(entrada.intencao)
    || !Number.isInteger(entrada.httpStatus) || entrada.httpStatus < 100 || entrada.httpStatus > 599
    || typeof entrada.recebidoEm !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(entrada.recebidoEm)
    || !Number.isFinite(Date.parse(entrada.recebidoEm))
    || new Date(entrada.recebidoEm).toISOString() !== entrada.recebidoEm) throw erroCustodia('FS12_CONTEXTO_INVALIDO');
  return Object.freeze(Object.fromEntries(campos.map(k => [k, entrada[k]])));
}
export const hashContexto = contexto => hashBytes(Buffer.from(JSON.stringify(contextoCustodia(contexto))));
function base64(value, max, exact) {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4) throw erroCustodia('FS12_CIFRA_INVALIDA');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > max || (exact !== undefined && bytes.length !== exact) || bytes.toString('base64') !== value) throw erroCustodia('FS12_CIFRA_INVALIDA');
  return bytes;
}
function validarEnvelope(e) {
  if (!exato(e, ['v', 'alg', 'keyId', 'nonce', 'ciphertext', 'tag', 'aadVersion'])
    || e.v !== 1 || e.aadVersion !== 1 || e.alg !== 'AES-256-GCM' || !texto(e.keyId)) throw erroCustodia('FS12_CIFRA_INVALIDA');
  return { nonce: base64(e.nonce, 12, 12), tag: base64(e.tag, 16, 16), ciphertext: base64(e.ciphertext, LIMITE_CORPO_FS12) };
}
function aad(contexto, keyId) {
  return Buffer.from(JSON.stringify(['ALTAN_FS12_RESPOSTA', 1, keyId, contextoCustodia(contexto)]), 'utf8');
}
// resolveKey(keyId) returns a borrowed Buffer(32). It must support historical IDs.
// No environment reads, current-key fallback, certificate key reuse or plaintext fallback.
export function criarCifraFs12({ resolveKey }) {
  if (typeof resolveKey !== 'function') throw erroCustodia('FS12_CHAVE_INDISPONIVEL');
  async function chave(keyId) {
    let value;
    try { value = await resolveKey(keyId); } catch (cause) { throw erroCustodia('FS12_CHAVE_INDISPONIVEL', cause); }
    if (!Buffer.isBuffer(value) || value.length !== 32) throw erroCustodia('FS12_CHAVE_INDISPONIVEL');
    return Buffer.from(value);
  }
  return {
    async cifrar({ corpo, contexto, keyId }) {
      const ctx = contextoCustodia(contexto);
      if (!Buffer.isBuffer(corpo) || corpo.length > LIMITE_CORPO_FS12) throw erroCustodia('FS12_CORPO_INVALIDO');
      const bytes = Buffer.from(corpo);
      if (hashBytes(bytes) !== ctx.corpoHash || !texto(keyId)) throw erroCustodia('FS12_CONTEXTO_INVALIDO');
      const key = await chave(keyId);
      try {
        const nonce = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', key, nonce);
        cipher.setAAD(aad(ctx, keyId));
        const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
        return { v: 1, alg: 'AES-256-GCM', keyId, nonce: nonce.toString('base64'),
          ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64'), aadVersion: 1 };
      } finally { key.fill(0); bytes.fill(0); }
    },
    async decifrar({ envelope, contexto }) {
      const ctx = contextoCustodia(contexto);
      const parsed = validarEnvelope(envelope);
      const key = await chave(envelope.keyId);
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, parsed.nonce);
        decipher.setAAD(aad(ctx, envelope.keyId));
        decipher.setAuthTag(parsed.tag);
        const bytes = Buffer.concat([decipher.update(parsed.ciphertext), decipher.final()]);
        if (hashBytes(bytes) !== ctx.corpoHash) { bytes.fill(0); throw erroCustodia('FS12_CORPO_DIVERGENTE'); }
        return bytes;
      } catch (cause) { throw erroCustodia('FS12_AUTENTICACAO_INVALIDA', cause); }
      finally { key.fill(0); }
    },
  };
}

// Experimental test fixture only. No production imports, keys, endpoints or dispatch.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
export const MAX_BYTES = 16 * 1024 * 1024;
const fields = ['portalClientId', 'companyId', 'competencia', 'comandoId', 'tentativaId', 'reservaId', 'tipo'];
const envelopeFields = ['v', 'alg', 'keyId', 'nonce', 'ciphertext', 'tag', 'aadVersion'];
const fail = () => { throw new Error('EVIDENCIA_INVALIDA'); };
function exactKeys(value, expected) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).sort().join('|') !== [...expected].sort().join('|')) fail();
}
function aad(context, keyId, hash) {
  exactKeys(context, fields);
  if (fields.some(k => typeof context[k] !== 'string' || !context[k] || context[k].length > 200)) fail();
  if (!/^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/.test(context.competencia) || !['ENVELOPE', 'RESPOSTA'].includes(context.tipo)) fail();
  if (typeof keyId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(keyId) || !/^[a-f0-9]{64}$/.test(hash)) fail();
  return Buffer.from(JSON.stringify(['FS12_AAD_V1', keyId, hash, ...fields.map(k => context[k])]), 'utf8');
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function keyFrom(keys, id) {
  const key = keys.get(id);
  if (!Buffer.isBuffer(key) || key.length !== 32) fail();
  return key;
}
function base64(value, maxBytes, exactLength) {
  if (typeof value !== 'string' || value.length > 4 * Math.ceil(maxBytes / 3) || value.length % 4 !== 0) fail();
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || bytes.length > maxBytes || (exactLength !== undefined && bytes.length !== exactLength)) fail();
  return bytes;
}
export function cifrarFixture(bytes, context, keyId, keys) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_BYTES) fail();
  const corpoHash = digest(bytes), nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(keys, keyId), nonce, { authTagLength: 16 });
  cipher.setAAD(aad(context, keyId, corpoHash));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return { corpoHash, envelope: { v: 1, alg: 'AES-256-GCM', keyId, nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64'), aadVersion: 1 } };
}
export function decifrarFixture(envelope, context, corpoHash, keys) {
  exactKeys(envelope, envelopeFields);
  if (envelope.v !== 1 || envelope.alg !== 'AES-256-GCM' || envelope.aadVersion !== 1) fail();
  const nonce = base64(envelope.nonce, 12, 12), tag = base64(envelope.tag, 16, 16);
  const ciphertext = base64(envelope.ciphertext, MAX_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(keys, envelope.keyId), nonce, { authTagLength: 16 });
  decipher.setAAD(aad(context, envelope.keyId, corpoHash));
  decipher.setAuthTag(tag);
  let bytes;
  try { bytes = Buffer.concat([decipher.update(ciphertext), decipher.final()]); } catch { fail(); }
  if (!timingSafeEqual(Buffer.from(digest(bytes), 'hex'), Buffer.from(corpoHash, 'hex'))) fail();
  return bytes;
}
// Syntax normalization only: does not authorize a PA, change payload, or prove fiscal eligibility.
export function normalizarPaFixture(payload) {
  if (payload?.pedidoDados?.idSistema !== 'PGDASD' || payload?.pedidoDados?.idServico !== 'TRANSDECLARACAO11') throw new Error('FORA_DO_ESCOPO');
  let data = payload.pedidoDados.dados;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { throw new Error('PA_INVALIDO'); } }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('PA_INVALIDO');
  const periods = [];
  for (const field of ['pa', 'periodoApuracao', 'competencia', '_periodoApuracao']) {
    if (!Object.hasOwn(data, field)) continue;
    const value = data[field];
    if (typeof value !== 'string' && !(typeof value === 'number' && Number.isSafeInteger(value))) throw new Error('PA_INVALIDO');
    const text = String(value);
    const format = field === 'pa' ? /^([1-9][0-9]{3})(0[1-9]|1[0-2])$/ : /^([1-9][0-9]{3})-?(0[1-9]|1[0-2])$/;
    const match = format.exec(text);
    if (!match) throw new Error('PA_INVALIDO');
    periods.push(`${match[1]}-${match[2]}`);
  }
  if (!periods.length) throw new Error('PA_AUSENTE');
  if (new Set(periods).size !== 1) throw new Error('PA_DIVERGENTE');
  return periods[0];
}

// Synthetic service capability. The secret exists only in the test process; this is not an authentication service.
export function criarCapacidadeFixture(context, envelopeHash, assinatura, serviceSecret, marker) {
  if (!marker || marker.key !== `serpro_dispatch:${context.reservaId}` || marker.value?.reservaId !== context.reservaId || marker.value?.companyId !== context.portalClientId || typeof marker.value?.authorizedAt !== 'string' || !Number.isFinite(Date.parse(marker.value.authorizedAt))) fail();
  const body = { v: 1, acao: 'custodiar_resposta_pgdas', context, envelopeHash, assinatura, marcadorKey: marker.key, marcadorAutorizadoEm: marker.value.authorizedAt };
  aad(context, 'capability_fixture', envelopeHash);
  if (!/^[a-f0-9]{64}$/.test(assinatura) || !Buffer.isBuffer(serviceSecret) || serviceSecret.length !== 32) fail();
  const serialized = JSON.stringify(body);
  return { serialized, mac: createHmac('sha256', serviceSecret).update(serialized).digest('hex') };
}
export function validarCapacidadeFixture(capability, expected, serviceSecret, marker) {
  if (!capability || typeof capability.serialized !== 'string' || capability.serialized.length > 8192 || !/^[a-f0-9]{64}$/.test(capability.mac)) fail();
  if (!Buffer.isBuffer(serviceSecret) || serviceSecret.length !== 32) fail();
  const mac = createHmac('sha256', serviceSecret).update(capability.serialized).digest();
  if (!timingSafeEqual(mac, Buffer.from(capability.mac, 'hex'))) fail();
  const expectedCap = criarCapacidadeFixture(expected.context, expected.envelopeHash, expected.assinatura, serviceSecret, marker);
  if (capability.serialized !== expectedCap.serialized || !marker || marker.key !== `serpro_dispatch:${expected.context.reservaId}` || marker.value?.reservaId !== expected.context.reservaId || marker.value?.companyId !== expected.context.portalClientId || typeof marker.value?.authorizedAt !== 'string' || !Number.isFinite(Date.parse(marker.value.authorizedAt))) fail();
  return { acao: 'custodiar_resposta_pgdas', autorizaNovoDespacho: false };
}

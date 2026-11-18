import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { MAX_BYTES, cifrarFixture, decifrarFixture, criarCapacidadeFixture, validarCapacidadeFixture } from './seguranca-fixture.mjs';
const ctx = Object.freeze({ portalClientId: 'portal-fixture', companyId: 'company-fixture', competencia: '2026-11', comandoId: 'comando-fixture', tentativaId: 'tentativa-fixture', reservaId: 'reserva-fixture', tipo: 'RESPOSTA' });
const source = Buffer.from('{"sintetico":true,"resultado":"observado"}');
const keys = new Map([['ephemeral_1', randomBytes(32)]]);
const encrypt = (bytes = source) => cifrarFixture(bytes, ctx, 'ephemeral_1', keys);
const decrypt = ({ envelope, corpoHash }, context = ctx, keyring = keys) => decifrarFixture(envelope, context, corpoHash, keyring);
const flip = value => { const b = Buffer.from(value, 'base64'); b[0] ^= 1; return b.toString('base64'); };

test('AES-256-GCM recovers exact synthetic bytes after serialized custody', () => {
  const frozen = JSON.parse(JSON.stringify(encrypt()));
  assert.deepEqual(decrypt(frozen), source);
  assert.equal(JSON.stringify(frozen).includes('sintetico'), false);
});
test('same body gets independent random nonces; this sample is not proof of lifetime uniqueness', () => {
  const a = encrypt(), b = encrypt();
  assert.notEqual(a.envelope.nonce, b.envelope.nonce);
  assert.notEqual(a.envelope.ciphertext, b.envelope.ciphertext);
  assert.equal(a.corpoHash, b.corpoHash);
});
for (const field of Object.keys(ctx)) test(`AAD rejects replay into another ${field}`, () => {
  const other = { ...ctx, [field]: field === 'competencia' ? '2026-12' : field === 'tipo' ? 'ENVELOPE' : `${ctx[field]}-other` };
  assert.throws(() => decrypt(encrypt(), other), /EVIDENCIA_INVALIDA/);
});
for (const field of ['nonce', 'tag', 'ciphertext']) test(`adulterated ${field} fails without plaintext return`, () => {
  const stored = encrypt(); stored.envelope[field] = flip(stored.envelope[field]);
  assert.throws(() => decrypt(stored), /EVIDENCIA_INVALIDA/);
});
test('keyId is authenticated even when a second identifier resolves to the same key', () => {
  const stored = encrypt(); stored.envelope.keyId = 'alias_same_key';
  const keyring = new Map([...keys, ['alias_same_key', keys.get('ephemeral_1')]]);
  assert.throws(() => decrypt(stored, ctx, keyring), /EVIDENCIA_INVALIDA/);
});
test('unknown, missing, or wrong key rejects; reinstated synthetic custody copy recovers', () => {
  const stored = encrypt(), savedKey = Buffer.from(keys.get('ephemeral_1'));
  assert.throws(() => decrypt(stored, ctx, new Map()), /EVIDENCIA_INVALIDA/);
  assert.throws(() => decrypt(stored, ctx, new Map([['ephemeral_1', randomBytes(32)]])), /EVIDENCIA_INVALIDA/);
  assert.deepEqual(decrypt(stored, ctx, new Map([['ephemeral_1', savedKey]])), source);
  savedKey.fill(0);
});
test('rotation keeps old evidence readable with its old key, without rewriting ciphertext', () => {
  const stored = encrypt(), preserved = JSON.stringify(stored), rotated = new Map([...keys, ['ephemeral_2', randomBytes(32)]]);
  const next = cifrarFixture(source, ctx, 'ephemeral_2', rotated);
  assert.deepEqual(decrypt(stored, ctx, rotated), source);
  assert.deepEqual(decrypt(next, ctx, rotated), source);
  assert.equal(JSON.stringify(stored), preserved);
});
test('corpoHash tampering is rejected by AAD and hash verification', () => {
  const stored = encrypt(); stored.corpoHash = '0'.repeat(64);
  assert.throws(() => decrypt(stored), /EVIDENCIA_INVALIDA/);
});
test('16MiB exact round trip; +1 byte is rejected without truncation', () => {
  const data = Buffer.alloc(MAX_BYTES, 0x5a);
  const stored = encrypt(data);
  assert.deepEqual(decrypt(stored), data);
  assert.throws(() => encrypt(Buffer.alloc(MAX_BYTES + 1)), /EVIDENCIA_INVALIDA/);
  stored.envelope.ciphertext = Buffer.alloc(MAX_BYTES + 1).toString('base64');
  assert.throws(() => decrypt(stored), /EVIDENCIA_INVALIDA/);
});
for (const patch of [{ tag: '' }, { nonce: '' }, { ciphertext: 'AAAA=' }, { v: 2 }, { alg: 'AES-128-GCM' }, { aadVersion: 'other' }, { headers: {} }]) test(`invalid cipher metadata ${JSON.stringify(patch)} is rejected`, () => {
  const stored = encrypt(); Object.assign(stored.envelope, patch);
  assert.throws(() => decrypt(stored), /EVIDENCIA_INVALIDA/);
});
test('empty body is distinct from missing ciphertext and authenticates normally', () => {
  assert.equal(decrypt(encrypt(Buffer.alloc(0))).length, 0);
  const stored = encrypt(); delete stored.envelope.ciphertext;
  assert.throws(() => decrypt(stored), /EVIDENCIA_INVALIDA/);
});
const secret = randomBytes(32), hash = '1'.repeat(64), signature = '2'.repeat(64);
const expected = { context: ctx, envelopeHash: hash, assinatura: signature };
const marker = { key: `serpro_dispatch:${ctx.reservaId}`, value: { reservaId: ctx.reservaId, companyId: ctx.portalClientId, authorizedAt: '2026-11-18T12:00:00Z' } };
const capability = () => criarCapacidadeFixture(ctx, hash, signature, secret, marker);
test('synthetic service capability permits late custody after human revocation, never dispatch', () => {
  const user = { active: false };
  assert.equal(user.active, false);
  assert.deepEqual(validarCapacidadeFixture(capability(), expected, secret, marker), { acao: 'custodiar_resposta_pgdas', autorizaNovoDespacho: false });
});
for (const field of Object.keys(ctx)) test(`capability cannot be rebound to another ${field}`, () => {
  assert.throws(() => validarCapacidadeFixture(capability(), { ...expected, context: { ...ctx, [field]: field === 'competencia' ? '2026-12' : field === 'tipo' ? 'ENVELOPE' : 'different' } }, secret, marker), /EVIDENCIA_INVALIDA/);
});
test('forged capability, different service secret, envelope or signature are rejected', () => {
  const forged = capability(); forged.serialized = forged.serialized.replace('custodiar_resposta_pgdas', 'despachar');
  assert.throws(() => validarCapacidadeFixture(forged, expected, secret, marker), /EVIDENCIA_INVALIDA/);
  assert.throws(() => validarCapacidadeFixture(capability(), expected, randomBytes(32), marker), /EVIDENCIA_INVALIDA/);
  for (const field of ['envelopeHash', 'assinatura']) assert.throws(() => validarCapacidadeFixture(capability(), { ...expected, [field]: '3'.repeat(64) }, secret, marker), /EVIDENCIA_INVALIDA/);
});
test('missing, wrong or malformed marker rejects custody, with PortalClient not Company in legacy companyId', () => {
  for (const candidate of [null, { ...marker, key: 'other' }, { ...marker, value: {} }, { ...marker, value: { ...marker.value, companyId: ctx.companyId } }, { ...marker, value: { ...marker.value, reservaId: 'other' } }, { ...marker, value: { ...marker.value, authorizedAt: 'invalid' } }, { ...marker, value: { ...marker.value, authorizedAt: '2026-11-19T12:00:00Z' } }]) assert.throws(() => validarCapacidadeFixture(capability(), expected, secret, candidate), /EVIDENCIA_INVALIDA/);
});
test('authentic capability replay is cryptographically valid; database uniqueness must deduplicate observation', () => {
  const c = capability();
  assert.deepEqual(validarCapacidadeFixture(c, expected, secret, marker), validarCapacidadeFixture(c, expected, secret, marker));
});

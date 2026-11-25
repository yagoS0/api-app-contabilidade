import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { normalizarPaFixture } from './seguranca-fixture.mjs';
const payload = (data, asString = false) => ({ contribuinte: { numero: '00000000000000' }, pedidoDados: { idSistema: 'PGDASD', idServico: 'TRANSDECLARACAO11', dados: asString ? JSON.stringify(data) : data } });
for (const [pa, expected] of [[202610, '2026-10'], [202611, '2026-11'], [202612, '2026-12'], [202701, '2027-01']]) {
  for (const asString of [false, true]) test(`syntactic PA ${pa}, JSON string=${asString}: no fiscal authorization implied`, () => {
    for (const value of [pa, String(pa)]) assert.equal(normalizarPaFixture(payload({ pa: value }, asString)), expected);
  });
}
for (const field of ['periodoApuracao', 'competencia', '_periodoApuracao']) test(`legacy ${field} accepts exact AAAAMM/AAAA-MM and agrees with pa`, () => {
  for (const value of [202611, '202611', '2026-11']) {
    assert.equal(normalizarPaFixture(payload({ [field]: value })), '2026-11');
    assert.equal(normalizarPaFixture(payload({ pa: 202611, [field]: value })), '2026-11');
  }
  assert.throws(() => normalizarPaFixture(payload({ pa: 202611, [field]: '2026-12' })), /PA_DIVERGENTE/);
});
test('all present aliases must agree; null or malformed alias cannot be silently ignored', () => {
  assert.equal(normalizarPaFixture(payload({ pa: 202611, periodoApuracao: '202611', competencia: '2026-11', _periodoApuracao: '2026-11' })), '2026-11');
  for (const value of [null, '', false, 'unknown', undefined]) assert.throws(() => normalizarPaFixture(payload({ pa: 202611, competencia: value })), /PA_INVALIDO/);
});
for (const value of [202600, 202613, 202611.5, true, false, null, {}, [], NaN, Infinity, '202611x', ' 202611', '202611 ', '2026-11', '000011', 20261]) test(`invalid canonical pa ${String(value)} is rejected`, () => {
  assert.throws(() => normalizarPaFixture(payload({ pa: value })), /PA_INVALIDO/);
});
test('absence and anoMesParcela are not guessed as transmission PA', () => {
  assert.throws(() => normalizarPaFixture(payload({})), /PA_AUSENTE/);
  assert.throws(() => normalizarPaFixture(payload({ anoMesParcela: 202611 })), /PA_AUSENTE/);
});
test('malformed JSON, scalar and array data are rejected', () => {
  for (const value of ['{', 'null', '123', '[]', '"202611"', null, [], 202611]) {
    const p = payload({}); p.pedidoDados.dados = value;
    assert.throws(() => normalizarPaFixture(p), /PA_INVALIDO/);
  }
});
test('other services are outside this proposed normalizer', () => {
  for (const service of ['GERARDAS12', 'GERARDASCOBRANCA17', 'CONSDECLARACAO13']) {
    const p = payload({ pa: 202611 }); p.pedidoDados.idServico = service;
    assert.throws(() => normalizarPaFixture(p), /FORA_DO_ESCOPO/);
  }
});
test('normalization does not mutate envelope, its serialization or any signature input', () => {
  for (const transmitir of [false, true]) for (const asString of [false, true]) {
    const p = payload({ pa: 202611, transmitir, folhasSalario: [] }, asString);
    const before = JSON.stringify(p), signatureInput = `/Declarar|${before}`;
    const hashBefore = createHash('sha256').update(signatureInput).digest('hex');
    Object.freeze(p.pedidoDados); Object.freeze(p);
    assert.equal(normalizarPaFixture(p), '2026-11');
    assert.equal(JSON.stringify(p), before);
    assert.equal(createHash('sha256').update(`/Declarar|${JSON.stringify(p)}`).digest('hex'), hashBefore);
  }
});

test('E2 PGDAS identifier recognizes canonical PA without mutating envelope or signature', async () => {
  // Prevent config discovery of private env files; this test never invokes a database or transport operation.
  process.env.DOTENV_CONFIG_PATH = new URL('./synthetic-env-does-not-exist', import.meta.url).pathname;
  process.env.DATABASE_URL = 'postgresql://synthetic:synthetic@127.0.0.1:1/validation_only_governance_test';
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  const { identificarChamada } = await import('../../src/application/fiscal/serpro/SerproCallGuard.js');
  const { chaveResposta } = await import('../../src/application/fiscal/serpro/SerproRespostaCache.js');
  for (const transmitir of [false, true]) for (const asString of [false, true]) {
    const p = payload({ pa: 202611, transmitir, folhasSalario: [] }, asString);
    const before = identificarChamada(p, '/Declarar'), serialized = JSON.stringify(p);
    assert.equal(before.competencia, '2026-11', 'E2 correlates canonical PGDAS PA with its reservation');
    assert.equal(before.assinatura, chaveResposta(p, '/Declarar'));
    assert.equal(normalizarPaFixture(p), '2026-11');
    assert.deepEqual(identificarChamada(p, '/Declarar'), before);
    assert.equal(JSON.stringify(p), serialized);
    assert.match(before.assinatura, /^[a-f0-9]{64}$/);
  }
  const invalid = payload({ competencia: '2026-13' });
  assert.equal(identificarChamada(invalid, '/Declarar').competencia, '2026-13');
  assert.throws(() => normalizarPaFixture(invalid), /PA_INVALIDO/);
  const conflicting = payload({ pa: 202611, competencia: '2026-12' });
  assert.equal(identificarChamada(conflicting, '/Declarar').competencia, '2026-11', 'Canonical PGDAS PA has identification precedence; it does not validate conflicting aliases');
  assert.throws(() => normalizarPaFixture(conflicting), /PA_DIVERGENTE/);
  for (const service of ['GERARDAS12','CONSDECLARACAO13']) {
    const other = payload({pa:202611,competencia:'2026-12'}); other.pedidoDados.idServico=service;
    assert.equal(identificarChamada(other,'/Consultar').competencia,'2026-12');
    assert.equal(identificarChamada(other,'/Consultar').assinatura,chaveResposta(other,'/Consultar'));
  }
});

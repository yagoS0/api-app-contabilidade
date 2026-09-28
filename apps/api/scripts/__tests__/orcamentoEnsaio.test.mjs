import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OrcamentoEnsaio, custoMicrousd } from '../lib/orcamentoEnsaio.mjs';
const modelo = 'gpt-5.4-mini';
const usage = { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 };
test('preço fracionário inclui cache e arredonda somente milionésimos para cima', () => {
  assert.equal(custoMicrousd(usage, modelo), 1275);
  assert.equal(custoMicrousd({ ...usage, input_tokens: 1, output_tokens: 0, cache_read_input_tokens: 0 }, modelo), 1);
  assert.throws(() => custoMicrousd({ ...usage, input_tokens: -1 }, modelo));
  assert.throws(() => custoMicrousd({}, modelo));
});
test('reserva durável, exclusão concorrente, teto compartilhado e conclusão única', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensaio-orcamento-')), arquivo = path.join(dir, 'custo.json');
  const a = new OrcamentoEnsaio(arquivo, .04);
  try {
    const id = a.reservar(30000, 'teste');
    assert.equal(JSON.parse(fs.readFileSync(arquivo)).chamadas[0].estado, 'RESERVADO');
    assert.throws(() => new OrcamentoEnsaio(arquivo, .04));
    assert.equal(a.reservar(30000, 'bloqueado'), null);
    a.concluir(id, usage, modelo);
    assert.throws(() => a.concluir(id, usage, modelo));
    a.reservar(30000, 'timeout');
  } finally { a.fechar(); }
  const b = new OrcamentoEnsaio(arquivo, .04);
  try { assert.equal(b.gasto, 31275); assert.equal(b.reservar(30000, 'outra-rodada'), null); }
  finally { b.fechar(); }
  assert.throws(() => new OrcamentoEnsaio(arquivo, 1));
  assert.equal(fs.existsSync(`${arquivo}.lock`), false);
});
test('bloqueio temporário de arquivo repete apenas escrita sem duplicar reserva', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensaio-lock-')), arquivo = path.join(dir, 'custo.json');
  const b = new OrcamentoEnsaio(arquivo, 1), original = fs.renameSync;
  let tentativas = 0;
  t.mock.method(fs, 'renameSync', (...args) => {
    if (++tentativas < 3) throw Object.assign(new Error('ocupado'), { code: 'EPERM' });
    return original(...args);
  });
  try { b.reservar(30000, 'unica'); assert.equal(b.estado.chamadas.length, 1); assert.equal(b.gasto, 30000); assert.equal(tentativas, 3); }
  finally { b.fechar(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { verificarAtendimento } from './monitor-atendimento.mjs';

const ok = () => ({ ok: true, json: async () => ({ ok: true }), text: async () => '<div id="root"></div>' });
test('confirma prontidão da API e conteúdo do portal', async () => {
  assert.equal((await verificarAtendimento({ fetchImpl: async () => ok() })).every(r => r.ok), true);
});
test('queda da API permanece visível mesmo com portal disponível', async () => {
  let chamadas = 0;
  const r = await verificarAtendimento({ esperar: async () => {}, fetchImpl: async url => {
    if (url.endsWith('/readyz')) { chamadas++; throw Error('indisponível'); }
    return ok();
  } });
  assert.deepEqual(r.map(v => v.ok), [false, true]);
  assert.equal(chamadas, 3);
});
test('recuperação transitória evita falso alerta', async () => {
  let chamadas = 0;
  const r = await verificarAtendimento({ esperar: async () => {}, fetchImpl: async url => {
    if (url.endsWith('/readyz') && ++chamadas === 1) return { ok: false };
    return ok();
  } });
  assert.equal(r.every(v => v.ok), true);
});
test('HTTP 200 com erro ou página vazia não é considerado saudável', async () => {
  const r = await verificarAtendimento({ esperar: async () => {}, fetchImpl: async () => ({ ok: true, json: async () => ({ ok: false }), text: async () => 'erro' }) });
  assert.equal(r.every(v => !v.ok), true);
});

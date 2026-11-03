import { createRealApi } from '../realApi';
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
test('prévia, aceite e acompanhamento usam rotas reais; leitura não reenvia POST', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
  const api = createRealApi();
  await api.previewOperationsBatch('2026-10');
  await api.acceptOperationsBatch({ previewId: 'p', requestId: 'request-12345678', confirmCompetencia: '2026-10' });
  await api.getOperationsBatch('batch/id');
  await api.listOperationsBatches('2026-10');
  const calls = global.fetch.mock.calls;
  expect(String(calls[0][0])).toContain('/firm/operacoes/lotes/previa');
  expect(JSON.parse(calls[0][1].body)).toEqual({ competencia: '2026-10', batchId: null });
  expect(String(calls[1][0])).toContain('/firm/operacoes/lotes/aceitar');
  expect(String(calls[2][0])).toContain('/firm/operacoes/lotes/batch%2Fid');
  expect(String(calls[3][0])).toContain('/firm/operacoes/lotes?competencia=2026-10');
  expect(calls.filter(([, o]) => o?.method === 'POST')).toHaveLength(2);
});

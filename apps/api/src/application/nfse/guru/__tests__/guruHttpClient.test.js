import { criarGuruHttpClient } from '../GuruHttpClient.js';
import { periodo, transacao } from './fixtures/transacoesGuru.js';

function response(payload, status = 200) {
  const bytes = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
  let read = false;
  return { status, headers: { get: name => name === 'content-type' ? 'application/json' : null },
    body: { getReader: () => ({ read: async () => read ? { done: true } : (read = true, { done: false, value: bytes }), releaseLock() {} }) } };
}
const envelope = { data: [transacao()], has_more_pages: 1, next_cursor: 'cursor-sintetico', total_rows: 2 };
test('GET exclusivo, host fixo, Bearer de usuário e filtros repetidos a cada página', async () => {
  const fetchImpl = jest.fn(async () => response(envelope));
  const client = criarGuruHttpClient({ fetchImpl });
  expect(await client.pagina({ token: 'segredo-sintetico', periodo })).toMatchObject({ hasMore: true, total: 2 });
  await client.pagina({ token: 'segredo-sintetico', periodo, cursor: 'cursor-sintetico' });
  for (const [url, options] of fetchImpl.mock.calls) {
    expect(url).toMatch(/^https:\/\/digitalmanager.guru\/api\/v2\/transactions\/\?/);
    expect(url).toContain('confirmed_at_ini=2026-10-01'); expect(url).toContain('confirmed_at_end=2026-10-22');
    expect(options).toMatchObject({ method: 'GET', redirect: 'manual', headers: { Accept: 'application/json', Authorization: 'Bearer segredo-sintetico' } });
  }
});
test.each([[401, 'guru_credencial_recusada'], [403, 'guru_credencial_recusada'], [429, 'guru_limite_requisicoes'],
  [500, 'guru_origem_indisponivel'], [302, 'guru_redirect_recusado']])('HTTP %s sem retry nem corpo externo', async (status, code) => {
  const fetchImpl = jest.fn(async () => response('segredo-sintetico', status));
  await expect(criarGuruHttpClient({ fetchImpl }).pagina({ token: 'segredo-sintetico', periodo })).rejects.toMatchObject({ code, message: code });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
test.each(['{invalido', {}, { ...envelope, has_more_pages: 'false' }, { ...envelope, next_cursor: '' }, { ...envelope, total_rows: -1 }])('envelope inválido %#', async payload => {
  await expect(criarGuruHttpClient({ fetchImpl: async () => response(payload) }).pagina({ token: 't', periodo })).rejects.toMatchObject({ code: 'guru_envelope_invalido' });
});
test.each([true, false, 0, 1])('booleano de paginação explícito %s', async flag => {
  expect(await criarGuruHttpClient({ fetchImpl: async () => response({ ...envelope, has_more_pages: flag }) }).pagina({ token: 't', periodo })).toMatchObject({ hasMore: Boolean(flag) });
});
test('limite de bytes, timeout e erro de transporte não expõem token', async () => {
  await expect(criarGuruHttpClient({ maxBytes: 5, fetchImpl: async () => response(envelope) }).pagina({ token: 't', periodo })).rejects.toMatchObject({ code: 'guru_resposta_excessiva' });
  const fetchImpl = (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('segredo-sintetico'))));
  await expect(criarGuruHttpClient({ timeoutMs: 5, fetchImpl }).pagina({ token: 'segredo-sintetico', periodo })).rejects.toMatchObject({ message: 'guru_timeout' });
  await expect(criarGuruHttpClient({ fetchImpl: async () => { throw Error('Bearer segredo-sintetico'); } }).pagina({ token: 'segredo-sintetico', periodo })).rejects.toMatchObject({ message: 'guru_origem_indisponivel' });
});

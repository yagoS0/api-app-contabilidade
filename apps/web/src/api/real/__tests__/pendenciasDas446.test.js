import { createRealApi } from '../realApi';
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
test('GET scoped and encoded, no store and no write', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
  const api = createRealApi(); await api.getCompanyDasPendencias('a/b', '2026-10');
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/companies/a%2Fb/operacoes/2026-10/pendencias-das'), expect.objectContaining({ method: 'GET', cache: 'no-store' }));
  expect(global.fetch.mock.calls[0][1].body).toBeUndefined();
});
test.each([401,403,503])('HTTP %s never refreshes or retries consultation', async status => {
  global.fetch = jest.fn(async () => ({ ok: false, status, json: async () => ({ message: 'Leitura indisponível.' }) }));
  await expect(createRealApi().getCompanyDasPendencias('a','2026-10')).rejects.toMatchObject({ status });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

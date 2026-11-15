jest.mock('../../../composition/pendenciasDas446.js', () => ({ consultarPendenciasDas446: jest.fn() }));
import { criarHandlerPendenciasDas446 } from '../pendenciasDas446Http.js';
const response = () => ({ setHeader: jest.fn(), status: jest.fn(function () { return this; }), json: jest.fn() });
test.each([{ page: '1' }, { offset: '0' }, { auth: 'admin' }, { limit: ['1','2'] }, { servico: {} }, { limit: '' }])('rejects unsupported query %j without consulting', async query => {
  const read = jest.fn(); const res = response();
  await criarHandlerPendenciasDas446(read)({ params: { companyId: 'a', competencia: '2026-10' }, query, auth: {} }, res);
  expect(res.status).toHaveBeenCalledWith(400); expect(read).not.toHaveBeenCalled();
});
test('passes only authenticated session and whitelisted inputs', async () => {
  const read = jest.fn(async () => ({ companyId: 'a' })); const res = response(); const auth = { user: { id: 'real' } };
  await criarHandlerPendenciasDas446(read)({ params: { companyId: 'a', competencia: '2026-10' }, query: { limit: '2' }, auth, body: { auth: 'forged' } }, res);
  expect(read).toHaveBeenCalledWith({ companyId: 'a', competencia: '2026-10', limit: 2 }, { auth });
  expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
});
test.each([[{ code: 'ACESSO_NEGADO', status: 401 },401], [{ code: 'ACESSO_NEGADO', status: 403 },403], [new Error('PRIVATE'),503]])('safe errors without retry', async (error, status) => {
  const read = jest.fn(async () => { throw error; }); const res = response();
  await criarHandlerPendenciasDas446(read)({ params: { companyId: 'a', competencia: '2026-10' }, query: {} }, res);
  expect(res.status).toHaveBeenCalledWith(status); expect(read).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(res.json.mock.calls)).not.toMatch(/PRIVATE|salvo/);
});

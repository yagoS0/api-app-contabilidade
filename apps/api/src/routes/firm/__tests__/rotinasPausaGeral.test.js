jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../../../application/fiscal/AutomacaoCicloFiscalService.js', () => ({ lerAutomacaoCicloFiscal: jest.fn(), alterarAutomacaoCicloFiscal: jest.fn() }));
import express from 'express';
import request from 'supertest';
import { createFirmPortalRouter } from '../index.js';
import { lerAutomacaoCicloFiscal, alterarAutomacaoCicloFiscal } from '../../../application/fiscal/AutomacaoCicloFiscalService.js';
function app(user) {
  const instance = express(); instance.use(express.json());
  // requireAuth lê a dependência em app.locals, como na montagem real do servidor.
  instance.locals.ensureAuthorized = jest.fn(async req => { req.auth = { user }; return true; });
  instance.use('/firm', createFirmPortalRouter({ ensureAuthorized: instance.locals.ensureAuthorized, log: { info() {}, warn() {}, error() {}, debug() {} } }));
  return instance;
}
beforeEach(() => jest.clearAllMocks());
test('staff não lê nem altera pausa global', async () => {
  const server = app({ id: 'u', role: 'staff', accountType: 'FIRM' });
  expect((await request(server).get('/firm/rotinas/pausa-geral')).status).toBe(403);
  expect((await request(server).put('/firm/rotinas/pausa-geral').send({ paused: true, version: 0, reason: 'x' })).status).toBe(403);
  expect(server.locals.ensureAuthorized).toHaveBeenCalled();
  expect(server.locals.ensureAuthorized).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), { allowApiKeyFallback: false });
  expect(lerAutomacaoCicloFiscal).not.toHaveBeenCalled(); expect(alterarAutomacaoCicloFiscal).not.toHaveBeenCalled();
});
test('ator autenticado prevalece sobre corpo e retorno exige persistência', async () => {
  const actor = { id: 'contador', role: 'contador', accountType: 'FIRM' };
  alterarAutomacaoCicloFiscal.mockResolvedValue({ paused: true, version: 1 });
  const result = await request(app(actor)).put('/firm/rotinas/pausa-geral').send({ paused: true, version: 0, reason: 'x', actor: { id: 'forjado' }, agenda: {} });
  expect(result.status).toBe(200);
  expect(alterarAutomacaoCicloFiscal).toHaveBeenCalledWith({ paused: true, version: 0, reason: 'x', actor });
  alterarAutomacaoCicloFiscal.mockRejectedValue(Object.assign(new Error('Conflito'), { code: 'CICLO_FISCAL_CONFLITO', status: 409 }));
  expect((await request(app(actor)).put('/firm/rotinas/pausa-geral').send({})).status).toBe(409);
});

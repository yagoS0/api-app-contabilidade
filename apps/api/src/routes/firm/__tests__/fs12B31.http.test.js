import express from 'express';
import request from 'supertest';
const mockConsulta = jest.fn();
const mockConfirmar = jest.fn();
const mockAccess = jest.fn();
jest.mock('../../../composition/fs12DaApuracao.js', () => ({
  consultarSerieFs12DaApuracao: (...args) => mockConsulta(...args),
  confirmarSerieFs12DaApuracao: (...args) => mockConfirmar(...args),
}));
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: { companyFirmAccess: { findUnique: (...args) => mockAccess(...args) } } }));
jest.mock('../../../application/fiscal/serpro/SerproHttpClient.js', () => ({
  SerproHttpClient: jest.fn(() => { throw Error('FISCAL_TRANSPORT_FORBIDDEN'); }),
}));
import { createApuracaoV2Router } from '../apuracaoV2.js';
import { SerproHttpClient } from '../../../application/fiscal/serpro/SerproHttpClient.js';
function app(user = { id: 'u', role: 'contador' }) {
  const a = express(); a.use(express.json());
  a.use((req, res, next) => { if (user) req.auth = { user }; next(); });
  a.use('/firm/companies/:companyId', createApuracaoV2Router()); return a;
}
const url = '/firm/companies/p/fechamento/2026-11/fs12/confirmacoes';
beforeEach(() => { jest.clearAllMocks(); mockAccess.mockResolvedValue({ role: 'ACCOUNTANT', status: 'ACTIVE', scopes: [] }); });
test('server identity overrides forged body, GET is no-store, no fiscal call', async () => {
  mockConsulta.mockResolvedValue({ historico: [] }); mockConfirmar.mockResolvedValue({ confirmacao: { id: 'r' }, autorizaEfeitoFiscal: false });
  expect((await request(app()).get(url)).headers['cache-control']).toBe('no-store');
  const payload = { serie: [], revisaoEsperada: 0, contextoRevisao: 'h', chaveIdempotencia: 'key', motivo: null };
  const r = await request(app()).post(url).send({ ...payload, autorId: 'forged', companyId: 'other', portalClientId: 'other', competencia: '2027-01', confirmadoEm: 'fake' });
  expect(r.status).toBe(200);
  expect(mockConfirmar).toHaveBeenCalledWith({ ...payload, autorId: 'u', portalClientId: 'p', competencia: '2026-11' });
  expect(SerproHttpClient).not.toHaveBeenCalled();
});
test('no session and revoked access stop the operation', async () => {
  expect((await request(app(null)).post(url).send({})).status).toBe(401);
  mockAccess.mockResolvedValue(null);
  expect((await request(app()).get(url)).status).toBe(403);
  expect(mockConsulta).not.toHaveBeenCalled(); expect(mockConfirmar).not.toHaveBeenCalled();
});
test('conflict is distinct from sanitized persistence failure', async () => {
  mockConfirmar.mockRejectedValueOnce(Object.assign(Error('Recarregue'), { status: 409, code: 'FS12_REVISAO_CONFLITO' }));
  expect((await request(app()).post(url).send({})).status).toBe(409);
  mockConfirmar.mockRejectedValueOnce(Error('private SQL or credentials'));
  const r = await request(app()).post(url).send({});
  expect(r.status).toBe(503); expect(JSON.stringify(r.body)).not.toContain('private'); expect(r.body.ok).toBe(false);
});

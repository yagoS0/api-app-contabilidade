import express from 'express';
import request from 'supertest';
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {
  companyFirmAccess: { findUnique: jest.fn() },
} }));
jest.mock('../../../composition/consultaFs12.js', () => ({ consultarFs12DoFechamento: jest.fn() }));
import { createApuracaoV2Router } from '../apuracaoV2.js';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { consultarFs12DoFechamento } from '../../../composition/consultaFs12.js';

function app(role = 'contador') {
  const a = express(); a.use(express.json());
  a.use((req, res, next) => { if (role) req.auth = { user: { id: 'u1', role } }; next(); });
  a.use('/firm/companies/:companyId', createApuracaoV2Router());
  return a;
}
beforeEach(() => {
  jest.clearAllMocks();
  prisma.companyFirmAccess.findUnique.mockResolvedValue({ role: 'ACCOUNTANT', status: 'ACTIVE', scopes: [] });
  consultarFs12DoFechamento.mockResolvedValue({ autorizaEfeitoFiscal: false });
});
test('GET escopado ignora fatos de navegador e não permite cache', async () => {
  const r = await request(app()).get('/firm/companies/p1/fechamento/2026-11/fs12?empresaId=outra&conferida=true&regime=SIMPLES');
  expect(r.status).toBe(200); expect(r.headers['cache-control']).toBe('no-store');
  expect(consultarFs12DoFechamento).toHaveBeenCalledWith({ portalClientId: 'p1', competencia: '2026-11' });
  expect(prisma.companyFirmAccess.findUnique).toHaveBeenCalledWith(expect.objectContaining({
    where: { companyId_userId: { companyId: 'p1', userId: 'u1' } },
  }));
});
test.each([null, { status: 'INACTIVE', role: 'ACCOUNTANT' }, { status: 'ACTIVE', role: 'STAFF' }])('guarda canônica recusa %j antes de ler', async link => {
  prisma.companyFirmAccess.findUnique.mockResolvedValue(link);
  expect((await request(app()).get('/firm/companies/p1/fechamento/2026-11/fs12')).status).toBe(403);
  expect(consultarFs12DoFechamento).not.toHaveBeenCalled();
});
test('sem sessão recusa; admin conserva acesso existente', async () => {
  expect((await request(app(null)).get('/firm/companies/p1/fechamento/2026-11/fs12')).status).toBe(401);
  expect(consultarFs12DoFechamento).not.toHaveBeenCalled();
  expect((await request(app('admin')).get('/firm/companies/p1/fechamento/2026-11/fs12')).status).toBe(200);
});
test('falha de leitura é indisponibilidade, sem detalhes internos', async () => {
  consultarFs12DoFechamento.mockRejectedValue(Error('segredo interno'));
  const r = await request(app()).get('/firm/companies/p1/fechamento/2026-11/fs12');
  expect(r.status).toBe(503); expect(r.body.ok).toBe(false);
  expect(JSON.stringify(r.body)).not.toContain('segredo interno');
});
test.each([400, 404])('preserva recusa de contexto %i', async status => {
  consultarFs12DoFechamento.mockRejectedValue(Object.assign(Error('Contexto inválido'), { status, code: 'CONTEXTO_INVALIDO' }));
  expect((await request(app()).get('/firm/companies/p1/fechamento/2026-11/fs12')).status).toBe(status);
});

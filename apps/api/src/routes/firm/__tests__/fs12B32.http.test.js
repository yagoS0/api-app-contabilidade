// Real router, canonical authorization and composition; persistence is an in-memory port.
import express from 'express';
import request from 'supertest';
let mockDb;
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: new Proxy({}, { get: (_t, k) => mockDb[k] }) }));
jest.mock('../../../application/fiscal/serpro/SerproHttpClient.js', () => ({ SerproHttpClient: jest.fn(() => { throw Error('FORBIDDEN_FISCAL_TRANSPORT'); }) }));
import { createApuracaoV2Router } from '../apuracaoV2.js';
import { SerproHttpClient } from '../../../application/fiscal/serpro/SerproHttpClient.js';
const user = { id: 'u', role: 'contador', status: 'active', accountType: 'FIRM' };
function app(session = user) {
  const a = express(); a.use(express.json());
  a.use((req, _res, next) => { if (session) req.auth = { user: session }; next(); });
  a.use('/firm/companies/:companyId', createApuracaoV2Router()); return a;
}
const url = (company = 'p', pa = '2026-11') => `/firm/companies/${company}/fechamento/${pa}/fs12/calculos/old-calculation`;
beforeEach(() => {
  jest.clearAllMocks();
  mockDb = {
    $transaction: async fn => fn(mockDb),
    companyFirmAccess: { findUnique: jest.fn(async ({ where }) => where.companyId_userId.companyId === 'p' ? { role: 'ACCOUNTANT', status: 'ACTIVE' } : null) },
    user: { findUnique: jest.fn(async () => user) },
    portalClient: { findUnique: jest.fn(async () => ({ companyId: 'c' })) },
    company: { findUnique: jest.fn(async () => ({ id: 'c', dataAbertura: new Date('2020-01-01'), regimeHistorico: [] })) },
    apuracaoFs12Calculo: { findFirst: jest.fn(async () => null) },
  };
});
afterEach(() => expect(SerproHttpClient).not.toHaveBeenCalled());
test('unknown historical calculation is a no-store read, including 2027', async () => {
  for (const pa of ['2026-11', '2027-01']) {
    const r = await request(app()).get(url('p', pa));
    expect(r.status).toBe(200); expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body).toEqual({ ok: true, situacao: 'DESCONHECIDO', vinculo: null, autorizaEfeitoFiscal: false });
  }
  expect(mockDb.apuracaoFs12Calculo.findFirst).toHaveBeenCalledWith({ where: { portalClientId: 'p', companyId: 'c', competencia: '2027-01', calculoId: 'old-calculation' } });
});
test('canonical ACL blocks missing session, other company and revoked membership', async () => {
  expect((await request(app(null)).get(url())).status).toBe(401);
  expect((await request(app()).get(url('other'))).status).toBe(403);
  mockDb.companyFirmAccess.findUnique.mockResolvedValue({ role: 'ACCOUNTANT', status: 'REMOVED' });
  expect((await request(app()).get(url())).status).toBe(403);
  expect(mockDb.apuracaoFs12Calculo.findFirst).not.toHaveBeenCalled();
});
test('composition rereads active identity; forged privileged session cannot bypass it', async () => {
  mockDb.user.findUnique.mockResolvedValue({ ...user, status: 'inactive' });
  const r = await request(app({ ...user, role: 'admin' })).get(url());
  expect(r.status).toBe(403); expect(mockDb.apuracaoFs12Calculo.findFirst).not.toHaveBeenCalled();
});
test('historical lookup failure is sanitized and no write route exists', async () => {
  mockDb.apuracaoFs12Calculo.findFirst.mockRejectedValue(Error('PRIVATE_SQL_SECRET'));
  const r = await request(app()).get(url());
  expect(r.status).toBe(503); expect(r.body.error).toBe('FS12_INDISPONIVEL');
  expect(JSON.stringify(r.body)).not.toContain('PRIVATE_SQL_SECRET');
  expect((await request(app()).post(url()).send({ autorizaEfeitoFiscal: true })).status).toBe(404);
});

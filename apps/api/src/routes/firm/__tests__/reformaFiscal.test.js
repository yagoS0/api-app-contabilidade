import express from 'express';
import request from 'supertest';
import { createReformaFiscalRouter } from '../reformaFiscal.js';
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: { companyFirmAccess: { findUnique: jest.fn() } } }));
import { prisma as accessDb } from '../../../infrastructure/db/prisma';
import { requireFirmCompanyAccess } from '../../../middlewares/requireFirmCompanyAccess';
let db, app;
beforeEach(() => {
  jest.clearAllMocks();
  db = { reformaFiscalRevisao: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), create: jest.fn() } };
  accessDb.companyFirmAccess.findUnique.mockResolvedValue({ role: 'ACCOUNTANT', status: 'ACTIVE' });
  app = express(); app.use(express.json()); app.use((req, res, next) => { req.auth = { user: { id: 'u', role: 'contador' } }; next(); });
  app.use(createReformaFiscalRouter({ prisma: db, requireFirmCompanyAccess }));
});
test.each(['', '/nfse'])('leitura exige acesso à empresa %s', async sufixo => {
  accessDb.companyFirmAccess.findUnique.mockResolvedValue(null);
  expect((await request(app).get(`/companies/outra/reforma${sufixo}`)).status).toBe(403);
  expect(db.reformaFiscalRevisao.findFirst).not.toHaveBeenCalled();
});
test('STAFF lê histórico mas não grava enquadramento', async () => {
  accessDb.companyFirmAccess.findUnique.mockResolvedValue({ role: 'STAFF', status: 'ACTIVE' });
  const r = await request(app).get('/companies/a/reforma');
  expect(r.body).toMatchObject({ ok: true, podeEditar: false, versao: 0 });
  expect(r.headers['cache-control']).toBe('no-store');
  expect((await request(app).post('/companies/a/reforma').send({})).status).toBe(403);
  expect(db.reformaFiscalRevisao.create).not.toHaveBeenCalled();
});
test('histórico é sempre filtrado pela empresa da URL', async () => {
  const r = await request(app).get('/companies/a/reforma');
  expect(r.status).toBe(200);
  expect(db.reformaFiscalRevisao.findMany.mock.calls[0][0].where).toEqual({ portalClientId: 'a' });
});
test('POST com intenção inválida não escreve', async () => {
  const r = await request(app).post('/companies/a/reforma').send({ versao: 0, id: '../outra' });
  expect(r.status).toBe(400);
  expect(r.body.reason).toMatch(/Identificador/);
  expect(db.reformaFiscalRevisao.create).not.toHaveBeenCalled();
});

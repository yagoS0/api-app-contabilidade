jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: { companyFirmAccess: { findUnique: jest.fn(), findMany: jest.fn() }, portalClient: { findMany: jest.fn() } } }));
jest.mock('../../../application/operacoes/OperationsService.js', () => ({ lerOperacao: jest.fn(), salvarOperacao: jest.fn() }));
jest.mock('../../../application/operacoes/OperationsExecution.js', () => ({ executarOperacao: jest.fn() }));
jest.mock('../../../application/tasks/ManualTaskService.js', () => ({ backgroundRoute: (_kind, run) => run }));
jest.mock('../../../application/operacoes/OperationsManualInss.js', () => ({ lerInssManual: jest.fn(), listarInssManual: jest.fn(), salvarInssManual: jest.fn() }));
import express from 'express';
import request from 'supertest';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { requireFirmCompanyAccess } from '../../../middlewares/requireFirmCompanyAccess.js';
import { lerInssManual, listarInssManual, salvarInssManual } from '../../../application/operacoes/OperationsManualInss.js';
import { createOperationsRouter } from '../operacoes.js';

const db = { $transaction: jest.fn(fn => fn(db)) };
const path = '/firm/companies/a/operacoes/2026-09/inss-manual';
function app(user = { id: 'u', role: 'staff' }) {
  const a = express(); a.use(express.json()); a.use((req, res, next) => { req.auth = { user }; if (!user) return res.sendStatus(401); next(); });
  a.use('/firm', createOperationsRouter({ prisma: db, requireFirmCompanyAccess })); return a;
}
beforeEach(() => {
  jest.clearAllMocks();
  prisma.companyFirmAccess.findUnique.mockResolvedValue({ status: 'ACTIVE', role: 'ACCOUNTANT' });
  prisma.companyFirmAccess.findMany.mockResolvedValue([{ companyId: 'a' }]);
  lerInssManual.mockResolvedValue({ companyId: 'a' }); listarInssManual.mockResolvedValue({ items: [] }); salvarInssManual.mockResolvedValue({ companyId: 'a' });
});
test('reads are local and batch only receives visible IDs, ignoring query scope injection', async () => {
  expect((await request(app()).get(path)).status).toBe(200);
  const result = await request(app()).get('/firm/operacoes/inss-manual?competencia=2026-09&companyId=foreign');
  expect(result.status).toBe(200); expect(result.headers['cache-control']).toBe('no-store');
  expect(listarInssManual).toHaveBeenCalledWith(db, ['a'], '2026-09');
  expect(salvarInssManual).not.toHaveBeenCalled();
});
test('mutation uses authenticated actor and route identity; STAFF cannot save', async () => {
  const body = { companyId: 'foreign', userId: 'intruder', isAdmin: true };
  expect((await request(app()).put(path).send(body)).status).toBe(200);
  expect(salvarInssManual).toHaveBeenCalledWith(db, 'a', '2026-09', 'u', body, { isAdmin: false });
  prisma.companyFirmAccess.findUnique.mockResolvedValue({ status: 'ACTIVE', role: 'STAFF' });
  expect((await request(app()).put(path).send({})).status).toBe(403);
  expect(salvarInssManual).toHaveBeenCalledTimes(1);
});
test('revoked and unauthenticated access blocked; safe conflict and uncertain messages returned', async () => {
  prisma.companyFirmAccess.findUnique.mockResolvedValue({ status: 'REVOKED', role: 'ACCOUNTANT' });
  expect((await request(app()).get(path)).status).toBe(403);
  expect((await request(app(null)).get(path)).status).toBe(401);
  prisma.companyFirmAccess.findUnique.mockResolvedValue({ status: 'ACTIVE', role: 'ACCOUNTANT' });
  salvarInssManual.mockRejectedValueOnce(Object.assign(new Error('secret db details'), { code: 'P2034' }));
  const conflict = await request(app()).put(path).send({});
  expect(conflict.status).toBe(409); expect(conflict.body.message).toContain('simultânea');
  salvarInssManual.mockRejectedValueOnce(new Error('secret db details'));
  const uncertain = await request(app()).put(path).send({});
  expect(uncertain.status).toBe(503); expect(uncertain.body.message).not.toContain('secret');
});

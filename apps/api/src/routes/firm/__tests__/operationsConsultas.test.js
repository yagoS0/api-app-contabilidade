jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: { companyFirmAccess: { findUnique: jest.fn(), findMany: jest.fn() }, portalClient: { findMany: jest.fn() } } }));
jest.mock('../../../application/operacoes/OperationsService.js', () => ({ lerOperacao: jest.fn(), salvarOperacao: jest.fn() }));
jest.mock('../../../application/operacoes/OperationsExecution.js', () => ({ executarOperacao: jest.fn() }));
jest.mock('../../../application/tasks/ManualTaskService.js', () => ({ backgroundRoute: (_kind, run) => run }));
jest.mock('../../../application/operacoes/OperationsManualInss.js', () => ({ lerInssManual: jest.fn(), listarInssManual: jest.fn(), salvarInssManual: jest.fn() }));
import express from 'express';
import request from 'supertest';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { requireFirmCompanyAccess } from '../../../middlewares/requireFirmCompanyAccess.js';

import { createOperationsRouter } from '../operacoes.js';


const db = { serproChamada: { findMany: jest.fn() } };
function app(user = { id: 'u', role: 'staff' }) {
  const a = express(); a.use((req, res, next) => { if (!user) return res.sendStatus(401); req.auth = { user }; next(); });
  a.use('/firm', createOperationsRouter({ prisma: db, requireFirmCompanyAccess })); return a;
}
beforeEach(() => { jest.clearAllMocks(); prisma.companyFirmAccess.findMany.mockResolvedValue([{ companyId: 'a' }]); db.serproChamada.findMany.mockResolvedValue([]); });
test('consulta autenticada ignora companyId injetado e usa apenas acessos ativos', async () => {
  const r = await request(app()).get('/firm/operacoes/consultas?competencia=2026-10&companyId=outra');
  expect(r.status).toBe(200); expect(r.body).toMatchObject({ total: 0, items: [], competencia: '2026-10' });
  expect(r.headers['cache-control']).toBe('no-store');
  expect(db.serproChamada.findMany.mock.calls[0][0].where.portalClientId).toEqual({ in: ['a'] });
  expect(prisma.companyFirmAccess.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u', status: 'ACTIVE' } }));
});
test('sem sessão, competência inválida ou erro de banco não inventa zero', async () => {
  await request(app(null)).get('/firm/operacoes/consultas?competencia=2026-10').expect(401);
  await request(app()).get('/firm/operacoes/consultas?competencia=2026-13').expect(422);
  expect(db.serproChamada.findMany).not.toHaveBeenCalled();
  db.serproChamada.findMany.mockRejectedValueOnce(Error('secret'));
  const r = await request(app()).get('/firm/operacoes/consultas?competencia=2026-10');
  expect(r.status).toBe(503); expect(r.body.total).toBeUndefined(); expect(r.body.message).not.toContain('secret');
});

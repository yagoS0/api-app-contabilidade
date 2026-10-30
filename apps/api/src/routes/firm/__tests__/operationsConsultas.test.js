jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: { companyFirmAccess: { findUnique: jest.fn(), findMany: jest.fn() }, portalClient: { findMany: jest.fn() } } }));
jest.mock('../../../application/operacoes/OperationsService.js', () => ({ lerOperacao: jest.fn(), salvarOperacao: jest.fn() }));
jest.mock('../../../application/operacoes/OperationsExecution.js', () => ({ executarOperacao: jest.fn() }));
jest.mock('../../../application/tasks/ManualTaskService.js', () => ({ backgroundRoute: (_kind, run) => run }));
jest.mock('../../../application/operacoes/OperationsManualInss.js', () => ({ lerInssManual: jest.fn(), listarInssManual: jest.fn(), salvarInssManual: jest.fn() }));
import express from 'express';
import request from 'supertest';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { requireFirmCompanyAccess } from '../../../middlewares/requireFirmCompanyAccess.js';
import { requireAccountType } from '../../../middlewares/requireAccountType.js';

import { createOperationsRouter } from '../operacoes.js';


const db = { serproChamada: { findMany: jest.fn() } };
function app(user = { id: 'u', role: 'staff', accountType: 'FIRM' }) {
  const a = express(); a.use((req, res, next) => { if (!user) return res.sendStatus(401); req.auth = { user }; next(); });
  a.use('/firm', requireAccountType('FIRM'), createOperationsRouter({ prisma: db, requireFirmCompanyAccess })); return a;
}
beforeEach(() => { jest.clearAllMocks(); prisma.companyFirmAccess.findMany.mockResolvedValue([{ companyId: 'a' }]); db.serproChamada.findMany.mockResolvedValue([]); });

test('sessão CLIENT não cruza a guarda FIRM nem consulta evidências', async () => {
 const projection = jest.spyOn(consultas, 'listarEvidenciasOperacoes');
 try {
  const r = await request(app({ id:'cliente', role:'client', accountType:'CLIENT', podeAbrirPortalDoCliente:true })).get('/firm/operacoes/evidencias?competencia=2026-10');
  expect(r.status).toBe(403); expect(r.body.error).toBe('forbidden_account_type');
  expect(projection).not.toHaveBeenCalled(); expect(prisma.companyFirmAccess.findMany).not.toHaveBeenCalled();
 } finally { projection.mockRestore(); }
});
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

import * as consultas from '../../../application/operacoes/OperationsConsultas.js';
test('evidências em lote usam carteira autorizada e snapshot transacional, sem aceitar escopo forjado',async()=>{
 const projection=jest.spyOn(consultas,'listarEvidenciasOperacoes').mockResolvedValue({items:[{companyId:'a',competencia:'2026-10',revision:'r'}],total:1,competencia:'2026-10'});
 db.$transaction=jest.fn(async callback=>callback(db));
 try {
  const r=await request(app()).get('/firm/operacoes/evidencias?competencia=2026-10&companyId=outra');expect(r.status).toBe(200);expect(r.headers['cache-control']).toBe('no-store');expect(projection).toHaveBeenCalledWith(db,['a'],'2026-10');expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function),{isolationLevel:'RepeatableRead',timeout:20000});
  await request(app(null)).get('/firm/operacoes/evidencias?competencia=2026-10').expect(401);expect(projection).toHaveBeenCalledTimes(1);
  projection.mockRejectedValueOnce(Error('segredo'));const failed=await request(app()).get('/firm/operacoes/evidencias?competencia=2026-10');expect(failed.status).toBe(503);expect(failed.body.total).toBeUndefined();expect(failed.body.message).not.toContain('segredo');
 } finally {projection.mockRestore();delete db.$transaction;}
});

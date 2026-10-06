import express from 'express';
import request from 'supertest';
import { createPendenciasManuaisRouter } from '../pendenciasManuais';
import { validarPendenciaManual } from '@contabilidade/shared/pendencias-manuais';
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: { companyFirmAccess: { findUnique: jest.fn() } } }));
import { prisma as accessDb } from '../../../infrastructure/db/prisma';
import { requireFirmCompanyAccess } from '../../../middlewares/requireFirmCompanyAccess';

const dados = { fonte: 'MUNICIPAL', tipo: 'DEBITO', estado: 'ABERTO', tributo: 'ISS', orgao: 'Prefeitura de teste / SP', competencia: '09/2026', dataReferencia: '2026-10-06', total: '1.234,56' };
const id = 'd7d592d7-c4b3-4fd1-8670-b25cd43923bb';
let model, app;
beforeEach(() => {
  jest.clearAllMocks();
  model = { findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() };
  accessDb.companyFirmAccess.findUnique.mockResolvedValue({ role: 'ACCOUNTANT', status: 'ACTIVE', scopes: [] });
  app = express(); app.use(express.json()); app.use((req,res,next) => { req.auth = { user: { id: 'contador', role: 'contador' } }; next(); });
  app.use(createPendenciasManuaisRouter({ prisma: { pendenciaFiscalManual: model }, requireFirmCompanyAccess }));
});
test('leitura e escrita exigem vínculo; STAFF não grava', async () => {
  accessDb.companyFirmAccess.findUnique.mockResolvedValue(null);
  expect((await request(app).get('/companies/b/pendencias-manuais')).status).toBe(403);
  expect(model.findMany).not.toHaveBeenCalled();
  accessDb.companyFirmAccess.findUnique.mockResolvedValue({ role: 'STAFF', status: 'ACTIVE' });
  expect((await request(app).post('/companies/a/pendencias-manuais').send({ id, dados })).status).toBe(403);
  expect(model.create).not.toHaveBeenCalled();
});
test('lista somente registros ativos da empresa autorizada', async () => {
  expect((await request(app).get('/companies/a/pendencias-manuais')).status).toBe(200);
  expect(model.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { portalClientId: 'a', deletedAt: null } }));
});
test('criação fixa empresa e autor no servidor e preserva centavos', async () => {
  model.create.mockImplementation(async ({data}) => data);
  const res = await request(app).post('/companies/a/pendencias-manuais').send({ id, dados, portalClientId: 'b', createdBy: 'intruso' });
  expect(res.status).toBe(201);
  expect(res.body.item).toMatchObject({ portalClientId: 'a', createdBy: 'contador', dados: { total: 123456, multa: null } });
});
test('retry da mesma criação é idempotente', async () => {
  model.create.mockRejectedValue({ code: 'P2002' });
  model.findFirst.mockResolvedValue({ id, dados: validarPendenciaManual(dados) });
  expect((await request(app).post('/companies/a/pendencias-manuais').send({ id, dados })).status).toBe(200);
  expect(model.findFirst).toHaveBeenCalledWith({ where: { id, portalClientId: 'a', deletedAt: null } });
});
test.each(['put','delete'])('%s recusa versão antiga e não altera outra empresa', async method => {
  model.updateMany.mockResolvedValue({ count: 0 });
  const res = await request(app)[method](`/companies/b/pendencias-manuais/${id}`).send({ versao: 1, dados });
  expect(res.status).toBe(409);
  expect(model.updateMany.mock.calls[0][0].where).toEqual({ id, portalClientId: 'b', versao: 1, deletedAt: null });
});
test('edição incrementa versão; exclusão preserva registro com data e autor', async () => {
  model.updateMany.mockResolvedValue({ count: 1 }); model.findFirst.mockResolvedValue({ id, versao: 2, dados: validarPendenciaManual(dados) });
  expect((await request(app).put(`/companies/a/pendencias-manuais/${id}`).send({ versao: 1, dados })).status).toBe(200);
  expect(model.updateMany.mock.calls[0][0].data).toMatchObject({ versao: { increment: 1 }, updatedBy: 'contador', dados: { total: 123456 } });
  expect((await request(app).delete(`/companies/a/pendencias-manuais/${id}`).send({ versao: 2 })).status).toBe(200);
  expect(model.updateMany.mock.calls[1][0].data).toMatchObject({ deletedAt: expect.any(Date), updatedBy: 'contador' });
});
test.each([{ total: '-1,00' }, { total: '10.0' }, { dataReferencia: '2026-02-30' }, { competencia: '13/2026' }, { tributo: '' }, { fonte: 'INVALIDO' }])('recusa dados inválidos %j antes de gravar', async patch => {
  expect((await request(app).post('/companies/a/pendencias-manuais').send({ id, dados: { ...dados, ...patch } })).status).toBe(400);
  expect(model.create).not.toHaveBeenCalled();
});

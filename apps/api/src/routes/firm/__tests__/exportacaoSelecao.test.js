jest.mock('../../../middlewares/requireFirmCompanyAccess.js', () => ({ requireFirmCompanyAccess: () => (_req, _res, next) => next() }));
jest.mock('../../../infrastructure/db/prisma.js', () => {
  const prisma = {
    accountingEntry: { findMany: jest.fn(), updateMany: jest.fn() },
    chartOfAccount: { findMany: jest.fn(async () => [{ codigo: '1' }, { codigo: '2' }]) },
    companyMonthlyCircular: { findUnique: jest.fn(async () => ({ fechadoContabilEm: '2026-09-01' })) },
  };
  prisma.$transaction = jest.fn(async cb => cb(prisma));
  return { prisma };
});
import express from 'express';
import request from 'supertest';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { createAccountingEntriesRouter } from '../accountingEntries.js';
const body = { competenciaInicio: '2026-08', competenciaFim: '2026-08', entryIds: ['a'] };
const entry = id => ({ id, competencia: '2026-08', tipo: 'DESPESA', status: 'CONFIRMADO', data: '2026-08-01', historico: `Registro ${id}`, lines: [{ tipo: 'D', conta: '1', valor: 25 }, { tipo: 'C', conta: '2', valor: 25 }] });
const app = express(); app.use(express.json());
app.use('/companies/:companyId', createAccountingEntriesRouter({ log: { error: jest.fn(), info: jest.fn(), warn: jest.fn() } }));
const path = '/companies/company-a/entries/export';
beforeEach(() => {
  jest.clearAllMocks();
  prisma.accountingEntry.findMany.mockImplementation(async ({ where }) => [entry('a'), entry('b')].filter(e => !where.id || where.id.in.includes(e.id)));
  prisma.accountingEntry.updateMany.mockResolvedValue({ count: 1 });
});
async function preview() { const r = await request(app).post(`${path}/preflight`).send(body); expect(r.status).toBe(200); return r.body.preflightHash; }
test('prévia e CSV usam somente IDs da empresa e confirmar marca somente a seleção', async () => {
  const preflightHash = await preview();
  const r = await request(app).post(`${path}/csv`).send({ ...body, preflightHash });
  expect(r.status).toBe(200); expect(r.text).toContain('Registro a'); expect(r.text).not.toContain('Registro b');
  expect(prisma.accountingEntry.updateMany).not.toHaveBeenCalled();
  const c = await request(app).post(`${path}/confirmar`).send({ ...body, preflightHash });
  expect(c.status).toBe(200);
  expect(prisma.accountingEntry.updateMany).toHaveBeenCalledWith({ where: { portalClientId: 'company-a', competencia: '2026-08', id: { in: ['a'] }, tipo: { not: 'PARCELA' }, status: 'CONFIRMADO' }, data: { status: 'EXPORTADO' } });
  expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
});
test.each([[], ['inexistente'], ['a', 'a']].map(entryIds => ({ entryIds })))('recusa seleção inválida %j', async ({ entryIds }) => {
  const r = await request(app).post(`${path}/preflight`).send({ ...body, entryIds }); expect(r.status).toBe(400);
  expect(prisma.accountingEntry.updateMany).not.toHaveBeenCalled();
});
test('alteração depois da prévia impede download e marcação', async () => {
  const preflightHash = await preview();
  prisma.accountingEntry.findMany.mockResolvedValue([{ ...entry('a'), historico: 'Alterado' }]);
  for (const action of ['csv', 'confirmar']) expect((await request(app).post(`${path}/${action}`).send({ ...body, preflightHash })).status).toBe(409);
  expect(prisma.accountingEntry.updateMany).not.toHaveBeenCalled();
});
test('seleção de apenas uma perna de folha não pode ser exportada', async () => {
  prisma.accountingEntry.findMany.mockResolvedValue([{ ...entry('a'), tipo: 'FOLHA', loteImportacao: 'FOLHA-1', lines: [{ tipo: 'D', conta: '1', valor: 25 }] }]);
  const p = await request(app).post(`${path}/preflight`).send(body);
  expect(p.body.erros.length).toBeGreaterThan(0);
  for (const action of ['csv', 'confirmar']) expect((await request(app).post(`${path}/${action}`).send({ ...body, preflightHash: p.body.preflightHash })).status).toBe(400);
});

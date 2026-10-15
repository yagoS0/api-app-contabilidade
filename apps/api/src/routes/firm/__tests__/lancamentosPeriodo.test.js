jest.mock('../../../middlewares/requireFirmCompanyAccess.js', () => ({ requireFirmCompanyAccess: () => (_q, _s, next) => next() }));
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {
  accountingEntry: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
} }));
import express from 'express';
import request from 'supertest';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { createAccountingEntriesRouter } from '../accountingEntries.js';
const app = express();
app.use('/firm/companies/:companyId', createAccountingEntriesRouter({ log: { error: jest.fn() } }));

test.each([
  ['2026-09', '2026-09-01', '2026-10-01'],
  ['2026-12', '2026-12-01', '2027-01-01'],
  ['2028-02', '2028-02-01', '2028-03-01'],
])('lista e total de %s usam data civil e não competência da provisão', async (mes, inicio, fim) => {
  const r = await request(app).get(`/firm/companies/empresa/entries?competencia=${mes}`);
  expect(r.status).toBe(200);
  const where = prisma.accountingEntry.findMany.mock.lastCall[0].where;
  expect(where).toMatchObject({ portalClientId: 'empresa', data: {
    gte: new Date(`${inicio}T00:00:00Z`), lt: new Date(`${fim}T00:00:00Z`),
  } });
  expect(where).not.toHaveProperty('competencia');
  expect(prisma.accountingEntry.count.mock.lastCall[0].where).toEqual(where);
});

test('mês inválido não abre consulta sem limite', async () => {
  expect((await request(app).get('/firm/companies/empresa/entries?competencia=2026-13')).status).toBe(400);
});

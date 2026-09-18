jest.mock('../../../middlewares/requireFirmCompanyAccess.js', () => ({
  requireFirmCompanyAccess: () => (req, res, next) => next(),
}));
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {
  accountingEntry: { findMany: jest.fn(), count: jest.fn(async () => 1) },
  guide: { findMany: jest.fn() },
  companyMonthlyCircular: { findMany: jest.fn(async () => []) },
} }));
import express from 'express';
import request from 'supertest';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { createAccountingEntriesRouter } from '../accountingEntries.js';

const marker = { guiaId: 'g1', recalculadoEm: '2026-09-18T12:00:00.000Z', valorAnterior: 1000, valorAtual: 1120, escopoValor: 'TOTAL_GUIA', especie: 'DARF_PRESUMIDO' };
const g = { id: 'g1', portalClientId: 'p1', competencia: '2026-07', tipo: 'OUTRA', extracted: { recalculoGuia: marker } };
const entry = { id: 'e1', portalClientId: 'p1', sourceGuideId: 'g1', competencia: '2026-07', eventType: 'DARF_PIS', tipo: 'PROVISAO', statusPagamento: 'ABERTO', status: 'EXPORTADO', lines: [{ tipo: 'D', valor: 100 }, { tipo: 'C', valor: 100 }], baixas: [] };
function app() {
  const a = express();
  a.use('/firm/companies/:companyId', createAccountingEntriesRouter({ log: { error: jest.fn(), warn: jest.fn() } }));
  return a;
}
beforeEach(() => {
  jest.clearAllMocks();
  prisma.accountingEntry.findMany.mockImplementation(async ({ where }) => where.tipo === 'RECEITA' || where.tipo === 'BAIXA' ? [] : [entry]);
  prisma.guide.findMany.mockImplementation(async ({ where }) => where.OR ? [g] : []);
});
it.each(['/entries', '/entries/provisoes', '/entries/circular?year=2026'])('expõe registro na rota %s sem mudar o lançamento exportado', async (path) => {
  const r = await request(app()).get('/firm/companies/p1' + path);
  expect(r.status).toBe(200);
  const row = (r.body.data || r.body.provisoes)[0];
  expect(row.recalculoGuia).toEqual(marker);
  expect(row.totalD).toBe(100);
  expect(row.lines).toEqual(entry.lines);
  expect(row.status).toBe('EXPORTADO');
});
it('a circular sintética do INSS sinaliza sucesso mesmo com valor igual', async () => {
  prisma.accountingEntry.findMany.mockResolvedValue([]);
  const inss = { ...g, tipo: 'INSS', valor: 1000, valorOriginal: 1000, source: 'SERPRO', paymentStatus: 'OPEN', extracted: { recalculoGuia: { ...marker, especie: 'INSS', valorAtual: 1000 } } };
  prisma.guide.findMany.mockImplementation(async ({ where }) => where.OR || where.tipo === 'INSS' ? [inss] : []);
  const r = await request(app()).get('/firm/companies/p1/entries/circular?year=2026');
  expect(r.status).toBe(200);
  expect(r.body.provisoes).toHaveLength(1);
  expect(r.body.provisoes[0]).toMatchObject({ id: 'synthetic-inss-g1', synthetic: true, totalD: 1000, recalculoGuia: { especie: 'INSS', valorAnterior: 1000, valorAtual: 1000 } });
});

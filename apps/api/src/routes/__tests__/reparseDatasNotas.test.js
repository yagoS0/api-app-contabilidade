import express from 'express';
import request from 'supertest';
import { xmlNfseData, CHAVE_NFSE, CNPJ_DATAS } from '../../application/notas/__fixtures__/dataEmissaoNotas.js';
jest.mock('../../infrastructure/db/prisma.js', () => {
  const prisma = { portalInvoice: { findFirst: jest.fn(), updateMany: jest.fn() } };
  prisma.$transaction = jest.fn(cb => cb(prisma));
  return { prisma };
});
jest.mock('../middlewares/portalAccess.js', () => ({ ensurePortalClientAccess: jest.fn(async () => ({ ok: true })) }));
import { prisma } from '../../infrastructure/db/prisma.js';
import { createPortalInvoicesRouter } from '../portalInvoices.js';
const row = { id: 'n', clientId: 'a', chaveAcesso: CHAVE_NFSE, emitenteDoc: CNPJ_DATAS,
  xmlRaw: xmlNfseData(), issueDate: new Date('2026-08-01'), competencia: new Date('2026-08-01'),
  total: 1234, updatedAt: new Date('2026-10-01') };
function app() {
  const a = express(); a.use(express.json());
  a.use('/clients/:clientId/invoices', createPortalInvoicesRouter({ ensureAuthorized: async req => {
    req.auth = { user: { id: 'contador' } }; return true;
  }, log: { error: jest.fn() } })); return a;
}
beforeEach(() => { jest.clearAllMocks(); prisma.portalInvoice.findFirst.mockResolvedValue(row); prisma.portalInvoice.updateMany.mockResolvedValue({ count: 1 }); });
test('reparse corrige só a projeção com auditoria atômica e revisão da fonte', async () => {
  const result = await request(app()).post('/clients/a/invoices/n/reparse');
  expect(result.status).toBe(200);
  const { where, data } = prisma.portalInvoice.updateMany.mock.calls[0][0];
  expect(where).toMatchObject({ id: 'n', clientId: 'a', updatedAt: row.updatedAt, xmlRaw: row.xmlRaw });
  expect(Object.keys(data).sort()).toEqual(['dataEmissaoCivil', 'dataEmissaoEvidencia', 'dataEmissaoInstante']);
  expect(data.dataEmissaoCivil).toBe('2026-09-28');
  expect(data.dataEmissaoEvidencia.historico[0]).toMatchObject({ autor: 'contador', notaId: 'n', clientId: 'a' });
});
test('fonte concorrente não recebe sucesso', async () => {
  prisma.portalInvoice.updateMany.mockResolvedValue({ count: 0 });
  expect((await request(app()).post('/clients/a/invoices/n/reparse')).status).toBe(409);
});
test('documento de outra identidade não é usado para corrigir a nota', async () => {
  prisma.portalInvoice.findFirst.mockResolvedValue({ ...row, chaveAcesso: '9'.repeat(50) });
  expect((await request(app()).post('/clients/a/invoices/n/reparse')).status).toBe(409);
  expect(prisma.portalInvoice.updateMany).not.toHaveBeenCalled();
});
test('consulta exige id e empresa juntos e não fabrica nota ausente', async () => {
  prisma.portalInvoice.findFirst.mockResolvedValue(null);
  expect((await request(app()).post('/clients/b/invoices/n/reparse')).status).toBe(404);
  expect(prisma.portalInvoice.findFirst).toHaveBeenCalledWith({ where: { id: 'n', clientId: 'b' } });
  expect(prisma.portalInvoice.updateMany).not.toHaveBeenCalled();
});

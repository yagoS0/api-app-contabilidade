import express from 'express';
import request from 'supertest';
import { xmlResumoData, CHAVE_NFE, CNPJ_DATAS } from '../../application/notas/__fixtures__/dataEmissaoNotas.js';
import { criarCapturaDfe } from '../../application/notas/dfe/provenienciaDfe.js';
import { camposDataEmissao, evidenciaDaNota } from '../../application/notas/dataEmissaoNota.js';
jest.mock('../../infrastructure/db/prisma.js', () => ({ prisma: { portalInvoice: { findFirst: jest.fn() }, portalSyncState: { findUnique: jest.fn(async () => null) } } }));
jest.mock('../middlewares/portalAccess.js', () => ({ ensurePortalClientAccess: jest.fn(async () => ({ ok: true })) }));
import { prisma } from '../../infrastructure/db/prisma.js';
import { createPortalInvoicesRouter } from '../portalInvoices.js';
const recipient = '44555666000177';
const app = express();
app.use('/clients/:clientId/invoices', createPortalInvoicesRouter({ ensureAuthorized: async () => true, log: { error: jest.fn() } }));
function note() {
  const n = { id: 'n', clientId: 'a', client: { cnpj: recipient }, type: 'NFE', status: 'EMITIDA',
    chaveAcesso: CHAVE_NFE, emitenteDoc: CNPJ_DATAS, xmlResumo: xmlResumoData(), xmlRaw: null,
    issueDate: new Date('2026-08-01'), competencia: new Date('2026-08-01'),
    provenienciaDfe: criarCapturaDfe({ clientId: 'a', cnpj: recipient, ambiente: 'prod', nsu: '1', chave: CHAVE_NFE, xml: xmlResumoData() }) };
  return { ...n, ...camposDataEmissao(evidenciaDaNota(n, { documentoEmpresa: recipient })) };
}
test('detail revalidates stored proof, preserves fiscal dates and does not advertise summary as XML', async () => {
  prisma.portalInvoice.findFirst.mockResolvedValue(note());
  const res = await request(app).get('/clients/a/invoices/n');
  expect(res.status).toBe(200); expect(res.body.dataEmissao.civil).toBe('2026-09-27');
  expect(res.body.competencia).toBe('2026-08'); expect(res.body.issueDate).toBe('2026-08-01T00:00:00.000Z');
  expect(res.body.storage.xml).toBe(false); expect(res.body.provenienciaDfe).toBeUndefined();
  expect(prisma.portalInvoice.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'n', clientId: 'a' } }));
});
test.each([{ provenienciaDfe: null }, { clientId: 'b' }, { xmlResumo: xmlResumoData('2026-10-01T00:00:00Z') }, { client: { cnpj: CNPJ_DATAS + '0' } }])('cached civil cannot hide changed proof/source: %j', patch => {
  prisma.portalInvoice.findFirst.mockResolvedValue({ ...note(), ...patch });
  return request(app).get('/clients/a/invoices/n').then(res => {
    expect(res.status).toBe(200); expect(res.body.dataEmissao.civil).toBeNull();
  });
});
test.each(['/xml', '/xml/raw'])('legacy summary in xmlRaw is not downloadable through %s', async suffix => {
  prisma.portalInvoice.findFirst.mockResolvedValue({ ...note(), xmlRaw: xmlResumoData() });
  expect((await request(app).get(`/clients/a/invoices/n${suffix}`)).status).toBe(404);
});

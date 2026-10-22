jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {
  companyDocument: { findFirst: jest.fn(), delete: jest.fn() }, guide: { findFirst: jest.fn() },
} }));
jest.mock('../GuideStorageService.js', () => ({ GuideStorageService: jest.fn() }));
import { createHash } from 'node:crypto';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { baixarBuffer, remover } from '../../companies/CompanyDocumentsService.js';
import { bloqueioEnvioParcela } from '../GuiaParcelaEnvioGuard.js';
import { canGuideConfirmPayment, canGuideRecalculate } from '../lib/recalculoDaGuia.js';
import { STATUS_DOCUMENTO } from '../lib/documentoNaoArrecadatorio.js';

const pdf = Buffer.from('%PDF-1.4 documento fictício');
beforeEach(() => jest.resetAllMocks());
test('download conserva bytes e escopo; exclusão do documento histórico recusada', async () => {
  const doc = { id: 'd', portalClientId: 'empresa', fileKey: 'guia-documento:g' };
  const guia = { id: 'g', portalClientId: 'empresa', status: STATUS_DOCUMENTO, pdfBytes: pdf, hash: createHash('sha256').update(pdf).digest('hex'), extracted: { documentoNaoArrecadatorio: { documentId: 'd' } } };
  prisma.companyDocument.findFirst.mockImplementation(async ({ where }) => where.portalClientId === doc.portalClientId ? doc : null);
  prisma.guide.findFirst.mockImplementation(async ({ where }) => where.portalClientId === guia.portalClientId ? guia : null);
  expect((await baixarBuffer({ portalClientId: 'empresa', documentId: 'd' })).buffer).toEqual(pdf);
  await expect(baixarBuffer({ portalClientId: 'outra', documentId: 'd' })).rejects.toMatchObject({ status: 404 });
  await expect(remover({ portalClientId: 'empresa', documentId: 'd' })).rejects.toMatchObject({ status: 409 });
  expect(prisma.companyDocument.delete).not.toHaveBeenCalled();
  guia.hash = 'alterado';
  await expect(baixarBuffer({ portalClientId: 'empresa', documentId: 'd' })).rejects.toMatchObject({ status: 409 });
});
test.each([{ status: STATUS_DOCUMENTO }, { extracted: { documentoNaoArrecadatorio: { documentId: 'd' } } }])('status ou metadado impedem envio, pagamento e recálculo', marker => {
  const guide = { source: 'SERPRO', tipo: 'SIMPLES', paymentStatus: 'OPEN', ...marker };
  expect(bloqueioEnvioParcela(guide)).toMatchObject({ code: STATUS_DOCUMENTO });
  expect(canGuideConfirmPayment(guide)).toBe(false);
  expect(canGuideRecalculate(guide)).toBe(false);
});

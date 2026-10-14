jest.mock('../../../config.js', () => ({ NFSE_ENV: 'producao', log: { error: jest.fn() } }));
jest.mock('../prisma.js', () => ({ prisma: {
  serviceInvoice: { update: jest.fn(async ({ data }) => ({ id: 's', companyId: 'empresa', competencia: new Date('2026-09-01'), valorServicos: 1, ...data })), updateMany: jest.fn(), findFirst: jest.fn(async () => ({ id: 's' })) },
  portalClient: { findUnique: jest.fn(async () => { throw Error('banco indisponível'); }) }
} }));
import { NfseRepository } from '../NfseRepository.js';
import { prisma } from '../prisma.js';
beforeEach(() => jest.clearAllMocks());
test('falha da pendência não reclassifica autorização e mantém fila persistida', async () => {
  const nota = await NfseRepository.markIssued('s', { status: 'issued', numeroNfse: '1', chaveAcesso: 'chave' });
  expect(nota.status).toBe('issued');
  expect(prisma.serviceInvoice.update).toHaveBeenCalledTimes(1);
  expect(prisma.serviceInvoice.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'issued', revisaoPeriodoPendente: true }) }));
  expect(prisma.serviceInvoice.updateMany).not.toHaveBeenCalled();
});
test('cancelamento preserva resultado e agenda apenas revisão local', async () => {
  const nota = await NfseRepository.updateByChaveAcesso('chave', { status: 'cancelled' });
  expect(nota.status).toBe('cancelled');
  expect(prisma.serviceInvoice.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled', revisaoPeriodoPendente: true }) }));
  expect(prisma.serviceInvoice.updateMany).not.toHaveBeenCalled();
});

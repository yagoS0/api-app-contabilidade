import { syncPgdasByCompetencia } from '../SerproPgdasDeclaracaoService.js';
import { prisma } from '../../../../infrastructure/db/prisma.js';
import { getResolvedSerproCredentials } from '../SerproRuntimeSettings.js';
jest.mock('../../../../infrastructure/db/prisma.js', () => ({ prisma: { $transaction: jest.fn(), portalClient: { findUnique: jest.fn() }, guide: { findFirst: jest.fn() }, companyMonthlyCircular: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() } } }));
jest.mock('../SerproRuntimeSettings.js', () => ({ getResolvedSerproCredentials: jest.fn(async () => { throw new Error('PARADA_ANTES_HTTP'); }) }));
const input = { portalClientId: 'c1', competencia: '2026-08' };
beforeEach(() => { jest.clearAllMocks(); prisma.$transaction.mockImplementation(callback => callback(prisma)); prisma.portalClient.findUnique.mockResolvedValue({ id: 'c1', cnpj: '12345678000199' }); prisma.guide.findFirst.mockResolvedValue({ id: 'g1', pdfBytes: Buffer.from('pdf') }); prisma.companyMonthlyCircular.upsert.mockResolvedValue({ id: 'circ' }); });
test('extrato completo reutiliza estado antes do upsert RUNNING', async () => {
  prisma.companyMonthlyCircular.findUnique.mockResolvedValue({ id: 'circ', serproSyncStatus: 'SUCCESS', pgdasDeclaracaoFileId: 'f1', pgdasNumeroDeclaracao: '123', pgdasReciboFileId: 'recibo', dasNumeroDocumento: '123' });
  expect(await syncPgdasByCompetencia(input)).toMatchObject({ reutilizado: true, guide: { id: 'g1' } });
  expect(prisma.companyMonthlyCircular.upsert).not.toHaveBeenCalled();
  expect(getResolvedSerproCredentials).not.toHaveBeenCalled();
});
test('ausência recente evita consultar índice de novo', async () => {
  prisma.companyMonthlyCircular.findUnique.mockResolvedValue({ id: 'circ', serproSyncStatus: 'NOT_FOUND', serproLastSyncAt: new Date() });
  expect(await syncPgdasByCompetencia(input)).toMatchObject({ reutilizado: true, guide: null });
  expect(getResolvedSerproCredentials).not.toHaveBeenCalled();
});
test.each([{ atualizar: true }, { indiceExistente: { dados: '{}' } }])('atualização ou índice novo não reutiliza ausência: %j', async extra => {
  prisma.companyMonthlyCircular.findUnique.mockResolvedValue({ id: 'circ', serproSyncStatus: 'NOT_FOUND', serproLastSyncAt: new Date() });
  await expect(syncPgdasByCompetencia({ ...input, ...extra })).rejects.toThrow('PARADA_ANTES_HTTP');
  expect(getResolvedSerproCredentials).toHaveBeenCalledTimes(1);
});

test('sucesso sem recibo não interrompe recuperação', async () => {
  prisma.companyMonthlyCircular.findUnique.mockResolvedValue({ serproSyncStatus: 'SUCCESS', pgdasNumeroDeclaracao: '123', pgdasDeclaracaoFileId: 'f1' });
  await expect(syncPgdasByCompetencia(input)).rejects.toThrow('PARADA_ANTES_HTTP');
});


test('DAS por upload evita repetir extrato completo', async () => {
  prisma.guide.findFirst.mockImplementation(async ({ where }) => where.source ? null : { id: 'upload', pdfBytes: Buffer.from('pdf') });
  prisma.companyMonthlyCircular.findUnique.mockResolvedValue({ serproSyncStatus: 'SUCCESS', pgdasDeclaracaoFileId: 'f1', pgdasNumeroDeclaracao: '123', pgdasReciboFileId: 'r', dasNumeroDocumento: '123' });
  expect(await syncPgdasByCompetencia(input)).toMatchObject({ reutilizado: true, guide: { id: 'upload' } });
  expect(getResolvedSerproCredentials).not.toHaveBeenCalled();
});

test('conciliação somente documental não repete extrato por falta de DAS', async () => {
  prisma.guide.findFirst.mockResolvedValue(null);
  prisma.companyMonthlyCircular.findUnique.mockResolvedValue({ serproSyncStatus: 'SUCCESS', pgdasDeclaracaoFileId: 'f1', pgdasNumeroDeclaracao: '123', pgdasReciboFileId: 'r', dasNumeroDocumento: '123' });
  expect(await syncPgdasByCompetencia({ ...input, somenteDocumentos: true })).toMatchObject({ reutilizado: true });
  expect(getResolvedSerproCredentials).not.toHaveBeenCalled();
  expect(prisma.companyMonthlyCircular.upsert).not.toHaveBeenCalled();
});

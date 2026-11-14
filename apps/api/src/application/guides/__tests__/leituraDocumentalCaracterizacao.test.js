jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {
  guide: { findMany: jest.fn(), count: jest.fn() }, $transaction: jest.fn(),
} }));
jest.mock('../GuideStorageService.js', () => ({ GuideStorageService: { create: jest.fn() } }));
import { prisma } from '../../../infrastructure/db/prisma.js';
import { GuideStorageService } from '../GuideStorageService.js';
import { getGuidePdfBuffer, listGuidesByCompany } from '../GuideService.js';

beforeEach(() => jest.resetAllMocks());
test('PDF incorporado precede storage, preservando Buffer e convertendo Uint8Array', async () => {
  const bytes = Buffer.from('%PDF-1.4 sintetico');
  expect(await getGuidePdfBuffer({ pdfBytes: bytes, storageKey: 'legado' })).toBe(bytes);
  expect(await getGuidePdfBuffer({ pdfBytes: new Uint8Array(bytes) })).toEqual(bytes);
  expect(GuideStorageService.create).not.toHaveBeenCalled();
});
test('ausência retorna null; bytes vazios usam storage e falha original é propagada', async () => {
  expect(await getGuidePdfBuffer(null)).toBeNull();
  expect(await getGuidePdfBuffer({ pdfBytes: Buffer.alloc(0) })).toBeNull();
  const bytes = Buffer.from('legado');
  const downloadBuffer = jest.fn().mockResolvedValue(bytes);
  GuideStorageService.create.mockReturnValue({ downloadBuffer });
  expect(await getGuidePdfBuffer({ pdfBytes: [], storageKey: 'key' })).toBe(bytes);
  expect(downloadBuffer).toHaveBeenCalledWith({ key: 'key' });
  const error = new Error('storage indisponivel');
  downloadBuffer.mockRejectedValue(error);
  await expect(getGuidePdfBuffer({ storageKey: 'key' })).rejects.toBe(error);
  GuideStorageService.create.mockImplementation(() => { throw error; });
  await expect(getGuidePdfBuffer({ storageKey: 'key' })).rejects.toBe(error);
});
test.each([{ status: 'DOCUMENTO_NAO_ARRECADATORIO' }, { extracted: { documentoNaoArrecadatorio: true } }])('não arrecadatório recusa antes de qualquer leitura %j', async marker => {
  await expect(getGuidePdfBuffer({ ...marker, pdfBytes: Buffer.from('pdf'), storageKey: 'key' }))
    .rejects.toMatchObject({ code: 'DOCUMENTO_NAO_ARRECADATORIO', status: 409 });
  expect(GuideStorageService.create).not.toHaveBeenCalled();
});
test('leitura binária não infere liberação, entrega, pagamento nem operação', async () => {
  const guide = Object.freeze({ status: 'PROCESSED', liberadaCliente: false, paymentStatus: 'OPEN', pdfBytes: Buffer.from('pdf') });
  expect(await getGuidePdfBuffer(guide)).toBe(guide.pdfBytes);
  expect(guide.liberadaCliente).toBe(false);
  expect(guide.paymentStatus).toBe('OPEN');
});
test('lista do portal conserva escopo e liberação nas duas queries e não inclui não arrecadatório', async () => {
  prisma.$transaction.mockResolvedValue([[], 0]);
  const result = await listGuidesByCompany({ portalClientId: 'tenant-a', apenasLiberadas: true, competencia: '2026-10' });
  const where = { portalClientId: 'tenant-a', competencia: '2026-10', liberadaCliente: true, AND: [{ status: { not: 'DOCUMENTO_NAO_ARRECADATORIO' } }] };
  expect(prisma.guide.findMany).toHaveBeenCalledWith(expect.objectContaining({ where, orderBy: { updatedAt: 'desc' }, skip: 0, take: 25 }));
  expect(prisma.guide.count).toHaveBeenCalledWith({ where });
  expect(result.items).toEqual([]);
});

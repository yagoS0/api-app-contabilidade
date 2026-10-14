jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: { guide: { findFirst: jest.fn(async () => null) }, portalClient: { findUnique: jest.fn(async () => ({ id: 'empresa', cnpj: '12345678000199', razao: 'Empresa' })) } } }));
jest.mock('../GuideRuntimeSettings.js', () => ({ getGuideRuntimeSettings: async () => ({ pdfReaderUrl: 'mock' }) }));
jest.mock('../GuideParserClient.js', () => ({ GuideParserClient: { create: jest.fn() } }));
jest.mock('../GuideService.js', () => ({
  hashPdf: () => 'hash', buildUploadSourceFileId: () => 'upload:hash',
  createOrUpdateGuideFromProcessing: jest.fn(async args => ({ id: 'guia', ...args.parsed, extracted: args.extracted })),
}));
jest.mock('../../accounting/parcelamento/GuiaAvulsaParcelamentoService.js', () => ({ prepararParcelamentoDaGuia: async () => null }));
import { GuideParserClient } from '../GuideParserClient.js';
import { createOrUpdateGuideFromProcessing } from '../GuideService.js';
import { uploadGuideForPortalClient } from '../GuideUploadService.js';

beforeEach(() => jest.clearAllMocks());
test.each([[14101.25,14101,14101.25],[100.01,100,100.01],[100.99,101,100.99],[null,142.25,142.25]])('preserva total do PDF (%s), formulário %s', async (lido, informado, esperado) => {
  GuideParserClient.create.mockReturnValue({ parsePdf: async () => ({ tipo: 'SIMPLES', competencia: '2026-09', valor: lido, cnpj: '12345678000199' }) });
  await uploadGuideForPortalClient({ portalClientId: 'empresa', fileBuffer: Buffer.from('%PDF'), fileName: 'guia.pdf', metadata: { valor: informado } });
  expect(createOrUpdateGuideFromProcessing).toHaveBeenCalledWith(expect.objectContaining({ parsed: expect.objectContaining({ valor: esperado }), extracted: expect.objectContaining({ valor: esperado }) }));
});

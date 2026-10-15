jest.mock('../../../../infrastructure/db/prisma.js', () => ({ prisma: {
 portalClient: { findUnique: jest.fn(async () => ({ id: 'a', cnpj: '12345678000199' })) },
 guide: { findFirst: jest.fn(async () => null), deleteMany: jest.fn() },
 companyMonthlyCircular: { findUnique: jest.fn(async () => ({ lockedAt: '2026-10-01', receitaBruta: 900 })), upsert: jest.fn(async () => ({})) },
} }));
jest.mock('../reutilizarGuia.js', () => ({ reutilizarGuia: jest.fn(async () => null) }));
jest.mock('../SerproRuntimeSettings.js', () => ({ getResolvedSerproCredentials: async () => ({ certificate: { document: '12345678000199' } }) }));
jest.mock('../SerproPgdasdService.js', () => ({ SERPRO_PGDASD_SERVICE_NORMAL: 'GERARDAS12', SERPRO_PGDASD_SERVICE_COBRANCA: 'GERARDASCOBRANCA17', SerproPgdasdService: jest.fn(() => ({ emitirDasNormal: async () => ({ pdf: Buffer.from('%PDF-' + 'test'.repeat(50)).toString('base64'), valor: 100 }) })) }));
jest.mock('../../../guides/GuideService.js', () => ({ createOrUpdateGuideFromProcessing: jest.fn(async () => ({ id: 'g' })), hashPdf: () => 'hash', toGuideResponse: g => ({ guideId: g.id }), PUBLICO: { ESCRITORIO: 'ESCRITORIO' } }));
jest.mock('../../../accounting/AccountingEntryGeneratorService.js', () => ({ generateEntriesFromCircular: jest.fn(async () => ({ ok: true })), FONTE_VALOR_GUIA: 'GUIA' }));
jest.mock('../../circularAcrescimos.js', () => ({ gravarAcrescimoCircular: jest.fn() }));
jest.mock('pdf-parse', () => jest.fn(async () => ({ text: '' })));
import { prisma } from '../../../../infrastructure/db/prisma.js';
import { capturePgdasGuideForCompany } from '../CaptureSerproGuidesService.js';
import { generateEntriesFromCircular } from '../../../accounting/AccountingEntryGeneratorService.js';
import { createOrUpdateGuideFromProcessing } from '../../../guides/GuideService.js';
import { gravarAcrescimoCircular } from '../../circularAcrescimos.js';
beforeEach(() => jest.clearAllMocks());
test('captura documental salva DAS sem sobrescrever circular, gerar lançamentos ou excluir guias', async () => {
 const r = await capturePgdasGuideForCompany({ portalClientId: 'a', competencia: '2026-10', somenteDocumentos: true });
 expect(r.guide.guideId).toBe('g');
 expect(r.circular).toMatchObject({ lockedAt: '2026-10-01', receitaBruta: 900 });
 expect(createOrUpdateGuideFromProcessing).toHaveBeenCalledTimes(1);
 expect(prisma.companyMonthlyCircular.upsert).not.toHaveBeenCalled();
 expect(generateEntriesFromCircular).not.toHaveBeenCalled();
 expect(gravarAcrescimoCircular).not.toHaveBeenCalled();
 expect(prisma.guide.deleteMany).not.toHaveBeenCalled();
});
test('captura explícita legada conserva geração contábil', async () => {
 await capturePgdasGuideForCompany({ portalClientId: 'a', competencia: '2026-10' });
 expect(prisma.companyMonthlyCircular.upsert).toHaveBeenCalledTimes(1);
 expect(generateEntriesFromCircular).toHaveBeenCalledTimes(1);
});

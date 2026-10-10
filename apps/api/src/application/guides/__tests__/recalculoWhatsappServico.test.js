jest.mock('../../fiscal/serpro/serproCallContext.js', () => ({ comContextoSerpro: jest.fn(async (_, fn) => fn()) }));
jest.mock('../../fiscal/serpro/CaptureSerproGuidesService.js', () => ({ capturePgdasGuideForCompany: jest.fn(async () => ({ guide: { guideId: 'nova' } })) }));
jest.mock('../../fiscal/lp/LucroPresumidoProvisaoService.js', () => ({ reemitirDarfLp: jest.fn(async () => ({})) }));
jest.mock('../RegistroRecalculoGuia.js', () => ({ registrarRecalculoGuia: jest.fn(async () => {}) }));
jest.mock('../GuidePaymentStatusService.js', () => ({ markGuideOpenBySerpro: jest.fn(async () => {}) }));
import { recalcularGuiaNoServico } from '../RecalcularGuiaWhatsappService.js';
import { comContextoSerpro } from '../../fiscal/serpro/serproCallContext.js';
import { capturePgdasGuideForCompany } from '../../fiscal/serpro/CaptureSerproGuidesService.js';
import { reemitirDarfLp } from '../../fiscal/lp/LucroPresumidoProvisaoService.js';
import { registrarRecalculoGuia } from '../RegistroRecalculoGuia.js';

beforeEach(() => jest.clearAllMocks());
test.each(['SIMPLES', 'OUTRA'])('recálculo %s usa serviço correto, conserva escopo e registra a nova guia', async tipo => {
  const guia = { id: 'antiga', portalClientId: 'empresa', competencia: '2026-09', source: 'SERPRO', tipo, ...(tipo === 'OUTRA' ? { sourceFileId: 'serpro:dctfweb:lp:empresa:2026-09' } : {}) };
  const client = { guide: { findFirst: jest.fn(async a => ({ id: a.where.id })) } };
  const r = await recalcularGuiaNoServico(guia, { userId: 'usuario' }, client);
  expect(comContextoSerpro).toHaveBeenCalledWith({ origem: 'whatsapp:recalcular', userId: 'usuario', forcar: false }, expect.any(Function));
  if (tipo === 'SIMPLES') {
    expect(capturePgdasGuideForCompany).toHaveBeenCalledWith({ portalClientId: 'empresa', competencia: '2026-09', existingGuideId: 'antiga', serviceId: 'GERARDASCOBRANCA17' });
    expect(reemitirDarfLp).not.toHaveBeenCalled(); expect(r.id).toBe('nova');
  } else {
    expect(reemitirDarfLp).toHaveBeenCalledWith({ portalClientId: 'empresa', competencia: '2026-09', guideId: 'antiga' });
    expect(capturePgdasGuideForCompany).not.toHaveBeenCalled(); expect(r.id).toBe('antiga');
  }
  expect(registrarRecalculoGuia).toHaveBeenCalledWith(client, expect.objectContaining({ guiaAnterior: guia, guiaId: r.id }));
  expect(client.guide.findFirst).toHaveBeenCalledWith({ where: { id: r.id, portalClientId: 'empresa', competencia: '2026-09' } });
});

import request from 'supertest';
import express from 'express';
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {
  guide: { findUnique: jest.fn(), findFirst: jest.fn() },
  companyFirmAccess: { findUnique: jest.fn(async () => null) },
} }));
jest.mock('../../../application/fiscal/serpro/CaptureSerproGuidesService.js', () => ({ capturePgdasGuideForCompany: jest.fn() }));
jest.mock('../../../application/fiscal/lp/LucroPresumidoProvisaoService.js', () => ({ reemitirDarfLp: jest.fn() }));
jest.mock('../../../application/fiscal/serpro/SerproDctfwebService.js', () => ({ syncSerproInssForCompany: jest.fn() }));
jest.mock('../../../application/guides/RegistroRecalculoGuia.js', () => ({ registrarRecalculoGuia: jest.fn(async () => ({})), sinalizarRecalculosNosLancamentos: jest.fn(async (_, __, entries) => entries) }));
jest.mock('../../../workers/guideEmailWorker.js', () => ({ runGuideEmailWorkerSelected: jest.fn(async () => ({})) }));
jest.mock('../../../application/guides/GuidePaymentStatusService.js', () => ({
  ...jest.requireActual('../../../application/guides/GuidePaymentStatusService.js'),
  markGuideOpenBySerpro: jest.fn(async () => ({})),
}));
import { createFirmPortalRouter } from '../index.js';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { registrarRecalculoGuia } from '../../../application/guides/RegistroRecalculoGuia.js';
import { capturePgdasGuideForCompany } from '../../../application/fiscal/serpro/CaptureSerproGuidesService.js';
import { reemitirDarfLp } from '../../../application/fiscal/lp/LucroPresumidoProvisaoService.js';
import { syncSerproInssForCompany } from '../../../application/fiscal/serpro/SerproDctfwebService.js';
import { runGuideEmailWorkerSelected } from '../../../workers/guideEmailWorker.js';
const guide = { id: 'g1', portalClientId: 'p1', competencia: '2026-07', source: 'SERPRO', tipo: 'SIMPLES', status: 'PROCESSED', paymentStatus: 'OVERDUE', valor: 1000 };
function app() {
  const a = express();
  a.use(express.json());
  a.locals.ensureAuthorized = async (req) => { req.auth = { user: { id: 'u1', accountType: 'FIRM', role: 'admin' } }; return true; };
  a.use('/firm', createFirmPortalRouter({ ensureAuthorized: a.locals.ensureAuthorized, log: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() } }));
  return a;
}
beforeEach(() => {
  jest.clearAllMocks();
  prisma.guide.findUnique.mockResolvedValue(guide);
  prisma.guide.findFirst.mockResolvedValue({ ...guide, tipo: 'INSS' });
  capturePgdasGuideForCompany.mockResolvedValue({ guide: { guideId: 'g1' } });
  reemitirDarfLp.mockResolvedValue({ valor: 1100, composicao: null });
  syncSerproInssForCompany.mockResolvedValue({ guide: { guideId: 'g1' }, inss: { status: 'EMITTED' } });
});
it.each(['DAS', 'DARF'])('falha de geração %s não registra recálculo', async (tipo) => {
  if (tipo === 'DARF') {
    prisma.guide.findUnique.mockResolvedValue({ ...guide, tipo: 'OUTRA', sourceFileId: 'serpro:dctfweb:lp:123:2026-07' });
    reemitirDarfLp.mockRejectedValueOnce(new Error('falha ao gerar/salvar'));
  } else capturePgdasGuideForCompany.mockRejectedValueOnce(new Error('falha ao gerar/salvar'));
  const r = await request(app()).post('/firm/guides/g1/recalculate').send({});
  expect(r.status).toBe(502);
  expect(registrarRecalculoGuia).not.toHaveBeenCalled();
  expect(runGuideEmailWorkerSelected).not.toHaveBeenCalled();
});
it('sucesso fiscal registra antes do email e falha posterior no envio não desfaz a evidência', async () => {
  runGuideEmailWorkerSelected.mockRejectedValueOnce(new Error('email indisponível'));
  await request(app()).post('/firm/guides/g1/recalculate').send({});
  expect(registrarRecalculoGuia).toHaveBeenCalledWith(prisma, expect.objectContaining({ guiaAnterior: guide, guiaId: 'g1', especie: 'DAS_SIMPLES' }));
  expect(registrarRecalculoGuia.mock.invocationCallOrder[0]).toBeLessThan(runGuideEmailWorkerSelected.mock.invocationCallOrder[0]);
});
it.each(['EMITTED', 'NOT_TRANSMITTED', 'NOT_INSS', 'REUSED'])('INSS %s só registra emissão efetiva após atualização solicitada', async (status) => {
  syncSerproInssForCompany.mockResolvedValueOnce({ guide: status === 'EMITTED' || status === 'REUSED' ? { guideId: 'g1' } : undefined, inss: { status } });
  const r = await request(app()).post('/firm/companies/p1/serpro/inss/sync').send({ competencia: '2026-07', atualizar: true });
  expect(r.status).toBe(200);
  expect(registrarRecalculoGuia).toHaveBeenCalledTimes(status === 'EMITTED' ? 1 : 0);
});
it('captura normal de INSS não afirma recálculo', async () => {
  await request(app()).post('/firm/companies/p1/serpro/inss/sync').send({ competencia: '2026-07' });
  expect(registrarRecalculoGuia).not.toHaveBeenCalled();
});
it('falha INSS não registra e guia paga não consulta serviço', async () => {
  syncSerproInssForCompany.mockRejectedValueOnce(new Error('falha fiscal'));
  const r = await request(app()).post('/firm/companies/p1/serpro/inss/sync').send({ competencia: '2026-07', atualizar: true });
  expect(r.status).toBe(502);
  expect(registrarRecalculoGuia).not.toHaveBeenCalled();
  syncSerproInssForCompany.mockClear();
  prisma.guide.findFirst.mockResolvedValueOnce({ ...guide, paymentStatus: 'PAID' });
  const paga = await request(app()).post('/firm/companies/p1/serpro/inss/sync').send({ competencia: '2026-07', atualizar: true });
  expect(paga.status).toBe(409);
  expect(syncSerproInssForCompany).not.toHaveBeenCalled();
});

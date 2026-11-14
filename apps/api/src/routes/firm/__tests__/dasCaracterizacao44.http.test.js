import request from 'supertest';
import express from 'express';
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {
  guide: { findUnique: jest.fn() }, companyFirmAccess: { findUnique: jest.fn(), findMany: jest.fn() },
} }));
jest.mock('../../../application/fiscal/serpro/CaptureSerproGuidesService.js', () => ({ capturePgdasGuideForCompany: jest.fn() }));
jest.mock('../../../application/guides/RegistroRecalculoGuia.js', () => ({ registrarRecalculoGuia: jest.fn(), sinalizarRecalculosNosLancamentos: jest.fn(async (_, __, entries) => entries) }));
jest.mock('../../../workers/guideEmailWorker.js', () => ({ runGuideEmailWorkerSelected: jest.fn() }));
jest.mock('../../../application/guides/GuidePaymentStatusService.js', () => ({
  ...jest.requireActual('../../../application/guides/GuidePaymentStatusService.js'), markGuideOpenBySerpro: jest.fn(),
}));
import { createFirmPortalRouter } from '../index.js';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { capturePgdasGuideForCompany } from '../../../application/fiscal/serpro/CaptureSerproGuidesService.js';
import { registrarRecalculoGuia } from '../../../application/guides/RegistroRecalculoGuia.js';
import { markGuideOpenBySerpro } from '../../../application/guides/GuidePaymentStatusService.js';
import { runGuideEmailWorkerSelected } from '../../../workers/guideEmailWorker.js';
import { contextoSerproAtual } from '../../../application/fiscal/serpro/serproCallContext.js';

const guide = { id: 'g1', portalClientId: 'a', competencia: '2026-10', source: 'SERPRO', tipo: 'SIMPLES', status: 'PROCESSED', paymentStatus: 'OVERDUE', valor: 100 };
const capturePath = '/firm/companies/a/serpro/pgdasd/capture';
const recalcPath = '/firm/guides/g1/recalculate';
let capturedContext;
function app(role = 'contador') {
  const instance = express(); instance.use(express.json());
  instance.locals.ensureAuthorized = async (req, res) => {
    if (!role) { res.status(401).json({ error: 'unauthorized' }); return false; }
    req.auth = { user: { id: 'u1', accountType: 'FIRM', role } }; return true;
  };
  instance.use('/firm', createFirmPortalRouter({ ensureAuthorized: instance.locals.ensureAuthorized, log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
  return instance;
}
beforeEach(() => {
  jest.clearAllMocks(); capturedContext = null;
  prisma.guide.findUnique.mockResolvedValue({ ...guide });
  prisma.companyFirmAccess.findUnique.mockResolvedValue({ role: 'ACCOUNTANT', status: 'ACTIVE', scopes: [] });
  prisma.companyFirmAccess.findMany.mockResolvedValue([{ companyId: 'a' }]);
  capturePgdasGuideForCompany.mockImplementation(async () => { capturedContext = contextoSerproAtual(); return { guide: { guideId: 'g1' }, accounting: { ok: true } }; });
  registrarRecalculoGuia.mockResolvedValue({}); markGuideOpenBySerpro.mockResolvedValue({}); runGuideEmailWorkerSelected.mockResolvedValue({ sent: 1 });
});
function noDownstream() {
  expect(capturePgdasGuideForCompany).not.toHaveBeenCalled(); expect(registrarRecalculoGuia).not.toHaveBeenCalled(); expect(markGuideOpenBySerpro).not.toHaveBeenCalled(); expect(runGuideEmailWorkerSelected).not.toHaveBeenCalled();
}
test('capture uses actual company guard and route identity; does not send or record recalculation', async () => {
  const result = await request(app()).post(capturePath).send({ competencia: '2026-10', companyId: 'other', portalClientId: 'other', serviceId: 'GERARDAS12' });
  expect(result.status).toBe(200);
  expect(result.body).toEqual({ ok: true, result: { guide: { guideId: 'g1' }, accounting: { ok: true } }, emailDispatch: null });
  expect(prisma.companyFirmAccess.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId_userId: { companyId: 'a', userId: 'u1' } } }));
  expect(capturePgdasGuideForCompany).toHaveBeenCalledWith({ portalClientId: 'a', competencia: '2026-10', contratanteCnpj: undefined, serviceId: 'GERARDAS12' });
  expect(capturedContext).toMatchObject({ origem: 'firm_captura_das', userId: 'u1' });
  expect(registrarRecalculoGuia).not.toHaveBeenCalled(); expect(runGuideEmailWorkerSelected).not.toHaveBeenCalled();
});
test.each([null, { status: 'INACTIVE', role: 'ACCOUNTANT' }, { status: 'REVOKED', role: 'ACCOUNTANT' }])('capture denies absent/inactive/revoked company link: %j', async link => {
  prisma.companyFirmAccess.findUnique.mockResolvedValue(link);
  const result = await request(app()).post(capturePath).send({ competencia: '2026-10' });
  expect(result.status).toBe(403); expect(result.body).toEqual({ error: 'forbidden' }); noDownstream();
});
test('capture denies insufficient company role and unauthenticated request', async () => {
  prisma.companyFirmAccess.findUnique.mockResolvedValue({ status: 'ACTIVE', role: 'STAFF', scopes: [] });
  expect((await request(app()).post(capturePath).send({ competencia: '2026-10' })).body).toEqual({ error: 'insufficient_role' });
  expect((await request(app(null)).post(capturePath).send({ competencia: '2026-10' })).status).toBe(401); noDownstream();
});
test('capture admin bypass is preserved, while invalid competence has no downstream effect', async () => {
  prisma.companyFirmAccess.findUnique.mockResolvedValue(null);
  expect((await request(app('admin')).post(capturePath).send({ competencia: '2026-10' })).status).toBe(200);
  capturePgdasGuideForCompany.mockClear();
  const invalid = await request(app('admin')).post(capturePath).send({ competencia: 'not-month' });
  expect(invalid.status).toBe(400); expect(invalid.body).toEqual({ ok: false, error: 'competencia_required' }); noDownstream();
});
test.each([
  ['SERPRO_PGDASD_NO_DEBTS_FOUND', 400], ['PORTAL_COMPANY_NOT_FOUND', 404],
  ['SERPRO_PGDASD_PDF_NOT_FOUND', 502], ['ETIMEDOUT', 502],
])('capture preserves public error %s → %i', async (code, status) => {
  capturePgdasGuideForCompany.mockRejectedValue(Object.assign(Error('synthetic refusal'), { code, retryable: false }));
  const result = await request(app()).post(capturePath).send({ competencia: '2026-10' });
  expect(result.status).toBe(status); expect(result.body).toMatchObject({ ok: false, error: code, reason: 'synthetic refusal' });
  expect(runGuideEmailWorkerSelected).not.toHaveBeenCalled();
});
test.each([['OVERDUE', 'GERARDASCOBRANCA17', true], ['OPEN', 'GERARDAS12', false]])('recalculation %s requests a new document, then records/opens/sends', async (paymentStatus, serviceId, vencida) => {
  prisma.guide.findUnique.mockResolvedValue({ ...guide, paymentStatus, vencimento: '2099-11-20' });
  const result = await request(app('admin')).post(recalcPath).send({ portalClientId: 'other' });
  expect(result.status).toBe(200);
  expect(result.body).toEqual({ ok: true, especie: 'DAS_SIMPLES', vencida, result: { guide: { guideId: 'g1' }, accounting: { ok: true } }, emailDispatch: { sent: 1 } });
  expect(capturePgdasGuideForCompany).toHaveBeenCalledWith({ portalClientId: 'a', competencia: '2026-10', existingGuideId: 'g1', serviceId });
  expect(capturedContext).toMatchObject({ origem: 'guias:recalcular', userId: 'u1' });
  expect(registrarRecalculoGuia.mock.invocationCallOrder[0]).toBeLessThan(markGuideOpenBySerpro.mock.invocationCallOrder[0]);
  expect(markGuideOpenBySerpro.mock.invocationCallOrder[0]).toBeLessThan(runGuideEmailWorkerSelected.mock.invocationCallOrder[0]);
});
test.each([{ paymentStatus: 'PAID' }, { parcelamentoId: 'installment-contract' }])('recalculation refuses paid/linked installment before fiscal call: %j', async extra => {
  prisma.guide.findUnique.mockResolvedValue({ ...guide, ...extra });
  const result = await request(app('admin')).post(recalcPath).send({});
  expect(result.status).toBe(400); expect(result.body).toEqual({ error: 'guide_recalculation_not_available' }); noDownstream();
});
test('recalculation fails after fiscal success if recording fails; does not reopen/send', async () => {
  registrarRecalculoGuia.mockRejectedValue(Error('audit unavailable'));
  const result = await request(app('admin')).post(recalcPath).send({});
  expect(result.status).toBe(502); expect(result.body).toEqual({ ok: false, error: 'SERPRO_PGDASD_RECALCULATE_FAILED', reason: 'audit unavailable', retryable: false });
  expect(capturePgdasGuideForCompany).toHaveBeenCalledTimes(1); expect(markGuideOpenBySerpro).not.toHaveBeenCalled(); expect(runGuideEmailWorkerSelected).not.toHaveBeenCalled();
});
test('failure of simulated send leaves previous fiscal/record/open calls completed and returns502', async () => {
  runGuideEmailWorkerSelected.mockRejectedValue(Error('transport unavailable'));
  const result = await request(app('admin')).post(recalcPath).send({});
  expect(result.status).toBe(502); expect(registrarRecalculoGuia).toHaveBeenCalledTimes(1); expect(markGuideOpenBySerpro).toHaveBeenCalledTimes(1);
});
test('known PDF failure differs between capture502 and recalculation400', async () => {
  capturePgdasGuideForCompany.mockRejectedValue(Object.assign(Error('pdf missing'), { code: 'SERPRO_PGDASD_PDF_NOT_FOUND' }));
  const result = await request(app('admin')).post(recalcPath).send({});
  expect(result.status).toBe(400); expect(result.body).toMatchObject({ ok: false, error: 'SERPRO_PGDASD_PDF_NOT_FOUND', reason: expect.any(String), message: expect.any(String) });
  expect(registrarRecalculoGuia).not.toHaveBeenCalled(); expect(runGuideEmailWorkerSelected).not.toHaveBeenCalled();
});

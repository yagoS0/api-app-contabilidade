// Real route, canonical authorization, facade and operational read composition.
// Only persistence and existing downstream capabilities are doubles; no transport runs.
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {
  companyFirmAccess: { findUnique: jest.fn() },
  portalClient: { findUnique: jest.fn() }, company: { findUnique: jest.fn() },
  regimeHistorico: { findMany: jest.fn() }, feriado: { findMany: jest.fn() },
  guide: { findMany: jest.fn(), update: jest.fn() }, envioGuia: { findMany: jest.fn() },
  appSetting: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  $transaction: jest.fn(),
} }));
jest.mock('../../../application/fiscal/serpro/CompanyAutomationService.js', () => ({ lerAutomacaoEmpresa: jest.fn(), salvarAutomacaoEmpresa: jest.fn() }));
jest.mock('../../../application/guides/guideCompliance.js', () => ({ computeGuideComplianceMap: jest.fn() }));
jest.mock('../../../application/whatsapp/ContatoWhatsappService.js', () => ({ destinatariosDeEnvio: jest.fn() }));
jest.mock('../../../application/whatsapp/EnvioGuiaWhatsappService.js', () => ({ carregarCanal: jest.fn(), enviarGuiaPorWhatsapp: jest.fn() }));
jest.mock('../../../application/guides/GuideCompanyEmailService.js', () => ({ enviarGuiasExatasDoCiclo: jest.fn() }));

import express from 'express';
import request from 'supertest';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { requireFirmCompanyAccess } from '../../../middlewares/requireFirmCompanyAccess.js';
import { createCompanyAutomationRouter } from '../companyAutomation.js';
import { lerAutomacaoEmpresa } from '../../../application/fiscal/serpro/CompanyAutomationService.js';
import { computeGuideComplianceMap } from '../../../application/guides/guideCompliance.js';
import { destinatariosDeEnvio } from '../../../application/whatsapp/ContatoWhatsappService.js';
import { carregarCanal, enviarGuiaPorWhatsapp } from '../../../application/whatsapp/EnvioGuiaWhatsappService.js';
import { enviarGuiasExatasDoCiclo } from '../../../application/guides/GuideCompanyEmailService.js';

const path = '/companies/a/operacoes/2026-10/envio-guias';
function mount(user = { id: 'accountant', role: 'contador' }) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.auth = { user }; next(); });
  app.use(createCompanyAutomationRouter({ prisma, requireFirmCompanyAccess }));
  return app;
}
function expectNoEffects() {
  for (const fn of [prisma.$transaction, prisma.guide.update, prisma.appSetting.upsert,
    prisma.appSetting.update, prisma.appSetting.updateMany, enviarGuiasExatasDoCiclo, enviarGuiaPorWhatsapp]) {
    expect(fn).not.toHaveBeenCalled();
  }
}
function expectNoCycleReads() {
  for (const fn of [prisma.portalClient.findUnique, prisma.company.findUnique,
    prisma.regimeHistorico.findMany, prisma.feriado.findMany, prisma.guide.findMany,
    prisma.envioGuia.findMany, prisma.appSetting.findUnique, lerAutomacaoEmpresa,
    computeGuideComplianceMap, destinatariosDeEnvio, carregarCanal]) expect(fn).not.toHaveBeenCalled();
  expectNoEffects();
}
beforeEach(() => {
  jest.resetAllMocks();
  prisma.companyFirmAccess.findUnique.mockResolvedValue({ role: 'ACCOUNTANT', status: 'ACTIVE', scopes: [] });
  prisma.portalClient.findUnique.mockResolvedValue({ id: 'a', companyId: 'legacy-a', status: 'ATIVA', temFolha: false });
  prisma.company.findUnique.mockResolvedValue({ regimeTributario: 'SIMPLES' });
  prisma.regimeHistorico.findMany.mockResolvedValue([{ regime: 'SIMPLES', vigenciaInicio: '2020-01-01', vigenciaFim: null }]);
  prisma.feriado.findMany.mockResolvedValue([]);
  prisma.guide.findMany.mockResolvedValue([]);
  prisma.envioGuia.findMany.mockResolvedValue([]);
  prisma.appSetting.findUnique.mockResolvedValue(null);
  lerAutomacaoEmpresa.mockResolvedValue({ automationPolicy: { paused: false }, globalAutomationPolicy: { paused: false } });
  computeGuideComplianceMap.mockResolvedValue(new Map([['a', {
    das: { required: true, ok: false }, inss: { required: false, ok: true },
    parcDas: { required: false, ok: true }, guiasParcelamentoMes: [], expectativaParcelamentoInconclusiva: false,
  }]]));
  destinatariosDeEnvio.mockResolvedValue({ emails: ['synthetic@example.test'], telefones: [] });
  carregarCanal.mockResolvedValue({ disponivel: false });
});

test('authorized GET executes real operational read and preserves company-scoped DTO without effects', async () => {
  const response = await request(mount()).get(path);
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body).toMatchObject({ ok: true, portalClientId: 'a', competencia: '2026-10',
    mesOperacional: '2026-11', status: 'DISABLED', enabled: false, paused: false, revision: 0, items: [],
    expectation: { state: 'REVIEW', requiredCount: 1, availableCount: 0,
      missing: [{ obligationKey: 'das', label: 'DAS', reason: 'Documento válido ainda não confirmado.' }] } });
  expect(prisma.companyFirmAccess.findUnique).toHaveBeenCalledWith({
    where: { companyId_userId: { companyId: 'a', userId: 'accountant' } },
    select: { role: true, status: true, scopes: true },
  });
  expect(prisma.portalClient.findUnique).toHaveBeenCalledWith({ where: { id: 'a' } });
  expect(prisma.guide.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { portalClientId: 'a', competencia: '2026-10' }, orderBy: { id: 'asc' },
  }));
  expect(prisma.companyFirmAccess.findUnique.mock.invocationCallOrder[0])
    .toBeLessThan(prisma.portalClient.findUnique.mock.invocationCallOrder[0]);
  expectNoEffects();
});

test.each([null, { role: 'ACCOUNTANT', status: 'INACTIVE' }, { role: 'ACCOUNTANT', status: 'REMOVED' }])(
  'canonical guard denies unavailable membership %j before any cycle read', async link => {
    prisma.companyFirmAccess.findUnique.mockResolvedValue(link);
    const response = await request(mount()).get(path);
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'forbidden' });
    expectNoCycleReads();
  });

test('another company cannot borrow membership through query parameters', async () => {
  prisma.companyFirmAccess.findUnique.mockImplementation(async ({ where }) =>
    where.companyId_userId.companyId === 'a' ? { role: 'ACCOUNTANT', status: 'ACTIVE' } : null);
  const response = await request(mount()).get('/companies/b/operacoes/2026-10/envio-guias?companyId=a&portalClientId=a');
  expect(response.status).toBe(403);
  expectNoCycleReads();
});

test('unauthenticated request does not read membership or cycle', async () => {
  const response = await request(mount(null)).get(path);
  expect(response.status).toBe(401);
  expect(response.body).toEqual({ error: 'unauthorized' });
  expect(prisma.companyFirmAccess.findUnique).not.toHaveBeenCalled();
  expectNoCycleReads();
});

test('authorized invalid competence preserves application error before company read', async () => {
  const response = await request(mount()).get('/companies/a/operacoes/2026-13/envio-guias');
  expect(response.status).toBe(422);
  expect(response.body).toMatchObject({ ok: false, error: 'ENVIO_GUIAS_PERIODO_INVALIDO' });
  expect(prisma.companyFirmAccess.findUnique).toHaveBeenCalledTimes(1);
  expectNoCycleReads();
});

test('authorized missing company preserves legacy unavailable response', async () => {
  prisma.portalClient.findUnique.mockResolvedValue(null);
  const response = await request(mount()).get(path);
  expect(response.status).toBe(409);
  expect(response.body).toMatchObject({ ok: false, error: 'ENVIO_GUIAS_EMPRESA_INDISPONIVEL' });
  expect(prisma.guide.findMany).not.toHaveBeenCalled();
  expectNoEffects();
});

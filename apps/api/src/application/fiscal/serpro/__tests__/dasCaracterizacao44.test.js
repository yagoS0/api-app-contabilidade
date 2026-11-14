// Characterization only: these assertions describe the legacy boundary, not new recovery rules.
jest.mock('../../../../infrastructure/db/prisma.js', () => ({ prisma: {
  portalClient: { findUnique: jest.fn() }, guide: { findFirst: jest.fn(), deleteMany: jest.fn() },
  companyMonthlyCircular: { findFirst: jest.fn(), findUnique: jest.fn(), upsert: jest.fn() },
} }));
jest.mock('../SerproRuntimeSettings.js', () => ({ getResolvedSerproCredentials: jest.fn() }));
jest.mock('../SerproHttpClient.js', () => ({ SerproHttpClient: jest.fn() }));
jest.mock('../../../guides/GuideService.js', () => ({
  ...jest.requireActual('../../../guides/GuideService.js'), createOrUpdateGuideFromProcessing: jest.fn(),
}));
jest.mock('../../../accounting/AccountingEntryGeneratorService.js', () => ({ generateEntriesFromCircular: jest.fn(), FONTE_VALOR_GUIA: 'GUIA' }));
jest.mock('../../circularAcrescimos.js', () => ({ gravarAcrescimoCircular: jest.fn() }));
jest.mock('pdf-parse', () => jest.fn(async () => ({ text: '' })));

import { createHash } from 'node:crypto';
import { prisma } from '../../../../infrastructure/db/prisma.js';
import { SerproHttpClient } from '../SerproHttpClient.js';
import { getResolvedSerproCredentials } from '../SerproRuntimeSettings.js';
import { capturePgdasGuideForCompany } from '../CaptureSerproGuidesService.js';
import { createOrUpdateGuideFromProcessing } from '../../../guides/GuideService.js';
import { generateEntriesFromCircular } from '../../../accounting/AccountingEntryGeneratorService.js';

const company = { id: 'company-a', companyId: 'legacy-a', cnpj: '12345678000199', razao: 'Synthetic company' };
const bytes = Buffer.from('%PDF-1.4\n' + 'synthetic fixture '.repeat(20));
const input = { portalClientId: company.id, competencia: '2026-10', serviceId: 'GERARDAS12' };
let post, trace;
function response() { return { dados: JSON.stringify({ pdf: bytes.toString('base64'), numeroDocumento: 'DAS-44', valorTotal: 125.50, dataVencimento: '20261120' }) }; }
beforeEach(() => {
  jest.clearAllMocks(); trace = [];
  prisma.portalClient.findUnique.mockResolvedValue(company);
  prisma.guide.findFirst.mockResolvedValue(null);
  prisma.guide.deleteMany.mockImplementation(async () => { trace.push('cleanup'); return { count: 0 }; });
  prisma.companyMonthlyCircular.findFirst.mockResolvedValue({ id: 'circular' });
  prisma.companyMonthlyCircular.findUnique.mockResolvedValue({ id: 'circular', lockedAt: '2026-11-01' });
  prisma.companyMonthlyCircular.upsert.mockImplementation(async () => { trace.push('circular'); return { id: 'circular' }; });
  getResolvedSerproCredentials.mockResolvedValue({ certificate: { document: '98765432000198' } });
  post = jest.fn(async () => { trace.push('provider'); return response(); });
  SerproHttpClient.mockImplementation(() => ({ post }));
  createOrUpdateGuideFromProcessing.mockImplementation(async data => {
    trace.push('document');
    return { ...data.parsed, ...data, id: data.existingGuideId || 'guide-new', valor: data.parsed.valor, competencia: data.parsed.competencia, tipo: 'SIMPLES' };
  });
  generateEntriesFromCircular.mockImplementation(async () => { trace.push('accounting'); return { ok: true, generatedEntries: [] }; });
});

test.each(['GERARDAS12', 'GERARDASCOBRANCA17'])('actual service builds /Emitir envelope for %s and preserves PDF/hash/ownership', async serviceId => {
  const result = await capturePgdasGuideForCompany({ ...input, serviceId, dataConsolidacao: '20261114' });
  expect(post).toHaveBeenCalledWith('/Emitir', {
    contratante: { numero: '98765432000198', tipo: 2 }, autorPedidoDados: { numero: '98765432000198', tipo: 2 },
    contribuinte: { numero: company.cnpj, tipo: 2 }, pedidoDados: { idSistema: 'PGDASD', idServico: serviceId, versaoSistema: '1.0', dados: JSON.stringify({ periodoApuracao: '202610', dataConsolidacao: '20261114' }) },
  });
  expect(createOrUpdateGuideFromProcessing).toHaveBeenCalledWith(expect.objectContaining({
    portalClientId: company.id, legacyCompanyId: 'legacy-a', pdfBytes: bytes,
    hash: createHash('sha256').update(bytes).digest('hex'), status: 'PROCESSED', source: 'SERPRO', paymentStatus: 'OPEN',
    sourceFileId: `serpro:pgdasd:${serviceId}:${company.cnpj}:2026-10:DAS-44`,
    parsed: expect.objectContaining({ competencia: '2026-10', tipo: 'SIMPLES', valor: 125.5, vencimento: '2026-11-20T00:00:00.000Z' }),
  }));
  expect(result).toMatchObject({ company: { id: company.id }, guide: { guideId: 'guide-new', companyId: company.id }, accounting: { ok: true }, integration: { servico: serviceId } });
  expect(trace).toEqual(['provider', 'document', 'circular', 'accounting', 'cleanup']);
  expect(prisma.guide.deleteMany).toHaveBeenCalledWith({ where: { portalClientId: company.id, competencia: '2026-10', tipo: 'SIMPLES', source: 'SERPRO', status: 'PROCESSED', parcelamentoId: null, NOT: { id: 'guide-new' } } });
});

test('stored PDF is reused, scoped to company/month and excluding installments, without provider or writes', async () => {
  prisma.guide.findFirst.mockResolvedValue({ id: 'stored', portalClientId: company.id, competencia: '2026-10', tipo: 'SIMPLES', pdfBytes: bytes, paymentStatus: 'PAID', hash: 'previous' });
  expect(await capturePgdasGuideForCompany(input)).toMatchObject({ reutilizado: true, integration: { chamadaSerpro: false }, guide: { guideId: 'stored', paymentStatus: 'PAID' } });
  expect(prisma.guide.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ portalClientId: company.id, competencia: '2026-10', parcelamentoId: null }), orderBy: { updatedAt: 'desc' } }));
  expect(SerproHttpClient).not.toHaveBeenCalled(); expect(createOrUpdateGuideFromProcessing).not.toHaveBeenCalled();
});
test('storageKey alone does not establish reusable local PDF', async () => {
  prisma.guide.findFirst.mockResolvedValueOnce({ id: 'stored', storageKey: 'private/key', pdfBytes: null }).mockResolvedValueOnce(null);
  expect(await capturePgdasGuideForCompany(input)).not.toHaveProperty('reutilizado'); expect(post).toHaveBeenCalledTimes(1);
});
test.each([{ atualizar: true }, { existingGuideId: 'stored' }, { dataConsolidacao: '20261114' }])('explicit request bypasses reuse: %j', async extra => {
  await capturePgdasGuideForCompany({ ...input, ...extra });
  expect(post).toHaveBeenCalledTimes(1);
  expect(prisma.guide.findFirst).toHaveBeenCalledTimes(1);
  expect(prisma.guide.findFirst.mock.calls[0][0].where).toHaveProperty('sourceFileId');
});
test('same source identity preserves paid metadata while replacing documentary bytes', async () => {
  prisma.guide.findFirst.mockResolvedValue({ id: 'stored', paymentStatus: 'PAID', paymentStatusSource: 'MANUAL', paymentConfirmedAt: new Date('2026-11-01') });
  await capturePgdasGuideForCompany({ ...input, atualizar: true });
  expect(createOrUpdateGuideFromProcessing).toHaveBeenCalledWith(expect.objectContaining({ existingGuideId: 'stored', paymentStatus: 'PAID', paymentStatusSource: 'MANUAL', pdfBytes: bytes }));
});
test.each([
  [{ portalClientId: '' }, 'PORTAL_COMPANY_ID_REQUIRED'],
  [{ competencia: 'invalid' }, 'SERPRO_INVALID_COMPETENCIA'],
])('invalid request fails before provider: %j', async (extra, code) => {
  await expect(capturePgdasGuideForCompany({ ...input, ...extra })).rejects.toMatchObject({ code });
  expect(prisma.portalClient.findUnique).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
});
test('company missing and credentials unavailable fail before external effect', async () => {
  prisma.portalClient.findUnique.mockResolvedValueOnce(null);
  await expect(capturePgdasGuideForCompany(input)).rejects.toMatchObject({ code: 'PORTAL_COMPANY_NOT_FOUND' });
  getResolvedSerproCredentials.mockRejectedValueOnce(Error('credential unavailable'));
  await expect(capturePgdasGuideForCompany(input)).rejects.toThrow('credential unavailable');
  expect(post).not.toHaveBeenCalled(); expect(createOrUpdateGuideFromProcessing).not.toHaveBeenCalled();
});
test.each(['ETIMEDOUT', 'SERPRO_PROCURACAO_INATIVA'])('provider rejects %s without local document persistence or service-level retry', async code => {
  const failure = Object.assign(Error('synthetic external failure'), { code }); post.mockRejectedValue(failure);
  await expect(capturePgdasGuideForCompany(input)).rejects.toBe(failure);
  expect(post).toHaveBeenCalledTimes(1); expect(createOrUpdateGuideFromProcessing).not.toHaveBeenCalled(); expect(prisma.companyMonthlyCircular.upsert).not.toHaveBeenCalled();
});
test('provider success followed by document write failure propagates, without circular/accounting/cleanup', async () => {
  createOrUpdateGuideFromProcessing.mockRejectedValue(Error('document unavailable'));
  await expect(capturePgdasGuideForCompany(input)).rejects.toThrow('document unavailable');
  expect(post).toHaveBeenCalledTimes(1); expect(prisma.companyMonthlyCircular.upsert).not.toHaveBeenCalled(); expect(generateEntriesFromCircular).not.toHaveBeenCalled(); expect(prisma.guide.deleteMany).not.toHaveBeenCalled();
});
test('circular failure follows document write; there is no compensating document write here', async () => {
  prisma.companyMonthlyCircular.upsert.mockRejectedValue(Error('circular unavailable'));
  await expect(capturePgdasGuideForCompany(input)).rejects.toThrow('circular unavailable');
  expect(createOrUpdateGuideFromProcessing).toHaveBeenCalledTimes(1); expect(generateEntriesFromCircular).not.toHaveBeenCalled(); expect(prisma.guide.deleteMany).not.toHaveBeenCalled();
});
test('provision failure returns partial accounting outcome and still completes duplicate cleanup', async () => {
  generateEntriesFromCircular.mockRejectedValue(Object.assign(Error('closed period'), { code: 'MES_FECHADO' }));
  expect(await capturePgdasGuideForCompany(input)).toMatchObject({ guide: { guideId: 'guide-new' }, accounting: { ok: false, error: 'MES_FECHADO', reason: 'closed period' } });
  expect(prisma.guide.deleteMany).toHaveBeenCalledTimes(1);
});
test('document-only path does not update circular/provision or delete prior guides', async () => {
  expect(await capturePgdasGuideForCompany({ ...input, somenteDocumentos: true })).toMatchObject({ circular: { lockedAt: '2026-11-01' }, accounting: { skipped: true, somenteDocumentos: true } });
  expect(createOrUpdateGuideFromProcessing).toHaveBeenCalledTimes(1); expect(generateEntriesFromCircular).not.toHaveBeenCalled(); expect(prisma.companyMonthlyCircular.upsert).not.toHaveBeenCalled(); expect(prisma.guide.deleteMany).not.toHaveBeenCalled();
});
test.each([
  [{ mensagens: [{ texto: 'nao foram encontrados debitos' }] }, 'SERPRO_PGDASD_NO_DEBTS_FOUND'],
  [{ mensagens: [{ texto: 'nao ha declaracao transmitida para o periodo informado' }] }, 'SERPRO_PGDASD_DECLARATION_NOT_TRANSMITTED'],
  [{}, 'SERPRO_PGDASD_PDF_NOT_FOUND'],
])('response without PDF retains refusal identity %s', async (payload, code) => {
  post.mockResolvedValue(payload); await expect(capturePgdasGuideForCompany(input)).rejects.toMatchObject({ code });
  expect(createOrUpdateGuideFromProcessing).not.toHaveBeenCalled();
});

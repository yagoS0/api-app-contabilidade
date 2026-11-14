// Characterization, not recovery authorization. HTTP client/cache/capture are real; persistence,
// reservation, credentials, PDF parsing and accounting are explicit doubles in this suite.
// Documentary CAS/paid duplicates/closed periods remain covered by 44/442/443 PostgreSQL suites.
jest.mock('axios', () => ({ request: jest.fn(), isAxiosError: error => error?.isAxiosError === true }));
jest.mock('../SerproAuthService.js', () => ({ SerproAuthService: jest.fn(() => ({
  authenticate: jest.fn(async () => ({ accessToken: 'synthetic', jwtToken: 'synthetic' })),
  buildHttpsAgent: jest.fn(async () => null),
})) }));
jest.mock('../SerproRuntimeSettings.js', () => ({ getResolvedSerproCredentials: jest.fn(async () => ({
  baseUrl: 'https://invalid.test', timeoutMs: 10, certificate: { document: '98765432000198' },
})) }));
jest.mock('../SerproCallGuard.js', () => ({ autorizarChamada: jest.fn(), autorizarDespacho: jest.fn(), concluirChamada: jest.fn() }));
jest.mock('../../../../infrastructure/db/prisma.js', () => ({ prisma: {
  portalClient: { findUnique: jest.fn() }, guide: { findFirst: jest.fn(), deleteMany: jest.fn() },
  companyMonthlyCircular: { findFirst: jest.fn(), findUnique: jest.fn(), upsert: jest.fn() },
  serproChamada: { findFirst: jest.fn() },
  serproRespostaCache: { findUnique: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
  fiscalExecutionLog: { create: jest.fn(), update: jest.fn() },
} }));
jest.mock('../../../guides/GuideService.js', () => ({
  ...jest.requireActual('../../../guides/GuideService.js'), createOrUpdateGuideFromProcessing: jest.fn(),
}));
jest.mock('../../../accounting/AccountingEntryGeneratorService.js', () => ({ generateEntriesFromCircular: jest.fn(), FONTE_VALOR_GUIA: 'GUIA' }));
jest.mock('../../circularAcrescimos.js', () => ({ gravarAcrescimoCircular: jest.fn() }));
jest.mock('../SerproDctfwebService.js', () => ({ syncSerproInssForCompany: jest.fn() }));
jest.mock('pdf-parse', () => jest.fn(async () => ({ text: '' })));

import axios from 'axios';
import { prisma } from '../../../../infrastructure/db/prisma.js';
import { SerproHttpClient } from '../SerproHttpClient.js';
import { autorizarChamada, autorizarDespacho, concluirChamada } from '../SerproCallGuard.js';
import { chaveResposta } from '../SerproRespostaCache.js';
import { capturePgdasGuideForCompany } from '../CaptureSerproGuidesService.js';
import { createOrUpdateGuideFromProcessing } from '../../../guides/GuideService.js';
import { generateEntriesFromCircular } from '../../../accounting/AccountingEntryGeneratorService.js';
import { FiscalManualRunService } from '../../FiscalManualRunService.js';

const company = { id: 'synthetic-444', companyId: 'legacy-444', cnpj: '12345678000199', razao: 'Synthetic 444' };
const bytes = Buffer.from('%PDF-1.4\n' + 'synthetic fixture '.repeat(20));
const body = { pdf: bytes.toString('base64'), numeroDocumento: 'DAS-444', valorTotal: 125.5, vencimento: '20261120' };
const payload = serviceId => ({ contribuinte: { numero: company.cnpj }, pedidoDados: {
  idSistema: 'PGDASD', idServico: serviceId, dados: JSON.stringify({ periodoApuracao: '202610' }),
} });
let cache;
beforeEach(() => {
  jest.resetAllMocks(); cache = new Map();
  // resetAllMocks also resets the auth/credentials factories; restore explicitly below.
  prisma.serproRespostaCache.findUnique.mockImplementation(async ({ where }) => cache.get(where.chave) || null);
  prisma.serproRespostaCache.upsert.mockImplementation(async ({ where, create }) => { cache.set(where.chave, create); return create; });
  prisma.serproRespostaCache.deleteMany.mockImplementation(async ({ where }) => {
    if (where.chave) cache.delete(where.chave);
    return { count: 0 };
  });
  autorizarChamada.mockResolvedValue({ id: 'reservation-444', inicio: Date.now() });
  autorizarDespacho.mockResolvedValue(); concluirChamada.mockResolvedValue();
  axios.request.mockResolvedValue({ status: 200, data: body, headers: {} });
  prisma.portalClient.findUnique.mockResolvedValue(company);
  prisma.guide.findFirst.mockResolvedValue(null); prisma.guide.deleteMany.mockResolvedValue({ count: 0 });
  prisma.companyMonthlyCircular.upsert.mockResolvedValue({ id: 'circular-444' });
  createOrUpdateGuideFromProcessing.mockImplementation(async data => ({ ...data.parsed, ...data, id: 'guide-444', valor: data.parsed.valor, competencia: data.parsed.competencia, tipo: 'SIMPLES' }));
  generateEntriesFromCircular.mockResolvedValue({ ok: true, generatedEntries: [] });
  prisma.fiscalExecutionLog.create.mockResolvedValue({ id: 'execution-444' });
  prisma.fiscalExecutionLog.update.mockResolvedValue({});
  getResolvedSerproCredentials.mockResolvedValue({ baseUrl: 'https://invalid.test', timeoutMs: 10, certificate: { document: '98765432000198' } });
  SerproAuthService.mockImplementation(() => ({ authenticate: async () => ({ accessToken: 'synthetic', jwtToken: 'synthetic' }), buildHttpsAgent: async () => null }));
  pdfParse.mockResolvedValue({ text: '' });
});
import { SerproAuthService } from '../SerproAuthService.js';
import { getResolvedSerproCredentials } from '../SerproRuntimeSettings.js';
import pdfParse from 'pdf-parse';

describe.each(['GERARDAS12', 'GERARDASCOBRANCA17'])('DAS 4.4.4 %s', serviceId => {
  const capture = () => capturePgdasGuideForCompany({ portalClientId: company.id, competencia: '2026-10', serviceId });

  test('HTTP 200 followed by cache failure leaves no document and never finalizes or retries', async () => {
    prisma.serproRespostaCache.upsert.mockRejectedValueOnce(Error('synthetic cache failure'));
    await expect(capture()).rejects.toMatchObject({ code: 'SERPRO_REGISTRO_INDETERMINADO' });
    expect(axios.request).toHaveBeenCalledTimes(1); expect(concluirChamada).not.toHaveBeenCalled();
    expect(createOrUpdateGuideFromProcessing).not.toHaveBeenCalled(); expect(cache.size).toBe(0);
  });

  test('ledger finalization failure retains cache; another capture processes locally without reconciling ledger', async () => {
    const error = Object.assign(Error('synthetic ledger failure'), { code: 'SERPRO_REGISTRO_INDETERMINADO' });
    concluirChamada.mockRejectedValueOnce(error);
    await expect(capture()).rejects.toBe(error);
    expect(cache.size).toBe(1); expect(createOrUpdateGuideFromProcessing).not.toHaveBeenCalled();
    autorizarChamada.mockRejectedValue(Object.assign(Error('pending'), { code: 'SERPRO_CHAMADA_EM_ANDAMENTO' }));
    const result = await capture();
    expect(result).toMatchObject({ guide: { guideId: 'guide-444', companyId: company.id }, accounting: { ok: true } });
    expect(createOrUpdateGuideFromProcessing).toHaveBeenCalledTimes(1);
    expect(axios.request).toHaveBeenCalledTimes(1); expect(autorizarChamada).toHaveBeenCalledTimes(1);
    expect(concluirChamada).toHaveBeenCalledTimes(1); // cache read does not repair the failed finalization
  });

  test('cached response without local guide permits local processing after document failure', async () => {
    createOrUpdateGuideFromProcessing.mockRejectedValueOnce(Error('synthetic document failure'));
    await expect(capture()).rejects.toThrow('synthetic document failure');
    expect(cache.size).toBe(1); expect(prisma.companyMonthlyCircular.upsert).not.toHaveBeenCalled();
    expect(await capture()).toMatchObject({ guide: { guideId: 'guide-444' } });
    expect(createOrUpdateGuideFromProcessing).toHaveBeenCalledTimes(2);
    expect(axios.request).toHaveBeenCalledTimes(1); expect(concluirChamada).toHaveBeenCalledTimes(1);
  });

  test('timeout propagates mapped DTO and finalizes uncertainty once, without caching or retrying', async () => {
    axios.request.mockRejectedValueOnce(Object.assign(Error('synthetic timeout'), { isAxiosError: true, code: 'ECONNABORTED' }));
    await expect(capture()).rejects.toMatchObject({ code: 'SERPRO_TIMEOUT', status: null, retryable: true });
    expect(concluirChamada).toHaveBeenCalledWith(expect.objectContaining({ id: 'reservation-444' }), expect.objectContaining({ httpStatus: null, erroCodigo: 'SERPRO_TIMEOUT' }));
    expect(concluirChamada).toHaveBeenCalledTimes(1); expect(axios.request).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(0); expect(createOrUpdateGuideFromProcessing).not.toHaveBeenCalled();
  });

  test('raw cache DTO preserves response but does not inspect pending DAS reservations', async () => {
    const data = payload(serviceId);
    cache.set(chaveResposta(data, '/Emitir'), { resposta: body, expiraEm: new Date(Date.now() + 60000) });
    prisma.serproChamada.findFirst.mockResolvedValue({ id: 'uncertain', status: 'incerta' });
    expect(await new SerproHttpClient().post('/Emitir', data, { raw: true })).toEqual({ status: 200, data: body, headers: {} });
    expect(prisma.serproChamada.findFirst).not.toHaveBeenCalled(); expect(autorizarChamada).not.toHaveBeenCalled();
    expect(axios.request).not.toHaveBeenCalled(); expect(concluirChamada).not.toHaveBeenCalled();
  });

  test('manual execution is completed despite accounting.ok false; completed is not reconciliation', async () => {
    generateEntriesFromCircular.mockRejectedValue(Object.assign(Error('synthetic accounting failure'), { code: 'P2034' }));
    let captured;
    const service = new FiscalManualRunService({ captureGuides: async input => { captured = await capturePgdasGuideForCompany(input); return captured; } });
    const result = await service.executeAction('search_guides', company.id, '2026-10', { serviceId });
    expect(captured.accounting).toEqual({ ok: false, error: 'P2034', reason: 'synthetic accounting failure' });
    expect(result).toMatchObject({ status: 'completed', guidesCaptured: 1, circularUpdated: true, entriesGenerated: 0, executionLogId: 'execution-444' });
    expect(prisma.fiscalExecutionLog.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'execution-444' }, data: expect.objectContaining({ status: 'completed', entriesGenerated: 0 }) }));
    expect(axios.request).toHaveBeenCalledTimes(1);
  });
});

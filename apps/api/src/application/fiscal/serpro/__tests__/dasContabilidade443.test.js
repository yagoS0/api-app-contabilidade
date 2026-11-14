// Baseline 4.4.3: capture and parsing are real; provider and persistence boundaries are doubles.
jest.mock('../../../../infrastructure/db/prisma.js', () => ({ prisma: {
  portalClient: { findUnique: jest.fn() }, guide: { findFirst: jest.fn(), deleteMany: jest.fn() },
  companyMonthlyCircular: { findUnique: jest.fn(), upsert: jest.fn() },
} }));
jest.mock('../SerproRuntimeSettings.js', () => ({ getResolvedSerproCredentials: async () => ({ certificate: { document: '98765432000198' } }) }));
jest.mock('../SerproHttpClient.js', () => ({ SerproHttpClient: jest.fn() }));
jest.mock('../../../guides/GuideService.js', () => ({ ...jest.requireActual('../../../guides/GuideService.js'), createOrUpdateGuideFromProcessing: jest.fn() }));
jest.mock('../../../accounting/AccountingEntryGeneratorService.js', () => ({ generateEntriesFromCircular: jest.fn(), FONTE_VALOR_GUIA: 'GUIA' }));
jest.mock('../../circularAcrescimos.js', () => ({ gravarAcrescimoCircular: jest.fn() }));
jest.mock('../reutilizarGuia.js', () => ({ reutilizarGuia: jest.fn() }));
jest.mock('pdf-parse', () => jest.fn());

import { prisma } from '../../../../infrastructure/db/prisma.js';
import { capturePgdasGuideForCompany } from '../CaptureSerproGuidesService.js';
import { SerproHttpClient } from '../SerproHttpClient.js';
import { createOrUpdateGuideFromProcessing } from '../../../guides/GuideService.js';
import { generateEntriesFromCircular, FONTE_VALOR_GUIA } from '../../../accounting/AccountingEntryGeneratorService.js';
import { gravarAcrescimoCircular } from '../../circularAcrescimos.js';
import { reutilizarGuia } from '../reutilizarGuia.js';
import pdfParse from 'pdf-parse';

const company = { id: 'company-443', companyId: 'legacy-443', cnpj: '12345678000199', razao: 'Synthetic accounting' };
const now = new Date('2026-11-14T12:00:00Z');
const bytes = Buffer.from('%PDF-SYNTHETIC-443-' + '-'.repeat(120));
const payload = { pdf: bytes.toString('base64'), numeroDocumento: '443', valorTotal: 115, receitaBruta: 500, inssTotal: 20, vencimento: '20261120' };
const input = { portalClientId: company.id, competencia: '2026-10', serviceId: 'GERARDAS12' };
let trace, post, circular, accounting;
const record = (name, value) => async () => { trace.push(name); return value; };
beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers({ now, doNotFake: ['nextTick', 'setImmediate'] });
  trace = []; circular = { id: 'circular-443', dasTotal: 115 };
  accounting = { ok: true, generatedEntries: [{ entryId: 'entry-443', action: 'created' }] };
  prisma.portalClient.findUnique.mockResolvedValue(company);
  prisma.guide.findFirst.mockResolvedValue(null);
  prisma.guide.deleteMany.mockImplementation(record('cleanup', { count: 0 }));
  prisma.companyMonthlyCircular.findUnique.mockImplementation(record('circularRead', circular));
  prisma.companyMonthlyCircular.upsert.mockImplementation(record('circularWrite', circular));
  reutilizarGuia.mockResolvedValue(null);
  post = jest.fn(record('provider', payload)); SerproHttpClient.mockImplementation(() => ({ post }));
  createOrUpdateGuideFromProcessing.mockImplementation(async data => {
    trace.push('documentWrite'); return { ...data.parsed, ...data, id: 'guide-443', valor: data.parsed.valor, tipo: 'SIMPLES' };
  });
  pdfParse.mockImplementation(record('pdfText', { text: 'Totais\n100,00 5,00 10,00 115,00' }));
  gravarAcrescimoCircular.mockImplementation(record('acrescimos', { DAS: { principal: 100, juros: 10, multa: 5 } }));
  generateEntriesFromCircular.mockImplementation(record('accounting', accounting));
});
afterEach(() => jest.useRealTimers());

test.each(['GERARDAS12', 'GERARDASCOBRANCA17'])('%s conserves circular arguments, split, source and exact effect order', async serviceId => {
  const result = await capturePgdasGuideForCompany({ ...input, serviceId });
  expect(trace).toEqual(['provider', 'documentWrite', 'circularWrite', 'pdfText', 'acrescimos', 'accounting', 'cleanup']);
  const metadata = { integrationSource: 'SERPRO_PGDASD', sistema: 'PGDASD', servico: serviceId, numeroDocumento: '443',
    contratanteCnpj: '98765432000198', contribuinteCnpj: company.cnpj, referencia: '2026-10', rawPayload: payload, capturedAt: now.toISOString() };
  expect(prisma.companyMonthlyCircular.upsert).toHaveBeenCalledTimes(1);
  expect(prisma.companyMonthlyCircular.upsert).toHaveBeenCalledWith({
    where: { portalClientId_competencia: { portalClientId: company.id, competencia: '2026-10' } },
    create: { portalClientId: company.id, competencia: '2026-10', receitaBruta: 500, dasTotal: 115, inssTotal: 20, metadata },
    update: { receitaBruta: 500, dasTotal: 115, inssTotal: 20, metadata },
  });
  expect(gravarAcrescimoCircular).toHaveBeenCalledWith({ client: prisma, portalClientId: company.id, competencia: '2026-10', valores: { DAS: { principal: 100, juros: 10, multa: 5 } } });
  expect(generateEntriesFromCircular).toHaveBeenCalledWith({ portalClientId: company.id, competencia: '2026-10', now, fonteValor: FONTE_VALOR_GUIA });
  expect(result.circular).toBe(circular); expect(result.accounting).toBe(accounting);
  expect(result.guide.guideId).toBe('guide-443');
});

test.each([{ ok: false, reason: 'mes_fechado', generatedEntries: [] }, { ok: true, generatedEntries: [], skipped: [{ reason: 'missing_rule' }] }])('returns partial accounting unchanged without inferring reconciliation: %j', async value => {
  generateEntriesFromCircular.mockImplementation(record('accounting', value));
  const result = await capturePgdasGuideForCompany(input);
  expect(result.accounting).toBe(value); expect(trace.at(-1)).toBe('cleanup');
});

test.each([Object.assign(new Error('falha de provisão'), { code: 'PROVISION_FAILED' }), new Error(''), null])('accounting rejection is partial, preserves document/circular and runs cleanup: %j', async error => {
  generateEntriesFromCircular.mockImplementation(async () => { trace.push('accounting'); throw error; });
  const result = await capturePgdasGuideForCompany(input);
  expect(result.accounting).toEqual({ ok: false, error: error?.code || 'ACCOUNTING_GENERATION_FAILED', reason: error?.message || 'Falha ao gerar lançamentos a partir da Circular.' });
  expect(result.circular).toBe(circular); expect(trace.at(-1)).toBe('cleanup');
});

test('circular failure propagates after document and prevents split, accounting and cleanup', async () => {
  const error = Object.assign(new Error('circular unavailable'), { code: 'P2002' });
  prisma.companyMonthlyCircular.upsert.mockImplementation(async () => { trace.push('circularWrite'); throw error; });
  await expect(capturePgdasGuideForCompany(input)).rejects.toBe(error);
  expect(trace).toEqual(['provider', 'documentWrite', 'circularWrite']);
});

test.each(['pdf', 'acrescimos'])('%s failure remains best effort, followed by accounting and cleanup', async phase => {
  const target = phase === 'pdf' ? pdfParse : gravarAcrescimoCircular;
  target.mockImplementation(async () => { trace.push(phase === 'pdf' ? 'pdfText' : 'acrescimos'); throw Error('synthetic split failure'); });
  const result = await capturePgdasGuideForCompany(input);
  expect(result.accounting).toBe(accounting);
  expect(trace.slice(-2)).toEqual(['accounting', 'cleanup']);
  if (phase === 'pdf') expect(gravarAcrescimoCircular).not.toHaveBeenCalled();
});

test('split mismatch is ignored and does not change document total or generation source', async () => {
  pdfParse.mockImplementation(record('pdfText', { text: 'Totais\n100,00 5,00 10,00 200,00' }));
  await capturePgdasGuideForCompany(input);
  expect(gravarAcrescimoCircular).not.toHaveBeenCalled();
  expect(generateEntriesFromCircular.mock.calls[0][0].fonteValor).toBe('GUIA');
});

test.each([null, { id: 'existing-circular', fechadoContabilEm: now }])('document-only reads existing circular and skips all accounting writes: %j', async value => {
  prisma.companyMonthlyCircular.findUnique.mockImplementation(record('circularRead', value));
  const result = await capturePgdasGuideForCompany({ ...input, somenteDocumentos: true });
  expect(trace).toEqual(['provider', 'documentWrite', 'circularRead']);
  expect(result.circular).toBe(value);
  expect(result.accounting).toEqual({ skipped: true, somenteDocumentos: true });
  expect(prisma.companyMonthlyCircular.upsert).not.toHaveBeenCalled();
});

test('reuse returns previous local result without calling provider or repairing accounting', async () => {
  const saved = { reutilizado: true, guide: { guideId: 'saved' }, accounting: { ok: true, generatedEntries: [] }, integration: { chamadaSerpro: false } };
  reutilizarGuia.mockResolvedValue(saved);
  expect(await capturePgdasGuideForCompany(input)).toEqual({ ...saved, company });
  expect(trace).toEqual([]); expect(generateEntriesFromCircular).not.toHaveBeenCalled();
});

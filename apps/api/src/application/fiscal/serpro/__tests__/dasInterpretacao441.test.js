// Golden behavior captured on 010e094 before the interpretation extraction.
// Production capture, SerproPgdasdService, hash and DTO are real. HTTP, PDF text and writes are doubles.
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
jest.mock('pdf-parse', () => jest.fn());

import { Prisma } from '@prisma/client';
import pdfParse from 'pdf-parse';
import { prisma } from '../../../../infrastructure/db/prisma.js';
import { SerproHttpClient } from '../SerproHttpClient.js';
import { getResolvedSerproCredentials } from '../SerproRuntimeSettings.js';
import { capturePgdasGuideForCompany, extractDocumentNumber, parsePossibleDate } from '../CaptureSerproGuidesService.js';
import { createOrUpdateGuideFromProcessing } from '../../../guides/GuideService.js';
import { generateEntriesFromCircular } from '../../../accounting/AccountingEntryGeneratorService.js';

const company = { id: 'company-441', companyId: 'legacy-441', cnpj: '12345678000199', razao: 'Synthetic interpretation' };
const bytes = Buffer.from('%PDF-1.4\n' + 'synthetic DAS interpretation '.repeat(8));
const input = { portalClientId: company.id, competencia: '2026-10', serviceId: 'GERARDAS12' };
const base = extra => ({ pdf: bytes.toString('base64'), numeroDocumento: 'DAS-441', valorTotal: 125.5, dataVencimento: '20261120', ...extra });
const plain = value => JSON.parse(JSON.stringify(value, (_key, item) => item?.type === 'Buffer' && Array.isArray(item.data) ? { bufferHex: Buffer.from(item.data).toString('hex') } : item));
let payload, trace, post;
const read = (name, value) => async args => { trace.push({ operation: name, args: plain(args ?? null) }); return value; };

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: new Date('2026-11-14T12:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate'] });
  trace = []; payload = base();
  prisma.portalClient.findUnique.mockImplementation(read('company', company));
  prisma.guide.findFirst.mockImplementation(read('guideLookup', null));
  prisma.guide.deleteMany.mockImplementation(read('cleanup', { count: 0 }));
  prisma.companyMonthlyCircular.findFirst.mockImplementation(read('circularLookup', { id: 'circular-441' }));
  prisma.companyMonthlyCircular.findUnique.mockImplementation(read('circularRead', { id: 'circular-441' }));
  prisma.companyMonthlyCircular.upsert.mockImplementation(read('circularWrite', { id: 'circular-441' }));
  getResolvedSerproCredentials.mockImplementation(read('credentials', { certificate: { document: '98765432000198' } }));
  post = jest.fn(async (...args) => { trace.push({ operation: 'provider', args }); return payload; });
  SerproHttpClient.mockImplementation(() => ({ post }));
  pdfParse.mockImplementation(async buffer => { trace.push({ operation: 'pdfText', bytes: buffer.toString('hex') }); return { text: '' }; });
  createOrUpdateGuideFromProcessing.mockImplementation(async data => {
    trace.push({ operation: 'documentWrite', args: plain(data) });
    return { ...data.parsed, ...data, id: 'guide-441', valor: data.parsed.valor, competencia: data.parsed.competencia, tipo: 'SIMPLES' };
  });
  generateEntriesFromCircular.mockImplementation(read('accounting', { ok: true, generatedEntries: [] }));
});
afterEach(() => jest.useRealTimers());

const cases = [
  ['normal-flat', () => base()],
  ['cobranca-nested-json', () => ({ dados: JSON.stringify([base({ valorTotal: '1.234,56' })]) }), { serviceId: 'GERARDASCOBRANCA17' }],
  ['nested-envelope', () => ({ response: [{ dados: JSON.stringify({ another: base() }) }] })],
  ['echo-cnpj-not-document-number', () => ({ contratante: { numero: '98765432000198' }, dados: JSON.stringify(base({ numeroDeclaracao: 'IGNORE', numeroDocumento: 'DOC/ 44.1' })) })],
  ['document-number-in-dados-generic', () => ({ contratante: { numero: '98765432000198' }, dados: JSON.stringify(base({ numeroDocumento: undefined, numero: 'DAS-GENERIC' })) })],
  ['numeric-fraction-not-rounded', () => base({ valorTotal: 0.1 + 0.2 })],
  ['numeric-half-cent-not-rounded', () => base({ valorTotal: 1.005 })],
  ['decimal-input', () => base({ valorTotal: new Prisma.Decimal('1234.5678') })],
  ['US-money', () => base({ valorTotal: '1,234.56' })],
  ['BR-money', () => base({ valorTotal: 'R$ 1.234,56' })],
  ['money-priority', () => base({ valorTotal: 3, nested: { valorTotalDocumento: '9,90' }, valorMulta: 0 })],
  ['negative-fallback-preserved', () => base({ valorTotal: -1 })],
  ['empty-money-fallback', () => base({ valorTotal: '' })],
  ['zero-json-fallback-pdf', () => base({ valorTotal: 0 }), {}, 'Valor Total do Documento\n1.234,56'],
  ['missing-json-fallback-pdf', () => base({ valorTotal: undefined }), {}, 'Valor Total do Documento 123,45'],
  ['fallback-label-gap', () => base({ valorTotal: null }), {}, 'Valor Total do Documento: R$ 80,19'],
  ['fallback-totais-legacy-first-value', () => base({ valorTotal: null }), {}, 'Totais 10,00 2,00 12,00'],
  ['fallback-principal-total', () => base({ valorTotal: null }), {}, 'Principal 10,00 Multa 1,00 Juros 1,00 Total 12,00'],
  ['fallback-no-match-keeps-null', () => base({ valorTotal: null }), {}, 'texto sem valor'],
  ['fallback-parser-fails-keeps-null', () => base({ valorTotal: null }), {}, new Error('synthetic invalid PDF')],
  ['positive-json-does-not-use-fallback', () => base({ valorTotal: 4.75 }), {}, 'Valor Total do Documento\n999,99'],
  ['secondary-money-fields', () => base({ receita_bruta: '1.000,10', inss: '80,50' })],
  ['date-BR', () => base({ dataVencimento: '20/11/2026' })],
  ['date-ISO-offset', () => base({ dataVencimento: '2026-11-20T03:00:00-03:00' })],
  ['date-compact-impossible-rollover', () => base({ dataVencimento: '20260231' })],
  ['date-compact-invalid-month', () => base({ dataVencimento: '20261301' })],
  ['date-unparseable-null', () => base({ dataVencimento: 'not-a-date' })],
  ['date-ISO-invalid-range-error', () => base({ dataVencimento: '2026-13-01' })],
  ['missing-document-id', () => base({ numeroDocumento: undefined })],
  ['missing-pdf', () => ({ valorTotal: 12 })],
  ['short-pdf-ignored', () => base({ pdf: Buffer.from('short').toString('base64') })],
  ['invalid-base64-empty', () => base({ pdf: '!'.repeat(120) })],
  ['non-pdf-nonempty-legacy-accepted', () => base({ pdf: Buffer.from('not PDF '.repeat(30)).toString('base64') })],
  ['malformed-envelope', () => ({ dados: '{not-json' })],
  ['null-response', () => null],
  ['no-debt', () => ({ mensagens: [{ texto: 'nao foram encontrados debitos para o contribuinte' }] })],
  ['no-amount', () => ({ mensagens: [{ texto: 'nao foi gerado das por nao haver valor devido' }] })],
  ['no-declaration', () => ({ mensagens: [{ texto: 'nao ha declaracao transmitida para o periodo informado' }] })],
  ['message-precedence', () => ({ mensagens: [{ texto: 'nao ha declaracao transmitida para o periodo informado' }, { texto: 'nao foram encontrados debitos' }, { texto: 'nao foi gerado das por nao haver valor devido' }] })],
  ['accented-message-legacy-generic', () => ({ mensagens: [{ texto: 'não foram encontrados débitos' }] })],
  ['valid-pdf-wins-over-message', () => base({ mensagens: [{ texto: 'nao foram encontrados debitos' }] })],
  ['malformed-messages-legacy-error', () => ({ mensagens: [null] })],
];

test.each(cases)('legacy interpretation, DTO and effect sequence: %s', async (name, makePayload, extra = {}, text = '') => {
  payload = makePayload();
  pdfParse.mockImplementation(async buffer => {
    trace.push({ operation: 'pdfText', bytes: buffer.toString('hex') });
    if (text instanceof Error) throw text;
    return { text };
  });
  let result;
  try {
    result = { ok: true, value: plain(await capturePgdasGuideForCompany({ ...input, ...extra })) };
    const writer = createOrUpdateGuideFromProcessing.mock.calls[0][0];
    expect(writer.extracted.rawPayload).toBe(payload);
    expect(post).toHaveBeenCalledTimes(1);
    expect(createOrUpdateGuideFromProcessing).toHaveBeenCalledTimes(1);
  } catch (error) {
    result = { ok: false, error: { name: error.name, code: error.code ?? null, message: error.message, details: plain(error.details ?? null) } };
    if (error.details) expect(error.details).toBe(payload);
    expect(createOrUpdateGuideFromProcessing).not.toHaveBeenCalled();
    expect(prisma.companyMonthlyCircular.upsert).not.toHaveBeenCalled();
    expect(generateEntriesFromCircular).not.toHaveBeenCalled();
    expect(prisma.guide.deleteMany).not.toHaveBeenCalled();
  }
  expect({ result, trace: plain(trace) }).toMatchSnapshot();
});

test('public parsing exports retain their contracts and reference behavior', () => {
  expect(extractDocumentNumber({ contratante: { numero: '98765432000198' }, dados: JSON.stringify({ numeroDocumento: 'DAS-441' }) })).toBe('DAS-441');
  expect(parsePossibleDate('20261120').toISOString()).toBe('2026-11-20T00:00:00.000Z');
  expect(parsePossibleDate('20261301')).toBeNull();
});


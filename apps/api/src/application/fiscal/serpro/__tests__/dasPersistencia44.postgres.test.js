// Characterization only: the capture, document funnel and PostgreSQL are real.
// HTTP, credentials and PDF interpretation are doubles. This does not certify fiscal acceptance.
jest.mock('../SerproHttpClient.js', () => ({ SerproHttpClient: jest.fn() }));
jest.mock('../SerproRuntimeSettings.js', () => ({ getResolvedSerproCredentials: async () => ({ certificate: { document: '12345678000199' } }) }));
jest.mock('../../../accounting/AccountingEntryGeneratorService.js', () => ({ generateEntriesFromCircular: jest.fn(), FONTE_VALOR_GUIA: 'GUIA' }));
jest.mock('../../../accounting/GuideToProvisionService.js', () => ({ generateProvisionsFromGuide: jest.fn() }));
jest.mock('pdf-parse', () => jest.fn(async () => ({ text: '' })));
jest.mock('../../../guides/lerLinhaDigitavelDoPdf.js', () => ({
  NAO_TENTADA: { linhaDigitavel: null, linhaDigitavelLidaEm: null, linhaDigitavelMotivo: null, linhaDigitavelValorLidoCentavos: null },
  situacaoDaLinhaDigitavel: () => 'NAO_TENTADA',
  lerLinhaDigitavelDoPdf: jest.fn(async () => { if (mockLineGate) await mockLineGate(); return {}; }),
}));

import { PrismaClient } from '@prisma/client';
import { autorizarChamada, concluirChamada } from '../SerproCallGuard.js';
import { randomUUID } from 'node:crypto';
import { prisma as db } from '../../../../infrastructure/db/prisma.js';
import { capturePgdasGuideForCompany } from '../CaptureSerproGuidesService.js';
import { SerproHttpClient } from '../SerproHttpClient.js';
import { generateEntriesFromCircular } from '../../../accounting/AccountingEntryGeneratorService.js';
import { generateProvisionsFromGuide } from '../../../accounting/GuideToProvisionService.js';
import { hashPdf } from '../../../guides/GuideService.js';

const suite = process.env.ALTAN_TESTE_POSTGRES === '1' ? describe : describe.skip;
const mockPost = jest.fn();
let mockLineGate = null;
const competencia = '2026-10';
function response(id = randomUUID(), valor = 100) {
  const bytes = Buffer.from('%PDF-SYNTHETIC-' + id + '-'.repeat(100));
  return { bytes, payload: { pdf: bytes.toString('base64'), numeroDocumento: id, valorTotal: valor, vencimento: '20261120' } };
}
async function company() {
  const id = randomUUID();
  const cnpj = BigInt('0x' + id.replace(/-/g, '').slice(0, 10)).toString().padStart(14, '0');
  return db.portalClient.create({ data: { id, razao: 'DAS44 SYNTHETIC ' + id, cnpj } });
}
const capture = (portal, extra = {}) => capturePgdasGuideForCompany({ portalClientId: portal.id, competencia, serviceId: 'GERARDAS12', ...extra });

suite('PostgreSQL16 — capture and reissue DAS characterization', () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL);
    if (process.env.NODE_ENV !== 'test' || url.hostname !== '127.0.0.1' || url.pathname !== '/altan_piloto_governance_test' || url.search) throw Error('Disposable pilot PostgreSQL required');
    const [actual] = await db.$queryRaw`SELECT current_database() AS name, current_user AS username, current_setting('server_version_num') AS version`;
    expect(actual.name).toBe(url.pathname.slice(1));
    expect(actual.username).toBe(decodeURIComponent(url.username));
    expect(Number(actual.version)).toBeGreaterThanOrEqual(160000);
    expect(Number(actual.version)).toBeLessThan(170000);
  });
  beforeEach(() => {
    jest.clearAllMocks(); mockLineGate = null; mockPost.mockReset();
    SerproHttpClient.mockImplementation(() => ({ post: mockPost }));
    generateEntriesFromCircular.mockReset().mockResolvedValue({ ok: true, generatedEntries: [] });
    generateProvisionsFromGuide.mockReset().mockResolvedValue({ skipped: true });
  });
  afterAll(async () => { await db.$disconnect(); }); // Preserve synthetic records in this disposable cluster.

  test.each(['GERARDAS12', 'GERARDASCOBRANCA17'])('%s persists company, competence, bytes/hash and reuses after a new invocation', async serviceId => {
    const portal = await company(), other = await company(), r = response();
    mockPost.mockResolvedValue(r.payload);
    const first = await capture(portal, { serviceId });
    const guide = await db.guide.findUnique({ where: { id: first.guide.guideId } });
    expect(guide).toMatchObject({ portalClientId: portal.id, competencia, tipo: 'SIMPLES', source: 'SERPRO', status: 'PROCESSED', storageProvider: 'DATABASE', hash: hashPdf(r.bytes), serproService: serviceId, paymentStatus: 'OPEN' });
    expect(Number(guide.valor)).toBe(100); expect(Number(guide.valorOriginal)).toBe(100);
    expect(Buffer.from(guide.pdfBytes)).toEqual(r.bytes);
    expect(guide.sourceFileId).toContain(`:${portal.cnpj}:${competencia}:`);
    expect(mockPost).toHaveBeenCalledWith('/Emitir', expect.objectContaining({ contribuinte: { numero: portal.cnpj, tipo: 2 }, pedidoDados: expect.objectContaining({ idServico: serviceId, dados: JSON.stringify({ periodoApuracao: '202610' }) }) }));
    expect(await db.guide.count({ where: { portalClientId: other.id } })).toBe(0);
    const replay = await capture(portal, { serviceId });
    expect(replay).toMatchObject({ reutilizado: true, guide: { guideId: guide.id }, integration: { chamadaSerpro: false } });
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(await db.guide.count({ where: { portalClientId: portal.id } })).toBe(1);
  });

  test('explicit reissue replaces revision while preserving payment, original amount and selected email history', async () => {
    const portal = await company(), r = response(); mockPost.mockResolvedValue(r.payload);
    const first = await capture(portal);
    const id = first.guide.guideId;
    const paidAt = new Date('2026-11-10T12:00:00Z');
    await db.guide.update({ where: { id }, data: { paymentStatus: 'PAID', paymentStatusSource: 'MANUAL', paymentConfirmedAt: paidAt, emailStatus: 'SENT', emailAttempts: 3, extracted: { comprovante: { fixture: true } } } });
    const changed = response(r.payload.numeroDocumento, 150); changed.bytes = Buffer.concat([changed.bytes, Buffer.from('new revision')]); changed.payload.pdf = changed.bytes.toString('base64'); mockPost.mockResolvedValue(changed.payload);
    await capture(portal, { existingGuideId: id, atualizar: true, emailStatusOverride: 'PRESERVE' });
    const after = await db.guide.findUnique({ where: { id } });
    expect(Number(after.valor)).toBe(150); expect(Number(after.valorOriginal)).toBe(100);
    expect(after).toMatchObject({ hash: hashPdf(changed.bytes), paymentStatus: 'PAID', paymentStatusSource: 'MANUAL', paymentConfirmedAt: paidAt, emailStatus: 'SENT', emailAttempts: 3, extracted: { comprovante: { fixture: true } } });
    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(await db.guide.count({ where: { portalClientId: portal.id } })).toBe(1);
  });

  test('accounting failure after document persistence leaves guide and circular, with explicit accounting error', async () => {
    const portal = await company(), r = response(); mockPost.mockResolvedValue(r.payload);
    generateEntriesFromCircular.mockRejectedValue(Object.assign(new Error('synthetic accounting failure'), { code: 'SYNTHETIC_ACCOUNTING_FAILURE' }));
    const result = await capture(portal);
    expect(result.accounting).toMatchObject({ ok: false, error: 'SYNTHETIC_ACCOUNTING_FAILURE' });
    expect(await db.guide.findUnique({ where: { id: result.guide.guideId } })).toMatchObject({ hash: hashPdf(r.bytes), status: 'PROCESSED' });
    expect(Number((await db.companyMonthlyCircular.findUnique({ where: { portalClientId_competencia: { portalClientId: portal.id, competencia } } })).dasTotal)).toBe(100);
    const replay = await capture(portal);
    expect(replay.accounting).toEqual({ ok: true, generatedEntries: [] });
    expect(replay.reutilizado).toBe(true); // Legacy reuse does not retry or report the earlier accounting failure.
    expect(generateEntriesFromCircular).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  test('successful external response followed by a real unique-hash failure saves no document for the requested company', async () => {
    const owner = await company(), portal = await company(), r = response();
    await db.guide.create({ data: { portalClientId: owner.id, competencia, tipo: 'SIMPLES', status: 'PROCESSED', hash: hashPdf(r.bytes), pdfBytes: r.bytes } });
    mockPost.mockResolvedValue(r.payload);
    await expect(capture(portal)).rejects.toMatchObject({ code: 'P2002' });
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(await db.guide.count({ where: { portalClientId: portal.id } })).toBe(0);
    expect(await db.companyMonthlyCircular.count({ where: { portalClientId: portal.id } })).toBe(0);
    expect(generateEntriesFromCircular).not.toHaveBeenCalled();
    expect(await db.guide.count({ where: { portalClientId: owner.id } })).toBe(1);
  });

  test('simultaneous responses race on the unique document; replay reuses the winner', async () => {
    const portal = await company(), r = response(); mockPost.mockResolvedValue(r.payload);
    let arrived = 0, release; const barrier = new Promise(resolve => { release = resolve; });
    mockLineGate = async () => { if (++arrived === 2) release(); await barrier; };
    const results = await Promise.allSettled([capture(portal), capture(portal)]);
    mockLineGate = null;
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(x => x.status === 'rejected').reason.code).toBe('P2002');
    expect(mockPost).toHaveBeenCalledTimes(2); // HTTP guard is doubled: this characterizes persistence, not provider idempotence.
    expect(await db.guide.count({ where: { portalClientId: portal.id } })).toBe(1);
    const replay = await capture(portal);
    expect(replay.reutilizado).toBe(true);
    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  test('real reservation guard serializes independent connections and preserves uncertain result across reconnect', async () => {
    const portal = await company();
    const otherConnection = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    const payload = { contribuinte: { numero: portal.cnpj }, pedidoDados: { idSistema: 'PGDASD', idServico: 'GERARDAS12', dados: JSON.stringify({ periodoApuracao: '202610' }) } };
    try {
      const results = await Promise.allSettled([
        autorizarChamada({ payload, rota: '/Emitir' }, db),
        autorizarChamada({ payload, rota: '/Emitir' }, otherConnection),
      ]);
      expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
      expect(results.find(x => x.status === 'rejected').reason.code).toBe('SERPRO_CHAMADA_EM_ANDAMENTO');
      const authorization = results.find(x => x.status === 'fulfilled').value;
      expect(await db.serproChamada.count({ where: { portalClientId: portal.id, status: 'reservada' } })).toBe(1);
      await concluirChamada(authorization, { erroCodigo: 'SYNTHETIC_TIMEOUT' }, db);
      await otherConnection.$disconnect();
      await expect(autorizarChamada({ payload, rota: '/Emitir' }, otherConnection)).rejects.toMatchObject({ code: 'SERPRO_CHAMADA_EM_ANDAMENTO' });
      expect(await db.serproChamada.findUnique({ where: { id: authorization.id } })).toMatchObject({ status: 'incerta', erroCodigo: 'SYNTHETIC_TIMEOUT' });
      expect(mockPost).not.toHaveBeenCalled();
    } finally { await otherConnection.$disconnect(); }
  });
  test('timeout propagates without creating guide or circular', async () => {
    const portal = await company(); mockPost.mockRejectedValue(Object.assign(new Error('synthetic timeout'), { code: 'ETIMEDOUT' }));
    await expect(capture(portal)).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    expect(await db.guide.count({ where: { portalClientId: portal.id } })).toBe(0);
    expect(await db.companyMonthlyCircular.count({ where: { portalClientId: portal.id } })).toBe(0);
    expect(generateEntriesFromCircular).not.toHaveBeenCalled();
  });
});

// Baseline 4.4.3: capture, circular/acrescimos writer and accounting generator use real PostgreSQL.
// Provider, credentials, PDF text/line extraction and automatic guide-provision hook are doubles.
// Individual failure tests additionally inject failures at the named persistence boundary.
jest.mock('../SerproHttpClient.js', () => ({ SerproHttpClient: jest.fn() }));
jest.mock('../SerproRuntimeSettings.js', () => ({ getResolvedSerproCredentials: async () => ({ certificate: { document: '12345678000199' } }) }));
jest.mock('../../../accounting/GuideToProvisionService.js', () => ({ generateProvisionsFromGuide: jest.fn(async () => ({ skipped: true })) }));
jest.mock('pdf-parse', () => jest.fn());
jest.mock('../../../guides/lerLinhaDigitavelDoPdf.js', () => ({
  NAO_TENTADA: {}, situacaoDaLinhaDigitavel: () => 'NAO_TENTADA', lerLinhaDigitavelDoPdf: jest.fn(async () => ({})),
}));
import { randomUUID } from 'node:crypto';
import { prisma as db } from '../../../../infrastructure/db/prisma.js';
import { capturePgdasGuideForCompany } from '../CaptureSerproGuidesService.js';
import { SerproHttpClient } from '../SerproHttpClient.js';
import pdfParse from 'pdf-parse';
const suite = process.env.ALTAN_TESTE_POSTGRES === '1' ? describe : describe.skip;
const competencia = '2026-10', mockPost = jest.fn();
async function company() {
  const id = randomUUID();
  return db.portalClient.create({ data: { id, razao: 'DAS443 SYNTHETIC', cnpj: BigInt('0x' + id.replace(/-/g, '').slice(0, 10)).toString().padStart(14, '0') } });
}
const where = portal => ({ portalClientId_competencia: { portalClientId: portal.id, competencia } });
const capture = (portal, extra = {}) => capturePgdasGuideForCompany({ portalClientId: portal.id, competencia, serviceId: 'GERARDAS12', ...extra });
function response(number = randomUUID(), valor = 115) {
  return { pdf: Buffer.from('%PDF-SYNTHETIC-' + randomUUID() + '-'.repeat(100)).toString('base64'), numeroDocumento: number, valorTotal: valor, vencimento: '20261120' };
}
const entries = portal => db.accountingEntry.findMany({ where: { portalClientId: portal.id, competencia }, include: { lines: { orderBy: { ordem: 'asc' } } } });
suite('DAS accounting contract baseline 4.4.3 — PostgreSQL16', () => {
  beforeAll(async () => {
    const raw = process.env.TEST_CICLO_PG_URL || process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
    const url = new URL(raw);
    if (process.env.NODE_ENV !== 'test' || !['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_governance_test') || url.search || raw !== process.env.DATABASE_URL) throw Error('Disposable loopback PostgreSQL required');
    const [actual] = await db.$queryRawUnsafe("SELECT current_database() AS name, current_setting('server_version_num') AS version");
    expect(actual.name).toBe(url.pathname.slice(1)); expect(Number(actual.version)).toBeGreaterThanOrEqual(160000); expect(Number(actual.version)).toBeLessThan(170000);
  });
  beforeEach(() => {
    jest.restoreAllMocks(); mockPost.mockReset();
    SerproHttpClient.mockImplementation(() => ({ post: mockPost }));
    pdfParse.mockReset().mockResolvedValue({ text: 'Totais\n100,00 5,00 10,00 115,00' });
  });
  afterAll(async () => { jest.restoreAllMocks(); await db.$disconnect(); });

  test.each(['GERARDAS12', 'GERARDASCOBRANCA17'])('%s creates real provision for principal, split and existing circular identity', async serviceId => {
    const portal = await company(), other = await company();
    const original = await db.companyMonthlyCircular.create({ data: { portalClientId: portal.id, competencia, acrescimos: { ISS: { principal: 7, juros: 1, multa: 0 } } } });
    const payload = response(); mockPost.mockResolvedValue(payload);
    const result = await capture(portal, { serviceId });
    const circular = await db.companyMonthlyCircular.findUnique({ where: where(portal) });
    expect(result.circular.id).toBe(original.id); expect(circular.id).toBe(original.id);
    expect(Number(circular.dasTotal)).toBe(115);
    expect(circular.acrescimos).toEqual({ ISS: { principal: 7, juros: 1, multa: 0 }, DAS: { principal: 100, juros: 10, multa: 5 } });
    const saved = await entries(portal);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ circularId: original.id, eventType: 'DAS_SIMPLES', origem: 'SERPRO', tipo: 'PROVISAO' });
    expect(saved[0].lines.map(x => [x.tipo, Number(x.valor)])).toEqual([['D', 100], ['C', 100]]);
    expect(result.accounting.ok).toBe(true); expect(result.accounting.generatedEntries).toHaveLength(1);
    expect(await entries(other)).toEqual([]);
    expect(await capture(portal)).toMatchObject({ reutilizado: true, accounting: { ok: true, generatedEntries: [] } });
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect((await entries(portal)).map(x => x.id)).toEqual(saved.map(x => x.id));
  });

  test('closed competence keeps closed marker; document/circular/split persist but no provision is generated', async () => {
    const portal = await company(), closedAt = new Date('2026-11-01T12:00:00Z');
    const initial = await db.companyMonthlyCircular.create({ data: { portalClientId: portal.id, competencia, fechadoContabilEm: closedAt } });
    mockPost.mockResolvedValue(response());
    const result = await capture(portal);
    expect(result.accounting).toMatchObject({ ok: false, reason: 'mes_fechado', generatedEntries: [] });
    const circular = await db.companyMonthlyCircular.findUnique({ where: where(portal) });
    expect(circular).toMatchObject({ id: initial.id, fechadoContabilEm: closedAt, acrescimos: { DAS: { principal: 100, juros: 10, multa: 5 } } });
    expect(Number(circular.dasTotal)).toBe(115); expect(await entries(portal)).toEqual([]);
    expect(await db.guide.count({ where: { portalClientId: portal.id } })).toBe(1);
  });

  test('recapture retains original provision and records recalculation under GUIA source', async () => {
    const portal = await company(), payload = response(); mockPost.mockResolvedValue(payload);
    const first = await capture(portal), [before] = await entries(portal);
    mockPost.mockResolvedValue(response(payload.numeroDocumento, 135));
    pdfParse.mockResolvedValue({ text: 'Totais\n120,00 5,00 10,00 135,00' });
    const result = await capture(portal, { atualizar: true, existingGuideId: first.guide.guideId });
    const [after] = await entries(portal);
    expect(after.id).toBe(before.id);
    expect(after.lines.map(x => [x.id, x.tipo, Number(x.valor)])).toEqual(before.lines.map(x => [x.id, x.tipo, Number(x.valor)]));
    expect(Number(after.recalculatedFromValor)).toBe(100); expect(Number(after.recalculatedToValor)).toBe(120);
    expect(result.accounting.generatedEntries).toEqual([{ eventType: 'DAS_SIMPLES', action: 'recalculated', entryId: before.id }]);
    const circular = await db.companyMonthlyCircular.findUnique({ where: where(portal) });
    expect(circular.id).toBe(first.circular.id); expect(Number(circular.dasTotal)).toBe(135);
    expect(circular.acrescimos.DAS).toEqual({ principal: 120, juros: 10, multa: 5 });
  });

  test('generation transaction failure is returned partially after committed document and circular; reuse does not repair', async () => {
    const portal = await company(); mockPost.mockResolvedValue(response());
    const transaction = jest.spyOn(db, '$transaction').mockRejectedValueOnce(Object.assign(new Error('synthetic transaction conflict'), { code: 'P2034' }));
    const result = await capture(portal);
    transaction.mockRestore();
    expect(result.accounting).toEqual({ ok: false, error: 'P2034', reason: 'synthetic transaction conflict' });
    expect(await db.companyMonthlyCircular.findUnique({ where: where(portal) })).not.toBeNull();
    expect(await db.guide.count({ where: { portalClientId: portal.id } })).toBe(1);
    expect(await entries(portal)).toEqual([]);
    expect(await capture(portal)).toMatchObject({ reutilizado: true, accounting: { ok: true, generatedEntries: [] } });
    expect(await entries(portal)).toEqual([]); expect(mockPost).toHaveBeenCalledTimes(1);
  });

  test('circular upsert failure leaves document without circular or provision', async () => {
    const portal = await company(); mockPost.mockResolvedValue(response());
    const error = Object.assign(new Error('synthetic upsert failure'), { code: 'P2002' });
    const write = jest.spyOn(db.companyMonthlyCircular, 'upsert').mockRejectedValueOnce(error);
    await expect(capture(portal)).rejects.toBe(error); write.mockRestore();
    expect(await db.guide.count({ where: { portalClientId: portal.id } })).toBe(1);
    expect(await db.companyMonthlyCircular.findUnique({ where: where(portal) })).toBeNull();
    expect(await entries(portal)).toEqual([]);
  });

  test('failed split update is swallowed and real generator uses full document total', async () => {
    const portal = await company(); mockPost.mockResolvedValue(response());
    const original = db.companyMonthlyCircular.update.bind(db.companyMonthlyCircular);
    jest.spyOn(db.companyMonthlyCircular, 'update').mockImplementation(args => {
      if (args.data.acrescimos) return Promise.reject(Error('synthetic split write failure'));
      return original(args);
    });
    const result = await capture(portal);
    expect(result.accounting.ok).toBe(true);
    const saved = await entries(portal);
    expect(saved).toHaveLength(1);
    expect(saved[0].lines.map(x => Number(x.valor))).toEqual([115, 115]);
    const circular = await db.companyMonthlyCircular.findUnique({ where: where(portal) });
    expect(circular.acrescimos).toBeNull();
  });

  test('somenteDocumentos with missing circular persists only guide', async () => {
    const portal = await company(); mockPost.mockResolvedValue(response());
    const result = await capture(portal, { somenteDocumentos: true });
    expect(result.circular).toBeNull(); expect(result.accounting).toEqual({ skipped: true, somenteDocumentos: true });
    expect(await db.companyMonthlyCircular.findUnique({ where: where(portal) })).toBeNull();
    expect(await entries(portal)).toEqual([]);
    expect(await db.guide.count({ where: { portalClientId: portal.id } })).toBe(1);
  });
});

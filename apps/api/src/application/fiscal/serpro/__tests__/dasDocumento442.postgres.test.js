// Baseline 4.4.2: real capture, document funnel and PostgreSQL; no fiscal HTTP.
jest.mock('../SerproHttpClient.js', () => ({ SerproHttpClient: jest.fn() }));
jest.mock('../SerproRuntimeSettings.js', () => ({ getResolvedSerproCredentials: async () => ({ certificate: { document: '12345678000199' } }) }));
jest.mock('../../../accounting/AccountingEntryGeneratorService.js', () => ({ generateEntriesFromCircular: jest.fn(), FONTE_VALOR_GUIA: 'GUIA' }));
jest.mock('../../../accounting/GuideToProvisionService.js', () => ({ generateProvisionsFromGuide: jest.fn() }));
jest.mock('pdf-parse', () => jest.fn(async () => ({ text: '' })));
jest.mock('../../../guides/lerLinhaDigitavelDoPdf.js', () => ({
  NAO_TENTADA: {}, situacaoDaLinhaDigitavel: () => 'NAO_TENTADA', lerLinhaDigitavelDoPdf: jest.fn(async () => ({})),
}));

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { prisma as db } from '../../../../infrastructure/db/prisma.js';
import { capturePgdasGuideForCompany } from '../CaptureSerproGuidesService.js';
import { SerproHttpClient } from '../SerproHttpClient.js';
import { generateEntriesFromCircular } from '../../../accounting/AccountingEntryGeneratorService.js';
import { generateProvisionsFromGuide } from '../../../accounting/GuideToProvisionService.js';
import { hashPdf } from '../../../guides/GuideService.js';

const suite = process.env.ALTAN_TESTE_POSTGRES === '1' ? describe : describe.skip;
const mockPost = jest.fn();
const competencia = '2026-10';
function response(number = randomUUID(), amount = 100, revision = randomUUID()) {
  const bytes = Buffer.from('%PDF-SYNTHETIC-' + revision + '-'.repeat(110));
  return { bytes, payload: { pdf: bytes.toString('base64'), numeroDocumento: number, valorTotal: amount, vencimento: '20261120' } };
}
async function company() {
  const id = randomUUID();
  return db.portalClient.create({ data: { id, razao: 'DAS442 SYNTHETIC ' + id,
    cnpj: BigInt('0x' + id.replace(/-/g, '').slice(0, 10)).toString().padStart(14, '0') } });
}
const capture = (portal, extra = {}) => capturePgdasGuideForCompany({ portalClientId: portal.id, competencia, serviceId: 'GERARDAS12', ...extra });
async function seed(portal) {
  const r = response(); mockPost.mockResolvedValue(r.payload);
  const result = await capture(portal, { somenteDocumentos: true });
  return { r, guide: await db.guide.findUnique({ where: { id: result.guide.guideId } }) };
}

suite('DAS documentary persistence baseline 4.4.2 — PostgreSQL16', () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL);
    if (process.env.NODE_ENV !== 'test' || url.hostname !== '127.0.0.1' || url.pathname !== '/altan_piloto_governance_test' || url.search || url.hash) throw Error('Disposable pilot PostgreSQL required');
    const [actual] = await db.$queryRaw`SELECT current_database() AS name, current_user AS username, current_setting('server_version_num') AS version`;
    expect(actual.name).toBe(url.pathname.slice(1)); expect(actual.username).toBe(decodeURIComponent(url.username));
    expect(Number(actual.version)).toBeGreaterThanOrEqual(160000); expect(Number(actual.version)).toBeLessThan(170000);
  });
  beforeEach(() => {
    jest.restoreAllMocks(); jest.clearAllMocks(); mockPost.mockReset();
    SerproHttpClient.mockImplementation(() => ({ post: mockPost }));
    generateEntriesFromCircular.mockReset().mockResolvedValue({ ok: true, generatedEntries: [] });
    generateProvisionsFromGuide.mockReset().mockResolvedValue({ skipped: true });
  });
  afterAll(async () => { jest.restoreAllMocks(); await db.$disconnect(); });

  test('sourceFileId lookup updates the same document and preserves payment, proof and original amount', async () => {
    const portal = await company(), other = await company(), { r, guide } = await seed(portal);
    const paidAt = new Date('2026-11-10T12:00:00Z'), beforeRevision = new Date('2020-01-01T00:00:00Z');
    await db.guide.update({ where: { id: guide.id }, data: { paymentStatus: 'PAID', paymentStatusSource: 'MANUAL', paymentConfirmedAt: paidAt,
      extracted: { comprovante: { reference: 'synthetic-proof' }, recalculoGuia: { reference: 'previous-review' } }, updatedAt: beforeRevision } });
    const next = response(r.payload.numeroDocumento, 123.45); mockPost.mockResolvedValue(next.payload);
    const result = await capture(portal, { atualizar: true, somenteDocumentos: true });
    const after = await db.guide.findUnique({ where: { id: guide.id } });
    expect(result.guide.guideId).toBe(guide.id);
    expect(after).toMatchObject({ sourceFileId: guide.sourceFileId, portalClientId: portal.id, competencia, hash: hashPdf(next.bytes), paymentStatus: 'PAID', paymentStatusSource: 'MANUAL', paymentConfirmedAt: paidAt,
      extracted: { comprovante: { reference: 'synthetic-proof' }, recalculoGuia: { reference: 'previous-review' } } });
    expect(Number(after.valor)).toBe(123.45); expect(Number(after.valorOriginal)).toBe(100);
    expect(after.updatedAt.getTime()).toBeGreaterThan(beforeRevision.getTime());
    expect(after.vencimento.toISOString()).toBe('2026-11-20T00:00:00.000Z');
    expect(Buffer.from(after.pdfBytes)).toEqual(next.bytes);
    expect(await db.guide.count({ where: { portalClientId: other.id } })).toBe(0);
    const replay = await capture(portal);
    expect(replay.reutilizado).toBe(true); expect(mockPost).toHaveBeenCalledTimes(2);
  });

  test.each(['GERARDAS12', 'GERARDASCOBRANCA17'])('%s documentary mode preserves a closed circular; SERPRO writer does not apply upload closure guard', async serviceId => {
    const portal = await company(), closedAt = new Date('2026-11-11T12:00:00Z');
    const circular = await db.companyMonthlyCircular.create({ data: { portalClientId: portal.id, competencia, fechadoContabilEm: closedAt, dasTotal: 77, metadata: { fixture: 'closed' } } });
    const r = response(); mockPost.mockResolvedValue(r.payload);
    const result = await capture(portal, { serviceId, somenteDocumentos: true });
    expect(result.guide.guideId).toBeTruthy();
    expect(result.accounting).toEqual({ skipped: true, somenteDocumentos: true });
    const after = await db.companyMonthlyCircular.findUnique({ where: { id: circular.id } });
    expect(after.fechadoContabilEm).toEqual(closedAt); expect(Number(after.dasTotal)).toBe(77); expect(after.metadata).toEqual({ fixture: 'closed' });
    expect(generateEntriesFromCircular).not.toHaveBeenCalled();
  });

  test('CAS retries after independent payment writer wins and preserves its proof', async () => {
    const portal = await company(), { r, guide } = await seed(portal);
    const peer = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    const realUpdate = db.guide.updateMany.bind(db.guide), observed = [];
    const paidAt = new Date('2026-11-12T12:00:00Z');
    const spy = jest.spyOn(db.guide, 'updateMany').mockImplementation(async args => {
      observed.push(args);
      if (observed.length === 1) await peer.guide.update({ where: { id: guide.id }, data: { paymentStatus: 'PAID', paymentStatusSource: 'MANUAL', paymentConfirmedAt: paidAt,
        extracted: { comprovante: { reference: 'concurrent-payment' } }, updatedAt: new Date(args.where.updatedAt.getTime() + 1000) } });
      return realUpdate(args); // Actual SQL still decides the CAS result.
    });
    try {
      const next = response(r.payload.numeroDocumento, 200); mockPost.mockResolvedValue(next.payload);
      await capture(portal, { existingGuideId: guide.id, somenteDocumentos: true });
      expect(observed).toHaveLength(2);
      expect(observed[1].where.updatedAt.getTime()).toBe(observed[0].where.updatedAt.getTime() + 1000);
      for (const call of observed) { expect(call.where.id).toBe(guide.id); expect(call.data.paymentStatus).toBeUndefined(); }
      const after = await peer.guide.findUnique({ where: { id: guide.id } });
      expect(after).toMatchObject({ hash: hashPdf(next.bytes), paymentStatus: 'PAID', paymentConfirmedAt: paidAt, extracted: { comprovante: { reference: 'concurrent-payment' } } });
      expect(Number(after.valorOriginal)).toBe(100); expect(Number(after.valor)).toBe(200);
    } finally { spy.mockRestore(); await peer.$disconnect(); }
  });

  test('four real CAS conflicts preserve original document and return GUIA_ALTERADA', async () => {
    const portal = await company(), { r, guide } = await seed(portal);
    const peer = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    const realUpdate = db.guide.updateMany.bind(db.guide); let conflicts = 0;
    const spy = jest.spyOn(db.guide, 'updateMany').mockImplementation(async args => {
      conflicts++;
      await peer.guide.update({ where: { id: guide.id }, data: { updatedAt: new Date(args.where.updatedAt.getTime() + 1000) } });
      return realUpdate(args);
    });
    try {
      mockPost.mockResolvedValue(response(r.payload.numeroDocumento, 200).payload);
      await expect(capture(portal, { existingGuideId: guide.id, somenteDocumentos: true })).rejects.toMatchObject({ code: 'GUIA_ALTERADA', status: 409, message: 'A guia mudou durante a atualização. Confira e tente novamente.' });
      expect(conflicts).toBe(4);
      const after = await peer.guide.findUnique({ where: { id: guide.id } });
      expect(after.hash).toBe(guide.hash); expect(Number(after.valor)).toBe(100); expect(Buffer.from(after.pdfBytes)).toEqual(r.bytes);
      expect(await db.companyMonthlyCircular.count({ where: { portalClientId: portal.id } })).toBe(0);
      expect(generateEntriesFromCircular).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); await peer.$disconnect(); }
  });

  test('sourceFileId conflict after a valid response is not converted to successful update', async () => {
    const portal = await company(), first = await seed(portal);
    const second = response(); mockPost.mockResolvedValue(second.payload);
    const created = await capture(portal, { atualizar: true, somenteDocumentos: true });
    mockPost.mockResolvedValue(response(second.payload.numeroDocumento, 200).payload);
    await expect(capture(portal, { existingGuideId: first.guide.id, somenteDocumentos: true })).rejects.toMatchObject({ code: 'P2002' });
    expect(await db.guide.count({ where: { portalClientId: portal.id } })).toBe(2);
    const original = await db.guide.findUnique({ where: { id: first.guide.id } });
    expect(original.hash).toBe(first.guide.hash); expect(Number(original.valor)).toBe(100);
    expect((await db.guide.findUnique({ where: { id: created.guide.guideId } })).sourceFileId).not.toBe(original.sourceFileId);
  });

  test.each([true, false])('somenteDocumentos=%s preserves its existing duplicate-cleanup semantics, including paid previous guide', async somenteDocumentos => {
    const portal = await company(), { guide } = await seed(portal);
    await db.guide.update({ where: { id: guide.id }, data: { paymentStatus: 'PAID' } });
    mockPost.mockResolvedValue(response().payload);
    const result = await capture(portal, { atualizar: true, somenteDocumentos });
    expect(await db.guide.findUnique({ where: { id: guide.id } })).toEqual(somenteDocumentos ? expect.objectContaining({ paymentStatus: 'PAID' }) : null);
    expect(await db.guide.findUnique({ where: { id: result.guide.guideId } })).toMatchObject({ portalClientId: portal.id, competencia });
    expect(generateEntriesFromCircular).toHaveBeenCalledTimes(somenteDocumentos ? 0 : 1);
  });
});

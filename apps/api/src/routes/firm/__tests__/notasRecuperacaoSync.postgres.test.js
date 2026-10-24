import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { createNotasRouter } from '../notas.js';
import { processarDocumentoSyncLocal, upsertPortalInvoiceSafe, hashCanonico } from '../../../application/sync/ProcessadorDocumentoSyncLocal.js';
import { registrarDocumentoRecusado, recuperarDocumentoSync, consultarPendenciaSync } from '../../../application/sync/RecuperacaoDocumentoSyncService.js';
import { InvoiceSyncEngine } from '../../../application/sync/InvoiceSyncEngine.js';
import { xmlNfseData, CNPJ_DATAS, CHAVE_NFSE } from '../../../application/notas/__fixtures__/dataEmissaoNotas.js';
jest.mock('../../../application/nfse/AdnSyncService.js', () => ({ AdnSyncService: { fetchLote: jest.fn(async () => { throw Error('TRANSPORTE_PROIBIDO'); }) } }));
jest.mock('../../../infrastructure/storage/CertStorage.js', () => ({ readStoredCompanyPfx: jest.fn(async () => { throw Error('CERTIFICADO_PROIBIDO'); }) }));
import { AdnSyncService } from '../../../application/nfse/AdnSyncService.js';
jest.mock('../../../utils/crypto.js', () => ({ decryptSecret: jest.fn(async () => 'synthetic-only') }));
import { readStoredCompanyPfx } from '../../../infrastructure/storage/CertStorage.js';
jest.setTimeout(45000);
const url = process.env.DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) && new URL(url).pathname.endsWith('_governance_test');
const snapshot = (id, item = {}) => ({ clientId: id, origem: 'ADN_SYNC', cursor: '10', recebidoEm: '2026-10-23T00:00:00Z', motivo: 'P1001',
  item: { NSU: '11', ChaveAcesso: CHAVE_NFSE, ArquivoXml: Buffer.from(xmlNfseData()).toString('base64'), ...item } });
function app(user) {
  const a = express(); a.use(express.json());
  a.use((req, res, next) => { req.auth = user ? { user } : null; next(); });
  a.use('/firm/companies/:companyId', createNotasRouter({ log: {} })); return a;
}
(local ? describe : describe.skip)('administrative recovery, real PostgreSQL and real tenant middleware', () => {
  let clientId, user, application, prefix;
  beforeEach(async () => {
    clientId = randomUUID();
    await prisma.portalClient.create({ data: { id: clientId, cnpj: CNPJ_DATAS, razao: 'RECUPERACAO SINTETICA' } });
    user = await prisma.user.create({ data: { email: randomUUID() + '@example.invalid', passwordHash: 'not-a-login', role: 'user', accountType: 'FIRM' } });
    await prisma.companyFirmAccess.create({ data: { companyId: clientId, userId: user.id, role: 'ACCOUNTANT', status: 'ACTIVE' } });
    await prisma.portalSyncState.create({ data: { clientId, lastCursor: 10n, backoffUntil: new Date('2026-01-01'), lastSyncAt: new Date('2026-01-01') } });
    application = app(user); prefix = `/firm/companies/${clientId}/notas/sincronizacao`;
    AdnSyncService.fetchLote.mockClear(); readStoredCompanyPfx.mockClear();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    const errors = [];
    for (const cleanup of [
      () => prisma.syncDocumentoTentativa.deleteMany({ where: { clientId } }),
      () => prisma.syncDocumentoPendente.deleteMany({ where: { clientId } }),
      () => prisma.syncDocumentoEntrega.deleteMany({ where: { clientId } }),
      () => prisma.portalClient.deleteMany({ where: { id: clientId, razao: 'RECUPERACAO SINTETICA' } }),
      () => prisma.user.deleteMany({ where: { id: user.id, email: user.email } }),
    ]) { try { await cleanup(); } catch (error) { errors.push(error); } }
    expect(AdnSyncService.fetchLote).not.toHaveBeenCalled();
    expect(readStoredCompanyPfx).not.toHaveBeenCalled();
    if (errors.length) throw new AggregateError(errors, 'cleanup');
  });
  afterAll(async () => { await prisma.$disconnect(); });
  async function pending(item) {
    await registrarDocumentoRecusado(prisma, snapshot(clientId, item));
    return (await request(application).get(prefix + '/pendencia').expect(200)).body.pendencia;
  }
  const body = (p, key = randomUUID()) => ({ revisao: p.revisao, hash: p.hash, idempotencyKey: key, motivo: 'Revalidar documento persistido localmente' });
  const post = (p, input) => request(application).post(`${prefix}/pendencias/${p.id}/recuperar`).send(input || body(p));

  test('GET -> POST, local result, history, response replay, siblings and backoff/cursor preserved', async () => {
    const p = await pending();
    const state = await prisma.portalSyncState.findUnique({ where: { clientId } });
    const input = body(p);
    const response = await post(p, input).expect(200);
    expect(await post(p, input).expect(200)).toMatchObject({ body: response.body });
    expect(await prisma.portalInvoice.count({ where: { clientId } })).toBe(1);
    expect(await prisma.syncDocumentoTentativa.count({ where: { clientId, estado: 'SUCESSO' } })).toBe(1);
    const after = await prisma.portalSyncState.findUnique({ where: { clientId } });
    expect(after).toMatchObject({ lastCursor: state.lastCursor, backoffUntil: state.backoffUntil, lastSyncAt: state.lastSyncAt, documentoRecusado: null });
    expect((await request(application).get(prefix + '/pendencia').expect(200)).body.pendencia).toBeNull();
    const history = (await request(application).get(`${prefix}/pendencias/${p.id}`).expect(200)).body.pendencia;
    expect(history.estado).toBe('RESOLVIDA'); expect(history.tentativas[0].actorId).toBe(user.id);
    expect(JSON.stringify(history)).not.toContain('ArquivoXml');
    await post(p, { ...input, motivo: 'different' }).expect(409);
    const replay = await prisma.$transaction(tx => processarDocumentoSyncLocal(tx, snapshot(clientId)));
    expect(replay.action).toBe('duplicate');
    // A sibling at NSU 12 cannot disappear because recovery advanced to NSU+1.
    const key = CHAVE_NFSE.slice(0, -1) + '2';
    await prisma.$transaction(tx => processarDocumentoSyncLocal(tx, snapshot(clientId, { NSU: '12', ChaveAcesso: key,
      ArquivoXml: Buffer.from(xmlNfseData({ chave: key }).replace('<nNFSe>1</nNFSe>', '<nNFSe>2</nNFSe>')).toString('base64') })));
    expect(await prisma.portalInvoice.count({ where: { clientId } })).toBe(2);
    // Start eligibility is checked without allowing the scheduled task to run or any transport.
    const immediate = jest.spyOn(global, 'setImmediate').mockImplementation(() => 0);
    try { expect(await InvoiceSyncEngine.start({ clientId })).toMatchObject({ queued: true }); }
    finally { immediate.mockRestore(); }
  });

  test('simulated capture transient failure persists pending source, then actual GET/POST recovers without transport', async () => {
    const findPortal = prisma.portalClient.findUnique.bind(prisma);
    const portalSpy = jest.spyOn(prisma.portalClient, 'findUnique').mockImplementation(async args => {
      const value = await findPortal(args); return value ? { ...value, companyId: 'synthetic-certificate-company' } : value;
    });
    const companySpy = jest.spyOn(prisma.company, 'findUnique').mockResolvedValue({ certPasswordEnc: 'synthetic-only' });
    readStoredCompanyPfx.mockResolvedValue(Buffer.from('synthetic-only'));
    AdnSyncService.fetchLote.mockResolvedValue({ documentos: [snapshot(clientId).item] });
    const original = prisma.$transaction.bind(prisma);
    const injected = jest.fn();
    const transactionSpy = jest.spyOn(prisma, '$transaction').mockImplementation((cb, options) => original(tx => cb({ ...tx, $queryRaw: (...args) => tx.$queryRaw(...args), $executeRaw: (...args) => tx.$executeRaw(...args),
      syncDocumentoEntrega: { ...tx.syncDocumentoEntrega, create: async () => { injected(); throw Object.assign(Error('LOCAL_TRANSIENT'), { code: 'LOCAL_TRANSIENT' }); } },
    }), options));
    try {
      const job = await prisma.portalInvoiceSyncJob.create({ data: { clientId, state: 'RUNNING' } });
      await InvoiceSyncEngine.runJob({ clientId, jobId: job.id, maxIterations: 1 });
      expect(injected).toHaveBeenCalled();
      expect(AdnSyncService.fetchLote).toHaveBeenCalledTimes(1);
      expect(await prisma.portalInvoice.count({ where: { clientId } })).toBe(0);
      expect(await prisma.portalSyncState.findUnique({ where: { clientId } })).toMatchObject({ lastCursor: 10n,
        documentoRecusado: { motivo: 'LOCAL_TRANSIENT', item: { NSU: '11' } } });
    } finally {
      transactionSpy.mockRestore(); companySpy.mockRestore(); portalSpy.mockRestore();
      AdnSyncService.fetchLote.mockReset().mockImplementation(async () => { throw Error('TRANSPORTE_PROIBIDO'); });
      readStoredCompanyPfx.mockReset().mockImplementation(async () => { throw Error('CERTIFICADO_PROIBIDO'); });
    }
    const p = (await request(application).get(prefix + '/pendencia').expect(200)).body.pendencia;
    expect(p.classe).toBe('TRANSITORIA');
    await post(p).expect(200);
    expect(await prisma.portalInvoice.count({ where: { clientId } })).toBe(1);
  });
  test('legacy GET never writes; first POST materializes original snapshot and immutable token', async () => {
    const legacy = snapshot(clientId);
    await prisma.portalSyncState.update({ where: { clientId }, data: { documentoRecusado: legacy } });
    const before = await prisma.portalSyncState.findUnique({ where: { clientId } });
    const p = (await request(application).get(prefix + '/pendencia').expect(200)).body.pendencia;
    expect(p.legado).toBe(true);
    expect(await prisma.syncDocumentoPendente.count({ where: { clientId } })).toBe(0);
    expect(await prisma.portalSyncState.findUnique({ where: { clientId } })).toEqual(before);
    await post(p).expect(200);
    expect(await prisma.syncDocumentoPendente.findUnique({ where: { id: p.id } })).toMatchObject({ snapshot: legacy, snapshotHash: hashCanonico(legacy), estado: 'RESOLVIDA' });
  });

  test('real document contradiction remains pending with durable rejected attempt and no mutation', async () => {
    const p = await pending({ ChaveAcesso: '9'.repeat(50) });
    const input = body(p);
    await post(p, input).expect(409);
    await post(p, input).expect(409);
    expect(await prisma.portalInvoice.count({ where: { clientId } })).toBe(0);
    expect(await prisma.syncDocumentoTentativa.count({ where: { clientId, estado: 'REJEITADA' } })).toBe(1);
    expect((await prisma.portalSyncState.findUnique({ where: { clientId } })).documentoRecusado).not.toBeNull();
    expect(await InvoiceSyncEngine.start({ clientId })).toMatchObject({ queued: false, reason: 'DOCUMENTO_RECUSADO_PENDENTE' });
  });

  test.each(['audit', 'cas', 'delivery'])('%s failure rolls back invoice/identity/release, subsequent new key recovers', async mode => {
    const p = await pending();
    const original = prisma.$transaction.bind(prisma);
    const injected = jest.fn();
    const spy = jest.spyOn(prisma, '$transaction').mockImplementation((cb, options) => original(tx => cb({ ...tx, $queryRaw: (...args) => tx.$queryRaw(...args), $executeRaw: (...args) => tx.$executeRaw(...args),
      ...(mode === 'audit' ? { syncDocumentoTentativa: { ...tx.syncDocumentoTentativa, updateMany: async () => { injected(); throw Error('AUDIT_FAILURE'); } } } : {}),
      ...(mode === 'cas' ? { portalSyncState: { ...tx.portalSyncState, updateMany: async () => { injected(); return { count: 0 }; } } } : {}),
      ...(mode === 'delivery' ? { syncDocumentoEntrega: { ...tx.syncDocumentoEntrega, create: async () => { injected(); throw Error('TRANSIENT_FAILURE_AFTER_INVOICE'); } } } : {}),
    }), options));
    try { await post(p).expect(mode === 'cas' ? 409 : 500); expect(injected).toHaveBeenCalled(); } finally { spy.mockRestore(); }
    expect(await prisma.portalInvoice.count({ where: { clientId } })).toBe(0);
    expect(await prisma.syncDocumentoEntrega.count({ where: { clientId } })).toBe(0);
    expect((await prisma.portalSyncState.findUnique({ where: { clientId } })).documentoRecusado).not.toBeNull();
    expect(await prisma.syncDocumentoTentativa.count({ where: { clientId, estado: 'REJEITADA' } })).toBe(1);
    await post(p).expect(200);
  });

  test('two connections, one resolution, no event/invoice duplication', async () => {
    const p = await pending(), second = new PrismaClient();
    const input = body(p);
    try {
      const args = { clientId, pendenciaId: p.id, actorId: user.id, pedido: input };
      const responses = await Promise.all([recuperarDocumentoSync(prisma, args), recuperarDocumentoSync(second, args)]);
      expect(responses[0]).toEqual(responses[1]);
      expect(await prisma.portalInvoice.count({ where: { clientId } })).toBe(1);
      expect(await prisma.syncDocumentoTentativa.count({ where: { clientId } })).toBe(1);
    } finally { await second.$disconnect(); }
  });

  test('event after note: rollback before event, replay success, delivery conflict, legacy ambiguity', async () => {
    await prisma.$transaction(tx => processarDocumentoSyncLocal(tx, snapshot(clientId)));
    const noteBefore = await prisma.portalInvoice.findFirst({ where: { clientId } });
    const p = await pending({ NSU: '12', TipoDocumento: 'EVENTO', TipoEvento: 'E101101', ArquivoXml: null });
    const original = prisma.$transaction.bind(prisma);
    const injected = jest.fn();
    const spy = jest.spyOn(prisma, '$transaction').mockImplementation((cb, options) => original(tx => cb({ ...tx, $queryRaw: (...args) => tx.$queryRaw(...args), $executeRaw: (...args) => tx.$executeRaw(...args),
      portalInvoiceEvent: { ...tx.portalInvoiceEvent, create: async () => { injected(); throw Error('EVENT_FAILURE'); } },
    }), options));
    try { await post(p).expect(500); expect(injected).toHaveBeenCalled(); } finally { spy.mockRestore(); }
    expect(await prisma.portalInvoice.findFirst({ where: { clientId } })).toEqual(noteBefore);
    expect(await prisma.portalInvoiceEvent.count({ where: { clientId } })).toBe(0);
    await post(p).expect(200);
    const eventSnapshot = snapshot(clientId, { NSU: '12', TipoDocumento: 'EVENTO', TipoEvento: 'E101101', ArquivoXml: null });
    expect((await prisma.$transaction(tx => processarDocumentoSyncLocal(tx, eventSnapshot))).action).toBe('duplicate');
    expect(await prisma.portalInvoiceEvent.count({ where: { clientId } })).toBe(1);
    await expect(prisma.$transaction(tx => processarDocumentoSyncLocal(tx, { ...eventSnapshot,
      item: { ...eventSnapshot.item, TipoEvento: 'E105102' } }))).rejects.toMatchObject({ code: 'NSU_CONTEUDO_CONFLITANTE' });
    await prisma.syncDocumentoEntrega.deleteMany({ where: { clientId, nsu: '12' } });
    expect((await prisma.$transaction(tx => processarDocumentoSyncLocal(tx, eventSnapshot))).action).toBe('duplicate');
    await prisma.syncDocumentoEntrega.deleteMany({ where: { clientId, nsu: '12' } });
    await prisma.portalInvoiceEvent.updateMany({ where: { clientId }, data: { payloadRaw: { nsu: '12', tipoDocumento: 'EVENTO', tipoEvento: 'E101101' } } });
    await expect(prisma.$transaction(tx => processarDocumentoSyncLocal(tx, eventSnapshot))).rejects.toMatchObject({ code: 'EVENTO_LEGADO_REQUER_CONFERENCIA' });
    expect(await prisma.portalInvoiceEvent.count({ where: { clientId } })).toBe(1);
  });

  test('lost commit response returns persisted success', async () => {
    const p = await pending(), input = body(p);
    const original = prisma.$transaction.bind(prisma); let call = 0;
    const spy = jest.spyOn(prisma, '$transaction').mockImplementation(async (cb, options) => {
      const result = await original(cb, options);
      if (++call === 2) throw Error('COMMIT_RESPONSE_LOST');
      return result;
    });
    try { await post(p, input).expect(200); } finally { spy.mockRestore(); }
    expect(await prisma.syncDocumentoTentativa.count({ where: { clientId, estado: 'SUCESSO' } })).toBe(1);
    await post(p, input).expect(200);
  });

  test('crash after durable reservation resumes only with the same fingerprint', async () => {
    const p = await pending(), input = body(p);
    const original = prisma.$transaction.bind(prisma); let first = true;
    const spy = jest.spyOn(prisma, '$transaction').mockImplementation(async (cb, options) => {
      const result = await original(cb, options);
      if (first) { first = false; throw Error('CRASH_AFTER_RESERVATION'); }
      return result;
    });
    try { await post(p, input).expect(500); } finally { spy.mockRestore(); }
    expect(await prisma.syncDocumentoTentativa.count({ where: { clientId, estado: 'EM_ANDAMENTO' } })).toBe(1);
    expect(await prisma.portalInvoice.count({ where: { clientId } })).toBe(0);
    await post(p, { ...input, motivo: 'changed fingerprint' }).expect(409);
    await post(p, input).expect(200);
    expect(await prisma.syncDocumentoTentativa.count({ where: { clientId } })).toBe(1);
  });

  test('failure in success audit and rejection audit preserves both errors, reservation and source', async () => {
    const p = await pending(), input = body(p);
    const original = prisma.$transaction.bind(prisma);
    const injected = jest.fn();
    const spy = jest.spyOn(prisma, '$transaction').mockImplementation((cb, options) => original(tx => cb({ ...tx, $queryRaw: (...args) => tx.$queryRaw(...args), $executeRaw: (...args) => tx.$executeRaw(...args),
      syncDocumentoTentativa: { ...tx.syncDocumentoTentativa,
        updateMany: async () => { injected(); throw Object.assign(Error('PRIMARY'), { code: 'PRIMARY' }); },
        update: async () => { injected(); throw Object.assign(Error('SECONDARY'), { code: 'SECONDARY' }); },
      },
    }), options));
    try {
      const response = await post(p, input).expect(500);
      expect(injected).toHaveBeenCalledTimes(2);
      expect(response.body).toMatchObject({ auditoria: 'PENDENTE', erroOriginal: 'PRIMARY', erroAuditoria: 'SECONDARY' });
    } finally { spy.mockRestore(); }
    expect(await prisma.portalInvoice.count({ where: { clientId } })).toBe(0);
    expect(await prisma.syncDocumentoTentativa.findFirst({ where: { clientId } })).toMatchObject({ estado: 'EM_ANDAMENTO', codigo: 'PRIMARY', erroSecundario: 'SECONDARY' });
    await post(p, input).expect(200);
  });

  test('non-cooperating second connection replaces active snapshot: CAS never erases it', async () => {
    const p = await pending(), second = new PrismaClient();
    const replacement = snapshot(clientId, { NSU: '99' });
    const original = prisma.$transaction.bind(prisma); let replaced = false;
    const spy = jest.spyOn(prisma, '$transaction').mockImplementation((cb, options) => original(tx => cb({ ...tx, $queryRaw: (...args) => tx.$queryRaw(...args), $executeRaw: (...args) => tx.$executeRaw(...args),
      portalSyncState: { ...tx.portalSyncState, updateMany: async args => {
        if (!replaced) {
          replaced = true;
          await second.portalSyncState.update({ where: { clientId }, data: { documentoRecusado: replacement, syncDocumentoPendenteId: null } });
        }
        return tx.portalSyncState.updateMany(args);
      } },
    }), options));
    try { await post(p).expect(409); expect(replaced).toBe(true); } finally { spy.mockRestore(); await second.$disconnect(); }
    expect(await prisma.portalInvoice.count({ where: { clientId } })).toBe(0);
    expect((await prisma.portalSyncState.findUnique({ where: { clientId } })).documentoRecusado).toEqual(replacement);
  });

  test('persisted closed fiscal/accounting period and legacy issueDate remain intact', async () => {
    const invoice = await upsertPortalInvoiceSafe({ client: prisma, clientId, data: { type: 'NFSE', status: 'EMITIDA',
      chaveAcesso: CHAVE_NFSE, idNfse: '1', emitenteDoc: CNPJ_DATAS, xmlRaw: xmlNfseData(),
      competencia: new Date('2026-08-01'), issueDate: new Date('2026-08-31'), total: 100 } });
    const circular = await prisma.companyMonthlyCircular.create({ data: { portalClientId: clientId,
      competencia: '2026-08', estado: 'fechado', fechadoContabilEm: new Date('2026-09-01'), receitaBruta: 100 } });
    const entry = await prisma.accountingEntry.create({ data: { portalClientId: clientId, circularId: circular.id,
      competencia: '2026-08', data: new Date('2026-08-31'), historico: 'Sintético fechado', tipo: 'RECEITA', status: 'CONFIRMADO',
      lines: { create: [{ conta: '1.1', tipo: 'D', valor: 100 }, { conta: '3.1', tipo: 'C', valor: 100 }] } }, include: { lines: true } });
    const p = await pending({ ArquivoXml: Buffer.from(xmlNfseData({ data: '2026-10-01T00:00:00Z' })).toString('base64') });
    await post(p).expect(409);
    expect((await prisma.portalSyncState.findUnique({ where: { clientId } })).documentoRecusado).not.toBeNull();
    const saved = await prisma.portalInvoice.findUnique({ where: { id: invoice.invoiceId } });
    for (const key of ['xmlRaw', 'issueDate', 'competencia', 'total']) expect(saved[key]).toEqual(invoice.invoice[key]);
    expect(await prisma.companyMonthlyCircular.findUnique({ where: { id: circular.id } })).toEqual(circular);
    expect(await prisma.accountingEntry.findUnique({ where: { id: entry.id }, include: { lines: true } })).toEqual(entry);
  });
  test('unauthorized, STAFF, removed link, other tenant, injected actor/XML and stale revision', async () => {
    const p = await pending();
    await request(app(null)).get(prefix + '/pendencia').expect(401);
    await request(app(null)).post(`${prefix}/pendencias/${p.id}/recuperar`).send(body(p)).expect(401);
    for (const patch of [{ role: 'STAFF' }, { role: 'ACCOUNTANT', status: 'REMOVED' }]) {
      await prisma.companyFirmAccess.update({ where: { companyId_userId: { companyId: clientId, userId: user.id } }, data: patch });
      await request(application).get(prefix + '/pendencia').expect(403);
      await post(p).expect(403);
    }
    await prisma.companyFirmAccess.update({ where: { companyId_userId: { companyId: clientId, userId: user.id } }, data: { role: 'ACCOUNTANT', status: 'ACTIVE' } });
    await request(application).get(`/firm/companies/${randomUUID()}/notas/sincronizacao/pendencia`).expect(403);
    await request(app({ id: user.id, role: 'admin' })).post(`/firm/companies/${randomUUID()}/notas/sincronizacao/pendencias/${p.id}/recuperar`).send(body(p)).expect(404);
    for (const field of ['actorId', 'xml', 'override', 'companyId']) await post(p, { ...body(p), [field]: 'injected' }).expect(400);
    await post(p, { ...body(p), revisao: 'stale' }).expect(409);
    expect(await prisma.portalInvoice.count({ where: { clientId } })).toBe(0);
  });
});

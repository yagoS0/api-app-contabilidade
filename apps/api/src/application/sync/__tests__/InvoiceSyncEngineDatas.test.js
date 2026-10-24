import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { xmlNfseData, CHAVE_NFSE, CNPJ_DATAS } from '../../notas/__fixtures__/dataEmissaoNotas.js';
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {
  portalClient: { findUnique: jest.fn() }, company: { findUnique: jest.fn() },
  portalInvoice: { findUnique: jest.fn() },
  portalSyncState: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  syncDocumentoPendente: { create: jest.fn(async ({ data }) => data) },
  syncDocumentoEntrega: { findUnique: jest.fn(async () => null) },
  portalInvoiceSyncJob: { update: jest.fn() }, $transaction: jest.fn(),
} }));
jest.mock('../../nfse/AdnSyncService.js', () => ({ AdnSyncService: { fetchLote: jest.fn() } }));
jest.mock('../../../infrastructure/storage/CertStorage.js', () => ({ readStoredCompanyPfx: jest.fn(async () => Buffer.from('synthetic')) }));
jest.mock('../../../utils/crypto.js', () => ({ decryptSecret: jest.fn(async () => 'synthetic') }));
import { prisma } from '../../../infrastructure/db/prisma.js';
import { AdnSyncService } from '../../nfse/AdnSyncService.js';
import { upsertPortalInvoiceSafe, InvoiceSyncEngine } from '../InvoiceSyncEngine.js';
import { processarDocumentoSyncLocal } from '../ProcessadorDocumentoSyncLocal.js';
const otherKey = '9'.repeat(50);
const incoming = () => ({ type: 'NFSE', idDps: 'DPS1', competencia: new Date('2026-08-01'), chaveAcesso: CHAVE_NFSE, xmlRaw: xmlNfseData(), emitenteDoc: CNPJ_DATAS, status: 'EMITIDA' });
function memory(rows) {
  const db = { $executeRaw: jest.fn(async () => 1), portalClient: { findUnique: async () => ({ cnpj: CNPJ_DATAS }) },
    companyMonthlyCircular: { findUnique: async () => null, findFirst: async () => null },
    apuracaoSnapshot: { findUnique: async () => null }, apuracao: { findUnique: async () => null },
    syncDocumentoEntrega: { findUnique: async () => null, create: async () => ({}) },
    portalInvoiceEvent: { findMany: async () => [], create: async () => ({ id: 'event' }) },
    portalInvoice: {
      findUnique: jest.fn(async ({ where }) => { const scope = Object.values(where)[0]; return rows.find(row => Object.entries(scope).every(([key, value]) => row[key] === value)) || null; }),
      updateMany: jest.fn(async ({ where, data }) => { const row = rows.find(r => r.id === where.id); Object.assign(row, data); return { count: 1 }; }),
      findFirst: async ({ where }) => rows.find(r => r.id === where.id && r.clientId === where.clientId),
      create: jest.fn(async ({ data }) => ({ id: 'new', ...data })),
    },
  }; db.$transaction = jest.fn(cb => cb(db)); return db;
}
test.each([
  { chaveAcesso: otherKey, xmlRaw: xmlNfseData({ chave: otherKey }) },
  { xmlRaw: xmlNfseData({ chave: otherKey }) },
  { chaveAcesso: null, xmlRaw: xmlNfseData({ chave: otherKey }) },
])('same DPS rejects contradictory XML/key before any mutation: %j', patch => {
  const rows = [{ id: 'n', clientId: 'a', ...incoming() }];
  const db = memory(rows), before = JSON.stringify(rows);
  return expect(upsertPortalInvoiceSafe({ clientId: 'a', data: { ...incoming(), ...patch }, client: db }))
    .rejects.toMatchObject({ code: 'IDENTIDADE_DOCUMENTAL_CONFLITANTE' }).then(() => {
      expect(JSON.stringify(rows)).toBe(before); expect(db.portalInvoice.updateMany).not.toHaveBeenCalled();
    });
});
test('all scoped aliases are resolved; two rows cannot merge by first match', async () => {
  const rows = [{ id: 'x', clientId: 'a', ...incoming(), chaveAcesso: null, xmlRaw: null },
    { id: 'y', clientId: 'a', ...incoming(), idDps: null }];
  const db = memory(rows);
  await expect(upsertPortalInvoiceSafe({ clientId: 'a', data: incoming(), client: db })).rejects.toMatchObject({ code: 'IDENTIDADE_DOCUMENTAL_CONFLITANTE' });
  expect(db.portalInvoice.findUnique.mock.calls.every(([args]) => Object.values(args.where)[0].clientId === 'a')).toBe(true);
  expect(db.portalInvoice.updateMany).not.toHaveBeenCalled();
});
test('canonical equivalent and legitimate event without XML retain the document', async () => {
  const row = { id: 'n', clientId: 'a', ...incoming(), chaveAcesso: `NFS${CHAVE_NFSE}` };
  const db = memory([row]);
  await processarDocumentoSyncLocal(db, { clientId: 'a', origem: 'ADN_SYNC', item: {
    NSU: '1', TipoDocumento: 'EVENTO', TipoEvento: 'E101101', ChaveAcesso: CHAVE_NFSE,
  } });
  expect(row.xmlRaw).toBe(xmlNfseData()); expect(row.status).toBe('CANCELADA');
  expect(db.portalInvoice.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'n', clientId: 'a', status: 'EMITIDA' });
  expect(db.portalInvoice.updateMany.mock.calls[0][0].data).toEqual({ status: 'CANCELADA' });
});
test.each(['FONTE_ALTERADA', 'P2002', 'P2034'])('local retry is bounded for %s', async code => {
  const db = { $transaction: jest.fn(async () => { throw Object.assign(Error(code), { code }); }) };
  await expect(upsertPortalInvoiceSafe({ clientId: 'a', data: incoming(), client: db })).rejects.toMatchObject({ code });
  expect(db.$transaction).toHaveBeenCalledTimes(3);
});
test('service persists rejected source and keeps cursor; next start makes no external call', async () => {
  const state = { clientId: 'a', lastCursor: 10n, state: 'OK', updatedAt: new Date('2026-10-23T00:00:00Z') };
  prisma.$transaction.mockImplementation(cb => cb(prisma));
  prisma.portalSyncState.updateMany.mockImplementation(async ({ where, data }) => {
    expect(where.clientId).toBe('a'); expect(where.updatedAt).toEqual(state.updatedAt);
    Object.assign(state, data); return { count: 1 };
  });
  prisma.portalSyncState.findUnique.mockImplementation(async () => state);
  prisma.portalSyncState.update.mockImplementation(async ({ data }) => Object.assign(state, data));
  prisma.portalClient.findUnique.mockResolvedValue({ id: 'a', cnpj: CNPJ_DATAS, companyId: 'co' });
  prisma.company.findUnique.mockResolvedValue({ id: 'co', certPasswordEnc: 'synthetic' });
  prisma.portalInvoice.findUnique.mockImplementation(async ({ where }) => {
    const scope = Object.values(where)[0];
    return scope.chaveAcesso === otherKey ? { id: 'n', clientId: 'a', chaveAcesso: otherKey } : null;
  });
  AdnSyncService.fetchLote.mockResolvedValue({ documentos: [{ NSU: '11', ChaveAcesso: otherKey, ArquivoXml: Buffer.from(xmlNfseData()).toString('base64') }] });
  await InvoiceSyncEngine.runJob({ clientId: 'a', jobId: 'job', maxIterations: 1 });
  expect(state.lastCursor).toBe(10n); expect(state.state).toBe('ERROR');
  expect(state.documentoRecusado).toMatchObject({ clientId: 'a', cursor: '10', motivo: 'IDENTIDADE_DOCUMENTAL_CONFLITANTE', item: { NSU: '11' } });
  expect(await InvoiceSyncEngine.start({ clientId: 'a', resetCursor: true })).toMatchObject({ reason: 'DOCUMENTO_RECUSADO_PENDENTE', queued: false });
  expect(AdnSyncService.fetchLote).toHaveBeenCalledTimes(1);
});

const url = process.env.DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) && new URL(url).pathname.endsWith('_governance_test');
(local ? describe : describe.skip)('CAS PostgreSQL with non-cooperating writer', () => {
  test('second connection changes source after first read; retry rereads and refuses contradiction', async () => {
    const a = new PrismaClient(), b = new PrismaClient();
    const clientId = randomUUID(); let created = false, changed = false; const errors = [];
    try {
      await a.portalClient.create({ data: { id: clientId, cnpj: CNPJ_DATAS, razao: 'SYNC CAS SINTETICO' } }); created = true;
      let inserted = false, creationAttempts = 0;
      const concurrentCreator = { $transaction: (cb, options) => {
        creationAttempts += 1;
        return a.$transaction(tx => cb({ ...tx, $queryRaw: (...args) => tx.$queryRaw(...args), $executeRaw: (...args) => tx.$executeRaw(...args), portalInvoice: {
          findUnique: args => tx.portalInvoice.findUnique(args), findFirst: args => tx.portalInvoice.findFirst(args),
          updateMany: args => tx.portalInvoice.updateMany(args),
          create: async args => {
            if (!inserted) { inserted = true; await b.portalInvoice.create(args); }
            return tx.portalInvoice.create(args);
          },
        } }), { ...options, timeout: options?.timeout ?? 15000 });
      } };
      const creation = await upsertPortalInvoiceSafe({ clientId, data: incoming(), client: concurrentCreator });
      expect(creation.action).toBe('updated'); expect(creationAttempts).toBe(2);
      expect(await a.portalInvoice.count({ where: { clientId } })).toBe(1);
      const note = creation.invoice;
      const client = { $transaction: (cb, options) => a.$transaction(tx => cb({ ...tx, $queryRaw: (...args) => tx.$queryRaw(...args), $executeRaw: (...args) => tx.$executeRaw(...args), portalInvoice: {
        findUnique: args => tx.portalInvoice.findUnique(args), findFirst: args => tx.portalInvoice.findFirst(args),
        updateMany: async args => {
          if (!changed) {
            changed = true;
            // Deliberately no advisory lock: this commit is the synchronization barrier.
            await b.portalInvoice.update({ where: { id: note.id }, data: { chaveAcesso: otherKey, xmlRaw: xmlNfseData({ chave: otherKey }) } });
          }
          return tx.portalInvoice.updateMany(args);
        },
      } }), { ...options, timeout: options?.timeout ?? 15000 }) };
      await expect(upsertPortalInvoiceSafe({ clientId, data: incoming(), client })).rejects.toMatchObject({ code: 'IDENTIDADE_DOCUMENTAL_CONFLITANTE' });
      expect(changed).toBe(true);
      expect(await b.portalInvoice.findUnique({ where: { id: note.id } })).toMatchObject({ chaveAcesso: otherKey, xmlRaw: xmlNfseData({ chave: otherKey }), status: 'EMITIDA' });
    } catch (error) { errors.push(error); }
    finally {
      try { if (created) await a.portalClient.deleteMany({ where: { id: clientId, razao: 'SYNC CAS SINTETICO' } }); } catch (error) { errors.push(error); }
      for (const r of await Promise.allSettled([a.$disconnect(), b.$disconnect()])) if (r.status === 'rejected') errors.push(r.reason);
    }
    if (errors.length) throw new AggregateError(errors, 'CAS/limpeza', { cause: errors[0] });
  }, 40000);
});

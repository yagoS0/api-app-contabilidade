import { bloquearDocumentosDaEmpresa } from "../persistirDocumentoNota.js";
import express from 'express';
import request from 'supertest';
import { prisma as routePrisma } from '../../../infrastructure/db/prisma.js';
import { createPortalInvoicesRouter } from '../../../routes/portalInvoices.js';
import { upsertNfseFromItem } from '../ingestaoNfse.js';
import { upsertPortalInvoiceSafe } from '../../sync/InvoiceSyncEngine.js';
import { xmlNfseData, CNPJ_DATAS, CHAVE_NFSE } from '../__fixtures__/dataEmissaoNotas.js';
jest.mock('../../../routes/middlewares/portalAccess.js', () => ({ ensurePortalClientAccess: jest.fn(async () => ({ ok: true })) }));
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { reconciliarDatasNotas } from '../reconciliarDatasNotas.js';

const url = process.env.DATABASE_URL;
const local = url && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname) && new URL(url).pathname.endsWith('_governance_test');
const suite = local ? describe : describe.skip;
suite('datas de notas em PostgreSQL loopback, rollback integral', () => {
  test('migration, >100 rows, civil range, unknown, scoped dry-run/write/idempotence and unchanged fiscal fields', async () => {
    const prisma = new PrismaClient();
    const rollback = new Error('ROLLBACK_TESTE_DATAS');
    try {
      await expect(prisma.$transaction(async tx => {
        const clientId = randomUUID();
        await tx.portalClient.create({ data: { id: clientId, razao: 'TESTE DESCARTAVEL DATAS', cnpj: CNPJ_DATAS } });
        const xml = xmlNfseData();
        const rows = Array.from({ length: 121 }, (_, i) => ({ id: randomUUID(), clientId, type: 'NFSE', status: 'EMITIDA', chaveAcesso: CHAVE_NFSE.slice(0, -4) + String(i + 1).padStart(4, '0'), emitenteDoc: CNPJ_DATAS,
          xmlRaw: i === 120 ? null : xmlNfseData({ chave: CHAVE_NFSE.slice(0, -4) + String(i + 1).padStart(4, '0') }),
          issueDate: new Date('2026-09-27T00:00:00Z'), competencia: new Date('2026-08-01'), competenciaPosFechamento: true }));
        await tx.portalInvoice.createMany({ data: rows });
        const circular = await tx.companyMonthlyCircular.create({ data: { portalClientId: clientId, competencia: '2026-08', estado: 'fechado',
          receitaBruta: 1234, receitaServicos: 1234, fechadoContabilEm: new Date('2026-09-01'), lockedAt: new Date('2026-09-01') } });
        const entry = await tx.accountingEntry.create({ data: { portalClientId: clientId, circularId: circular.id, competencia: '2026-08',
          data: new Date('2026-08-31'), historico: 'Receita sintética fechada', tipo: 'RECEITA', status: 'CONFIRMADO',
          lines: { create: [{ conta: '1.1', tipo: 'D', valor: 1234 }, { conta: '3.1', tipo: 'C', valor: 1234 }] } }, include: { lines: true } });
        const args = { clientId, ids: rows.map(r => r.id) };
        expect((await reconciliarDatasNotas(tx, args)).contagens).toEqual({ DIFERENCA: 120, INDETERMINADA: 1 });
        expect(await tx.portalInvoice.count({ where: { clientId, dataEmissaoCivil: { not: null } } })).toBe(0);
        expect((await reconciliarDatasNotas(tx, { ...args, aplicar: true, confirmarBancoDescartavel: true })).contagens).toEqual({ APLICADA: 120, INDETERMINADA: 1 });
        expect((await reconciliarDatasNotas(tx, args)).contagens).toEqual({ SEM_ALTERACAO: 120, INDETERMINADA: 1 });
        const where = { clientId, dataEmissaoCivil: { gte: '2026-09-28', lte: '2026-09-28' } };
        expect(await tx.portalInvoice.count({ where })).toBe(120);
        expect(await tx.portalInvoice.findMany({ where, take: 100, skip: 100 })).toHaveLength(20);
        const saved = await tx.portalInvoice.findUnique({ where: { id: rows[0].id } });
        expect(saved.issueDate).toEqual(rows[0].issueDate); expect(saved.competencia).toEqual(rows[0].competencia);
        expect(saved.competenciaPosFechamento).toBe(true);
        const original = await tx.portalInvoice.findUnique({ where: { id: rows[0].id } });
        const changedXml = xmlNfseData({ chave: original.chaveAcesso, data: '2027-01-01T00:00:00Z' });
        await upsertNfseFromItem(tx, { portalClientId: clientId, companyCnpj: CNPJ_DATAS, xmlPlain: changedXml,
          metadata: { chaveAcesso: original.chaveAcesso, numeroNfse: '1', cnpjPrestador: CNPJ_DATAS,
            competencia: new Date('2026-12-01'), dataEmissao: new Date('2027-01-01'), valorServicos: 9999 } });
        await expect(upsertPortalInvoiceSafe({ clientId, client: { $transaction: cb => cb(tx) },
          data: { ...original, xmlRaw: changedXml, total: 9999, competencia: new Date('2026-12-01'), issueDate: new Date('2027-01-01') } }))
          .rejects.toMatchObject({ code: 'MES_CONTABIL_FECHADO_REQUER_REVISAO', status: 409 });
        expect(await tx.portalInvoice.findUnique({ where: { id: original.id } })).toMatchObject({
          issueDate: original.issueDate, competencia: original.competencia, total: original.total, xmlRaw: original.xmlRaw });
        // Exercise the actual HTTP reparse handler against the persisted closed period.
        const app = express();
        app.use(express.json());
        app.use('/clients/:clientId/invoices', createPortalInvoicesRouter({ ensureAuthorized: async req => {
          req.auth = { user: { id: 'contador-sintetico', role: 'admin' } }; return true;
        }, log: { error: jest.fn() } }));
        const transaction = jest.spyOn(routePrisma, '$transaction').mockImplementation(cb => cb(tx));
        try {
          const reparse = await request(app).post(`/clients/${clientId}/invoices/${original.id}/reparse`);
          expect(reparse.status).toBe(200);
          expect(reparse.body.ok).toBe(true);
        } finally { transaction.mockRestore(); }
        expect(await tx.companyMonthlyCircular.findUnique({ where: { id: circular.id } })).toEqual(circular);
        expect(await tx.accountingEntry.findUnique({ where: { id: entry.id }, include: { lines: true } })).toEqual(entry);
        const final = await tx.portalInvoice.findUnique({ where: { id: original.id } });
        expect(final.issueDate).toEqual(original.issueDate);
        expect(final.competencia).toEqual(original.competencia);
        expect(final.total).toEqual(original.total);
        throw rollback;
      }, { timeout: 30000 })).rejects.toBe(rollback);
    } finally { await prisma.$disconnect(); }
  }, 40000);
});

suite('concorrência documental em duas sessões descartáveis', () => {
  test.each(['ingestao-primeiro', 'backfill-primeiro', 'falha-parcial', 'falha-antes-ready', 'falha-antes-started', 'falha-depois-started', 'falhas-multiplas'])('%s mantém fonte forte e identidade', async order => {
    const first = new PrismaClient(), second = new PrismaClient();
    const clientId = randomUUID(), notaId = randomUUID();
    const pending = [], createdIds = [], errors = [];
    const injected = new Error(`INJETADA:${order}`);
    const observe = promise => { pending.push(promise); promise.catch(() => {}); return promise; };
    let firstTx, secondPid;
    let unlock;
    const gate = new Promise(resolve => { unlock = resolve; });
    let locked;
    const ready = new Promise(resolve => { locked = resolve; });
    try {
      await first.portalClient.create({ data: { id: clientId, razao: 'CONCORRENCIA SINTETICA', cnpj: CNPJ_DATAS } });
      createdIds.push(clientId);
      if (order === 'falha-parcial') throw injected;
      await first.portalInvoice.create({ data: { id: notaId, clientId, type: 'NFSE', chaveAcesso: CHAVE_NFSE,
        emitenteDoc: CNPJ_DATAS, xmlRaw: xmlNfseData(), status: 'EMITIDA', issueDate: new Date('2026-08-01'), competencia: new Date('2026-08-01') } });
      const backfill = tx => reconciliarDatasNotas(tx, { clientId, ids: [notaId], aplicar: true, confirmarBancoDescartavel: true });
      const ingest = tx => upsertNfseFromItem(tx, { portalClientId: clientId, companyCnpj: CNPJ_DATAS,
        xmlPlain: null, metadata: { chaveAcesso: CHAVE_NFSE, numeroNfse: '1', cnpjPrestador: CNPJ_DATAS,
          competencia: new Date('2026-08-01'), dataEmissao: new Date('2026-10-01'), valorServicos: 0 } });
      const a = observe(first.$transaction(async tx => {
        firstTx = tx;
        if (['falha-antes-ready', 'falhas-multiplas'].includes(order)) throw injected;
        await bloquearDocumentosDaEmpresa(tx, clientId);
        locked(); await gate;
        return order === 'ingestao-primeiro' ? ingest(tx) : backfill(tx);
      }, { timeout: 15000 }));
      await Promise.race([ready, a.then(() => { throw Error('A terminou antes da barreira'); })]);
      let started;
      const startedPromise = new Promise(resolve => { started = resolve; });
      const b = observe(second.$transaction(async tx => {
        if (order === 'falha-antes-started') throw injected;
        const [backend] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
        secondPid = backend.pid;
        started();
        if (order === 'falha-depois-started') throw injected;
        return order === 'ingestao-primeiro' ? backfill(tx) : ingest(tx);
      }, { timeout: 15000 }));
      await Promise.race([startedPromise, b.then(() => { throw Error('B terminou antes da barreira'); })]);
      // Observe the server's wait graph, not merely entry into the JS callback.
      const deadline = Date.now() + 5000;
      let blocked = false;
      while (Date.now() < deadline && !blocked) {
        const [row] = await Promise.race([firstTx.$queryRaw`SELECT cardinality(pg_blocking_pids(${secondPid}::int)) > 0 AS blocked`,
          b.then(() => { throw Error('B concluiu sem contenção'); })]);
        blocked = row.blocked;
      }
      expect(blocked).toBe(true);
      unlock();
      await Promise.all([a, b]);
      const saved = await first.portalInvoice.findUnique({ where: { id: notaId } });
      expect(saved.xmlRaw).toBe(xmlNfseData());
      expect(saved.dataEmissaoCivil).toBe('2026-09-28');
      expect(saved.dataEmissaoEvidencia.identidadeConferida).toBe(true);
      expect(saved.issueDate).toEqual(new Date('2026-08-01'));
      expect(saved.competencia).toEqual(new Date('2026-08-01'));
    } catch (error) { errors.push(error); }
    finally {
      unlock?.();
      const settled = await Promise.allSettled(pending);
      for (const result of settled) if (result.status === 'rejected' && !errors.includes(result.reason)) errors.push(result.reason);
      try {
        if (createdIds.length) await first.portalClient.deleteMany({ where: { id: { in: createdIds }, razao: 'CONCORRENCIA SINTETICA' } });
      } catch (error) { errors.push(error); }
      if (order === 'falhas-multiplas') errors.push(new Error('LIMPEZA_INJETADA'));
      const disconnected = await Promise.allSettled([first.$disconnect(), second.$disconnect()]);
      for (const result of disconnected) if (result.status === 'rejected') errors.push(result.reason);
      if (order === 'falhas-multiplas') errors.push(new Error('DESCONEXAO_INJETADA'));
    }
    if (order.startsWith('falha')) {
      const failure = errors.length === 1 ? errors[0] : new AggregateError(errors, 'Falha primária e falhas de limpeza', { cause: errors[0] });
      expect(errors[0]).toBe(injected);
      if (order === 'falhas-multiplas') {
        expect(failure.cause).toBe(injected);
        expect(failure.errors.map(error => error.message)).toEqual([injected.message, 'LIMPEZA_INJETADA', 'DESCONEXAO_INJETADA']);
      } else expect(failure).toBe(injected);
      // Reconnect only to verify cleanup, including partial fixture creation.
      try { expect(await first.portalClient.count({ where: { id: clientId } })).toBe(0); }
      finally { await first.$disconnect(); }
      return;
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, 'Falha primária e falhas de limpeza', { cause: errors[0] });
  }, 40000);
});

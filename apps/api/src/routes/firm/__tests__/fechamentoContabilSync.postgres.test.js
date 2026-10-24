import express from 'express';
import { tipoLinhaDaBaixa } from '../../../application/accounting/tipoLinhaBaixa.js';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { createAccountingEntriesRouter } from '../accountingEntries.js';
import { createNotasRouter } from '../notas.js';
import { processarDocumentoSyncLocal, upsertPortalInvoiceSafe } from '../../../application/sync/ProcessadorDocumentoSyncLocal.js';
import { registrarDocumentoRecusado, consultarPendenciaSync, recuperarDocumentoSync } from '../../../application/sync/RecuperacaoDocumentoSyncService.js';
import { estadoCorrecaoTx } from '../../../application/accounting/CorrecaoMesContabilService.js';
import { InvoiceSyncEngine } from '../../../application/sync/InvoiceSyncEngine.js';
import { xmlNfseData, CHAVE_NFSE, CNPJ_DATAS } from '../../../application/notas/__fixtures__/dataEmissaoNotas.js';

jest.mock('../../../application/nfse/AdnSyncService.js', () => ({ AdnSyncService: { fetchLote: jest.fn() } }));
jest.mock('../../../infrastructure/storage/CertStorage.js', () => ({ readStoredCompanyPfx: jest.fn() }));
jest.mock('../../../utils/crypto.js', () => ({ decryptSecret: jest.fn(async () => 'synthetic') }));
import { AdnSyncService } from '../../../application/nfse/AdnSyncService.js';
import { readStoredCompanyPfx } from '../../../infrastructure/storage/CertStorage.js';

const url = process.env.DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)
  && new URL(url).pathname.endsWith('_governance_test');
jest.setTimeout(45000);
const xml = (value = 100, competencia = '2026-08-01') => xmlNfseData()
  .replace('<dCompet>2026-08-01</dCompet>', competencia ? `<dCompet>${competencia}</dCompet>` : '')
  .replace('</infDPS>', `<valores><vServ>${value}</vServ></valores></infDPS>`);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

(local ? describe : describe.skip)('accounting closure and document sync — actual routes and two PostgreSQL sessions', () => {
  let clientId, user, app, second, root, invoice, tenantBaseline;
  const snapshot = (value = 200, options = {}) => ({ clientId, origem: 'ADN_SYNC', cursor: '10', motivo: 'P1001',
    item: { NSU: '11', ChaveAcesso: CHAVE_NFSE, ArquivoXml: Buffer.from(xml(value)).toString('base64'), ...options } });
  const recoverBody = p => ({ revisao: p.revisao, hash: p.hash, idempotencyKey: randomUUID(), motivo: 'Conferência sintética da base' });
  const recover = (p, body = recoverBody(p)) => request(app).post(`${root}/notas/sincronizacao/pendencias/${p.id}/recuperar`).send(body);
  const close = () => request(app).post(`${root}/fechamento-contabil/2026-08/fechar`).send({});
  const note = () => prisma.portalInvoice.findUnique({ where: { id: invoice.invoiceId } });
  async function pending() {
    await registrarDocumentoRecusado(prisma, snapshot());
    return consultarPendenciaSync(prisma, { clientId });
  }
  async function circular(estado = 'aberto', accounting = true, competencia = '2026-08') {
    return prisma.companyMonthlyCircular.create({ data: { portalClientId: clientId, competencia, estado,
      fechadoContabilEm: accounting ? new Date('2026-09-01T00:00:00Z') : null } });
  }
  beforeEach(async () => {
    clientId = randomUUID(); second = new PrismaClient();
    await prisma.portalClient.create({ data: { id: clientId, cnpj: CNPJ_DATAS, razao: 'FECHAMENTO SYNC SINTETICO' } });
    tenantBaseline = await second.portalClient.findUnique({ where: { id: clientId } });
    user = await prisma.user.create({ data: { email: randomUUID() + '@example.invalid', passwordHash: 'synthetic', role: 'user', accountType: 'FIRM' } });
    await prisma.companyFirmAccess.create({ data: { companyId: clientId, userId: user.id, role: 'ACCOUNTANT', status: 'ACTIVE' } });
    await prisma.portalSyncState.create({ data: { clientId, lastCursor: 10n } });
    invoice = await upsertPortalInvoiceSafe({ clientId, data: { type: 'NFSE', status: 'EMITIDA',
      chaveAcesso: CHAVE_NFSE, idNfse: '1', emitenteDoc: CNPJ_DATAS, competencia: new Date('2026-08-01'),
      issueDate: new Date('2026-09-28'), xmlRaw: xml(), total: 100 } });
    // Real, balanced synthetic entries satisfy the existing automatic checklist,
    // including when no circular exists. No mocked closure validation.
    for (const tipo of ['FOLHA', 'DESPESA', 'RECEITA', 'PROVISAO', 'BAIXA']) {
      await prisma.accountingEntry.create({ data: { portalClientId: clientId, competencia: '2026-08',
        data: new Date('2026-08-31'), historico: 'Conferência sintética', tipo, tipoLinha: tipoLinhaDaBaixa(tipo), status: 'CONFIRMADO',
        lines: { create: [{ conta: '1.1', tipo: 'D', valor: 100 }, { conta: '3.1', tipo: 'C', valor: 100 }] } } });
    }
    app = express(); app.use(express.json()); app.use((req, res, next) => { req.auth = { user }; next(); });
    app.use('/firm/companies/:companyId', createNotasRouter({ log: { error: jest.fn() } }));
    app.use('/firm/companies/:companyId', createAccountingEntriesRouter({ log: { error: jest.fn(), warn: jest.fn() } }));
    root = `/firm/companies/${clientId}`;
    AdnSyncService.fetchLote.mockReset().mockRejectedValue(Error('TRANSPORTE_PROIBIDO'));
    readStoredCompanyPfx.mockReset().mockRejectedValue(Error('CERTIFICADO_PROIBIDO'));
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    let tenantAfter;
    try {
      tenantAfter = await second.portalClient.findUnique({ where: { id: clientId } });
      await prisma.syncDocumentoTentativa.deleteMany({ where: { clientId } });
      await prisma.syncDocumentoPendente.deleteMany({ where: { clientId } });
      await prisma.syncDocumentoEntrega.deleteMany({ where: { clientId } });
      await prisma.appSetting.deleteMany({ where: { OR: [
        { key: { startsWith: `contabil:correcao:v1:${clientId}:` } },
        { key: { startsWith: `contabil:audit:v1:${clientId}:` } },
      ] } });
      await prisma.portalClient.deleteMany({ where: { id: clientId, razao: 'FECHAMENTO SYNC SINTETICO' } });
      await prisma.user.deleteMany({ where: { id: user.id, email: user.email } });
    } finally { await second.$disconnect(); }
    expect(tenantAfter).toEqual(tenantBaseline);
  });
  afterAll(async () => prisma.$disconnect());

  test.each([['aberto', true, 'MES_CONTABIL_FECHADO_REQUER_REVISAO'],
    ['fechado', true, 'MES_CONTABIL_FECHADO_REQUER_REVISAO'],
    ['fechado', false, 'PERIODO_FISCAL_FECHADO_REQUER_REVISAO']])(
    '%s / contábil %s: HTTP e persistência recusam 100→200 sem sucesso parcial', async (fiscal, accounting, code) => {
      const circ = await circular(fiscal, accounting), before = await note();
      const entries = await prisma.accountingEntry.findMany({ where: { portalClientId: clientId }, include: { lines: true }, orderBy: { id: 'asc' } });
      await expect(second.$transaction(tx => processarDocumentoSyncLocal(tx, snapshot()))).rejects.toMatchObject({ code, status: 409 });
      const p = await pending(), body = recoverBody(p);
      const state = await prisma.portalSyncState.findUnique({ where: { clientId } });
      expect((await recover(p, body).expect(409)).body.error).toBe(code);
      await recover(p, body).expect(409);
      expect(await note()).toEqual(before);
      expect(await prisma.companyMonthlyCircular.findUnique({ where: { id: circ.id } })).toEqual(circ);
      expect(await prisma.accountingEntry.findMany({ where: { portalClientId: clientId }, include: { lines: true }, orderBy: { id: 'asc' } })).toEqual(entries);
      expect(await prisma.portalSyncState.findUnique({ where: { clientId } })).toEqual(state);
      expect(await prisma.syncDocumentoEntrega.count({ where: { clientId } })).toBe(0);
      expect(await prisma.syncDocumentoPendente.findUnique({ where: { id: p.id } })).toMatchObject({ estado: 'ATIVA', classe: 'DOCUMENTAL', snapshot: state.documentoRecusado });
      expect(await prisma.syncDocumentoTentativa.findMany({ where: { clientId } })).toEqual([expect.objectContaining({ estado: 'REJEITADA', codigo: code, actorId: user.id })]);
      expect(AdnSyncService.fetchLote).not.toHaveBeenCalled(); expect(readStoredCompanyPfx).not.toHaveBeenCalled();
    });

  test('ambos abertos aceitam; replay comprovado após fechamento não regrava base', async () => {
    await circular('aberto', false);
    const p = await pending(); await recover(p).expect(200);
    expect(Number((await note()).total)).toBe(200);
    await close().expect(200);
    const before = await note();
    expect(await second.$transaction(tx => processarDocumentoSyncLocal(tx, snapshot()))).toMatchObject({ action: 'duplicate' });
    expect(await note()).toEqual(before);
  });

  test('novo documento em mês fechado não entra; outras competências e empresas permanecem isoladas', async () => {
    await circular();
    const key = CHAVE_NFSE.slice(0, -1) + '2';
    const source = xml().replaceAll(CHAVE_NFSE, key).replace('<nNFSe>1</nNFSe>', '<nNFSe>2</nNFSe>');
    await expect(second.$transaction(tx => processarDocumentoSyncLocal(tx, snapshot(100, {
      ChaveAcesso: key, ArquivoXml: Buffer.from(source).toString('base64'),
    })))).rejects.toMatchObject({ code: 'MES_CONTABIL_FECHADO_REQUER_REVISAO' });
    expect(await prisma.portalInvoice.count({ where: { clientId } })).toBe(1);
    await second.$transaction(tx => processarDocumentoSyncLocal(tx, snapshot(100, {
      ChaveAcesso: key, ArquivoXml: Buffer.from(source.replace('2026-08-01', '2026-07-01')).toString('base64'),
    })));
    const other = randomUUID(), otherDoc = '44555666000177';
    await prisma.portalClient.create({ data: { id: other, cnpj: otherDoc, razao: 'OUTRA SINTETICA' } });
    try {
      await second.$transaction(tx => processarDocumentoSyncLocal(tx, { ...snapshot(200, {
        ChaveAcesso: CHAVE_NFSE.replace(CNPJ_DATAS, otherDoc),
        ArquivoXml: Buffer.from(xml(200).replaceAll(CNPJ_DATAS, otherDoc)).toString('base64'),
      }), clientId: other }));
      expect(await prisma.portalInvoice.count({ where: { clientId: other } })).toBe(1);
    } finally {
      await prisma.syncDocumentoEntrega.deleteMany({ where: { clientId: other } });
      await prisma.portalClient.delete({ where: { id: other } });
    }
  });

  test.each(['documental-ausente', 'persistida-ausente', 'divergente', 'destino-fechado'])('competência %s não usa emissão como atalho', async mode => {
    const before = await note();
    if (mode === 'persistida-ausente') await prisma.portalInvoice.update({ where: { id: invoice.invoiceId }, data: { competencia: null } });
    if (mode === 'destino-fechado') await circular('aberto', true, '2026-09');
    const xmlSource = mode === 'documental-ausente' ? xml(200, null) : mode.includes('fechado') || mode === 'divergente' ? xml(200, '2026-09-01') : xml(200);
    const expected = mode === 'destino-fechado' ? 'MES_CONTABIL_FECHADO_REQUER_REVISAO' : mode === 'divergente' ? 'COMPETENCIA_DOCUMENTAL_DIVERGENTE' : 'COMPETENCIA_DOCUMENTAL_DESCONHECIDA';
    const baseline = await note();
    await expect(second.$transaction(tx => processarDocumentoSyncLocal(tx, snapshot(200, { ArquivoXml: Buffer.from(xmlSource).toString('base64') })))).rejects.toMatchObject({ code: expected, status: 409 });
    expect(await note()).toEqual(baseline); expect((await note()).issueDate).toEqual(before.issueDate);
  });

  test('evento contendo XML divergente altera somente status; replay não duplica', async () => {
    await circular(); const before = await note();
    const event = snapshot(999, { TipoDocumento: 'EVENTO', TipoEvento: 'E101101' });
    await second.$transaction(tx => processarDocumentoSyncLocal(tx, event));
    expect(await note()).toEqual({ ...before, status: 'CANCELADA', updatedAt: expect.any(Date) });
    expect(await second.$transaction(tx => processarDocumentoSyncLocal(tx, event))).toMatchObject({ action: 'duplicate' });
    expect(await prisma.portalInvoiceEvent.count({ where: { clientId } })).toBe(1);
  });

  test('reabertura HTTP exige versão/motivo, conserva auditoria e libera somente nova tentativa', async () => {
    await circular(); const p = await pending(), body = recoverBody(p);
    await recover(p, body).expect(409);
    const state = await estadoCorrecaoTx(prisma, clientId, '2026-08');
    await request(app).post(`${root}/fechamento-contabil/2026-08/reabrir`).send({ versao: state.versao }).expect(400);
    await request(app).post(`${root}/fechamento-contabil/2026-08/reabrir`).send({ versao: state.versao, motivo: 'Conferir documento recusado' }).expect(200);
    await recover(p, body).expect(409);
    await recover(p).expect(200);
    expect(Number((await note()).total)).toBe(200);
    expect(await prisma.appSetting.findMany({ where: { key: { startsWith: `contabil:audit:v1:${clientId}:` } } })).toEqual([
      expect.objectContaining({ value: expect.objectContaining({ tipo: 'CORRECAO_ABERTA', autor: expect.objectContaining({ id: user.id }) }) }),
    ]);
  });

  test('engine conserva cursor e classifica recusa contábil como documental', async () => {
    await circular(); const before = await note();
    const find = prisma.portalClient.findUnique.bind(prisma);
    jest.spyOn(prisma.portalClient, 'findUnique').mockImplementation(async args => {
      const row = await find(args); return row ? { ...row, companyId: 'synthetic' } : row;
    });
    jest.spyOn(prisma.company, 'findUnique').mockResolvedValue({ certPasswordEnc: 'synthetic' });
    readStoredCompanyPfx.mockResolvedValue(Buffer.from('synthetic'));
    AdnSyncService.fetchLote.mockResolvedValue({ documentos: [snapshot().item] });
    const job = await prisma.portalInvoiceSyncJob.create({ data: { clientId, state: 'RUNNING' } });
    await InvoiceSyncEngine.runJob({ clientId, jobId: job.id, maxIterations: 1 });
    expect(await note()).toEqual(before);
    expect(await prisma.portalSyncState.findUnique({ where: { clientId } })).toMatchObject({ lastCursor: 10n,
      documentoRecusado: { motivo: 'MES_CONTABIL_FECHADO_REQUER_REVISAO' } });
    expect(await consultarPendenciaSync(prisma, { clientId })).toMatchObject({ classe: 'DOCUMENTAL' });
    expect(await InvoiceSyncEngine.start({ clientId })).toMatchObject({ queued: false, reason: 'DOCUMENTO_RECUSADO_PENDENTE' });
    expect(AdnSyncService.fetchLote).toHaveBeenCalledTimes(1);
  });

  test.each(['auditoria', 'liberacao'])('%s falha após 100→200: rollback da base e nova tentativa recuperável', async mode => {
    const p = await pending(), before = await note();
    const state = await prisma.portalSyncState.findUnique({ where: { clientId } });
    const original = prisma.$transaction.bind(prisma);
    const injected = jest.fn();
    const spy = jest.spyOn(prisma, '$transaction').mockImplementation((cb, options) => original(tx => cb({ ...tx, $queryRaw: (...args) => tx.$queryRaw(...args), $executeRaw: (...args) => tx.$executeRaw(...args),
      ...(mode === 'auditoria' ? { syncDocumentoTentativa: { ...tx.syncDocumentoTentativa,
        updateMany: async () => { injected(); throw Error('AUDITORIA_INDISPONIVEL'); } } } : {}),
      ...(mode === 'liberacao' ? { portalSyncState: { ...tx.portalSyncState, updateMany: async () => { injected(); return { count: 0 }; } } } : {}),
    }), options));
    try { await recover(p).expect(mode === 'auditoria' ? 500 : 409); expect(injected).toHaveBeenCalled(); } finally { spy.mockRestore(); }
    expect(await note()).toEqual(before);
    expect(await prisma.portalSyncState.findUnique({ where: { clientId } })).toEqual(state);
    expect(await prisma.syncDocumentoEntrega.count({ where: { clientId } })).toBe(0);
    expect(await prisma.syncDocumentoPendente.findUnique({ where: { id: p.id } })).toMatchObject({ estado: 'ATIVA' });
    await recover(p).expect(200);
    expect(Number((await note()).total)).toBe(200);
  });

  test.each(['2026-02-30', '2026-02-29', '2026-13-01', '2026-02-00'].flatMap(literal =>
    [false, true].map(existing => [literal, existing])))(
    'literal %s existente=%s: engine, recovery e payload normalizado preservam fevereiro fechado', async (literal, existing) => {
      const circ = await circular('aberto', true, '2026-02');
      const march = await circular('aberto', false, '2026-03');
      const key = existing ? CHAVE_NFSE : CHAVE_NFSE.slice(0, -1) + '2';
      const source = xml(200, literal).replaceAll(CHAVE_NFSE, key)
        .replace('<nNFSe>1</nNFSe>', `<nNFSe>${existing ? '1' : '2'}</nNFSe>`);
      const rejected = snapshot(200, { ChaveAcesso: key, ArquivoXml: Buffer.from(source).toString('base64') });
      const before = await note();
      const entries = await prisma.accountingEntry.findMany({ where: { portalClientId: clientId }, include: { lines: true }, orderBy: { id: 'asc' } });
      for (const competencia of [undefined, new Date('2026-03-02T00:00:00Z')]) {
        await expect(upsertPortalInvoiceSafe({ client: second, clientId, data: { type: 'NFSE',
          chaveAcesso: key, xmlRaw: source, competencia, emitenteDoc: CNPJ_DATAS, status: 'EMITIDA', total: 200 } }))
          .rejects.toMatchObject({ code: 'COMPETENCIA_DOCUMENTAL_INVALIDA', status: 409 });
      }
      const find = prisma.portalClient.findUnique.bind(prisma);
      jest.spyOn(prisma.portalClient, 'findUnique').mockImplementation(async args => {
        const row = await find(args); return row ? { ...row, companyId: 'synthetic' } : row;
      });
      jest.spyOn(prisma.company, 'findUnique').mockResolvedValue({ certPasswordEnc: 'synthetic' });
      readStoredCompanyPfx.mockResolvedValue(Buffer.from('synthetic'));
      AdnSyncService.fetchLote.mockResolvedValue({ documentos: [rejected.item] });
      const job = await prisma.portalInvoiceSyncJob.create({ data: { clientId, state: 'RUNNING' } });
      await InvoiceSyncEngine.runJob({ clientId, jobId: job.id, maxIterations: 1 });
      const state = await prisma.portalSyncState.findUnique({ where: { clientId } });
      expect(state).toMatchObject({ lastCursor: 10n, documentoRecusado: {
        motivo: 'COMPETENCIA_DOCUMENTAL_INVALIDA', item: rejected.item,
      } });
      const p = await consultarPendenciaSync(prisma, { clientId });
      expect(p).toMatchObject({ classe: 'DOCUMENTAL' });
      const input = recoverBody(p);
      expect((await recover(p, input).expect(409)).body.error).toBe('COMPETENCIA_DOCUMENTAL_INVALIDA');
      await recover(p, input).expect(409);
      expect(await prisma.portalSyncState.findUnique({ where: { clientId } })).toEqual(state);
      expect(await prisma.syncDocumentoPendente.findUnique({ where: { id: p.id } }))
        .toMatchObject({ estado: 'ATIVA', classe: 'DOCUMENTAL', snapshot: state.documentoRecusado });
      expect(await prisma.syncDocumentoTentativa.findMany({ where: { clientId } })).toEqual([
        expect.objectContaining({ estado: 'REJEITADA', codigo: 'COMPETENCIA_DOCUMENTAL_INVALIDA', actorId: user.id }),
      ]);
      expect(await note()).toEqual(before);
      expect(await prisma.portalInvoice.count({ where: { clientId } })).toBe(1);
      expect(await prisma.syncDocumentoEntrega.count({ where: { clientId } })).toBe(0);
      expect(await prisma.companyMonthlyCircular.findUnique({ where: { id: circ.id } })).toEqual(circ);
      expect(await prisma.companyMonthlyCircular.findUnique({ where: { id: march.id } })).toEqual(march);
      expect(await prisma.accountingEntry.findMany({ where: { portalClientId: clientId }, include: { lines: true }, orderBy: { id: 'asc' } })).toEqual(entries);
      expect(AdnSyncService.fetchLote).toHaveBeenCalledTimes(1);
      jest.restoreAllMocks();
    });

  test.each(['2026-02-28', '2028-02-29'])('controle civil válido %s é persistido sem rollover', async literal => {
    const key = CHAVE_NFSE.slice(0, -1) + '2';
    const source = xml(200, literal).replaceAll(CHAVE_NFSE, key).replace('<nNFSe>1</nNFSe>', '<nNFSe>2</nNFSe>');
    await second.$transaction(tx => processarDocumentoSyncLocal(tx, snapshot(200, {
      ChaveAcesso: key, ArquivoXml: Buffer.from(source).toString('base64'),
    })));
    expect(await prisma.portalInvoice.findUnique({ where: { clientId_chaveAcesso: { clientId, chaveAcesso: key } } }))
      .toMatchObject({ competencia: new Date(`${literal}T00:00:00Z`) });
    expect(await prisma.syncDocumentoEntrega.count({ where: { clientId } })).toBe(1);
  });

  // Observe an actual PostgreSQL lock wait, not a sleep standing in for concurrency.
  async function waitForLock(pid) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRaw`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pid}`;
      if (rows[0]?.wait_event_type === 'Lock') return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw Error('Expected second connection to wait on the shared closure fence');
  }

  test.each([false, true].flatMap(exists => ['processador', 'upsert', 'recuperacao'].map(mode => [exists, mode])))(
    'fechar vence; circular pré-existente=%s; %s aguarda e recusa', async (exists, mode) => {
    if (exists) await circular('aberto', false);
    const p = mode === 'recuperacao' ? await pending() : null;
    const state = await prisma.portalSyncState.findUnique({ where: { clientId } });
    const original = prisma.$transaction.bind(prisma), held = deferred(), release = deferred(), started = deferred();
    const spy = jest.spyOn(prisma, '$transaction').mockImplementation((cb, options) => original(async tx => cb({ ...tx, $queryRaw: (...args) => tx.$queryRaw(...args),
      $executeRaw: async (...args) => { const result = await tx.$executeRaw(...args); held.resolve(); await release.promise; return result; },
    }), { ...options, timeout: 20000 }));
    let closing, writing;
    const before = await note();
    try {
      closing = close().then(r => r); await held.promise;
      const writer = { $transaction: (cb, options) => second.$transaction(async tx => {
        const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
        return cb({ ...tx, $queryRaw: (...args) => tx.$queryRaw(...args), $executeRaw: async (...args) => { started.resolve(pid); return tx.$executeRaw(...args); } });
      }, { ...options, timeout: 20000 }) };
      const operation = mode === 'processador' ? writer.$transaction(tx => processarDocumentoSyncLocal(tx, snapshot()))
        : mode === 'upsert' ? upsertPortalInvoiceSafe({ client: writer, clientId,
          data: { ...before, xmlRaw: xml(200), total: 200 } })
          : recuperarDocumentoSync(writer, { clientId, pendenciaId: p.id, actorId: user.id, pedido: recoverBody(p) });
      writing = operation.then(value => ({ value }), error => ({ error }));
      await waitForLock(await started.promise); release.resolve();
      expect((await closing).status).toBe(200);
      expect(await writing).toMatchObject({ error: { code: 'MES_CONTABIL_FECHADO_REQUER_REVISAO' } });
      expect(await note()).toEqual(before);
      expect(await prisma.syncDocumentoEntrega.count({ where: { clientId } })).toBe(0);
      expect(await prisma.portalSyncState.findUnique({ where: { clientId } })).toEqual(state);
      if (p) expect(await prisma.syncDocumentoTentativa.findFirst({ where: { clientId } }))
        .toMatchObject({ estado: 'REJEITADA', codigo: 'MES_CONTABIL_FECHADO_REQUER_REVISAO' });
    } finally { release.resolve(); await Promise.allSettled([closing, writing].filter(Boolean)); spy.mockRestore(); }
  });

  test.each([false, true])('documento vence; fechamento Serializable com snapshot anterior recusa, circular=%s', async exists => {
    if (exists) await circular('aberto', false);
    const held = deferred(), release = deferred(), closingStarted = deferred();
    const original = prisma.$transaction.bind(prisma);
    const spy = jest.spyOn(prisma, '$transaction').mockImplementation((cb, options) => original(async tx => {
      // Establish the old snapshot before waiting in the actual route's fence.
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`; closingStarted.resolve(pid);
      return cb(tx);
    }, { ...options, timeout: 20000 }));
    let writing, closing;
    try {
      writing = second.$transaction(async tx => {
        const result = await processarDocumentoSyncLocal(tx, snapshot()); held.resolve(); await release.promise; return result;
      }, { timeout: 20000 });
      await held.promise; closing = close().then(r => r);
      await waitForLock(await closingStarted.promise); release.resolve();
      await writing;
      const response = await closing;
      expect(response.status).toBe(409); expect(response.body.error).toBe('P2034');
      expect(Number((await note()).total)).toBe(200);
      expect((await prisma.companyMonthlyCircular.findUnique({ where: { portalClientId_competencia: { portalClientId: clientId, competencia: '2026-08' } } }))?.fechadoContabilEm).toBeFalsy();
      spy.mockRestore(); await close().expect(200);
    } finally { release.resolve(); await Promise.allSettled([writing, closing].filter(Boolean)); spy.mockRestore(); }
  });
});

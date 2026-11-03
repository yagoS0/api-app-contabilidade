import { createOperationsBatchService } from '../../../application/operacoes/OperationsBatchService.js';
import { lerOperacao, salvarOperacao } from '../../../application/operacoes/OperationsService.js';
import { contextoOrigemCalculo } from '../../../application/notas/apuracao/v2/RecuperacaoCalculo.js';
import { criarVinculoCalculo } from '../../../application/notas/apuracao/v2/CalculoConfirmado.js';
import { conferirContextoCicloFiscal, conferirTentativaAutomaticaDespacho } from '../../../application/fiscal/automacaoCicloFiscalContext.js';

const pa = '2026-10', userId = 'operator';
async function fixture() {
  const settings = new Map(), snapshots = new Map(), queue = [];
  const user = { id: userId, role: 'contador', accountType: 'FIRM', status: 'active' };
  const portals = ['a', 'b', 'c'].map(id => ({ id, razao: id, cnpj: '12345678000190', companyId: `legacy-${id}`, status: 'ATIVA' }));
  const access = new Map(portals.map(p => [p.id, { companyId: p.id, status: 'ACTIVE', role: 'ACCOUNTANT' }]));
  const select = (row, fields) => !row ? null : !fields ? structuredClone(row) : Object.fromEntries(Object.keys(fields).map(k => [k, row[k]]));
  const tx = {
    user: { findUnique: jest.fn(async () => user) },
    portalClient: { findUnique: async ({ where, select: fields }) => select(portals.find(p => p.id === where.id), fields), findMany: async () => portals },
    companyFirmAccess: { findUnique: async ({ where }) => access.get(where.companyId_userId.companyId), findMany: async () => [...access.values()] },
    cadastroFiscal: { findUnique: async () => ({ regime: 'SIMPLES_NACIONAL', regimeApuracao: 'COMPETENCIA', dataOpcaoSN: '2025-01-01', cnaePrincipal: '6201501' }) },
    company: { findUnique: async ({ select: fields }) => select({ regimeTributario: 'SIMPLES', cnpj: '12345678000190' }, fields) },
    regimeHistorico: { findMany: async () => [] },
    portalInvoice: { findMany: async () => [] }, accountingEntry: { findMany: async () => [] }, rbtExtratoCache: { findUnique: async () => null },
    apuracaoSnapshot: { findUnique: async ({ where }) => structuredClone(snapshots.get(where.portalClientId_competencia.portalClientId) || null) },
    pendenciaPosFechamento: { findMany: async () => [], count: async () => 0 }, companyMonthlyCircular: { findUnique: async () => null },
    appSetting: {
      findUnique: async ({ where }) => settings.has(where.key) ? { key: where.key, value: structuredClone(settings.get(where.key)) } : null,
      findMany: async () => [...settings].map(([key, value]) => ({ key, value: structuredClone(value) })),
      create: async ({ data }) => { if (settings.has(data.key)) throw Object.assign(Error('duplicate'), { code: 'P2002' }); settings.set(data.key, structuredClone(data.value)); return data; },
      update: async ({ where, data }) => settings.set(where.key, structuredClone(data.value)),
      upsert: async ({ where, create, update }) => settings.set(where.key, structuredClone(settings.has(where.key) ? update.value : create.value)),
    }, $queryRaw: async () => [],
  };
  const db = { ...tx, $transaction: async fn => fn(tx) };
  for (const p of portals) {
    settings.set(`ciclo_simples_config:${p.id}`, { enabled: true, fontes: ['NFSE'] });
    settings.set(`serpro_procuration_status:${p.id}`, { cnpj: p.cnpj, procuradorCnpj: '11111111000191', status: 'ATIVA', systems: ['PGDAS-D'], checkedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 86400000).toISOString() });
    const contextoOrigem = await contextoOrigemCalculo({ portalClientId: p.id, competencia: pa }, db);
    const v = criarVinculoCalculo({ portalClientId: p.id, competencia: pa, contribuinteCnpj: p.cnpj, contextoOrigem,
      formulario: { atividades: [], folhaMensal12: [], regimeApuracao: 'COMPETENCIA' } });
    snapshots.set(p.id, { estado: 'calculada', idempotencyKey: v.calculoId, dasSimuladoSerpro: 10, atividadesEscolhidas: [], folhaMensal12: [], simulacaoSerpro: { _portalCalculo: v } });
  }
  async function confirm(id) {
    const op = await lerOperacao(db, id, pa);
    return salvarOperacao(db, id, pa, userId, { action: 'confirm', expectedRevision: op.revision, requestId: `confirm-${id}-unique` });
  }
  await confirm('a'); await confirm('b');
  const transport = jest.fn(async () => ({ ok: true }));
  const auth = jest.fn(async () => {});
  const transmit = jest.fn(async args => {
    await args.antesDeTransmitir();
    await auth(args);
    // Mesmo contrato local chamado pela guarda de despacho após autenticação.
    await conferirContextoCicloFiscal(tx, { portalClientId: args.portalClientId, requireCompany: true });
    await conferirTentativaAutomaticaDespacho(tx, { portalClientId: args.portalClientId });
    return transport(args);
  });
  const tasks = { start: jest.fn(async (descriptor, run) => { queue.push(run); return { id: `task-${queue.length}`, newlyStarted: true }; }) };
  const service = createOperationsBatchService({ db, tasks, credentials: async () => ({ certificate: { document: '11111111000191' } }), executionDeps: { transmit } });
  const preview = () => service.preview({ userId, competencia: pa });
  const accept = p => service.accept({ userId, previewId: p.id, requestId: 'unique-request-123456', confirmCompetencia: pa });
  return { db, settings, snapshots, user, access, queue, tasks, service, preview, accept, confirm, transport, auth, transmit };
}


import express from 'express';
import request from 'supertest';
import { createOperationsRouter } from '../operacoes.js';
function app(f, actor = { id: userId, role: 'contador' }) {
  const server = express(); server.use(express.json());
  server.use((req, res, next) => { if (!actor) return res.sendStatus(401); req.auth = { user: actor }; next(); });
  server.use('/firm', createOperationsRouter({ prisma: f.db, requireFirmCompanyAccess: () => (_req, _res, next) => next(),
    batchDependencies: { tasks: f.tasks, credentials: async () => ({ certificate: { document: '11111111000191' } }), executionDeps: { transmit: f.transmit } } }));
  return server;
}
test('rotas usam ator autenticado e universo do servidor; aceite e acompanhamento sobrevivem à requisição', async () => {
  const f = await fixture(), server = app(f);
  const preview = await request(server).post('/firm/operacoes/lotes/previa').send({ competencia: pa, companyIds: ['c'], userId: 'intruder', isAdmin: true });
  expect(preview.status).toBe(200); expect(preview.headers['cache-control']).toBe('no-store');
  expect(preview.body.preview.items.map(i => i.companyId)).toEqual(['a', 'b']);
  const input = { previewId: preview.body.preview.id, requestId: 'route-request-123456', confirmCompetencia: pa };
  const accepted = await request(server).post('/firm/operacoes/lotes/aceitar').send(input);
  expect(accepted.status).toBe(200); expect(f.transport).not.toHaveBeenCalled();
  await f.queue[0](async () => {});
  const read = await request(server).get(`/firm/operacoes/lotes/${accepted.body.batch.id}`);
  expect(read.status).toBe(200); expect(read.body.batch.items.map(i => i.state)).toEqual(['DONE', 'DONE']);
  expect((await request(server).post('/firm/operacoes/lotes/aceitar').send(input)).body.batch.id).toBe(accepted.body.batch.id);
  expect(f.transport).toHaveBeenCalledTimes(2); expect(f.tasks.start).toHaveBeenCalledTimes(1);
  expect((await request(server).get(`/firm/operacoes/lotes?competencia=${pa}`)).body.items).toHaveLength(1);
});
test('rotas recusam competência errada, ator revogado e acesso anônimo sem transporte', async () => {
  const f = await fixture(), server = app(f), p = await f.preview();
  expect((await request(app(f, null)).post('/firm/operacoes/lotes/previa').send({ competencia: pa })).status).toBe(401);
  expect((await request(server).post('/firm/operacoes/lotes/aceitar').send({ previewId: p.id, requestId: 'route-request-123456', confirmCompetencia: '2026-09' })).status).toBe(409);
  f.user.status = 'inactive';
  expect((await request(server).post('/firm/operacoes/lotes/previa').send({ competencia: pa })).status).toBe(403);
  expect(f.tasks.start).not.toHaveBeenCalled(); expect(f.transport).not.toHaveBeenCalled();
});

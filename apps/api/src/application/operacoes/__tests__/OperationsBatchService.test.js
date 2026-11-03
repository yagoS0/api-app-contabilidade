import { createOperationsBatchService } from '../OperationsBatchService.js';
import { lerOperacao, salvarOperacao } from '../OperationsService.js';
import { contextoOrigemCalculo } from '../../notas/apuracao/v2/RecuperacaoCalculo.js';
import { criarVinculoCalculo } from '../../notas/apuracao/v2/CalculoConfirmado.js';
import { conferirContextoCicloFiscal, conferirTentativaAutomaticaDespacho } from '../../fiscal/automacaoCicloFiscalContext.js';

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

test('prévia e aceite reais incluem universo autorizado; confirmação posterior fica fora; replay não agenda duas vezes', async () => {
  const f = await fixture(), p = await f.preview();
  expect(p.items.map(i => i.companyId)).toEqual(['a', 'b']); expect(p.blocked).toHaveLength(1);
  expect(f.transport).not.toHaveBeenCalled();
  await f.confirm('c');
  const accepted = await f.accept(p);
  expect(accepted.items.map(i => i.companyId)).toEqual(['a', 'b']);
  expect((await f.accept(p)).id).toBe(accepted.id); expect(f.tasks.start).toHaveBeenCalledTimes(1);
  await f.queue[0](async () => {});
  expect(f.transport).toHaveBeenCalledTimes(2);
  expect((await f.service.get({ userId, batchId: accepted.id })).items.every(i => i.state === 'DONE')).toBe(true);
  expect((await f.service.get({ userId, batchId: accepted.id })).items.every(i => i.message === null)).toBe(true);
  const other = await f.preview(); await expect(f.accept(other)).rejects.toThrow('outra liberação');
});

test('revogação parcial preserva resultados autorizados e retomada, sem revelar a empresa revogada', async () => {
  const f = await fixture(); f.tasks.start.mockRejectedValueOnce(Error('scheduler down'));
  const accepted = await f.accept(await f.preview());
  f.access.get('a').status = 'REVOKED';
  const visible = await f.service.get({ userId, batchId: accepted.id });
  expect(visible.items.map(i => i.companyId)).toEqual(['b']);
  expect(visible.taskId).toBeNull(); expect(visible.canResume).toBe(true);
  expect((await f.service.list({ userId, competencia: pa })).items).toEqual([visible]);
  const p = await f.service.preview({ userId, competencia: pa, batchId: accepted.id });
  expect(p.items.map(i => i.companyId)).toEqual(['b']); expect(p.blocked).toEqual([]);
  await f.service.accept({ userId, previewId: p.id, requestId: 'resume-access-12345', confirmCompetencia: pa });
  await f.queue[0](async () => {});
  expect(f.transport.mock.calls.map(([a]) => a.portalClientId)).toEqual(['b']);
  const result = await f.service.get({ userId, batchId: accepted.id });
  expect(result.items).toEqual([{ companyId: 'b', name: 'b', state: 'DONE', message: null }]);
  const stored = f.settings.get(`operations_batch:${accepted.id}`);
  expect(stored.items.map(i => i.companyId)).toEqual(['a', 'b']);
});

test('segunda liberação da mesma revisão e concorrência com manual não substituem o aceite', async () => {
  const f = await fixture(), p1 = await f.preview(), p2 = await f.preview();
  await f.accept(p1);
  await expect(f.service.accept({ userId, previewId: p2.id, requestId: 'another-request-1234', confirmCompetencia: pa })).rejects.toThrow();
  expect(f.tasks.start).toHaveBeenCalledTimes(1);
  const state = await lerOperacao(f.db, 'a', pa);
  await expect(salvarOperacao(f.db, 'a', pa, userId, { action: 'release', requestId: 'manual-request', expectedRevision: state.revision })).rejects.toThrow('Confirme');
});

test.each(['access', 'selection', 'snapshot'])('alteração %s depois do aceite bloqueia antes de qualquer transporte', async kind => {
  const f = await fixture(), accepted = await f.accept(await f.preview());
  if (kind === 'access') f.access.get('a').status = 'REVOKED';
  if (kind === 'selection') f.settings.set('ciclo_simples_config:a', { enabled: false, fontes: ['NFSE'] });
  if (kind === 'snapshot') f.snapshots.get('a').idempotencyKey = 'outra-revisao';
  await f.queue[0](async () => {});
  expect(f.transport).not.toHaveBeenCalled();
  const visible = await f.service.get({ userId, batchId: accepted.id });
  expect(visible.items[0].state).toBe('WAITING');
  if (kind === 'access') expect(visible.items.map(i => i.companyId)).toEqual(['b']);
});

test.each(['global', 'company', 'actor'])('mudança %s durante auth é recusada na guarda final', async kind => {
  const f = await fixture(); await f.accept(await f.preview());
  f.auth.mockImplementation(async () => {
    const at = new Date().toISOString();
    if (kind === 'global') f.settings.set('automacao_ciclo_fiscal', { paused: true, version: 1, reason: 'Pausa', actor: { id: userId }, changedAt: at, resumedAt: null });
    if (kind === 'company') f.settings.set('company_automation_policy:a', { paused: true, version: 1, reason: 'Pausa', updatedBy: userId, updatedAt: at, resumedAt: null });
    if (kind === 'actor') f.user.status = 'inactive';
  });
  if (kind === 'actor') await expect(f.queue[0](async () => {})).rejects.toThrow();
  else await f.queue[0](async () => {});
  expect(f.transport.mock.calls.filter(([args]) => args.portalClientId === 'a')).toHaveLength(0);
  expect([...f.settings].some(([key, v]) => key.startsWith('operations_execution:a:') && v.status === 'ATTENTION')).toBe(true);
});

test('timeout mantém resultado por item; leitura/reinício não repete; retomada não inclui iniciados', async () => {
  const f = await fixture(), accepted = await f.accept(await f.preview());
  f.transport.mockRejectedValueOnce(Error('timeout'));
  await f.queue[0](async () => {});
  const result = await f.service.get({ userId, batchId: accepted.id });
  expect(result.items.map(i => i.state)).toEqual(['ATTENTION', 'DONE']);
  expect(result.canResume).toBe(false);
  const p = await f.service.preview({ userId, competencia: pa, batchId: accepted.id });
  expect(p.items).toHaveLength(0); expect(f.transport).toHaveBeenCalledTimes(2);
  expect((await f.service.list({ userId, competencia: pa })).items).toHaveLength(1);
  expect(f.tasks.start).toHaveBeenCalledTimes(1);
});

test('falha de agendamento conserva aceite; retomada explícita troca geração e impede executor antigo', async () => {
  const f = await fixture(); f.tasks.start.mockRejectedValueOnce(Error('scheduler down'));
  const accepted = await f.accept(await f.preview());
  expect(accepted.schedulingError).toMatch(/Aceite preservado/); expect(accepted.canResume).toBe(true);
  const p = await f.service.preview({ userId, competencia: pa, batchId: accepted.id });
  const resumed = await f.service.accept({ userId, previewId: p.id, requestId: 'resume-request-12345', confirmCompetencia: pa });
  expect(resumed.id).toBe(accepted.id); expect(resumed.generation).toBe(2);
  await f.queue[0](async () => {}); expect(f.transport).toHaveBeenCalledTimes(2);
});

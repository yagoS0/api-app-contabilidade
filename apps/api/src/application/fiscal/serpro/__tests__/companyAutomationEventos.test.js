const cloneSetting = value => JSON.parse(JSON.stringify(value));
jest.mock('../SerproRuntimeSettings.js', () => ({ ROTINA_KEYS: ['das', 'inss'] }));
jest.mock('../../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../CompanyRotinasService.js', () => ({ ROTINA_LABELS: { das: 'DAS', inss: 'INSS' } }));
import { lerAutomacaoEmpresa, salvarAutomacaoEmpresa } from '../CompanyAutomationService.js';
import { lerAgendaEventosGlobal, salvarAgendaEventosGlobal } from '../AgendaEventosService.js';
function database() {
  let settings = new Map([['serpro_runtime_settings', { key: 'serpro_runtime_settings', value: { clientSecret: 'kept-secret', rotinas: { das: { enabled: false, day: 5, hour: 7 } } } }], ['ciclo_simples_config:a', { key: 'ciclo_simples_config:a', value: { enabled: false, fontes: ['NFSE'], selectionToken: '11111111-1111-4111-8111-111111111111' } }]]);
  const db = {
    user: { findUnique: jest.fn(async()=>({role:'contador',status:'active',accountType:'FIRM'})) },
    portalClient: { findUnique: jest.fn(async () => ({ id: 'a', companyId: 'legacy', razao: 'Empresa de teste' })) },
    company: { findUnique: jest.fn(async () => ({ regimeTributario: 'SIMPLES' })) },
    companyFirmAccess: { findUnique: jest.fn(async () => ({ status: 'ACTIVE', role: 'ACCOUNTANT' })) },
    companyRotina: { findMany: jest.fn(async () => []), upsert: jest.fn() }, $queryRaw: jest.fn(),
    appSetting: {
      findUnique: jest.fn(async ({ where }) => cloneSetting(settings.get(where.key) || null)),
      create: jest.fn(async ({ data }) => { if (settings.has(data.key)) throw Object.assign(Error('duplicate'), { code: 'P2002' }); settings.set(data.key, cloneSetting(data)); }),
      updateMany: jest.fn(async ({ where, data }) => { const r = settings.get(where.key); if (!r || JSON.stringify(r.value) !== JSON.stringify(where.value.equals)) return { count: 0 }; settings.set(where.key, { key: where.key, value: cloneSetting(data.value) }); return { count: 1 }; }),
      upsert: jest.fn(async ({ create }) => settings.set(create.key, cloneSetting(create))),
    },
  };
  db.$transaction = jest.fn(async fn => { const snapshot = new Map([...settings].map(([key,value]) => [key,cloneSetting(value)])); try { return await fn(db); } catch (e) { settings = snapshot; throw e; } }); return db;
}
test('save empresarial de parâmetros usa auditoria/replay existente sem adesão ou token novo', async () => {
  const db = database(), before = await lerAutomacaoEmpresa(db, 'a');
  const tokenBefore = await db.appSetting.findUnique({ where: { key: 'ciclo_simples_config:a' } });
  const request = { expectedRevision: before.revision, requestId: 'empresa-evento-001', agendaEventos: { patch: { tributos: { IRPJ: { captura: { enabled: false, hour: 9 } } } } } };
  const saved = await salvarAutomacaoEmpresa(db, 'a', 'user', request);
  expect(saved.agendaEventos.effective.IRPJ.captura).toEqual({ enabled: false, hour: 9 });
  expect(saved.agendaEventos.relativeConsumerReady).toBe(true); expect(saved.agendaEventos.capabilities.capture).toBe(false);
  expect(saved.cicloSimples).toEqual(before.cicloSimples); expect(saved.lembretes).toEqual(before.lembretes);
  expect(db.companyRotina.upsert).not.toHaveBeenCalled(); expect(db.appSetting.upsert).not.toHaveBeenCalled();
  expect(await db.appSetting.findUnique({ where: { key: 'ciclo_simples_config:a' } })).toEqual(tokenBefore);
  expect(await salvarAutomacaoEmpresa(db, 'a', 'user', request)).toEqual(saved);
  const audit = await db.appSetting.findUnique({ where: { key: 'company_automation_request:user:empresa-evento-001' } });
  expect(audit.value.beforeAgendaEventos).toEqual(before.agendaEventos);
  expect(audit.value.result.revision).toBe(saved.revision); expect(JSON.stringify(saved)).not.toContain('kept-secret');
});
test('mudança global invalida revisão empresarial antes de gravar override', async () => {
  const db = database(), before = await lerAutomacaoEmpresa(db, 'a');
  await salvarAgendaEventosGlobal(db, { id: 'admin', role: 'admin' }, { requestId: 'global-evento-001', agendaEventos: { expectedRevision: (await lerAgendaEventosGlobal(db)).revision, patch: { defaults: { captura: { hour: 8 } } } } });
  await expect(salvarAutomacaoEmpresa(db, 'a', 'user', { expectedRevision: before.revision, requestId: 'empresa-evento-002', agendaEventos: { patch: { defaults: { captura: { hour: 9 } } } } })).rejects.toMatchObject({ code: 'AUTOMATION_CHANGED' });
  expect(await db.appSetting.findUnique({ where: { key: 'agenda_eventos_empresa:v1:a' } })).toBeNull();
});

test('GET usa snapshot RepeatableRead para política e projeção; SAVE não abre transação aninhada', async () => {
  const db = database();
  // Transaction client intentionally has no $transaction, matching Prisma.
  db.$transaction.mockImplementation(async callback => {
    const { $transaction: _outer, ...tx } = db;
    return callback(tx);
  });
  const before = await lerAutomacaoEmpresa(db, 'a');
  expect(db.$transaction).toHaveBeenCalledTimes(1);
  expect(db.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'RepeatableRead' });
  expect(db.appSetting.create).not.toHaveBeenCalled(); expect(db.appSetting.updateMany).not.toHaveBeenCalled();
  await salvarAutomacaoEmpresa(db, 'a', 'user', { expectedRevision: before.revision, requestId: 'snapshot-save-001', agendaEventos: { patch: { defaults: { captura: { enabled: false } } } } });
  expect(db.$transaction).toHaveBeenCalledTimes(2);
  expect(db.$transaction.mock.calls[1][1]).toEqual({ isolationLevel: 'Serializable' });
});

test('troca global durante GET não mistura effective com versão nova em snapshot simulado', async () => {
  const db = database();
  const oldRead = db.appSetting.findUnique.getMockImplementation();
  const policyKey = 'agenda_eventos_global:v1';
  let changed = false;
  db.$transaction.mockImplementation(async callback => {
    const frozenGlobal = await oldRead({ where: { key: policyKey } });
    const { $transaction: _outer, ...tx } = db;
    tx.appSetting = { ...db.appSetting, findUnique: jest.fn(async args => {
      if (!changed) {
        changed = true;
        await db.appSetting.create({ data: { key: policyKey, value: {
          schemaVersion: 1, version: 1, updatedAt: '2026-11-04T12:00:00Z', updatedBy: 'other',
          parameters: { schemaVersion: 1, defaults: { captura: { hour: 9 } } },
        } } });
      }
      return args.where.key === policyKey ? cloneSetting(frozenGlobal) : oldRead(args);
    }) };
    return callback(tx);
  });
  const first = await lerAutomacaoEmpresa(db, 'a');
  expect(first.agendaEventos.globalConfigured).toBe(false);
  expect(first.agendaEventos.effective.IRPJ.captura).toBeUndefined();
  const second = await lerAutomacaoEmpresa(db, 'a');
  expect(second.agendaEventos.globalConfigured).toBe(true);
  expect(second.agendaEventos.effective.IRPJ.captura.hour).toBe(9);
  expect(second.revision).not.toBe(first.revision);
});

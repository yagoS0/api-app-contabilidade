const cloneSetting = value => JSON.parse(JSON.stringify(value));
import { lerAgendaEventosGlobal, salvarAgendaEventosGlobal, lerAgendaEventosEmpresa } from '../AgendaEventosService.js';
const user = { id: 'contador-a', role: 'contador' };
function database() {
  let rows = new Map([['serpro_runtime_settings', { key: 'serpro_runtime_settings', value: { clientSecret: 'secret-test', rotinas: { conferencia: { enabled: false, day: 1, hour: 7 } } } }]]);
  const db = { appSetting: {
    findUnique: jest.fn(async ({ where }) => cloneSetting(rows.get(where.key) || null)),
    create: jest.fn(async ({ data }) => { if (rows.has(data.key)) throw Object.assign(Error('duplicate'), { code: 'P2002' }); rows.set(data.key, cloneSetting(data)); return data; }),
    updateMany: jest.fn(async ({ where, data }) => { const old = rows.get(where.key); if (!old || JSON.stringify(old.value) !== JSON.stringify(where.value.equals)) return { count: 0 }; rows.set(where.key, { key: where.key, value: cloneSetting(data.value) }); return { count: 1 }; }),
  } };
  db.$transaction = jest.fn(async fn => { const before = new Map([...rows].map(([key,value]) => [key,cloneSetting(value)])); try { return await fn(db); } catch (e) { rows = before; throw e; } });
  return db;
}
const input = revision => ({ requestId: 'request-global-001', agendaEventos: { expectedRevision: revision, patch: { tributos: { IRPJ: { captura: { enabled: false, hour: 7, businessDaysBefore: 3 } } } } } });
test('GET ausente não grava nem expõe segredos; save preparado preserva legado e replay', async () => {
  const db = database(), before = await lerAgendaEventosGlobal(db);
  expect(before).toMatchObject({ configured: false, relativeConsumerReady: true, capabilities: { capture: false }, executionMode: 'LEGADO' });
  expect(db.appSetting.create).not.toHaveBeenCalled();
  const legacy = await db.appSetting.findUnique({ where: { key: 'serpro_runtime_settings' } });
  const request = input(before.revision), saved = await salvarAgendaEventosGlobal(db, user, request);
  expect(saved).toMatchObject({ configured: true, version: 1, relativeConsumerReady: true, capabilities: { capture: false }, prepared: true });
  expect(saved.tributos.IRPJ.captura.enabled).toBe(false);
  expect(JSON.stringify(saved)).not.toContain('secret-test');
  expect(await salvarAgendaEventosGlobal(db, user, request)).toEqual(saved);
  expect(db.appSetting.create).toHaveBeenCalledTimes(2);
  expect(await db.appSetting.findUnique({ where: { key: 'serpro_runtime_settings' } })).toEqual(legacy);
});
test.each([{ empresas: [] }, { agenda: {} }, { enabled: true }, { credentials: {} }])('pedido misto rejeita antes de escrita %j', async extra => {
  const db = database(), p = input((await lerAgendaEventosGlobal(db)).revision);
  await expect(salvarAgendaEventosGlobal(db, user, { ...p, ...extra })).rejects.toMatchObject({ status: 422 });
  expect(db.$transaction).not.toHaveBeenCalled(); expect(db.appSetting.create).not.toHaveBeenCalled();
});
test('payload diferente no replay, revisão antiga e ator sem acesso são recusados', async () => {
  const db = database(), old = await lerAgendaEventosGlobal(db), p = input(old.revision);
  await salvarAgendaEventosGlobal(db, user, p);
  const different = cloneSetting(p); different.agendaEventos.patch.tributos.IRPJ.captura.hour = 9;
  await expect(salvarAgendaEventosGlobal(db, user, different)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  await expect(salvarAgendaEventosGlobal(db, user, { ...p, requestId: 'new-request-001' })).rejects.toMatchObject({ code: 'EVENT_POLICY_CHANGED' });
  await expect(salvarAgendaEventosGlobal(db, { id: 'staff', role: 'staff' }, p)).rejects.toMatchObject({ status: 403 });
});
test('falha de auditoria reverte parâmetros no adaptador transacional; CAS recusa disputa', async () => {
  const db = database(), before = await lerAgendaEventosGlobal(db), original = db.appSetting.create.getMockImplementation();
  db.appSetting.create.mockImplementation(args => { if (args.data.key.startsWith('agenda_eventos_request:')) throw Error('audit unavailable'); return original(args); });
  await expect(salvarAgendaEventosGlobal(db, user, input(before.revision))).rejects.toThrow('audit unavailable');
  expect(await lerAgendaEventosGlobal(db)).toEqual(before);
  db.appSetting.create.mockImplementation(original);
  const saved = await salvarAgendaEventosGlobal(db, user, input(before.revision));
  db.appSetting.updateMany.mockResolvedValue({ count: 0 });
  await expect(salvarAgendaEventosGlobal(db, user, { ...input(saved.revision), requestId: 'request-global-002' })).rejects.toMatchObject({ code: 'EVENT_POLICY_CHANGED' });
  expect(await lerAgendaEventosGlobal(db)).toEqual(saved);
});
test('herança empresarial muda revisão global sem gravar override ou ativar', async () => {
  const db = database(), a = await lerAgendaEventosEmpresa(db, 'empresa-a');
  await salvarAgendaEventosGlobal(db, user, input((await lerAgendaEventosGlobal(db)).revision));
  const b = await lerAgendaEventosEmpresa(db, 'empresa-a');
  expect(b.globalRevision).not.toBe(a.globalRevision); expect(b.revision).toBe(a.revision);
  expect(b.effective.IRPJ.captura.hour).toBe(7); expect(b.relativeConsumerReady).toBe(true); expect(b.capabilities.capture).toBe(false);
  expect(await db.appSetting.findUnique({ where: { key: 'agenda_eventos_empresa:v1:empresa-a' } })).toBeNull();
});

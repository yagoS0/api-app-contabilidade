jest.mock('../SerproRuntimeSettings.js', () => ({ ROTINA_KEYS: ['das', 'inss'] }));
jest.mock('../CompanyRotinasService.js', () => ({ ROTINA_LABELS: { das: 'DAS', inss: 'INSS' } }));
import { lerAutomacaoEmpresa, salvarAutomacaoEmpresa } from '../CompanyAutomationService.js';

function database() {
  const rows = [], settings = new Map([['serpro_runtime_settings', { value: { clientSecret: 'nunca-expor', rotinas: { das: { enabled: true, day: 5, hour: 7 } } } }]]);
  const db = {
    portalClient: { findUnique: jest.fn(async () => ({ id: 'a', companyId: 'legacy-a' })) },
    company: { findUnique: jest.fn(async () => ({ regimeTributario: 'SIMPLES' })) },
    companyFirmAccess: { findUnique: jest.fn(async () => ({ status: 'ACTIVE', role: 'ACCOUNTANT' })) },
    companyRotina: { findMany: jest.fn(async ({ where }) => rows.filter(r => r.portalClientId === where.portalClientId)), upsert: jest.fn(async ({ create, update }) => { const old = rows.find(r => r.rotina === create.rotina && r.portalClientId === create.portalClientId); if (old) Object.assign(old, update); else rows.push(create); }) },
    appSetting: { findUnique: jest.fn(async ({ where }) => settings.get(where.key) || null), create: jest.fn(async ({ data }) => settings.set(data.key, data)), upsert: jest.fn(async ({ create }) => settings.set(create.key, create)) },
    $queryRaw: jest.fn(),
  };
  db.$transaction = jest.fn(fn => fn(db));
  return db;
}
test('leitura não habilita rotinas nem expõe credenciais', async () => {
  const db = database(), r = await lerAutomacaoEmpresa(db, 'a');
  expect(r.rotinas.every(x => !x.enabled)).toBe(true);
  expect(JSON.stringify(r)).not.toContain('nunca-expor');
  expect(r.rotinas[0].agenda.hour).toBe(7);
  expect(db.companyRotina.upsert).not.toHaveBeenCalled();
  expect(db.appSetting.create).not.toHaveBeenCalled();
});
test('salvamento idempotente por empresa e auditoria na mesma transação', async () => {
  const db = database(), before = await lerAutomacaoEmpresa(db, 'a');
  const input = { expectedRevision: before.revision, requestId: 'pedido-123', rotinas: { das: true } };
  const r = await salvarAutomacaoEmpresa(db, 'a', 'user', input);
  expect(r.rotinas[0].enabled).toBe(true);
  expect(await salvarAutomacaoEmpresa(db, 'a', 'user', input)).toEqual(r);
  expect(db.companyRotina.upsert).toHaveBeenCalledTimes(1);
  expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  await expect(salvarAutomacaoEmpresa(db, 'b', 'user', input)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
});
test('versão antiga e valores inválidos não sobrescrevem escolhas', async () => {
  const db = database(), before = await lerAutomacaoEmpresa(db, 'a');
  const input = { expectedRevision: before.revision, requestId: 'pedido-123', rotinas: { das: true } };
  await salvarAutomacaoEmpresa(db, 'a', 'user', input);
  await expect(salvarAutomacaoEmpresa(db, 'a', 'user', { ...input, requestId: 'pedido-456', rotinas: { inss: true } })).rejects.toMatchObject({ code: 'AUTOMATION_CHANGED' });
  await expect(salvarAutomacaoEmpresa(db, 'a', 'user', { ...input, rotinas: { das: 'true' } })).rejects.toMatchObject({ status: 422 });
  expect(db.companyRotina.upsert).toHaveBeenCalledTimes(1);
});
test('acesso revogado bloqueia gravação mesmo após middleware', async () => {
  const db = database(), r = await lerAutomacaoEmpresa(db, 'a');
  db.companyFirmAccess.findUnique.mockResolvedValue({ status: 'REVOKED', role: 'ACCOUNTANT' });
  await expect(salvarAutomacaoEmpresa(db, 'a', 'user', { expectedRevision: r.revision, requestId: 'pedido-123', rotinas: { das: true } })).rejects.toMatchObject({ status: 403 });
  expect(db.companyRotina.upsert).not.toHaveBeenCalled();
});

test('Lucro Presumido não permite habilitar DAS do Simples e preserva escolhas anteriores', async () => {
  const db = database();
  db.company.findUnique.mockResolvedValue({ regimeTributario: 'LUCRO_PRESUMIDO' });
  const before = await lerAutomacaoEmpresa(db, 'a');
  expect(before.regime).toBe('LUCRO_PRESUMIDO');
  expect(before.rotinas.find(r => r.key === 'das').applicable).toBe(false);
  expect(before.rotinas.find(r => r.key === 'inss').applicable).toBe(true);
  await expect(salvarAutomacaoEmpresa(db, 'a', 'user', { expectedRevision: before.revision, requestId: 'pedido-lp-123', rotinas: { das: true } }))
    .rejects.toMatchObject({ code: 'ROUTINE_NOT_APPLICABLE', status: 422 });
  expect(db.companyRotina.upsert).not.toHaveBeenCalled();
});

test('mudança de regime invalida prévia sem executar consultas ou habilitar rotinas', async () => {
  const db = database(), before = await lerAutomacaoEmpresa(db, 'a');
  db.company.findUnique.mockResolvedValue({ regimeTributario: 'LUCRO_PRESUMIDO' });
  await expect(salvarAutomacaoEmpresa(db, 'a', 'user', { expectedRevision: before.revision, requestId: 'pedido-change-123', rotinas: { das: true } }))
    .rejects.toMatchObject({ code: 'AUTOMATION_CHANGED' });
  expect(db.companyRotina.upsert).not.toHaveBeenCalled();
});

test('regime desconhecido permite salvar pausa mas impede habilitação presumida', async () => {
  const db = database(); db.company.findUnique.mockResolvedValue({ regimeTributario: null });
  const before = await lerAutomacaoEmpresa(db, 'a');
  expect(before.unavailableReason).toBeTruthy(); expect(before.applicableKeys).toEqual([]);
  await expect(salvarAutomacaoEmpresa(db, 'a', 'user', { expectedRevision: before.revision, requestId: 'pedido-unknown', rotinas: { inss: true } }))
    .rejects.toMatchObject({ code: 'ROUTINE_NOT_APPLICABLE' });
  const saved = await salvarAutomacaoEmpresa(db, 'a', 'user', { expectedRevision: before.revision, requestId: 'pedido-pause-unknown', serproPolicy: { paused: true, reason: 'Conferir cadastro' } });
  expect(saved.serproPolicy.paused).toBe(true); expect(db.companyRotina.upsert).not.toHaveBeenCalled();
});

test('pausa e retomada auditadas sem mudar rotinas; replay mantém o resultado e motivo é obrigatório', async () => {
  const db = database(), initial = await lerAutomacaoEmpresa(db, 'a');
  expect(initial.serproPolicy.paused).toBe(false);
  const input = { expectedRevision: initial.revision, requestId: 'pausa-123', serproPolicy: { paused: true, reason: '  Conferir documentos  ' } };
  const paused = await salvarAutomacaoEmpresa(db, 'a', 'user', input);
  expect(paused.serproPolicy).toMatchObject({ paused: true, reason: 'Conferir documentos', updatedBy: 'user' });
  expect(paused.revision).not.toBe(initial.revision);
  expect(await salvarAutomacaoEmpresa(db, 'a', 'user', input)).toEqual(paused);
  expect(db.companyRotina.upsert).not.toHaveBeenCalled();
  expect(db.appSetting.upsert).toHaveBeenCalledTimes(1);
  await expect(salvarAutomacaoEmpresa(db, 'a', 'user', { ...input, requestId: 'retoma-1', expectedRevision: paused.revision, serproPolicy: { paused: false, reason: ' ' } })).rejects.toMatchObject({ status: 422 });
  const resumed = await salvarAutomacaoEmpresa(db, 'a', 'user', { ...input, requestId: 'retoma-2', expectedRevision: paused.revision, serproPolicy: { paused: false, reason: 'Revisão concluída' } });
  expect(resumed.serproPolicy.paused).toBe(false);
  expect(db.appSetting.create.mock.calls.at(-1)[0].data.value.beforeSerproPolicy.paused).toBe(true);
});

test('lembretes ausentes ficam OFF, independentes da consulta fiscal e da agenda global', async () => {
  const db = database();
  await db.companyRotina.upsert({ create: { portalClientId: 'a', rotina: 'pagamento', enabled: true }, update: {} });
  const before = await lerAutomacaoEmpresa(db, 'a');
  expect(before.lembretes).toMatchObject({ enabled: false, agenda: { enabled: false, hour: null } });
  db.companyRotina.upsert.mockClear();
  const input = { expectedRevision: before.revision, requestId: 'reminder-123', lembretes: { enabled: true } };
  const saved = await salvarAutomacaoEmpresa(db, 'a', 'user', input);
  expect(saved.lembretes).toMatchObject({ enabled: true, agenda: { enabled: false } });
  expect(saved.rotinas).toEqual(before.rotinas);
  expect(saved.serproPolicy).toEqual(before.serproPolicy);
  expect(db.companyRotina.upsert).toHaveBeenCalledTimes(1);
  expect(db.companyRotina.upsert.mock.calls[0][0].create.rotina).toBe('avisos_guias_whatsapp');
  expect(db.appSetting.upsert).not.toHaveBeenCalled();
  expect(db.appSetting.create.mock.calls.at(-1)[0].data.value.beforeLembretes.enabled).toBe(false);
  expect(await salvarAutomacaoEmpresa(db, 'a', 'user', input)).toEqual(saved);
  await expect(salvarAutomacaoEmpresa(db, 'a', 'user', { ...input, lembretes: { enabled: false } })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  await expect(salvarAutomacaoEmpresa(db, 'a', 'user', { ...input, requestId: 'reminder-stale' })).rejects.toMatchObject({ code: 'AUTOMATION_CHANGED' });
});

test.each([null, [], {}, { enabled: 'true' }, { enabled: true, hour: 10 }])('rejeita contrato de lembretes inválido %j sem mutações', async lembretes => {
  const db = database(), before = await lerAutomacaoEmpresa(db, 'a');
  await expect(salvarAutomacaoEmpresa(db, 'a', 'user', { expectedRevision: before.revision, requestId: 'invalid-reminder', lembretes })).rejects.toMatchObject({ status: 422 });
  expect(db.companyRotina.upsert).not.toHaveBeenCalled();
});

test('permissão revogada bloqueia lembretes, inclusive replay de pedido salvo', async () => {
  const db = database(), before = await lerAutomacaoEmpresa(db, 'a');
  const input = { expectedRevision: before.revision, requestId: 'access-reminder', lembretes: { enabled: true } };
  await salvarAutomacaoEmpresa(db, 'a', 'user', input);
  db.companyRotina.upsert.mockClear();
  db.companyFirmAccess.findUnique.mockResolvedValue({ status: 'ACTIVE', role: 'STAFF' });
  await expect(salvarAutomacaoEmpresa(db, 'a', 'user', input)).rejects.toMatchObject({ status: 403 });
  expect(db.companyRotina.upsert).not.toHaveBeenCalled();
});

test('agenda global entra na revisão; leitura não salva ou expõe dados privados', async () => {
  const db = database(), before = await lerAutomacaoEmpresa(db, 'a');
  await db.appSetting.upsert({ create: { key: 'serpro_runtime_settings', value: { rotinas: { avisos_guias_whatsapp: { enabled: true, day: 1, hour: 8, frequency: 'DAILY' } } } } });
  const current = await lerAutomacaoEmpresa(db, 'a');
  expect(current.lembretes).toMatchObject({ enabled: false, agenda: { enabled: true, hour: 8 } });
  await expect(salvarAutomacaoEmpresa(db, 'a', 'user', { expectedRevision: before.revision, requestId: 'agenda-reminder', lembretes: { enabled: true } })).rejects.toMatchObject({ code: 'AUTOMATION_CHANGED' });
  expect(db.companyRotina.upsert).not.toHaveBeenCalled();
});

jest.mock('../SerproRuntimeSettings.js', () => ({ ROTINA_KEYS: ['das', 'inss'] }));
jest.mock('../../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../CompanyRotinasService.js', () => ({ ROTINA_LABELS: { das: 'DAS', inss: 'INSS' } }));
import { lerAutomacaoEmpresa, salvarAutomacaoEmpresa, identidadeSelecaoCicloSimples } from '../CompanyAutomationService.js';

test.each(['global', 'empresa'])('replay após mudança da pausa %s exige recarga sem regravar histórico', async scope => {
  const db = database(), before = await lerAutomacaoEmpresa(db, 'a');
  const input = { expectedRevision: before.revision, requestId: 'replay-atual', rotinas: { das: true } };
  const saved = await salvarAutomacaoEmpresa(db, 'a', 'user', input);
  const audit = structuredClone(db.appSetting.create.mock.calls[0][0]);
  const key = scope === 'global' ? 'automacao_ciclo_fiscal' : 'company_automation_policy:a';
  const value = scope === 'global'
    ? { paused: true, version: 1, reason: 'Conferir', actor: { id: 'outro' }, changedAt: '2026-11-01T10:00:00Z', resumedAt: null }
    : { paused: true, version: 1, reason: 'Conferir', updatedBy: 'outro', updatedAt: '2026-11-01T10:00:00Z', resumedAt: null };
  await db.appSetting.upsert({ create: { key, value } });
  await expect(salvarAutomacaoEmpresa(db, 'a', 'user', input)).rejects.toMatchObject({ code: 'AUTOMATION_CHANGED', status: 409 });
  expect(db.appSetting.create).toHaveBeenCalledTimes(1);
  expect(db.appSetting.create.mock.calls[0][0]).toEqual(audit);
  expect(db.appSetting.upsert).toHaveBeenCalledTimes(1);
  expect(db.companyRotina.upsert).toHaveBeenCalledTimes(1);
  expect(saved.effectiveAutomationState).toBe('SUBJECT_TO_SCHEDULE');
  const current = await lerAutomacaoEmpresa(db, 'a');
  expect(current.effectiveAutomationState).toBe(scope === 'global' ? 'GLOBAL_PAUSED' : 'COMPANY_PAUSED');
  expect(current.rotinas[0].enabled).toBe(true);
});

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

test('token interno detecta ABA; no-op e replay preservam token, legado não migra em leitura', async () => {
  const db = database(), key = 'ciclo_simples_config:a';
  const legacy = { enabled: true, fontes: ['NFSE', 'NFE'] };
  await db.appSetting.upsert({ create: { key, value: legacy } });
  const identity = identidadeSelecaoCicloSimples(legacy);
  expect(identity).toBe(identidadeSelecaoCicloSimples({ enabled: true, fontes: ['NFE', 'NFSE'] }));
  expect(identity).toMatch(/^legacy:/);
  const save = async (cicloSimples, requestId) => { const before = await lerAutomacaoEmpresa(db, 'a'); return salvarAutomacaoEmpresa(db, 'a', 'user', { expectedRevision: before.revision, requestId, cicloSimples }); };
  await save({ enabled: true, fontes: ['NFE', 'NFSE'] }, 'noop-legado');
  expect((await db.appSetting.findUnique({ where: { key } })).value).toEqual(legacy);
  await save({ enabled: false, fontes: ['NFE', 'NFSE'] }, 'desativacao-token');
  const disabled = (await db.appSetting.findUnique({ where: { key } })).value;
  expect(disabled.selectionToken).toMatch(/^[a-f0-9-]{36}$/);
  await save({ enabled: true, fontes: ['NFE', 'NFSE'] }, 'reativacao-token');
  const restored = (await db.appSetting.findUnique({ where: { key } })).value;
  expect(restored.selectionToken).not.toBe(disabled.selectionToken);
  expect(identidadeSelecaoCicloSimples(restored)).not.toBe(identity);
  const before = await lerAutomacaoEmpresa(db, 'a');
  const input = { expectedRevision: before.revision, requestId: 'noop-token', cicloSimples: { enabled: true, fontes: ['NFSE', 'NFE'] } };
  const once = await salvarAutomacaoEmpresa(db, 'a', 'user', input);
  expect(await salvarAutomacaoEmpresa(db, 'a', 'user', input)).toEqual(once);
  expect((await db.appSetting.findUnique({ where: { key } })).value).toEqual(restored);
  expect(once.cicloSimples).not.toHaveProperty('selectionToken');
  await expect(salvarAutomacaoEmpresa(db, 'a', 'user', { ...input, requestId: 'token-injetado', cicloSimples: { ...input.cicloSimples, selectionToken: restored.selectionToken } })).rejects.toMatchObject({ code: 'INVALID_AUTOMATION' });
});
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

test('pausa automática própria é auditada, não muda SERPRO, rotinas ou lembretes e replay não repete', async () => {
  const db = database(), initial = await lerAutomacaoEmpresa(db, 'a');
  const input = { expectedRevision: initial.revision, requestId: 'automacao-pause', automationPolicy: { paused: true, reason: 'Conferir ciclo' } };
  const saved = await salvarAutomacaoEmpresa(db, 'a', 'user', input);
  expect(saved.automationPolicy).toMatchObject({ paused: true, version: 1, updatedBy: 'user', reason: 'Conferir ciclo' });
  expect(saved.effectiveAutomationState).toBe('COMPANY_PAUSED');
  expect(saved.serproPolicy).toEqual(initial.serproPolicy);
  expect(saved.rotinas).toEqual(initial.rotinas); expect(saved.lembretes).toEqual(initial.lembretes);
  expect(await salvarAutomacaoEmpresa(db, 'a', 'user', input)).toEqual(saved);
  expect(db.appSetting.upsert).toHaveBeenCalledTimes(1);
  expect(db.appSetting.create.mock.calls[0][0].data.value.beforeAutomationPolicy.paused).toBe(false);
  await expect(salvarAutomacaoEmpresa(db, 'a', 'user', { ...input, requestId: 'stale-auto' })).rejects.toMatchObject({ code: 'AUTOMATION_CHANGED' });
  db.companyFirmAccess.findUnique.mockResolvedValue({ status: 'REVOKED', role: 'ACCOUNTANT' });
  await expect(salvarAutomacaoEmpresa(db, 'a', 'user', input)).rejects.toMatchObject({ status: 403 });
});

test('ciclo opt-in mantém uma fonte de configuração e revisão auditada', async () => {
  const db = database(), before = await lerAutomacaoEmpresa(db, 'a');
  expect(before.cicloSimples).toEqual({ enabled: false, fontes: [], applicableCurrentRegime: true, configurationValid: false });
  const input = { expectedRevision: before.revision, requestId: 'ciclo-pedido-123', cicloSimples: { enabled: true, fontes: ['NFSE'] } };
  const saved = await salvarAutomacaoEmpresa(db, 'a', 'user', input);
  expect(saved.cicloSimples).toEqual({ ...input.cicloSimples, applicableCurrentRegime: true, configurationValid: true });
  expect(saved.revision).not.toBe(before.revision);
  expect(db.companyRotina.upsert).not.toHaveBeenCalled();
  expect(db.appSetting.create.mock.calls[0][0].data.value.beforeCicloSimples).toEqual(before.cicloSimples);
  expect(await salvarAutomacaoEmpresa(db, 'a', 'user', input)).toEqual(saved);
  await expect(salvarAutomacaoEmpresa(db, 'a', 'user', { ...input, requestId: 'ciclo-pedido-456' })).rejects.toMatchObject({ code: 'AUTOMATION_CHANGED' });
});
test.each([{ enabled: true, fontes: [] }, { enabled: true, fontes: ['NFE', 'NFE'] }, { enabled: true, fontes: ['OUTRA'] }])('recusa fontes não explícitas ou inválidas %j', async cicloSimples => {
  const db = database(), before = await lerAutomacaoEmpresa(db, 'a');
  await expect(salvarAutomacaoEmpresa(db, 'a', 'user', { expectedRevision: before.revision, requestId: 'ciclo-invalido', cicloSimples })).rejects.toMatchObject({ status: 422 });
  expect(db.appSetting.create).not.toHaveBeenCalled();
});

test('seleção anterior permanece visível fora do regime atual e pode ser desativada com auditoria', async () => {
  const db = database();
  await db.appSetting.upsert({ create: { key: 'ciclo_simples_config:a', value: { enabled: true, fontes: ['NFSE'] } } });
  db.company.findUnique.mockResolvedValue({ regimeTributario: 'LUCRO_PRESUMIDO' });
  const before = await lerAutomacaoEmpresa(db, 'a');
  expect(before.cicloSimples).toEqual({ enabled: true, fontes: ['NFSE'], applicableCurrentRegime: false, configurationValid: true });
  expect(db.appSetting.create).not.toHaveBeenCalled();
  const result = await salvarAutomacaoEmpresa(db, 'a', 'user', { expectedRevision: before.revision, requestId: 'desativar-ciclo-legado', cicloSimples: { enabled: false, fontes: ['NFSE'] } });
  expect(result.cicloSimples).toEqual({ ...before.cicloSimples, enabled: false });
  expect(db.appSetting.create.mock.calls[0][0].data.value.beforeCicloSimples).toEqual(before.cicloSimples);
});

test.each([
  { anterior: { enabled: false, fontes: ['NFSE'] }, novo: { enabled: true, fontes: ['NFSE'] } },
  { anterior: { enabled: true, fontes: ['NFSE'] }, novo: { enabled: true, fontes: ['NFSE', 'NFE'] } },
  { anterior: { enabled: true, fontes: ['NFSE'] }, novo: { enabled: false, fontes: ['NFSE', 'NFE'] } },
])('fora do regime atual recusa ativação ou ampliação, preservando seleção: %j', async ({ anterior, novo }) => {
  const db = database();
  await db.appSetting.upsert({ create: { key: 'ciclo_simples_config:a', value: anterior } });
  db.company.findUnique.mockResolvedValue({ regimeTributario: 'LUCRO_PRESUMIDO' });
  const before = await lerAutomacaoEmpresa(db, 'a');
  db.appSetting.upsert.mockClear();
  await expect(salvarAutomacaoEmpresa(db, 'a', 'user', { expectedRevision: before.revision, requestId: 'bloqueio-ciclo-legado', cicloSimples: novo })).rejects.toMatchObject({ code: 'ROUTINE_NOT_APPLICABLE' });
  expect(db.appSetting.upsert).not.toHaveBeenCalled();
  expect(db.appSetting.create).not.toHaveBeenCalled();
});

test('salvar outros controles fora do regime preserva ciclo selecionado sem reativar', async () => {
  const db = database(), selected = { enabled: true, fontes: ['NFSE'] };
  await db.appSetting.upsert({ create: { key: 'ciclo_simples_config:a', value: selected } });
  db.company.findUnique.mockResolvedValue({ regimeTributario: 'LUCRO_PRESUMIDO' });
  const before = await lerAutomacaoEmpresa(db, 'a');
  const result = await salvarAutomacaoEmpresa(db, 'a', 'user', { expectedRevision: before.revision, requestId: 'manter-ciclo-legado', cicloSimples: selected, lembretes: { enabled: false } });
  expect(result.cicloSimples).toEqual(before.cicloSimples);
  expect(result.lembretes.enabled).toBe(false);
});

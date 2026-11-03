import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { alterarAutomacaoCicloFiscal, lerAutomacaoCicloFiscal, CICLO_FISCAL_KEY } from '../AutomacaoCicloFiscalService.js';
import { lerAutomacaoEmpresa, salvarAutomacaoEmpresa } from '../serpro/CompanyAutomationService.js';
import { chavePoliticaAutomacao } from '../serpro/CompanyAutomationPolicy.js';
const raw = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
if (!raw) throw new Error('ALTAN_GOVERNANCE_TEST_DATABASE_URL obrigatório.');
const url = new URL(raw);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_governance_test')) throw new Error('Somente PostgreSQL descartável loopback _governance_test.');
const db = new PrismaClient({ datasources: { db: { url: raw } } });
const actor = { id: `pausa-test-${randomUUID()}`, role: 'admin' };
beforeAll(async () => {
  if (await db.appSetting.findFirst({ where: { key: { startsWith: CICLO_FISCAL_KEY } } })) throw new Error('Ensaio exige namespace de pausa vazio; não remove registros preexistentes.');
});

test('pausa empresarial real: isolamento, concorrência, replay e rollback da auditoria', async () => {
  const a = randomUUID(), b = randomUUID();
  const suffix = randomUUID();
  try {
    await db.portalClient.createMany({ data: [{ id: a, razao: 'Teste descartável A', cnpj: `test-a-${suffix}` }, { id: b, razao: 'Teste descartável B', cnpj: `test-b-${suffix}` }] });
    const initial = await lerAutomacaoEmpresa(db, a);
    const beforeB = await lerAutomacaoEmpresa(db, b);
    const input = { expectedRevision: initial.revision, requestId: `pause-${suffix}`, automationPolicy: { paused: true, reason: 'Ensaio local' } };
    const attempts = await Promise.allSettled([salvarAutomacaoEmpresa(db, a, actor.id, input, { isAdmin: true }), salvarAutomacaoEmpresa(db, a, actor.id, input, { isAdmin: true })]);
    expect(attempts.filter(r => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    for (const r of attempts.filter(r => r.status === 'rejected')) expect(r.reason.code).toBe('P2034');
    const saved = await salvarAutomacaoEmpresa(db, a, actor.id, input, { isAdmin: true });
    expect(saved.automationPolicy).toMatchObject({ paused: true, version: 1, updatedBy: actor.id });
    expect(saved.serproPolicy).toEqual(initial.serproPolicy);
    expect(saved.rotinas).toEqual(initial.rotinas);
    expect((await lerAutomacaoEmpresa(db, b)).automationPolicy).toEqual(beforeB.automationPolicy);
    expect(await db.appSetting.count({ where: { key: `company_automation_request:${actor.id}:${input.requestId}` } })).toBe(1);
    const broken = { $transaction: (fn, options) => db.$transaction(tx => fn(new Proxy(tx, { get(target, prop) {
      if (prop === 'appSetting') return { ...target.appSetting, create: () => { throw new Error('company-audit-failed'); } };
      return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
    } })), options) };
    await expect(salvarAutomacaoEmpresa(broken, a, actor.id, { expectedRevision: saved.revision, requestId: `resume-${suffix}`, automationPolicy: { paused: false, reason: 'Retomar' } }, { isAdmin: true })).rejects.toThrow('company-audit-failed');
    expect((await lerAutomacaoEmpresa(db, a)).automationPolicy).toEqual(saved.automationPolicy);
  } finally {
    await db.appSetting.deleteMany({ where: { key: { in: [chavePoliticaAutomacao(a), chavePoliticaAutomacao(b), `company_automation_request:${actor.id}:pause-${suffix}`, `company_automation_request:${actor.id}:resume-${suffix}`] } } });
    await db.portalClient.deleteMany({ where: { id: { in: [a, b] } } });
  }
});
afterAll(async () => {
  const row = await db.appSetting.findUnique({ where: { key: CICLO_FISCAL_KEY } });
  if (row?.value?.actor?.id === actor.id) await db.appSetting.deleteMany({ where: { key: CICLO_FISCAL_KEY } });
  await db.appSetting.deleteMany({ where: { key: { startsWith: `${CICLO_FISCAL_KEY}:audit:` }, value: { path: ['after', 'actor', 'id'], equals: actor.id } } });
  await db.$disconnect();
});
test('concorrência real, replay, versão obsoleta e rollback de auditoria', async () => {
  const input = { paused: true, version: 0, reason: 'Ensaio isolado', actor };
  const results = await Promise.all([alterarAutomacaoCicloFiscal(input, db), alterarAutomacaoCicloFiscal(input, db)]);
  expect(results[0]).toEqual(results[1]);
  expect(await db.appSetting.count({ where: { key: { startsWith: `${CICLO_FISCAL_KEY}:audit:` } } })).toBe(1);
  await expect(alterarAutomacaoCicloFiscal({ ...input, paused: false }, db)).rejects.toMatchObject({ code: 'CICLO_FISCAL_CONFLITO' });
  const broken = { $transaction: fn => db.$transaction(tx => fn(new Proxy(tx, { get(target, prop) {
    if (prop === 'appSetting') return { ...target.appSetting, create: () => { throw new Error('audit-failed'); } };
    return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
  } }))) };
  await expect(alterarAutomacaoCicloFiscal({ ...input, paused: false, version: 1 }, broken)).rejects.toThrow('audit-failed');
  expect(await lerAutomacaoCicloFiscal(db)).toMatchObject({ paused: true, version: 1 });
  expect(await alterarAutomacaoCicloFiscal({ ...input, paused: false, version: 1 }, db)).toMatchObject({ paused: false, version: 2 });
});

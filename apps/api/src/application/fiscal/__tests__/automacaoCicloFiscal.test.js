jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { lerAutomacaoCicloFiscal, alterarAutomacaoCicloFiscal, conferirAutomacaoCicloFiscal, CICLO_FISCAL_KEY } from '../AutomacaoCicloFiscalService.js';
import { comAutomacaoCicloFiscal, comAutomacaoEmpresa, conferirContextoCicloFiscal, conferirTransporteCicloFiscal } from '../automacaoCicloFiscalContext.js';
import { chavePoliticaAutomacao } from '../serpro/CompanyAutomationPolicy.js';

const actor = { id: 'operador-teste', role: 'contador', name: 'Teste' };
function memoryDb() {
  let rows = new Map(), queue = Promise.resolve();
  const db = { portalClient: { findUnique: jest.fn(async ({ where }) => ['a', 'b'].includes(where.id) ? { id: where.id } : null) }, $queryRaw: jest.fn(), appSetting: {
    findUnique: jest.fn(async ({ where }) => rows.has(where.key) ? structuredClone(rows.get(where.key)) : null),
    upsert: jest.fn(async ({ create }) => { rows.set(create.key, structuredClone(create)); }),
    create: jest.fn(async ({ data }) => { if (rows.has(data.key)) throw new Error('duplicate'); rows.set(data.key, structuredClone(data)); }),
  } };
  db.$transaction = fn => {
    const task = queue.then(async () => { const before = structuredClone(rows); try { return await fn(db); } catch (e) { rows = before; throw e; } });
    queue = task.catch(() => {}); return task;
  };
  return db;
}
const change = (db, paused = true, version = 0, reason = 'Manutenção') => alterarAutomacaoCicloFiscal({ paused, version, reason, actor }, db);
test('legado não escreve nem ativa agendas; leitura falha fechada', async () => {
  const db = memoryDb();
  expect(await lerAutomacaoCicloFiscal(db)).toMatchObject({ legacy: true, paused: false, version: 0 });
  expect(db.appSetting.create).not.toHaveBeenCalled(); expect(db.appSetting.upsert).not.toHaveBeenCalled();
  db.appSetting.findUnique.mockRejectedValueOnce(new Error('offline'));
  await expect(conferirAutomacaoCicloFiscal({ db })).rejects.toMatchObject({ code: 'CICLO_FISCAL_INDISPONIVEL' });
  db.appSetting.findUnique.mockResolvedValueOnce({ value: { paused: false } });
  await expect(lerAutomacaoCicloFiscal(db)).rejects.toMatchObject({ code: 'CICLO_FISCAL_INDISPONIVEL' });
});

async function companyPolicy(db, id, paused, version = 1) {
  await db.appSetting.upsert({ create: { key: chavePoliticaAutomacao(id), value: { paused, version, reason: 'Conferência', updatedAt: new Date().toISOString(), updatedBy: actor.id, resumedAt: null } } });
}
test('pausa empresarial A não impede B; identidade Company e contexto ausente não liberam transporte', async () => {
  const db = memoryDb(), run = jest.fn();
  await companyPolicy(db, 'a', true);
  await comAutomacaoCicloFiscal({ version: 0 }, async () => {
    await expect(comAutomacaoEmpresa('a', run)).rejects.toMatchObject({ code: 'AUTOMACAO_EMPRESA_PAUSADA' });
    await expect(comAutomacaoEmpresa('legacy-a', run)).rejects.toMatchObject({ code: 'AUTOMACAO_EMPRESA_INDISPONIVEL' });
    await expect(conferirTransporteCicloFiscal()).rejects.toMatchObject({ code: 'AUTOMACAO_EMPRESA_IDENTIDADE_INVALIDA' });
    await comAutomacaoEmpresa('b', async () => { await conferirTransporteCicloFiscal(); run(); });
  }, db);
  expect(run).toHaveBeenCalledTimes(1);
});
test('contextos concorrentes isolam A/B e pausa entre reserva/transporte bloqueia somente A', async () => {
  const db = memoryDb(), sent = [], returned = [];
  let ready, release;
  const barrier = new Promise(r => { ready = r; }), go = new Promise(r => { release = r; });
  await comAutomacaoCicloFiscal({ version: 0 }, async () => {
    const a = comAutomacaoEmpresa('a', async () => { ready(); await go; returned.push('retorno já iniciado'); await conferirTransporteCicloFiscal(); sent.push('a'); });
    const rejected = expect(a).rejects.toMatchObject({ code: 'AUTOMACAO_EMPRESA_PAUSADA' });
    await barrier;
    await companyPolicy(db, 'a', true);
    await comAutomacaoEmpresa('b', async () => {
      await expect(comAutomacaoEmpresa('a', () => {})).rejects.toMatchObject({ code: 'AUTOMACAO_EMPRESA_IDENTIDADE_INVALIDA' });
      await conferirTransporteCicloFiscal(); sent.push('b');
    });
    release(); await rejected;
  }, db);
  expect(sent).toEqual(['b']); expect(returned).toEqual(['retorno já iniciado']);
});
test('retomar empresa não vence pausa global; retomar global não vence pausa empresarial', async () => {
  const db = memoryDb();
  await companyPolicy(db, 'a', false); await change(db);
  await expect(comAutomacaoCicloFiscal({ version: 1 }, () => comAutomacaoEmpresa('a', () => {}), db)).rejects.toMatchObject({ code: 'CICLO_FISCAL_PAUSADO' });
  await companyPolicy(db, 'a', true, 2); await change(db, false, 1);
  await expect(comAutomacaoCicloFiscal({ version: 2 }, () => comAutomacaoEmpresa('a', () => {}), db)).rejects.toMatchObject({ code: 'AUTOMACAO_EMPRESA_PAUSADA' });
});
test('revisão empresarial e falha de leitura impedem saída; manual não ganha bypass SERPRO', async () => {
  const db = memoryDb();
  await comAutomacaoCicloFiscal({ version: 0 }, () => comAutomacaoEmpresa('a', async () => {
    await companyPolicy(db, 'a', false);
    await expect(conferirTransporteCicloFiscal()).rejects.toMatchObject({ code: 'AUTOMACAO_EMPRESA_REVISAO_ALTERADA' });
  }), db);
  db.portalClient.findUnique.mockRejectedValue(new Error('offline'));
  await expect(comAutomacaoCicloFiscal({ version: 0 }, () => comAutomacaoEmpresa('a', () => {}), db)).rejects.toMatchObject({ code: 'AUTOMACAO_EMPRESA_INDISPONIVEL' });
  const ownGuard = jest.fn(() => { throw Object.assign(new Error('SERPRO pausado'), { code: 'SERPRO_EMPRESA_PAUSADA' }); });
  await expect(comAutomacaoEmpresa('a', ownGuard, db)).rejects.toMatchObject({ code: 'SERPRO_EMPRESA_PAUSADA' });
  expect(ownGuard).toHaveBeenCalledTimes(1);
});
test('replay concorrente é idempotente e revisão antiga não retoma', async () => {
  const db = memoryDb();
  const results = await Promise.all([change(db), change(db)]);
  expect(results[0]).toEqual(results[1]); expect(db.appSetting.create).toHaveBeenCalledTimes(1);
  await expect(change(db, false, 0)).rejects.toMatchObject({ code: 'CICLO_FISCAL_CONFLITO' });
  await expect(conferirAutomacaoCicloFiscal({ db })).rejects.toMatchObject({ code: 'CICLO_FISCAL_PAUSADO' });
});
test('auditoria falha desfaz estado e preserva legado', async () => {
  const db = memoryDb(); db.appSetting.create.mockRejectedValueOnce(new Error('audit'));
  await expect(change(db)).rejects.toThrow('audit');
  expect((await lerAutomacaoCicloFiscal(db)).version).toBe(0);
});
test('retomada invalida execução antiga e horário perdido; manual não lê política', async () => {
  const db = memoryDb(); const before = await lerAutomacaoCicloFiscal(db);
  await change(db); const resumed = await change(db, false, 1, 'Retomada');
  await expect(comAutomacaoCicloFiscal(before, () => conferirContextoCicloFiscal(), db)).rejects.toMatchObject({ code: 'CICLO_FISCAL_REVISAO_ALTERADA' });
  await expect(conferirAutomacaoCicloFiscal({ db, scheduledAt: resumed.resumedAt })).rejects.toMatchObject({ code: 'CICLO_FISCAL_HORARIO_ANTERIOR' });
  await expect(conferirAutomacaoCicloFiscal({ db, scheduledAt: new Date(Date.parse(resumed.resumedAt) + 60000).toISOString() })).resolves.toMatchObject({ paused: false });
  db.appSetting.findUnique.mockRejectedValue(new Error('offline'));
  await expect(conferirContextoCicloFiscal(db)).resolves.toBeNull();
});
test('autor não vem do corpo livre e motivo é obrigatório', async () => {
  const db = memoryDb();
  await expect(alterarAutomacaoCicloFiscal({ paused: true, version: 0, reason: 'x', actor: { id: 'staff', role: 'staff' } }, db)).rejects.toMatchObject({ status: 403 });
  await expect(change(db, true, 0, ' ')).rejects.toMatchObject({ status: 400 });
  const result = await change(db);
  expect(result.actor.id).toBe(actor.id);
  expect(db.appSetting.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ key: `${CICLO_FISCAL_KEY}:audit:1` }) }));
});

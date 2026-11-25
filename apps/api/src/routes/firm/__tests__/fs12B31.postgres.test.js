// Real PostgreSQL16, HTTP handlers, canonical ACL and FS12 composition.
// Only session resolution and prohibited external transport are replaced.
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import request from 'supertest';

let mockDb;
let mockBeforeTransaction;
let mockFailAfterInsert = false;
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: new Proxy({}, {
  get(_target, key) {
    if (key === '$transaction') return async (fn, options) => {
      if (mockBeforeTransaction) { const hook = mockBeforeTransaction; mockBeforeTransaction = null; await hook(); }
      return mockDb.$transaction(tx => fn(new Proxy(tx, { get(target, name) {
        if (name === 'apuracaoFs12Revisao' && mockFailAfterInsert) return new Proxy(target[name], { get(model, method) {
          if (method === 'create') return async args => {
            await model.create(args);
            throw Error('SYNTHETIC_PRIVATE_FAILURE_AFTER_INSERT');
          };
          const value = model[method]; return typeof value === 'function' ? value.bind(model) : value;
        } });
        const value = target[name]; return typeof value === 'function' ? value.bind(target) : value;
      } })), options);
    };
    const value = mockDb[key]; return typeof value === 'function' ? value.bind(mockDb) : value;
  },
}) }));
jest.mock('../../../application/fiscal/serpro/SerproHttpClient.js', () => ({
  SerproHttpClient: jest.fn(() => { throw Error('FISCAL_TRANSPORT_FORBIDDEN'); }),
}));
import { SerproHttpClient } from '../../../application/fiscal/serpro/SerproHttpClient.js';
import { createApuracaoV2Router } from '../apuracaoV2.js';
import { criarPersistenciaFs12 } from '../../../modules/fiscal/infrastructure/prisma/fs12DaApuracao.js';
import { confirmarFs12DaApuracao } from '../../../modules/fiscal/application/confirmarFs12DaApuracao.js';

const suite = process.env.ALTAN_TESTE_POSTGRES === '1' ? describe : describe.skip;
let otherDb;
let queries = [];
let queryEvents = [];
import { chaveCoordenacaoFs12 } from '../../../modules/fiscal/infrastructure/prisma/coordenacaoFs12.js';
const date = value => new Date(`${value}T00:00:00.000Z`);
const key = () => randomUUID();
function app(user) {
  const a = express(); a.use(express.json());
  a.use((req, _res, next) => { if (user) req.auth = { user }; next(); });
  a.use('/firm/companies/:companyId', createApuracaoV2Router());
  return a;
}
async function fixture({ opening = '2020-01-01', start = '2020-01-01' } = {}) {
  const id = randomUUID();
  const client = await mockDb.client.create({ data: { name: 'SYNTHETIC FS12 B31', login: id, email: `${id}@example.test`, passwordHash: 'not-a-login' } });
  const company = await mockDb.company.create({ data: { clientId: client.id, razaoSocial: 'SYNTHETIC FS12 B31', cnpj: id, atividades: [], dataAbertura: date(opening) } });
  const portal = await mockDb.portalClient.create({ data: { companyId: company.id, razao: 'SYNTHETIC FS12 B31', cnpj: id } });
  const user = await mockDb.user.create({ data: { name: 'Contador sintético', email: `${key()}@example.test`, passwordHash: 'not-a-login', role: 'contador', accountType: 'FIRM', status: 'active' } });
  const access = await mockDb.companyFirmAccess.create({ data: { companyId: portal.id, userId: user.id, role: 'ACCOUNTANT', status: 'ACTIVE' } });
  const history = await mockDb.regimeHistorico.create({ data: { companyId: company.id, regime: 'SIMPLES', vigenciaInicio: date(start) } });
  return { company, portal, user, access, history };
}
const url = (f, pa = '2026-11') => `/firm/companies/${f.portal.id}/fechamento/${pa}/fs12/confirmacoes`;
const get = (f, pa = '2026-11', user = f.user) => request(app(user)).get(url(f, pa));
const post = (f, body, pa = '2026-11', user = f.user) => request(app(user)).post(url(f, pa)).send(body);
async function command(f, { pa = '2026-11', valor = 0 } = {}) {
  const r = await get(f, pa); expect(r.status).toBe(200);
  return { serie: r.body.fs12.politica.janela.competencias.map(mes => ({ mes, valorCentavos: valor })),
    revisaoEsperada: r.body.fs12.revisaoVigente, contextoRevisao: r.body.fs12.contextoRevisao,
    chaveIdempotencia: key(), motivo: r.body.fs12.revisaoVigente ? 'Correção manual sintética' : null };
}
const count = f => mockDb.apuracaoFs12Revisao.count({ where: { portalClientId: f.portal.id } });
function assertNoOtherEffects(f) {
  expect(SerproHttpClient).not.toHaveBeenCalled();
  const writes = queries.filter(q => /\b(INSERT INTO|UPDATE |DELETE FROM)\b/i.test(q));
  const coordination = queryEvents.filter(e => writes.includes(e.query) && !e.query.includes('apuracao_fs12_revisoes'));
  for (const e of coordination) {
    expect(e.query).toMatch(/INSERT INTO "AppSetting"/);
    expect(e.query).toContain('ON CONFLICT ("key") DO UPDATE');
    expect(e.query).toContain('jsonb_set');
    expect(JSON.parse(e.params)).toEqual([chaveCoordenacaoFs12({portalClientId:f.portal.id,competencia:'2026-11'})]);
  }
  expect(writes.length).toBe(queryEvents.filter(e => writes.includes(e.query) && e.query.includes('apuracao_fs12_revisoes')).length + coordination.length);
}
// Rendezvous BEFORE the first coordination statement. Holding that lock while
// waiting for the other protected read would deadlock the harness itself.
function barrierClients(clients) {
  let arrivals = 0, release;
  const ready = new Promise(resolve => { release = resolve; });
  const pids = new Set();
  const withBarrier = db => {
    let firstAttempt = true;
    return new Proxy(db, { get(target, name) {
      if (name === '$transaction') return (fn, options) => target.$transaction(async tx => {
        if (firstAttempt) {
          firstAttempt = false;
          const [{pid}] = await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');
          pids.add(pid); arrivals++;
          if (arrivals === 2) release();
          await new Promise((resolve,reject) => {
            const timer=setTimeout(()=>reject(Error('B31 concurrency barrier timed out')),4000);
            ready.then(()=>{clearTimeout(timer);resolve();},reject);
          });
        }
        return fn(tx);
      },options);
      const value=target[name]; return typeof value==='function'?value.bind(target):value;
    }});
  };
  return {clients:clients.map(withBarrier),arrivals:()=>arrivals,pids:()=>pids.size};
}
suite('B3.1 manual FS12: real PostgreSQL16 and authenticated HTTP', () => {
  beforeAll(async () => {
    const raw = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
    const destination = new URL(raw);
    if (process.env.NODE_ENV !== 'test' || raw !== process.env.DATABASE_URL
      || !['postgres:', 'postgresql:'].includes(destination.protocol) || destination.hostname !== '127.0.0.1'
      || !['/altan_fs12_b31_final_governance_test', '/altan_piloto_governance_test'].includes(destination.pathname) || destination.search || destination.hash)
      throw Error('Explicit disposable FS12 B31 loopback database required');
    mockDb = new PrismaClient({ datasources: { db: { url: raw } }, log: [{ emit: 'event', level: 'query' }] });
    otherDb = new PrismaClient({ datasources: { db: { url: raw } } });
    mockDb.$on('query', e => {queries.push(e.query); queryEvents.push(e);});
    const [version] = await mockDb.$queryRawUnsafe("SELECT current_setting('server_version_num')::int AS version");
    expect(version.version).toBeGreaterThanOrEqual(160000); expect(version.version).toBeLessThan(170000);
  });
  beforeEach(() => { mockBeforeTransaction = null; mockFailAfterInsert = false; queries = []; queryEvents = []; jest.clearAllMocks(); });
  afterEach(() => { expect(SerproHttpClient).not.toHaveBeenCalled(); });
  afterAll(async () => { await mockDb?.$disconnect(); await otherDb?.$disconnect(); });

  test('zero explicit, server authorship, persisted revision, replay and ordered history without fiscal release', async () => {
    const f = await fixture(); const input = await command(f); queries = [];
    const r = await post(f, { ...input, autorId: 'FORGED', companyId: 'FORGED', confirmadoEm: '1900-01-01', revisao: 99 });
    expect(r.status).toBe(200); expect(r.body.replay).toBe(false);
    expect(r.body.confirmacao).toMatchObject({ portalClientId: f.portal.id, companyId: f.company.id,
      competencia: '2026-11', revisao: 1, autorId: f.user.id, totalCentavos: 0, origem: 'MANUAL_APURACAO' });
    expect(r.body.confirmacao.serieHash).toMatch(/^[a-f0-9]{64}$/);
    expect(r.body.confirmacao.confirmadoEm).not.toBe('1900-01-01');
    expect(r.body.confirmacao).not.toHaveProperty('chaveIdempotencia');
    expect(r.body.confirmacao).not.toHaveProperty('comandoHash');
    expect(r.body.autorizaEfeitoFiscal).toBe(false);
    const replay = await post(f, input);
    expect(replay.status).toBe(200); expect(replay.body.replay).toBe(true);
    expect(replay.body.confirmacao).toEqual(r.body.confirmacao);
    const next = await command(f, { valor: 12345 });
    const second = await post(f, next); expect(second.status).toBe(200);
    expect(second.body.confirmacao.revisao).toBe(2);
    const history = await get(f); expect(history.status).toBe(200);
    expect(history.body.fs12.historico.map(x => x.revisao)).toEqual([2, 1]);
    expect(history.body.fs12.historico[1]).toEqual(r.body.confirmacao);
    expect(history.body.fs12.integracao.permiteNovoCalculo).toBe(false);
    expect(history.body.fs12.autorizaEfeitoFiscal).toBe(false);
    expect((await post(f, input)).body.confirmacao.id).toBe(r.body.confirmacao.id);
    expect(await count(f)).toBe(2); assertNoOtherEffects(f);
  });

  test('same key with changed content, stale predecessor and different actor never replace a revision', async () => {
    const f = await fixture(); const input = await command(f);
    expect((await post(f, input)).status).toBe(200);
    const changed = { ...input, serie: input.serie.map(x => ({ ...x, valorCentavos: 1 })) };
    expect((await post(f, changed)).body.error).toBe('FS12_IDEMPOTENCIA_CONFLITO');
    expect((await post(f, { ...input, chaveIdempotencia: key() })).body.error).toBe('FS12_REVISAO_CONFLITO');
    const admin = await mockDb.user.create({ data: { email: `${key()}@example.test`, passwordHash: 'not-a-login', role: 'admin', status: 'active' } });
    expect((await post(f, input, '2026-11', admin)).body.error).toBe('FS12_IDEMPOTENCIA_CONFLITO');
    expect(await count(f)).toBe(1);
  });

  test.each(['different', 'same'])('independent PostgreSQL connections compete using %s idempotency keys', async mode => {
    const f = await fixture(); const input = await command(f);
    const barrier = barrierClients([mockDb, otherDb]);
    const execute = (db, body) => confirmarFs12DaApuracao({ ...body, portalClientId: f.portal.id, competencia: '2026-11', autorId: f.user.id }, criarPersistenciaFs12(db));
    const results = await Promise.allSettled([
      execute(barrier.clients[0], input),
      execute(barrier.clients[1], mode === 'same' ? input : { ...input, chaveIdempotencia: key() }),
    ]);
    expect(barrier.arrivals()).toBe(2); expect(barrier.pids()).toBe(2);
    expect(await count(f)).toBe(1);
    if (mode === 'same') {
      expect(results.every(x => x.status === 'fulfilled')).toBe(true);
      expect(results[0].value.confirmacao.id).toBe(results[1].value.confirmacao.id);
      expect(results.map(x => x.value.replay).sort()).toEqual([false, true]);
    } else {
      expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
      expect(results.find(x => x.status === 'rejected').reason).toMatchObject({ status: 409, code: 'FS12_REVISAO_CONFLITO' });
    }
  });

  test('real guards reject unauthenticated, revoked, inactive, staff and other tenant; admin remains authorized', async () => {
    const f = await fixture(); const other = await fixture(); const input = await command(f);
    expect((await post(f, input, '2026-11', null)).status).toBe(401);
    expect((await post(other, input, '2026-11', f.user)).status).toBe(403);
    for (const status of ['INACTIVE', 'REMOVED']) {
      await otherDb.companyFirmAccess.update({ where: { id: f.access.id }, data: { status } });
      expect((await post(f, input)).status).toBe(403);
    }
    await otherDb.companyFirmAccess.update({ where: { id: f.access.id }, data: { status: 'ACTIVE', role: 'STAFF' } });
    expect((await post(f, input)).status).toBe(403);
    // A stale privileged session cannot override the current database identity.
    expect((await post(f, input, '2026-11', { ...f.user, role: 'admin' })).status).toBe(403);
    expect(await count(f)).toBe(0);
    const admin = await mockDb.user.create({ data: { email: `${key()}@example.test`, passwordHash: 'not-a-login', role: 'admin', status: 'active' } });
    expect((await post(f, input, '2026-11', admin)).status).toBe(200);
  });

  test('canonical role normalization is preserved by both route and transactional authorization', async () => {
    const f = await fixture(); const input = await command(f);
    await otherDb.companyFirmAccess.update({ where: { id: f.access.id }, data: { role: ' accountant ' } });
    expect((await post(f, input)).status).toBe(200);
    expect((await get(f)).status).toBe(200);
    expect(await count(f)).toBe(1);
  });

  test('access revoked between HTTP middleware and transactional use case is refused, including replay', async () => {
    const f = await fixture(); const input = await command(f);
    mockBeforeTransaction = () => otherDb.companyFirmAccess.update({ where: { id: f.access.id }, data: { status: 'REMOVED' } });
    expect((await post(f, input)).status).toBe(403); expect(await count(f)).toBe(0);
    await otherDb.companyFirmAccess.update({ where: { id: f.access.id }, data: { status: 'ACTIVE' } });
    expect((await post(f, input)).status).toBe(200);
    mockBeforeTransaction = () => otherDb.companyFirmAccess.update({ where: { id: f.access.id }, data: { status: 'REMOVED' } });
    expect((await post(f, input)).status).toBe(403); expect(await count(f)).toBe(1);
  });

  test('opening date or regime changed after read requires new context; another PA does not share confirmation', async () => {
    const f = await fixture(); const input = await command(f);
    await otherDb.company.update({ where: { id: f.company.id }, data: { dataAbertura: date('2020-01-02') } });
    expect((await post(f, input)).body.error).toBe('FS12_CONTEXTO_ALTERADO');
    const refreshed = await command(f);
    await otherDb.regimeHistorico.update({ where: { id: f.history.id }, data: { updatedAt: new Date('2030-01-01T00:00:00Z') } });
    expect((await post(f, refreshed)).body.error).toBe('FS12_CONTEXTO_ALTERADO');
    const final = await command(f); expect((await post(f, final)).status).toBe(200);
    expect((await get(f, '2026-12')).body.fs12.historico).toEqual([]);
    expect((await post(f, final, '2026-12')).status).toBe(409);
    expect(await count(f)).toBe(1);
  });

  test('opening-month series is one month; future/historical policy and invalid period are not bypassed', async () => {
    const f = await fixture({ opening: '2026-11-01', start: '2026-11-01' });
    const input = await command(f); expect(input.serie).toEqual([{ mes: '2026-11', valorCentavos: 0 }]);
    expect((await post(f, input)).status).toBe(200);
    expect((await get(f, '2026-13')).status).toBe(400);
    for (const pa of ['2026-10', '2027-01']) {
      const r = await get(f, pa); expect(r.status).toBe(200);
      expect(r.body.fs12.politica.janela).toBeNull();
      expect((await post(f, { ...input, chaveIdempotencia: key(), contextoRevisao: r.body.fs12.contextoRevisao }, pa)).status).toBe(422);
    }
  });

  test('invalid series has no writes: empty, missing, duplicate, extra, negative, fractional, string and overflow', async () => {
    const f = await fixture(); const input = await command(f);
    const variants = [[], input.serie.slice(1), [...input.serie.slice(1), input.serie[1]],
      [...input.serie, { mes: '2026-11', valorCentavos: 0 }],
      ...[-1, 0.1, '', '0', null].map(valorCentavos => input.serie.map((x, i) => i === 0 ? { ...x, valorCentavos } : x)),
      input.serie.map(x => ({ ...x, valorCentavos: Number.MAX_SAFE_INTEGER }))];
    queries = [];
    for (const serie of variants) expect((await post(f, { ...input, serie, chaveIdempotencia: key() })).status).toBe(422);
    expect(await count(f)).toBe(0);
    expect(queries.some(q => /INSERT INTO.*apuracao_fs12_revisoes/.test(q))).toBe(false);
  });

  test('failure after insert rolls back evidence and returns sanitized error, then same command can succeed', async () => {
    const f = await fixture(); const input = await command(f); queries = [];
    mockFailAfterInsert = true;
    const r = await post(f, input); expect(r.status).toBe(503);
    expect(JSON.stringify(r.body)).not.toContain('SYNTHETIC_PRIVATE');
    expect(await count(f)).toBe(0);
    expect(queries.some(q => /^ROLLBACK/i.test(q))).toBe(true);
    mockFailAfterInsert = false;
    expect((await post(f, input)).status).toBe(200); expect(await count(f)).toBe(1);
  });

  test('database prohibits update/delete, invalid amounts, missing replacement reason and identity mismatch', async () => {
    const f = await fixture(); const input = await command(f); const r = await post(f, input);
    expect(r.status).toBe(200);
    const original = await mockDb.apuracaoFs12Revisao.findUnique({ where: { id: r.body.confirmacao.id } });
    await expect(otherDb.apuracaoFs12Revisao.update({ where: { id: original.id }, data: { motivo: 'mutated' } })).rejects.toBeDefined();
    await expect(otherDb.apuracaoFs12Revisao.delete({ where: { id: original.id } })).rejects.toBeDefined();
    const { id: _id, confirmadoEm: _at, ...saved } = original;
    const direct = changes => otherDb.apuracaoFs12Revisao.create({ data: { ...saved, revisao: 2, chaveIdempotencia: key(), motivo: 'substituição', ...changes } });
    await expect(direct({ motivo: null })).rejects.toBeDefined();
    await expect(direct({ serie: [{ mes: '2026-10', valorCentavos: -1 }] })).rejects.toBeDefined();
    await expect(direct({ serie: [{ mes: '2026-10', valorCentavos: 0.1 }] })).rejects.toBeDefined();
    await expect(direct({ serie: [{ mes: '2026-10', valorCentavos: 0 }, { mes: '2026-10', valorCentavos: 0 }] })).rejects.toBeDefined();
    const other = await fixture();
    await expect(direct({ companyId: other.company.id })).rejects.toBeDefined();
    expect(await mockDb.apuracaoFs12Revisao.findUnique({ where: { id: original.id } })).toEqual(original);
    expect(await count(f)).toBe(1);
  });

  test('Company reassociation never exposes the prior Company series and a new scope can confirm', async () => {
    const f = await fixture(); const other = await fixture();
    expect((await post(f, await command(f))).status).toBe(200);
    await otherDb.portalClient.update({ where: { id: f.portal.id }, data: { companyId: null } });
    await otherDb.portalClient.update({ where: { id: other.portal.id }, data: { companyId: f.company.id } });
    const reading = await get(other); expect(reading.status).toBe(200);
    expect(reading.body.fs12.historico).toEqual([]);
    const r = await post(other, await command(other)); expect(r.status).toBe(200);
    expect(r.body.confirmacao).toMatchObject({ portalClientId: other.portal.id, companyId: f.company.id, revisao: 1 });
    expect(await count(f)).toBe(1); expect(await count(other)).toBe(1);
  });

  test('history GET performs no DML and rejects an unrelated user without returning data', async () => {
    const f = await fixture(); const other = await fixture();
    expect((await post(f, await command(f))).status).toBe(200); queries = [];
    const r = await get(f); expect(r.status).toBe(200); expect(r.body.fs12.historico).toHaveLength(1);
    expect(queries.some(q => /\b(INSERT INTO|UPDATE |DELETE FROM)\b/i.test(q))).toBe(false);
    const forbidden = await get(f, '2026-11', other.user);
    expect(forbidden.status).toBe(403); expect(forbidden.body).not.toHaveProperty('fs12');
    assertNoOtherEffects(f);
  });
});

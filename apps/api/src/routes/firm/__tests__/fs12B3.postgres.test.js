// Characterization only: real PostgreSQL, router, ACL, composition and B2 reader.
// Session resolution is synthetic. No fiscal transport or monthly evidence is created.
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import request from 'supertest';

let mockDb;
let mockAfterPortalRead;
let mockContextReads = 0;
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: new Proxy({}, {
  get(_target, key) {
    if (key === '$transaction') return (fn, options) => {
      mockContextReads++;
      return mockDb.$transaction(tx => fn(new Proxy(tx, { get(target, name) {
        if (name === 'portalClient') return { findUnique: async args => {
          const result = await target.portalClient.findUnique(args);
          if (mockAfterPortalRead) await mockAfterPortalRead();
          return result;
        } };
        const value = target[name];
        return typeof value === 'function' ? value.bind(target) : value;
      } })), options);
    };
    const value = mockDb[key];
    return typeof value === 'function' ? value.bind(mockDb) : value;
  },
}) }));
jest.mock('../../../application/fiscal/serpro/SerproHttpClient.js', () => ({
  SerproHttpClient: jest.fn(() => { throw Error('REAL_FISCAL_TRANSPORT_FORBIDDEN'); }),
}));
import { SerproHttpClient } from '../../../application/fiscal/serpro/SerproHttpClient.js';
import { createApuracaoV2Router } from '../apuracaoV2.js';
import { lerContextoFs12Consistente } from '../../../modules/fiscal/infrastructure/prisma/leituraContextoFs12.js';
import { contextoOrigemCalculo } from '../../../application/notas/apuracao/v2/RecuperacaoCalculo.js';

const suite = process.env.ALTAN_TESTE_POSTGRES === '1' ? describe : describe.skip;
let otherDb;
let queries = [];
const date = value => new Date(`${value}T00:00:00.000Z`);
function app(user) {
  const a = express(); a.use(express.json());
  a.use((req, _res, next) => { if (user) req.auth = { user }; next(); });
  a.use('/firm/companies/:companyId', createApuracaoV2Router());
  return a;
}
async function fixture({ opening = '2020-01-01', start = '2020-01-01', regime = 'SIMPLES' } = {}) {
  const id = randomUUID();
  const client = await mockDb.client.create({ data: { name: 'SYNTHETIC FS12', login: id, email: `${id}@example.test`, passwordHash: 'not-a-login' } });
  const company = await mockDb.company.create({ data: { clientId: client.id, razaoSocial: 'SYNTHETIC FS12', cnpj: id, atividades: [], dataAbertura: date(opening) } });
  const portal = await mockDb.portalClient.create({ data: { companyId: company.id, razao: 'SYNTHETIC FS12', cnpj: id } });
  const user = await mockDb.user.create({ data: { email: `${randomUUID()}@example.test`, passwordHash: 'not-a-login', role: 'contador', accountType: 'FIRM', status: 'active' } });
  const access = await mockDb.companyFirmAccess.create({ data: { companyId: portal.id, userId: user.id, role: 'ACCOUNTANT', status: 'ACTIVE' } });
  const history = await mockDb.regimeHistorico.create({ data: { companyId: company.id, regime, vigenciaInicio: date(start) } });
  return { company, portal, user, access, history };
}
function get(f, pa = '2026-11', user = f.user, suffix = '') {
  return request(app(user)).get(`/firm/companies/${f.portal.id}/fechamento/${pa}/fs12${suffix}`);
}
function assertReadOnly() {
  expect(queries.some(q => /ISOLATION LEVEL REPEATABLE READ/i.test(q))).toBe(true);
  expect(queries.filter(q => /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE)\b/i.test(q))).toEqual([]);
  expect(SerproHttpClient).not.toHaveBeenCalled();
}

suite('B3 characterization of B2 with PostgreSQL16, not a fiscal release', () => {
  beforeAll(async () => {
    const raw = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
    const url = new URL(raw);
    if (process.env.NODE_ENV !== 'test' || raw !== process.env.DATABASE_URL
      || !['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1'
      || url.pathname !== '/altan_piloto_governance_test' || url.search || url.hash) throw Error('Explicit disposable loopback database required');
    mockDb = new PrismaClient({ datasources: { db: { url: raw } }, log: [{ emit: 'event', level: 'query' }] });
    otherDb = new PrismaClient({ datasources: { db: { url: raw } } });
    mockDb.$on('query', e => queries.push(e.query));
    const [version] = await mockDb.$queryRawUnsafe("SELECT current_setting('server_version_num')::int AS version");
    expect(version.version).toBeGreaterThanOrEqual(160000); expect(version.version).toBeLessThan(170000);
  });
  beforeEach(() => { mockAfterPortalRead = null; mockContextReads = 0; queries = []; jest.clearAllMocks(); });
  afterAll(async () => { await mockDb?.$disconnect(); await otherDb?.$disconnect(); });

  test('real HTTP isolates Company/PortalClient and ignores forged evidence', async () => {
    const a = await fixture(); const b = await fixture({ regime: 'LUCRO_REAL' });
    queries = [];
    const r = await get(a, '2026-11', a.user, `?empresaId=${b.company.id}&conferida=true&valorCentavos=0`);
    expect(r.status).toBe(200); expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body.fs12).toMatchObject({ portalClientId: a.portal.id, competencia: '2026-11',
      politica: { empresaId: a.company.id, exigida: true }, evidenciaSuficiente: false,
      autorizaEfeitoFiscal: false, integracao: { permiteNovoCalculo: false } });
    expect(r.body.fs12.qualidade.totalCentavos).toBeNull();
    expect((await get(b)).body.fs12.politica.situacao).toBe('FORA_DO_ESCOPO');
    assertReadOnly();
  });
  test('revoked/inactive/insufficient/different-company access stops before contextual reads', async () => {
    const a = await fixture(); const b = await fixture();
    for (const status of ['INACTIVE', 'REMOVED']) {
      await mockDb.companyFirmAccess.update({ where: { id: a.access.id }, data: { status } });
      mockContextReads = 0;
      expect((await get(a)).status).toBe(403); expect(mockContextReads).toBe(0);
    }
    await mockDb.companyFirmAccess.update({ where: { id: a.access.id }, data: { status: 'ACTIVE', role: 'STAFF' } });
    expect((await get(a)).status).toBe(403); expect(mockContextReads).toBe(0);
    expect((await get(b, '2026-11', a.user)).status).toBe(403); expect(mockContextReads).toBe(0);
    expect((await get(a, '2026-11', null)).status).toBe(401); expect(mockContextReads).toBe(0);
    expect((await get(a, '2026-11', { ...a.user, role: 'admin' })).status).toBe(200);
  });
  test('missing company and invalid period keep HTTP errors; absent regime is not inferred', async () => {
    const a = await fixture();
    expect((await get(a, '2026-13')).status).toBe(400);
    await mockDb.regimeHistorico.delete({ where: { id: a.history.id } });
    expect((await get(a)).body.fs12.politica.impedimentos).toContain('REGIME_DO_PERIODO_NAO_COMPROVADO');
    await mockDb.portalClient.update({ where: { id: a.portal.id }, data: { companyId: null } });
    expect((await get(a)).status).toBe(404);
  });
  test.each(['2026-10', '2026-11', '2026-12', '2027-01'])('%s preserves policy and never promotes draft to evidence', async pa => {
    const f = await fixture(); queries = [];
    const r = await get(f, pa); expect(r.status).toBe(200);
    expect(r.body.fs12.integracao.permiteNovoCalculo).toBe(false);
    if (pa === '2026-10') expect(r.body.fs12.politica.impedimentos).toContain('EXIGENCIA_HISTORICA_DESCONHECIDA');
    else if (pa === '2027-01') expect(r.body.fs12.politica.regra).toBe('HOMOLOGACAO_2027_PENDENTE');
    else {
      expect(r.body.fs12.politica.janela.competencias).toHaveLength(12);
      expect(r.body.fs12.politica.janela.competencias.at(-1)).toBe(pa === '2026-11' ? '2026-10' : '2026-11');
    }
    assertReadOnly();
  });
  test('opening-month window, partial vigency and overlap retain their distinct limitations', async () => {
    const f = await fixture({ opening: '2026-11-01', start: '2026-11-01' });
    expect((await get(f)).body.fs12.politica.janela.competencias).toEqual(['2026-11']);
    await mockDb.regimeHistorico.update({ where: { id: f.history.id }, data: { vigenciaInicio: date('2026-11-15') } });
    expect((await get(f)).body.fs12.politica.janela).toBeNull();
    await mockDb.regimeHistorico.update({ where: { id: f.history.id }, data: { vigenciaInicio: date('2026-11-01') } });
    await mockDb.regimeHistorico.create({ data: { companyId: f.company.id, regime: 'SIMPLES', vigenciaInicio: date('2026-11-10') } });
    expect((await get(f)).body.fs12.politica.impedimentos).toContain('REGIME_DO_PERIODO_NAO_COMPROVADO');
  });
  test('independent connection commits between the two reads: snapshot is stable, next GET sees new revision', async () => {
    const f = await fixture(); const input = { portalClientId: f.portal.id, competencia: '2026-11' };
    const old = await lerContextoFs12Consistente(input); queries = [];
    mockAfterPortalRead = async () => {
      mockAfterPortalRead = null;
      await otherDb.$transaction(async tx => {
        await tx.regimeHistorico.update({ where: { id: f.history.id }, data: { regime: 'LUCRO_REAL', updatedAt: new Date('2030-01-01T00:00:00Z') } });
        await tx.company.update({ where: { id: f.company.id }, data: { dataAbertura: date('2021-01-01') } });
      });
    };
    expect(await lerContextoFs12Consistente(input)).toEqual(old);
    const current = await lerContextoFs12Consistente(input);
    expect(current.regimeDoPeriodo.tipo).toBe('LUCRO_REAL');
    expect(current.regimeDoPeriodo.referencia).not.toBe(old.regimeDoPeriodo.referencia);
    expect(current.inicioAtividade).toBe('2021-01');
    expect((await get(f)).body.fs12.integracao.permiteNovoCalculo).toBe(false);
    assertReadOnly(); // otherDb fixture writes excluded from the reader's query log.
  });
  test('legacy fingerprint ignores opening/history changes: documented gap, not approval to dispatch', async () => {
    const f = await fixture(); const input = { portalClientId: f.portal.id, competencia: '2026-11' };
    const before = await contextoOrigemCalculo(input, mockDb);
    await mockDb.regimeHistorico.update({ where: { id: f.history.id }, data: { regime: 'LUCRO_REAL' } });
    await mockDb.company.update({ where: { id: f.company.id }, data: { dataAbertura: date('2025-01-01') } });
    expect(await contextoOrigemCalculo(input, mockDb)).toEqual(before);
    expect((await get(f)).body.fs12.politica.situacao).toBe('FORA_DO_ESCOPO');
  });
  test('read failure rolls back the read transaction and returns sanitized 503', async () => {
    const f = await fixture(); queries = [];
    mockAfterPortalRead = async () => { throw Error('synthetic-private-detail'); };
    const r = await get(f);
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ ok: false, error: 'FS12_INDISPONIVEL' });
    expect(JSON.stringify(r.body)).not.toContain('synthetic-private-detail');
    expect(queries.some(q => /^ROLLBACK/i.test(q))).toBe(true);
    assertReadOnly();
  });
  test('revocation after the read ACL does not authorize an effect; next request is denied', async () => {
    const f = await fixture();
    mockAfterPortalRead = async () => {
      mockAfterPortalRead = null;
      await otherDb.companyFirmAccess.update({ where: { id: f.access.id }, data: { status: 'REMOVED' } });
    };
    // Existing GET checks access at entry. It is not the future dispatch guard.
    const inFlight = await get(f);
    expect(inFlight.status).toBe(200);
    expect(inFlight.body.fs12.autorizaEfeitoFiscal).toBe(false);
    mockContextReads = 0;
    expect((await get(f)).status).toBe(403); expect(mockContextReads).toBe(0);
    expect(SerproHttpClient).not.toHaveBeenCalled();
  });
});

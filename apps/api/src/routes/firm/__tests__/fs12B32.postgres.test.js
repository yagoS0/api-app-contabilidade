// Real HTTP, PostgreSQL, canonical ACL, FS12 composition and Fechamento guards.
// Only session and recovery context are synthetic; all fiscal transport is forbidden.
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import request from 'supertest';
let mockDb;
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: new Proxy({}, { get(_t, key) {
  const value = mockDb[key]; return typeof value === 'function' ? value.bind(mockDb) : value;
} }) }));
jest.mock('../../../application/fiscal/serpro/SerproHttpClient.js', () => ({ SerproHttpClient: jest.fn(() => { throw Error('FORBIDDEN_FISCAL_TRANSPORT'); }) }));
jest.mock('../../../application/notas/apuracao/v2/RecuperacaoCalculo.js', () => ({
  ...jest.requireActual('../../../application/notas/apuracao/v2/RecuperacaoCalculo.js'),
  contextoOrigemCalculo: jest.fn(async () => ({ contribuinteCnpj: '12345678000195' })),
}));
import { createApuracaoV2Router } from '../apuracaoV2.js';
import { SerproHttpClient } from '../../../application/fiscal/serpro/SerproHttpClient.js';
import { hashCalculo } from '../../../application/notas/apuracao/v2/CalculoConfirmado.js';
import { registrarRuntimeFs12 } from '../../../composition/execucaoFs12.js';
import { criarRuntimeFiscalFs12 } from '../../../composition/criarRuntimeFiscalFs12.js';
import { criarCifraFs12 } from '../../../modules/fiscal/infrastructure/custody/cifraRespostaFs12.js';
import { criarCifraEnvelopeFs12 } from '../../../modules/fiscal/infrastructure/custody/cifraEnvelopeFs12.js';
import { criarStageRespostaFs12 } from '../../../modules/fiscal/infrastructure/custody/stageRespostaFs12.js';
import { identificarChamada } from '../../../application/fiscal/serpro/SerproCallGuard.js';
import { chaveCoordenacaoFs12 } from '../../../modules/fiscal/infrastructure/prisma/coordenacaoFs12.js';
const suite = process.env.ALTAN_TESTE_POSTGRES === '1' ? describe : describe.skip;
const key = () => randomUUID();
let secondDb, queries, queryEvents;
function app(user) {
  const a = express(); a.use(express.json());
  a.use((req, _res, next) => { if (user) req.auth = { user }; next(); });
  a.use('/firm/companies/:companyId', createApuracaoV2Router()); return a;
}
async function fixture() {
  const id = key();
  const client = await mockDb.client.create({ data: { name: 'SYNTHETIC B32 HTTP', login: id, email: `${id}@example.test`, passwordHash: 'not-a-login' } });
  const company = await mockDb.company.create({ data: { clientId: client.id, razaoSocial: 'SYNTHETIC B32 HTTP', cnpj: id, atividades: [], dataAbertura: new Date('2020-01-01') } });
  const portal = await mockDb.portalClient.create({ data: { companyId: company.id, razao: 'SYNTHETIC B32 HTTP', cnpj: id } });
  const user = await mockDb.user.create({ data: { name: 'SYNTHETIC accountant', email: `${key()}@example.test`, passwordHash: 'not-a-login', role: 'contador', accountType: 'FIRM', status: 'active' } });
  const access = await mockDb.companyFirmAccess.create({ data: { companyId: portal.id, userId: user.id, role: 'ACCOUNTANT', status: 'ACTIVE' } });
  await mockDb.regimeHistorico.create({ data: { companyId: company.id, regime: 'SIMPLES', vigenciaInicio: new Date('2020-01-01') } });
  return { company, portal, user, access };
}
const base = (f, pa = '2026-11') => `/firm/companies/${f.portal.id}/fechamento/${pa}`;
async function confirm(f) {
  const r = await request(app(f.user)).get(`${base(f)}/fs12/confirmacoes`); expect(r.status).toBe(200);
  const saved = await request(app(f.user)).post(`${base(f)}/fs12/confirmacoes`).send({
    serie: r.body.fs12.politica.janela.competencias.map(mes => ({ mes, valorCentavos: 0 })),
    revisaoEsperada: r.body.fs12.revisaoVigente, contextoRevisao: r.body.fs12.contextoRevisao,
    chaveIdempotencia: key(), motivo: r.body.fs12.revisaoVigente ? 'Synthetic replacement' : null,
  }); expect(saved.status).toBe(200); return saved.body.confirmacao;
}
const calculate = (f, pa = '2026-11', user = f.user) => request(app(user)).post(`${base(f, pa)}/calcular`).send({ atividades: [], folhaMensal12: [], regimeApuracao: 'COMPETENCIA', semMovimento: true });
const history = (f, id, pa = '2026-11', user = f.user) => request(app(user)).get(`${base(f, pa)}/fs12/calculos/${encodeURIComponent(id)}`);
suite('B3.2 real HTTP/PG boundaries', () => {
  beforeAll(async () => {
    const raw = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
    const u = new URL(raw);
    if (process.env.NODE_ENV !== 'test' || raw !== process.env.DATABASE_URL || !['postgres:', 'postgresql:'].includes(u.protocol)
      || u.hostname !== '127.0.0.1' || u.pathname !== '/altan_piloto_governance_test'
      || u.search || u.hash) throw Error('B32 disposable loopback database required');
    mockDb = new PrismaClient({ datasources: { db: { url: raw } }, log: [{ emit: 'event', level: 'query' }] });
    secondDb = new PrismaClient({ datasources: { db: { url: raw } } });
    mockDb.$on('query', e => {queries.push(e.query);queryEvents.push(e);});
  });
  beforeEach(() => { queries = []; queryEvents = []; jest.clearAllMocks(); });
  afterEach(() => expect(SerproHttpClient).not.toHaveBeenCalled());
  afterAll(async () => { await mockDb?.$disconnect(); await secondDb?.$disconnect(); });
  test('unconfigured runtime is unavailable, while 2027 retains its calendar guard', async () => {
    const f = await fixture();
    await confirm(f); // Valid domain prerequisite isolates runtime absence from missing FS12.
    const unavailable = await calculate(f);
    expect(unavailable.status).toBe(503); expect(unavailable.body.error).toBe('FS12_CUSTODIA_INDISPONIVEL');
    const future = await calculate(f,'2027-01');
    expect(future.status).toBe(422); expect(future.body.error).toBe('FS12_HOMOLOGACAO_2027_PENDENTE');
    expect(await mockDb.fs12Comando.count({where:{portalClientId:f.portal.id}})).toBe(0);
  });
  describe('configured real runtime: predispatch domain guards', () => {
    beforeAll(async () => {
      const bytes=randomBytes(32), keyId='synthetic-b32-guards';
      const resolveKey=async id=>id===keyId?bytes:null;
      const cifraResposta=criarCifraFs12({resolveKey});
      const cifraEnvelope=criarCifraEnvelopeFs12({keyId,resolveKey});
      const root=await mkdtemp(path.join(tmpdir(),'altan-synthetic-b32-guards-'));
      // No stage writes should occur in these guard cases. Directory durability is
      // real/default, with no no-op sync adapter and no relaxed runtime guarantee.
      const stageResposta=criarStageRespostaFs12({root,cifra:cifraResposta});
      registrarRuntimeFs12(criarRuntimeFiscalFs12({db:mockDb,cifraResposta,cifraEnvelope,stageResposta,
        custodianteId:'synthetic-b32',capacidadeId:'synthetic-guards',keyIdAtivo:keyId,identificarEnvelope:identificarChamada}));
    });
    test('missing confirmation has its precise domain error; confirmed revision without explicit client version is stale', async () => {
      const f=await fixture();
      const missing=await calculate(f);
      expect(missing.status).toBe(409); expect(missing.body.error).toBe('FS12_CONFIRMACAO_AUSENTE');
      await confirm(f);
      const stale=await calculate(f);
      expect(stale.status).toBe(409); expect(stale.body.error).toBe('FS12_CALCULO_CONFLITO');
      expect(await mockDb.apuracaoSnapshot.count({where:{portalClientId:f.portal.id}})).toBe(0);
      expect(await mockDb.apuracaoFs12Calculo.count({where:{portalClientId:f.portal.id}})).toBe(0);
      expect(await mockDb.fs12Comando.count({where:{portalClientId:f.portal.id}})).toBe(0);
      expect(await mockDb.fs12ComandoResposta.count({where:{reserva:{comando:{portalClientId:f.portal.id}}}})).toBe(0);
    });
  test('changed fiscal context invalidates confirmed revision before dispatch', async () => {
    const f = await fixture(); await confirm(f);
    await secondDb.company.update({ where: { id: f.company.id }, data: { dataAbertura: new Date('2020-02-01') } });
    const r = await calculate(f); expect(r.status).toBe(409); expect(r.body.error).toBe('FS12_CALCULO_CONFLITO');
  });
  test('2027 calculation remains blocked while unknown historical lookup is readable without writes', async () => {
    const f = await fixture();
    const r = await calculate(f, '2027-01'); expect(r.status).toBe(422); expect(r.body.error).toBe('FS12_HOMOLOGACAO_2027_PENDENTE');
    queries = [];
    const h = await history(f, 'not-known', '2027-01'); expect(h.status).toBe(200);
    expect(h.body).toEqual({ ok: true, situacao: 'DESCONHECIDO', vinculo: null, autorizaEfeitoFiscal: false });
    expect(queries.filter(q => /\b(INSERT INTO|UPDATE |DELETE FROM)\b/i.test(q))).toEqual([]);
  });
  test('historical link survives revision replacement and never leaks into another company', async () => {
    const f = await fixture(); const other = await fixture(); const revision = await confirm(f);
    // Synthetic historical fixture, not a production write endpoint or a successful fiscal act.
    const dados = { portalClientId: f.portal.id, competencia: '2026-11',
      fs12: { revisaoId: revision.id, revisao: revision.revisao, contextoHash: revision.contextoRevisao, politicaVersao: revision.politicaVersao } };
    const calculoId = `fech:v2:${key()}:${hashCalculo(dados)}`;
    const calculoConfirmado = { ...dados, calculoId };
    const row = await mockDb.apuracaoFs12Calculo.create({ data: { portalClientId: f.portal.id, companyId: f.company.id,
      competencia: '2026-11', calculoId, revisaoFs12: revision.revisao, contextoHash: revision.contextoRevisao,
      politicaVersao: revision.politicaVersao, calculoConfirmado, calculoHash: hashCalculo(calculoConfirmado) } });
    await confirm(f); queries = [];
    const r = await history(f, row.calculoId); expect(r.status).toBe(200); expect(r.body.situacao).toBe('VINCULADO');
    expect(r.body.vinculo.id).toBe(row.id); expect(r.body.vinculo.revisaoFs12).toBe(1); expect(r.body.autorizaEfeitoFiscal).toBe(false);
    const isolated = await history(other, row.calculoId); expect(isolated.status).toBe(200); expect(isolated.body.situacao).toBe('DESCONHECIDO');
    expect(queries.filter(q => /\b(INSERT INTO|UPDATE |DELETE FROM)\b/i.test(q))).toEqual([]);
  });
  test('saving a calculation bound to a replaced revision fails with no snapshot transition', async () => {
    const f = await fixture(); const revision = await confirm(f);
    const formulario = { atividades: [], folhaMensal12: [], regimeApuracao: 'COMPETENCIA' };
    const dados = { portalClientId: f.portal.id, competencia: '2026-11', formulario,
      receitasBrutasAnteriores: [], folhasSalario: [], contextoOrigem: { contribuinteCnpj: '12345678000195' },
      fs12: { revisaoId: revision.id, revisao: revision.revisao, contextoHash: revision.contextoRevisao, politicaVersao: revision.politicaVersao } };
    const calculoId = `fech:v2:${key()}:${hashCalculo(dados)}`;
    const calculoConfirmado = { ...dados, calculoId };
    const snapshot = await mockDb.apuracaoSnapshot.create({ data: { portalClientId: f.portal.id, competencia: '2026-11',
      rbt12: 0, receitaPorTipo: {}, estado: 'calculada', atividadesEscolhidas: [], folhaMensal12: [],
      idempotencyKey: calculoId, simulacaoSerpro: { _portalCalculo: calculoConfirmado } } });
    await mockDb.apuracaoFs12Calculo.create({ data: { portalClientId: f.portal.id, companyId: f.company.id,
      competencia: '2026-11', calculoId, revisaoFs12: revision.revisao, contextoHash: revision.contextoRevisao,
      politicaVersao: revision.politicaVersao, calculoConfirmado, calculoHash: hashCalculo(calculoConfirmado) } });
    await confirm(f);
    const coordinationKey=chaveCoordenacaoFs12({portalClientId:f.portal.id,competencia:'2026-11'});
    const beforeCoord=await mockDb.appSetting.findUnique({where:{key:coordinationKey}});
    const beforeSnapshot=await mockDb.apuracaoSnapshot.findUnique({where:{id:snapshot.id}});
    const beforeLinks=await mockDb.apuracaoFs12Calculo.findMany({where:{portalClientId:f.portal.id}});
    queries=[]; queryEvents=[];
    const result = await request(app(f.user)).post(`${base(f)}/salvar`).send({ ...formulario, calculoId });
    expect(result.status).toBe(409); expect(result.body.error).toBe('FS12_CALCULO_CONFLITO');
    expect(await mockDb.apuracaoSnapshot.findUnique({where:{id:snapshot.id}})).toEqual(beforeSnapshot);
    expect(await mockDb.apuracaoFs12Calculo.findMany({where:{portalClientId:f.portal.id}})).toEqual(beforeLinks);
    expect(await mockDb.appSetting.findUnique({where:{key:coordinationKey}})).toEqual(beforeCoord);
    expect(await mockDb.fs12Comando.count({where:{portalClientId:f.portal.id}})).toBe(0);
    const writes=queryEvents.filter(e=>/\b(INSERT INTO|UPDATE |DELETE FROM)\b/i.test(e.query));
    expect(writes).toHaveLength(1);
    expect(writes[0].query).toMatch(/INSERT INTO "AppSetting"/);
    expect(writes[0].query).toContain('ON CONFLICT ("key") DO UPDATE');
    expect(JSON.parse(writes[0].params)).toEqual([coordinationKey]);
    expect(queries.some(q=>/^ROLLBACK/i.test(q))).toBe(true);
  });
  test('real membership revocation and inactive identity override stale session', async () => {
    const f = await fixture(); const other = await fixture();
    expect((await history(f, 'unknown', '2026-11', null)).status).toBe(401);
    expect((await history(other, 'unknown', '2026-11', f.user)).status).toBe(403);
    await secondDb.companyFirmAccess.update({ where: { id: f.access.id }, data: { status: 'REMOVED' } });
    expect((await history(f, 'unknown')).status).toBe(403); expect((await calculate(f)).status).toBe(403);
    await secondDb.user.update({ where: { id: f.user.id }, data: { status: 'inactive' } });
    expect((await history(f, 'unknown', '2026-11', { ...f.user, role: 'admin' })).status).toBe(403);
  });
  }); // configured real runtime
});

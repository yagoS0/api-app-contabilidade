// Only fixture setup writes. The measured use case receives read-only capabilities.
jest.mock('axios', () => ({ request: jest.fn(() => { throw Error('NETWORK_FORBIDDEN'); }) }));
jest.mock('../../application/fiscal/serpro/SerproHttpClient.js', () => ({ SerproHttpClient: jest.fn(() => { throw Error('SERPRO_FORBIDDEN'); }) }));
jest.mock('../../application/guides/EnvioGuiaService.js', () => ({ enviarGuia: jest.fn(() => { throw Error('MESSAGE_FORBIDDEN'); }) }));
import { randomUUID, createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { SerproHttpClient } from '../../application/fiscal/serpro/SerproHttpClient.js';
import { enviarGuia } from '../../application/guides/EnvioGuiaService.js';
import { prisma as authDb } from '../../infrastructure/db/prisma.js';
import { autorizarLeituraConciliacaoDas445 } from '../../infrastructure/security/autorizarLeituraConciliacaoDas445.js';
import { avaliarElegibilidadeRecuperacaoDas448 as avaliarComposicao } from '../previaRecuperacaoDas448.js';
import { avaliarElegibilidadeRecuperacaoDas448 } from '../../modules/operations/publicPreviaRecuperacaoDas448.js';
import { consultarConciliacaoDas445 } from '../../modules/operations/publicConciliacaoDas445.js';
import { projetarFiscal445 } from '../../modules/fiscal/publicConciliacaoDas445.js';
import { projetarGuias445 } from '../../modules/guides/publicConciliacaoDas445.js';
import { projetarContabilidade445 } from '../../modules/accounting/publicConciliacaoDas445.js';
import { criarLeiturasFiscais445 } from '../../modules/fiscal/infrastructure/prisma/leituraConciliacaoDas445.js';
import { criarLeiturasGuias445 } from '../../modules/guides/infrastructure/prisma/leituraConciliacaoDas445.js';
import { criarLeiturasContabeis445 } from '../../modules/accounting/infrastructure/prisma/leituraConciliacaoDas445.js';
import { criarLeiturasOperacionais445 } from '../../modules/operations/infrastructure/prisma/leituraConciliacaoDas445.js';
import { criarLeituraHistoricoDas448 } from '../../modules/guides/infrastructure/prisma/leituraHistoricoDas448.js';

const suite = process.env.ALTAN_TESTE_POSTGRES === '1' ? describe : describe.skip;
const url = process.env.TEST_CICLO_PG_URL || process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
const competencia = '2026-10'; const digest = s => createHash('sha256').update(s).digest('hex');
let db; let concorrente; let queries = [];
const models = ['serproChamada','serproRespostaCache','appSetting','guide','companyMonthlyCircular','accountingEntry','fiscalExecutionLog'];
function readonly(client, fail) {
  return Object.fromEntries(models.map(name => [name, new Proxy({}, { get(_, method) {
    if (!['findMany','findUnique'].includes(method)) throw Error('WRITE_FORBIDDEN');
    return args => { if (fail === name) throw Error('SOURCE_UNAVAILABLE'); return client[name][method](args); };
  } })]));
}
async function fixture() {
  const id = randomUUID(); const other = randomUUID(); const userId = randomUUID();
  for (const companyId of [id,other]) await db.portalClient.create({ data: { id: companyId,
    cnpj: BigInt('0x' + companyId.replace(/-/g, '').slice(0,10)).toString().padStart(14,'0'), razao: 'SYNTHETIC448' } });
  await db.user.create({ data: { id: userId, email: `${userId}@invalid.test`, passwordHash: 'synthetic', role: 'accountant', accountType: 'FIRM', status: 'active' } });
  await db.companyFirmAccess.create({ data: { companyId: id, userId, role: 'ACCOUNTANT', status: 'ACTIVE' } });
  const f = { id, other, userId, assinatura: digest(id), guideId: randomUUID() };
  f.guide = (patch = {}) => db.guide.create({ data: { id: f.guideId, portalClientId: id, competencia, tipo: 'SIMPLES', source: 'LOCAL',
    sourceFileId: `synthetic448:${randomUUID()}`, hash: digest(randomUUID()), status: 'PROCESSED', valor: '100', pdfBytes: Buffer.from('%PDF-synthetic'), ...patch } });
  f.call = (status = 'ok') => db.serproChamada.create({ data: { portalClientId: id, cnpj: '00000000000000', competencia,
    idSistema: 'PGDASD', idServico: 'GERARDAS12', rota: '/Emitir', assinatura: f.assinatura, status } });
  f.cache = (resposta = { pdf: Buffer.from('NOT_A_PDF').toString('base64') }) => db.serproRespostaCache.create({ data: { chave: f.assinatura, resposta, expiraEm: new Date('2099-01-01') } });
  f.confirmacao = async (patch = {}) => { const eventId = randomUUID(); return db.appSetting.create({ data: {
    key: `contabil:cliente:confirmacao:${id}:${eventId}`, value: { id: eventId, companyId: id, guideId: f.guideId,
      documento: { tipo: 'SIMPLES', competencia, hash: digest('historico' + id) }, competenciaPagamento: '2026-11', origem: 'CLIENTE', secret: 'NEVER_EXPOSE', ...patch },
  } }); };
  return f;
}
async function snapshot(f) {
  return JSON.stringify(await Promise.all(models.map(name => db[name].findMany({
    where: name === 'serproRespostaCache' ? { chave: f.assinatura }
      : name === 'appSetting' ? { key: { contains: f.id } } : { portalClientId: { in: [f.id,f.other] } },
    orderBy: name === 'appSetting' ? { key: 'asc' } : name === 'serproRespostaCache' ? { chave: 'asc' } : { id: 'asc' },
  }))));
}
async function consult(f, patch = {}, { fail, between } = {}) {
  const before = await snapshot(f); queries = [];
  const read = readonly(db, fail); let n = 0;
  const autorizar = companyId => autorizarLeituraConciliacaoDas445(companyId, { user: { id: f.userId, role: 'accountant', accountType: 'FIRM' } });
  const ports445 = { ...criarLeiturasFiscais445(read), ...criarLeiturasGuias445(read), ...criarLeiturasContabeis445(read), ...criarLeiturasOperacionais445(read),
    autorizar, projetarFiscal: projetarFiscal445, projetarGuias: projetarGuias445, projetarContabilidade: projetarContabilidade445 };
  const result = await avaliarElegibilidadeRecuperacaoDas448({ companyId: f.id, competencia, servico: 'GERARDAS12', ...patch }, {
    autorizar, consultarContexto: args => consultarConciliacaoDas445(args, ports445),
    lerHistorico: async args => { const r = await criarLeituraHistoricoDas448(read)(args); if (++n === 1 && between) await between(); return r; },
  });
  expect(queries.every(q => /^\s*SELECT\b/i.test(q))).toBe(true);
  if (!between) expect(await snapshot(f)).toBe(before);
  expect(axios.request).not.toHaveBeenCalled(); expect(SerproHttpClient).not.toHaveBeenCalled(); expect(enviarGuia).not.toHaveBeenCalled();
  expect(result.efeitosPermitidos).toEqual([]); expect(JSON.stringify(result)).not.toContain('NEVER_EXPOSE');
  return result;
}
suite('448 PostgreSQL16 sintético, zero escrita no caso de uso', () => {
  beforeAll(async () => {
    const parsed = new URL(url);
    if (process.env.NODE_ENV !== 'test' || url !== process.env.DATABASE_URL || !['postgres:','postgresql:'].includes(parsed.protocol)
      || !['127.0.0.1','localhost'].includes(parsed.hostname) || !/^\/[a-zA-Z0-9_]+_governance_test$/.test(parsed.pathname) || parsed.search || parsed.hash) throw Error('DISPOSABLE_POSTGRES_REQUIRED');
    db = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
    concorrente = new PrismaClient({ datasources: { db: { url } } }); db.$on('query', e => queries.push(e.query));
    const [actual] = await db.$queryRawUnsafe("SELECT current_database() AS name, current_setting('server_version_num') AS version");
    expect(actual.name).toBe(parsed.pathname.slice(1)); expect(Number(actual.version)).toBeGreaterThanOrEqual(160000); expect(Number(actual.version)).toBeLessThan(170000);
  });
  afterAll(async () => { await db?.$disconnect(); await concorrente?.$disconnect(); await authDb.$disconnect(); });
  test.each([false,true])('reserva incerta, cache=%s', async cache => {
    const f = await fixture(); await f.call('incerta'); if (cache) await f.cache();
    const r = await consult(f); expect(r.classificacao).toBe('BLOQUEADO'); expect(r.bloqueios).toContain('RESERVA_INCERTA');
  });
  test.each([{}, { pdf: Buffer.from('NOT_PDF').toString('base64'), cnpj: '99999999999999', competencia: '2020-01' }])('resposta ausente ou sem identidade/integridade', async response => {
    const f = await fixture(); await f.call(); await f.cache(response); const r = await consult(f); expect(r.classificacao).toBe('NAO_VERIFICAVEL'); expect(r.lacunas).toContain('IDENTIDADE_RESPOSTA_NAO_ATESTADA');
  });
  test('guia existente não comprova equivalência e múltiplas revisões não são ocultadas pelo seletor', async () => {
    const f = await fixture(); await f.guide(); expect((await consult(f)).classificacao).toBe('NAO_VERIFICAVEL');
    await f.guide({ id: randomUUID() }); const r = await consult(f, { documentoId: f.guideId }); expect(r.lacunas).toContain('MULTIPLAS_GUIAS_REVISAO_AMBIGUA');
  });
  test('remoção histórica e confirmação órfã não são ausência de pagamento', async () => {
    const f = await fixture(); await f.guide(); await f.confirmacao(); await db.guide.delete({ where: { id: f.guideId } });
    const r = await consult(f); expect(r.bloqueios).toContain('CONFIRMACAO_ORFA'); expect(r.lacunas).toContain('HISTORICO_REMOCAO_SUBSTITUICAO_INCOMPLETO');
  });
  test('revisão conhecida e conflito de hash não autorizam restauração', async () => {
    const f = await fixture(); await f.guide({ extracted: { recalculoGuia: { guiaId: f.guideId, recalculadoEm: '2026-11-01T12:00:00Z' } } }); await f.confirmacao();
    const r = await consult(f); expect(r.bloqueios).toContain('HASH_DOCUMENTAL_DIVERGENTE'); expect(r.bloqueios).toContain('DOCUMENTO_SUBSTITUIDO_OU_RECALCULADO');
  });
  test('hash/sourceFileId de outra empresa não são consultados nem identificados', async () => {
    const f = await fixture(); const foreign = await f.guide({ portalClientId: f.other });
    // Characterize actual unique constraints outside the measured read-only preview.
    await expect(f.guide({ id: randomUUID(), hash: foreign.hash })).rejects.toMatchObject({ code: 'P2002' });
    await expect(f.guide({ id: randomUUID(), sourceFileId: foreign.sourceFileId })).rejects.toMatchObject({ code: 'P2002' });
    const a = await consult(f, { documentoId: f.guideId }); const b = await consult(f, { documentoId: 'inexistente' });
    expect(a.classificacao).toBe(b.classificacao); expect(a.evidencias.map(o => ({ ...o, consultadoEm: null }))).toEqual(b.evidencias.map(o => ({ ...o, consultadoEm: null }))); expect(a.lacunas).toEqual(b.lacunas);
  });
  test('pagamento/comprovante e competência fechada bloqueiam', async () => {
    const f = await fixture(); await f.guide({ paymentStatus: 'PAID', comprovantePdfFileId: 'sintetico' });
    await db.companyMonthlyCircular.create({ data: { portalClientId: f.id, competencia, fechadoContabilEm: new Date() } });
    const r = await consult(f); expect(r.bloqueios).toContain('COMPETENCIA_CONTABIL_FECHADA'); expect(r.bloqueios).toContain('PAGAMENTO_OU_VINCULO_FINANCEIRO_CONHECIDO');
  });
  test('lançamento sem vínculo documental permanece não verificável', async () => {
    const f = await fixture(); await db.accountingEntry.create({ data: { portalClientId: f.id, competencia,
      data: new Date('2026-10-20'), historico: 'synthetic448', tipo: 'PROVISAO', eventType: 'DAS_SIMPLES', origem: 'MANUAL' } });
    expect((await consult(f)).lacunas).toContain('LANCAMENTO_SEM_VINCULO_DOCUMENTAL');
  });
  test('fontes truncadas/indisponíveis e ausência completa não são sucesso', async () => {
    const f = await fixture(); expect((await consult(f)).classificacao).toBe('NAO_VERIFICAVEL'); await f.guide(); await f.guide({ id: randomUUID() });
    expect((await consult(f, { limit: 1 })).lacunas).toContain('COMPLETUDE_NAO_COMPROVADA');
    expect((await consult(f, {}, { fail: 'guide' })).lacunas).toContain('FONTE_INDISPONIVEL');
  });
  test('segunda conexão modifica evidência entre observações, sem hook produtivo', async () => {
    const f = await fixture(); await f.guide(); const r = await consult(f, {}, { between: () => concorrente.guide.update({ where: { id: f.guideId }, data: { paymentStatus: 'PAID' } }) });
    expect(r.lacunas).toContain('EVIDENCIAS_ALTERADAS_ENTRE_OBSERVACOES'); expect(r.classificacao).toBe('BLOQUEADO');
  });
  test('empresa não autorizada', async () => { const f = await fixture(); await expect(consult(f, { companyId: f.other })).rejects.toMatchObject({ code: 'ACESSO_NEGADO' }); });
  test('histórico de outros tributos não bloqueia DAS; competência documental prevalece', async () => {
    const f = await fixture(); await f.confirmacao({ documento: { tipo: 'DARF', competencia } });
    const r = await consult(f); expect(r.bloqueios).not.toContain('CONFIRMACAO_PAGAMENTO_CONHECIDA');
    await f.confirmacao({ documento: { tipo: 'SIMPLES', competencia }, competenciaPagamento: '2026-11' });
    expect((await consult(f)).bloqueios).toContain('CONFIRMACAO_ORFA');
  });
  test('mesma guia mudou competência: igualdade de hash não comprova revisão', async () => {
    const f = await fixture(); const g = await f.guide({ competencia: '2026-09' });
    await f.confirmacao({ documento: { tipo: 'SIMPLES', competencia, hash: g.hash } });
    const r = await consult(f); expect(r.bloqueios).toContain('COMPETENCIA_DOCUMENTAL_DIVERGENTE');
    const h = r.evidencias[0].fontes.find(f => f.origem === 'Guias.historico448').registros[0];
    expect(h.hashDocumentalCoincidente).toBe(true); expect(h).not.toHaveProperty('revisaoCompativel');
  });
  test('composição pública real preserva vínculos, sessão e exceção admin sem fontes após recusa', async () => {
    const f = await fixture(); const actions = [];
    authDb.$use(async (p, next) => { actions.push(`${p.model}.${p.action}`); return next(p); });
    const input = { companyId: f.id, competencia, servico: 'GERARDASCOBRANCA17' };
    const user = { id: f.userId, role: 'accountant', accountType: 'FIRM' };
    for (const data of [{ status: 'INACTIVE' }, { status: 'REMOVED' }, { status: 'ACTIVE', role: 'STAFF' }]) {
      await db.companyFirmAccess.update({ where: { companyId_userId: { companyId: f.id, userId: f.userId } }, data }); actions.length = 0;
      await expect(avaliarComposicao(input, { auth: { user } })).rejects.toMatchObject({ code: 'ACESSO_NEGADO', status: 403 });
      expect(actions).toEqual(['CompanyFirmAccess.findUnique']);
    }
    actions.length = 0; await expect(avaliarComposicao(input, {})).rejects.toMatchObject({ code: 'ACESSO_NEGADO', status: 401 }); expect(actions).toEqual([]);
    await expect(avaliarComposicao(input, { auth: { user: { ...user, accountType: 'CLIENT' } } })).rejects.toMatchObject({ status: 403 });
    await db.companyFirmAccess.update({ where: { companyId_userId: { companyId: f.id, userId: f.userId } }, data: { status: 'ACTIVE', role: 'ACCOUNTANT' } });
    actions.length = 0; expect((await avaliarComposicao(input, { auth: { user } })).classificacao).toBe('NAO_VERIFICAVEL');
    expect(actions.every(a => /\.(findMany|findUnique)$/.test(a))).toBe(true);
    expect((await avaliarComposicao({ ...input, companyId: f.other }, { auth: { user: { ...user, role: 'admin' } } })).efeitosPermitidos).toEqual([]);
  });

});

// Synthetic PostgreSQL16 only. Fixture writes are outside the measured consultation.
jest.mock('axios', () => ({ request: jest.fn(() => { throw Error('EXTERNAL_TRANSPORT_FORBIDDEN'); }), post: jest.fn(() => { throw Error('EXTERNAL_TRANSPORT_FORBIDDEN'); }) }));
jest.mock('../../application/fiscal/serpro/SerproHttpClient.js', () => ({ SerproHttpClient: jest.fn(() => { throw Error('SERPRO_FORBIDDEN'); }) }));
jest.mock('../../application/guides/EnvioGuiaService.js', () => ({ enviarGuia: jest.fn(() => { throw Error('MESSAGE_FORBIDDEN'); }) }));

import { randomUUID, createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { SerproHttpClient } from '../../application/fiscal/serpro/SerproHttpClient.js';
import { prisma as authDb } from '../../infrastructure/db/prisma.js';
import { autorizarLeituraConciliacaoDas445 } from '../../infrastructure/security/autorizarLeituraConciliacaoDas445.js';
import { consultarConciliacaoDas445 } from '../../modules/operations/publicConciliacaoDas445.js';
import { projetarFiscal445 } from '../../modules/fiscal/publicConciliacaoDas445.js';
import { projetarGuias445 } from '../../modules/guides/publicConciliacaoDas445.js';
import { projetarContabilidade445 } from '../../modules/accounting/publicConciliacaoDas445.js';
import { criarLeiturasFiscais445 } from '../../modules/fiscal/infrastructure/prisma/leituraConciliacaoDas445.js';
import { criarLeiturasGuias445 } from '../../modules/guides/infrastructure/prisma/leituraConciliacaoDas445.js';
import { criarLeiturasContabeis445 } from '../../modules/accounting/infrastructure/prisma/leituraConciliacaoDas445.js';
import { criarLeiturasOperacionais445 } from '../../modules/operations/infrastructure/prisma/leituraConciliacaoDas445.js';

const suite = process.env.ALTAN_TESTE_POSTGRES === '1' ? describe : describe.skip;
const url = process.env.TEST_CICLO_PG_URL || process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
const now = new Date('2026-11-14T12:00:00Z');
const competencia = '2026-10';
let db; let queries = [];
const digest = value => createHash('sha256').update(value).digest('hex');
const models = ['serproChamada','serproRespostaCache','appSetting','guide','companyMonthlyCircular','accountingEntry','fiscalExecutionLog'];
function readonly(client, fail = null) {
  return Object.fromEntries(models.map(name => [name, new Proxy({}, { get(_, method) {
    if (!['findMany','findUnique'].includes(method)) throw Error(`WRITE_FORBIDDEN:${name}.${String(method)}`);
    return async args => { if (fail === name) throw Error('synthetic source failure'); return client[name][method](args); }; } })]));
}
async function fixture() {
  const id = randomUUID(); const other = randomUUID(); const userId = randomUUID();
  for (const companyId of [id, other]) await db.portalClient.create({ data: { id: companyId, cnpj: BigInt('0x' + companyId.replace(/-/g, '').slice(0, 10)).toString().padStart(14, '0'), razao: 'SYNTHETIC DAS445' } });
  await db.user.create({ data: { id: userId, email: `${userId}@invalid.test`, passwordHash: 'synthetic', role: 'accountant', accountType: 'FIRM', status: 'active' } });
  await db.companyFirmAccess.create({ data: { companyId: id, userId, role: 'ACCOUNTANT', status: 'ACTIVE' } });
  const f = { id, other, userId, assinatura: digest(id), guideId: randomUUID() };
  f.guide = (patch = {}) => db.guide.create({ data: { id: f.guideId, portalClientId: id, competencia, tipo: 'SIMPLES', source: 'LOCAL', sourceFileId: `synthetic:${randomUUID()}`,
    status: 'PROCESSED', valor: '100', hash: digest(randomUUID()), pdfBytes: Buffer.from('%PDF synthetic'),
    extracted: { numeroDocumento: '12345678901234567' }, ...patch } });
  f.call = (status = 'incerta', service = 'GERARDAS12') => db.serproChamada.create({ data: { portalClientId: id, cnpj: '00000000000000', competencia, idSistema: 'PGDASD', idServico: service, rota: '/Emitir', assinatura: f.assinatura, status } });
  f.cache = () => db.serproRespostaCache.create({ data: { chave: f.assinatura, expiraEm: new Date('2026-11-14T13:00:00Z'), resposta: { pdf: Buffer.from('%PDF-' + 'synthetic'.repeat(30)).toString('base64'), numeroDocumento: '12345678901234567', valorTotal: 100, secret: 'NEVER_EXPOSE' } } });
  f.circular = (patch = {}) => db.companyMonthlyCircular.create({ data: { portalClientId: id, competencia, dasTotal: '100', dasNumeroDocumento: '12345678901234567', ...patch } });
  return f;
}
async function snapshot(f) {
  const ids = [f.id, f.other];
  return JSON.stringify(await Promise.all([
    db.guide.findMany({ where: { portalClientId: { in: ids } }, orderBy: { id: 'asc' } }),
    db.companyMonthlyCircular.findMany({ where: { portalClientId: { in: ids } }, orderBy: { id: 'asc' } }),
    db.accountingEntry.findMany({ where: { portalClientId: { in: ids } }, include: { lines: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } }),
    db.fiscalExecutionLog.findMany({ where: { portalClientId: { in: ids } }, orderBy: { id: 'asc' } }),
    db.serproChamada.findMany({ where: { portalClientId: { in: ids } }, orderBy: { id: 'asc' } }),
    db.serproRespostaCache.findMany({ where: { chave: f.assinatura } }),
    db.appSetting.findMany({ where: { OR: [{ key: { contains: f.id } }, { key: { contains: f.assinatura } }, { key: { contains: f.guideId } }] }, orderBy: { key: 'asc' } }),
  ]));
}
async function consult(f, patch = {}, fail = null) {
  const before = await snapshot(f); queries = [];
  const read = readonly(db, fail);
  const ports = { ...criarLeiturasFiscais445(read), ...criarLeiturasGuias445(read), ...criarLeiturasContabeis445(read), ...criarLeiturasOperacionais445(read),
    projetarFiscal: projetarFiscal445, projetarGuias: projetarGuias445, projetarContabilidade: projetarContabilidade445,
    autorizar: id => autorizarLeituraConciliacaoDas445(id, { user: { id: f.userId, role: 'accountant', accountType: 'FIRM' } }), agora: () => now };
  const result = await consultarConciliacaoDas445({ companyId: f.id, competencia, ...patch }, ports);
  expect(queries.every(q => /^\s*SELECT\b/i.test(q))).toBe(true);
  expect(await snapshot(f)).toBe(before);
  expect(axios.request).not.toHaveBeenCalled(); expect(axios.post).not.toHaveBeenCalled(); expect(SerproHttpClient).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain('NEVER_EXPOSE');
  return result;
}
suite('4.4.5 PostgreSQL16 selection, isolation and zero mutations', () => {
  beforeAll(async () => {
    const parsed = new URL(url);
    if (process.env.NODE_ENV !== 'test' || url !== process.env.DATABASE_URL || !['postgres:','postgresql:'].includes(parsed.protocol) ||
      !['127.0.0.1','localhost'].includes(parsed.hostname) || !/^\/[a-zA-Z0-9_]+_governance_test$/.test(parsed.pathname) || parsed.search || parsed.hash) throw Error('Explicit disposable loopback PostgreSQL required');
    db = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
    db.$on('query', e => queries.push(e.query));
    const [actual] = await db.$queryRawUnsafe("SELECT current_database() AS name, current_setting('server_version_num') AS version");
    expect(actual.name).toBe(parsed.pathname.slice(1)); expect(Number(actual.version)).toBeGreaterThanOrEqual(160000); expect(Number(actual.version)).toBeLessThan(170000);
  });
  afterAll(async () => { await db?.$disconnect(); await authDb.$disconnect(); });
  test('1 uncertain reservation without cache and dispatch remains unchanged', async () => {
    const f = await fixture(); const c = await f.call();
    await db.appSetting.create({ data: { key: `serpro_dispatch:${c.id}`, value: { companyId: f.id, reservaId: c.id, authorizedAt: now.toISOString() } } });
    const r = await consult(f); expect(r.fiscal.estado).toBe('Incerto'); expect(r.fiscal.despachos.items).toHaveLength(1);
  });
  test('2 uncertain reservation with valid cache stays uncertain', async () => {
    const f = await fixture(); await f.call(); await f.cache(); const r = await consult(f);
    expect(r.fiscal.estado).toBe('Incerto'); expect(r.fiscal.cache.items[0]).toMatchObject({ vigente: true, interpretacao: 'DOCUMENTO_NA_RESPOSTA_LOCAL' });
  });
  test('3 cache without guide does not create one; unassociated cache is not scanned', async () => {
    const f = await fixture(); await f.cache(); expect((await consult(f)).fiscal.cache.items).toEqual([]);
    await f.call('ok', 'GERARDASCOBRANCA17'); const r = await consult(f, { servico: 'GERARDASCOBRANCA17' });
    expect(r.lacunas).toContain('CACHE_SEM_GUIA_NO_RECORTE');
  });
  test('4 local/upload guide without circular preserves source, hash and revision', async () => {
    const f = await fixture(); const g = await f.guide({ sourceFileId: null }); const r = await consult(f);
    expect(r.lacunas).toContain('GUIA_SEM_CIRCULAR_NO_RECORTE'); expect(r.guias.guias.items[0]).toMatchObject({ id: g.id, origem: 'LOCAL', hash: g.hash, servico: null });
  });
  test('5 circular without provision remains partial', async () => {
    const f = await fixture(); await f.circular(); const r = await consult(f); expect(r.contabilidade.estado).toBe('Parcial'); expect(r.contabilidade.lancamentos.items).toEqual([]);
  });
  test('6 reused guide has no implicit accounting evidence', async () => {
    const f = await fixture(); await f.guide(); expect((await consult(f)).contabilidade.lacunas).toContain(`GUIA_SEM_PROVISAO_VINCULADA:${f.guideId}`);
  });
  test('7 paid guide, receipt and historical client event stay separate', async () => {
    const f = await fixture(); await f.guide({ paymentStatus: 'PAID', paymentStatusSource: 'CLIENTE', comprovantePdfFileId: 'synthetic-receipt' });
    await db.appSetting.create({ data: { key: `contabil:cliente:confirmacao:${f.id}:event`, value: { id: 'event', companyId: f.id, guideId: f.guideId, origem: 'CLIENTE', versaoGuia: f.assinatura, confirmadoEm: now.toISOString(), estadoBaixa: 'PENDENTE', autor: { secret: 'NEVER_EXPOSE' } } } });
    const r = await consult(f); expect(r.guias.pagamentos.items).toHaveLength(1); expect(r.guias.guias.items[0].pagamento).toMatchObject({ estadoLocal: 'PAID', referenciaComprovante: true });
  });
  test('8 duplicates/ambiguous revisions are not cleaned', async () => {
    const f = await fixture(); await f.guide(); await f.guide({ id: randomUUID() }); const r = await consult(f);
    expect(r.guias.guias.items).toHaveLength(2); expect(r.guias.lacunas).toContain('MULTIPLAS_GUIAS_REVISAO_VIGENTE_NAO_DETERMINADA');
  });
  test('9 other-company document and missing access cannot leak evidence', async () => {
    const f = await fixture(); const g = await f.guide({ portalClientId: f.other }); const r = await consult(f, { documentoId: g.id }); expect(r.guias.guias.items).toEqual([]);
    await expect(consult(f, { companyId: f.other })).rejects.toMatchObject({ code: 'ACESSO_NEGADO' });
  });
  test('10 accounting closure differs from fiscal estado', async () => {
    const f = await fixture(); await f.circular({ estado: 'fechado' }); expect((await consult(f)).contabilidade.estado).toBe('Parcial');
    await db.companyMonthlyCircular.update({ where: { portalClientId_competencia: { portalClientId: f.id, competencia } }, data: { fechadoContabilEm: now } });
    expect((await consult(f)).contabilidade.estado).toBe('Bloqueado');
  });
  test('11 completed/zero entries cannot reconstruct accounting.ok:false', async () => {
    const f = await fixture(); await db.fiscalExecutionLog.create({ data: { portalClientId: f.id, competencia, action: 'search_guides', status: 'completed', entriesGenerated: 0 } });
    const r = await consult(f); expect(r.operacoes.execucoes.items[0].resultadoContabil).toBe('NAO_PERSISTIDO_NESTE_LOG');
  });
  test('12 total absence is not reconciliation or absence of debt', async () => {
    const r = await consult(await fixture()); expect(r.fiscal.estado).toBe('Não verificável'); expect(r).not.toHaveProperty('conciliado');
  });
  test('13 contradictory evidence, direct and legacy accounting links', async () => {
    const f = await fixture(); await f.guide(); const c = await f.circular({ dasTotal: '999' });
    for (const direct of [true, false]) await db.accountingEntry.create({ data: { portalClientId: f.id, competencia, circularId: c.id,
      sourceGuideId: direct ? f.guideId : null, data: now, historico: 'Synthetic', tipo: 'PROVISAO', subtipo: 'DAS', origem: 'MANUAL',
      lines: { create: [{ conta: 'synthetic', tipo: 'D', valor: '100' }, { conta: 'synthetic', tipo: 'C', valor: '100' }] } } });
    const r = await consult(f); expect(r.lacunas).toContain('VALOR_GUIA_CIRCULAR_DIVERGENTE');
    expect(r.contabilidade.lancamentos.items.some(e => e.associacao === 'SOURCE_GUIDE_ID')).toBe(true);
    expect(r.contabilidade.lacunas).toContain('LANCAMENTO_SEM_VINCULO_DOCUMENTAL_INEQUIVOCO');
  });
  test('14 partial source outage has no retry, writes or external calls', async () => {
    const f = await fixture(); await f.guide(); const r = await consult(f, {}, 'serproChamada');
    expect(r.fiscal.chamadas).toMatchObject({ consulta: 'falhou', items: null }); expect(r.guias.guias.items).toHaveLength(1);
  });
  test('worker JSON filters at source and exposes only own matching period; limits explicit', async () => {
    const f = await fixture(); await db.appSetting.create({ data: { key: `serpro_pgdasd_log:${f.id}`, value: { competencia, settings: { secret: 'NEVER_EXPOSE' }, summary: { results: [
      { companyId: f.id, competencia, status: 'captured', cnpj: 'NEVER_EXPOSE' }, { companyId: f.other, competencia, status: 'error' },
      { companyId: f.id, competencia: '2026-09', status: 'error' } ] } } } });
    await f.guide(); await f.guide({ id: randomUUID() }); const r = await consult(f, { limit: 1 });
    expect(r.operacoes.worker.items).toHaveLength(1); expect(r.guias.guias.truncated).toBe(true); expect(r.lacunas).toContain('RECORTE_TRUNCADO:guias');
  });
  test('ledger/cache remain scoped to company, competence, PGDASD and service', async () => {
    const f = await fixture(); await f.call('ok'); await f.cache();
    for (const patch of [{ portalClientId: f.other }, { competencia: '2026-09' }, { idSistema: 'OTHER' }, { idServico: 'TRANSDECLARACAO11' }]) {
      await db.serproChamada.create({ data: { portalClientId: f.id, cnpj: '00000000000000', competencia, idSistema: 'PGDASD', idServico: 'GERARDAS12', rota: '/Emitir', assinatura: digest(randomUUID()), status: 'ok', ...patch } });
    }
    const r = await consult(f, { servico: 'GERARDAS12' }); expect(r.fiscal.chamadas.items).toHaveLength(1); expect(r.fiscal.cache.items).toHaveLength(1);
  });
  test('worker preserves actual statuses and excludes foreign period/company and LP results', async () => {
    const f = await fixture();
    await db.appSetting.create({ data: { key: `serpro_pgdasd_log:${f.id}:states`, value: { competencia, summary: {
      results: [{ companyId: f.id, competencia, status: 'aguardando_conferencia' }, { companyId: f.other, competencia, status: 'captured' }, { companyId: f.id, competencia, status: 'lp_captured' }],
      extratoResults: [{ companyId: f.id, competencia, status: 'extrato_incompleto' }], parcelaResults: [{ companyId: f.id, status: 'ok' }]
    } } } });
    const r = await consult(f); expect(r.operacoes.worker.items.map(x=>x.status).sort()).toEqual(['aguardando_conferencia','extrato_incompleto']);
  });
  test('DAS eventType finds legacy entry without sourceGuideId or subtype', async () => {
    const f = await fixture(); await db.accountingEntry.create({ data: { portalClientId: f.id, competencia, data: now, historico: 'synthetic', tipo: 'PROVISAO', eventType: 'DAS_SIMPLES', origem: 'MANUAL' } });
    const r = await consult(f); expect(r.contabilidade.lancamentos.items).toHaveLength(1);
    expect(r.contabilidade.lancamentos.items[0].associacao).toBe('SEM_VINCULO_DOCUMENTAL_INEQUIVOCO');
  });

  test('historical payment revision and separate state remain distinct after document replacement', async () => {
    const f = await fixture(); await f.guide(); const initial = await consult(f);
    const revision = initial.guias.guias.items[0].revisao.versaoPagamento;
    await db.appSetting.create({ data: { key: `contabil:cliente:confirmacao:${f.id}:revision`, value: { id: 'revision', companyId: f.id, guideId: f.guideId, versaoGuia: revision, estadoBaixa: 'PENDENTE', origem: 'CLIENTE' } } });
    await db.appSetting.create({ data: { key: `contabil:cliente:estado:${f.id}:revision`, value: { estadoBaixa: 'CONCLUIDA', revisao: 1 } } });
    let r = await consult(f); expect(r.guias.pagamentos.items[0]).toMatchObject({ revisaoCompativel: true, estadoBaixaNoEvento: 'PENDENTE', estadoAtualRegistrado: { estadoBaixa: 'CONCLUIDA' } });
    await db.guide.update({ where: { id: f.guideId }, data: { hash: digest('replacement') } });
    r = await consult(f); expect(r.guias.pagamentos.items[0].revisaoCompativel).toBe(false);
    expect(r.guias.lacunas).toContain('CONFIRMACAO_PAGAMENTO_DE_REVISAO_ANTERIOR');
    expect(r.contabilidade.lancamentos.items).toEqual([]);
  });

});

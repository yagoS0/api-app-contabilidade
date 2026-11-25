// Existing components under doubles; no B33b coordinator is implemented here.
// The ledger double proves calls/CAS, not PostgreSQL isolation or rollback.
import axios from 'axios';
import { SerproHttpClient } from '../SerproHttpClient.js';
import { autorizarChamada, autorizarDespacho, concluirChamada } from '../SerproCallGuard.js';
import { lerResposta, guardarResposta } from '../SerproRespostaCache.js';
import { comContextoSerpro } from '../serproCallContext.js';
jest.mock('../../../../config.js', () => ({ SERPRO_GUARDA_ATIVA: true, SERPRO_COOLDOWN_SEGUNDOS: 300, SERPRO_TETO_DIARIO_EMPRESA: 60, SERPRO_ORCAMENTO_MENSAL_POR_EMPRESA: 100, SERPRO_TETO_MENSAL_MINIMO: 1000, SERPRO_TETO_MENSAL_ABSOLUTO: 0, SERPRO_ALERTA_FRACAO: 0.8 }));
jest.mock('../SerproAuthService.js', () => ({ SerproAuthService: class { constructor() { throw Error('Use injected fixture authentication'); } } }));
jest.mock('axios', () => ({ request: jest.fn(), isAxiosError: e => Boolean(e?.isAxiosError) }));
jest.mock('../../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../SerproCallGuard.js', () => ({ ...jest.requireActual('../SerproCallGuard.js'), autorizarChamada: jest.fn(), autorizarDespacho: jest.fn(), concluirChamada: jest.fn() }));
jest.mock('../SerproRespostaCache.js', () => ({ ...jest.requireActual('../SerproRespostaCache.js'), lerResposta: jest.fn(), guardarResposta: jest.fn() }));
jest.mock('../SerproRuntimeSettings.js', () => ({ getResolvedSerproCredentials: jest.fn() }));
jest.mock('../CompanySerproPolicy.js', () => ({ empresaDaChamada: jest.fn(), conferirPoliticaSerpro: jest.fn(), bloquearPoliticaEmpresa: jest.fn() }));
jest.mock('../ConsultaPagamentoAutomaticaService.js', () => ({ conferirModoConsultaDespacho: jest.fn() }));
jest.mock('../../AutomacaoCicloFiscalService.js', () => ({ bloquearCicloFiscal: jest.fn(), AutomacaoCicloFiscalError: class extends Error {} }));
jest.mock('../../automacaoCicloFiscalContext.js', () => ({ conferirTransporteCicloFiscal: jest.fn(), conferirContribuinteCicloFiscal: jest.fn(), conferirContextoCicloFiscal: jest.fn(), conferirTentativaAutomaticaDespacho: jest.fn(), tentativaAutomaticaSemDespacho: jest.fn(), marcarDespachoTentativaAutomatica: jest.fn() }));
const guard = jest.requireActual('../SerproCallGuard.js');
const envelope = (pa = 202610, indicadorTransmissao = false, idServico = 'TRANSDECLARACAO11') => ({ contribuinte: { numero: '00000000000100' }, pedidoDados: { idSistema: 'PGDASD', idServico, dados: JSON.stringify({ pa, indicadorTransmissao }) } });
function ledger() {
  const rows = [], markers = new Map();
  const match = (row, where) => Object.entries(where).every(([k, v]) => v && typeof v === 'object' ? v.in ? v.in.includes(row[k]) : v.gte ? new Date(row[k]) >= v.gte : false : row[k] === v);
  const db = {
    rows, markers, inTransaction: false, portalClient: { count: jest.fn(async () => 10) },
    appSetting: { findUnique: jest.fn(async ({ where }) => markers.get(where.key) || null), create: jest.fn(async ({ data }) => { markers.set(data.key, data); return data; }) },
    serproChamada: {
      findFirst: jest.fn(async ({ where }) => rows.filter(r => match(r, where)).at(-1) || null),
      findUnique: jest.fn(async ({ where }) => rows.find(r => r.id === where.id) || null),
      count: jest.fn(async ({ where }) => rows.filter(r => match(r, where)).length),
      create: jest.fn(async ({ data }) => { const row = { id: `r-${rows.length}`, createdAt: new Date(), ...data }; rows.push(row); return row; }),
      updateMany: jest.fn(async ({ where, data }) => { const found = rows.filter(r => match(r, where)); found.forEach(r => Object.assign(r, data)); return { count: found.length }; }),
    },
    $queryRaw: jest.fn(async () => []),
    $transaction: jest.fn(async fn => { db.inTransaction = true; try { return await fn(db); } finally { db.inTransaction = false; } }),
  };
  return db;
}
let db, auth, client;
beforeEach(() => {
  jest.resetAllMocks();
  jest.requireMock('../CompanySerproPolicy.js').empresaDaChamada.mockResolvedValue('portal-fixture');
  jest.requireMock('../SerproRuntimeSettings.js').getResolvedSerproCredentials.mockResolvedValue({ baseUrl: 'https://invalid.test', timeoutMs: 1000 });
  db = ledger();
  autorizarChamada.mockImplementation(input => guard.autorizarChamada(input, db));
  autorizarDespacho.mockImplementation(input => guard.autorizarDespacho(input, db));
  concluirChamada.mockImplementation((input, result) => guard.concluirChamada(input, result, db));
  lerResposta.mockResolvedValue(null);
  auth = { authenticate: jest.fn(async () => ({ accessToken: 'fixture' })), buildHttpsAgent: jest.fn() };
  client = new SerproHttpClient({ authService: auth });
  axios.request.mockImplementation(async () => { expect(db.inTransaction).toBe(false); const authorization = autorizarDespacho.mock.calls.at(-1)?.[0]; expect(authorization?.id).toBeDefined(); expect(db.markers.has(`serpro_dispatch:${authorization.id}`)).toBe(true); return { status: 200, data: { fixture: true }, headers: {} }; });
});

const cache = jest.requireActual('../SerproRespostaCache.js');
let cached;
beforeEach(() => {
  cached = new Map();
  db.serproRespostaCache = {
    findUnique: jest.fn(async ({ where }) => cached.get(where.chave) || null),
    upsert: jest.fn(async ({ where, create, update }) => {
      const row = cached.has(where.chave) ? { ...cached.get(where.chave), ...update } : create;
      cached.set(where.chave, row); return row;
    }),
    deleteMany: jest.fn(async () => ({ count: 0 })),
  };
  lerResposta.mockImplementation((payload, route) => cache.lerResposta(payload, route, db));
  guardarResposta.mockImplementation((payload, route, response) => cache.guardarResposta(payload, route, response, db));
});
describe('B33b.1: identidade e custódia existentes; transporte fake, sem coordenador', () => {
  test('PA canônico identifica competência sem alterar envelope; metadata não autoriza despacho', () => {
    const payload = envelope();
    const before = JSON.stringify(payload), signature = cache.chaveResposta(payload, '/Declarar');
    expect(guard.identificarChamada(payload, '/Declarar')).toMatchObject({ competencia: '2026-10', assinatura: signature });
    expect(JSON.stringify(payload)).toBe(before);
    payload.pedidoDados.dados = JSON.stringify({ pa: 202610, competencia: '2026-13', indicadorTransmissao: false });
    const conflicting = JSON.stringify(payload);
    expect(guard.identificarChamada(payload, '/Declarar').competencia).toBe('2026-10');
    expect(JSON.stringify(payload)).toBe(conflicting);
    // Identifier is metadata only: canonical pa wins; conflicting aliases are not normalized or approved here.
  });
  test('hash ordena chaves; tipo de pa e modo continuam identidades diferentes', () => {
    const original = envelope(), reordered = envelope();
    reordered.pedidoDados.dados = '{"indicadorTransmissao":false,"pa":202610}';
    expect(cache.chaveResposta(original, '/Declarar')).toBe(cache.chaveResposta(reordered, '/Declarar'));
    expect(cache.chaveResposta(original, '/Declarar')).not.toBe(cache.chaveResposta(envelope('202610'), '/Declarar'));
    expect(cache.chaveResposta(original, '/Declarar')).not.toBe(cache.chaveResposta(envelope(202610, true), '/Declarar'));
  });
  test('acaoId repetido com outra intenção não é idempotência de negócio', async () => {
    await comContextoSerpro({ acaoId: 'same-command', userId: 'fixture' }, async () => {
      await client.post('/Declarar', envelope(202610, false));
      await client.post('/Declarar', envelope(202610, true));
    });
    expect(db.rows.map(r => r.acaoId)).toEqual(['same-command', 'same-command']);
    expect(new Set(db.rows.map(r => r.assinatura)).size).toBe(2);
    expect(db.markers.size).toBe(2); expect(db.rows.map(r => r.status)).toEqual(['ok', 'ok']);
    expect(axios.request).toHaveBeenCalledTimes(2);
  });
  test('transmissão PA10 termina ok sem custódia do corpo; cache real é no-op', async () => {
    await expect(client.post('/Declarar', envelope(202610, true))).resolves.toEqual({ fixture: true });
    expect(db.rows[0]).toMatchObject({ status: 'ok', competencia: '2026-10' });
    expect(db.serproRespostaCache.upsert).not.toHaveBeenCalled();
    expect(cached.size).toBe(0);
    expect(db.rows[0]).not.toHaveProperty('resposta');
    expect(db.rows[0]).not.toHaveProperty('revisaoFs12');
  });
  test('cache de simulação recupera sem nova reserva ou autenticação e sem identidade da tentativa', async () => {
    await client.post('/Declarar', envelope());
    await expect(client.post('/Declarar', envelope())).resolves.toEqual({ fixture: true });
    expect(cached.size).toBe(1); expect(db.rows).toHaveLength(1);
    expect(axios.request).toHaveBeenCalledTimes(1); expect(auth.authenticate).toHaveBeenCalledTimes(1);
    const row = [...cached.values()][0];
    expect(row).not.toHaveProperty('reservaId'); expect(row).not.toHaveProperty('tentativaId');
  });
  test('cache expirado de simulação conhecida não inicia nova rede', async () => {
    await client.post('/Declarar', envelope());
    [...cached.values()][0].expiraEm = new Date(0);
    await expect(client.post('/Declarar', envelope())).rejects.toMatchObject({ code: 'SERPRO_SIMULACAO_ANTERIOR_NAO_RECUPERAVEL' });
    expect(axios.request).toHaveBeenCalledTimes(1);
  });
  test('falha do ledger após cache salvo impede usar resposta e repetir HTTP', async () => {
    db.serproChamada.updateMany.mockRejectedValue(new Error('synthetic ledger outage'));
    await expect(client.post('/Declarar', envelope())).rejects.toMatchObject({ code: 'SERPRO_REGISTRO_INDETERMINADO' });
    expect(cached.size).toBe(1); expect(db.rows[0].status).toBe('reservada');
    await expect(client.post('/Declarar', envelope())).rejects.toMatchObject({ code: 'SERPRO_CHAMADA_EM_ANDAMENTO' });
    expect(axios.request).toHaveBeenCalledTimes(1);
  });
  test('falha da persistência real de cache preserva reserva sem resposta recuperável', async () => {
    db.serproRespostaCache.upsert.mockRejectedValue(new Error('synthetic storage outage'));
    await expect(client.post('/Declarar', envelope())).rejects.toMatchObject({ code: 'SERPRO_REGISTRO_INDETERMINADO' });
    expect(db.rows[0].status).toBe('reservada'); expect(cached.size).toBe(0);
    await expect(client.post('/Declarar', envelope())).rejects.toMatchObject({ code: 'SERPRO_CHAMADA_EM_ANDAMENTO' });
    expect(axios.request).toHaveBeenCalledTimes(1); expect(concluirChamada).not.toHaveBeenCalled();
  });
  test('resposta raw de erro finaliza ledger sem passar pela custódia/cache', async () => {
    axios.request.mockRejectedValue({ response: { status: 500, data: { synthetic: 'body' }, headers: {} } });
    await expect(client.post('/Declarar', envelope(), { raw: true })).resolves.toMatchObject({ status: 500, data: { synthetic: 'body' } });
    expect(db.rows[0]).toMatchObject({ status: 'erro', httpStatus: 500 });
    expect(guardarResposta).not.toHaveBeenCalled(); expect(cached.size).toBe(0);
  });
  test('interrupção após marca sem HTTP não permite novo despacho da reserva', async () => {
    const authorization = await guard.autorizarChamada({ payload: envelope(), rota: '/Declarar' }, db);
    await guard.autorizarDespacho(authorization, db);
    // Stop at persisted boundary; this does not simulate a real process crash or PostgreSQL.
    expect(db.rows[0].status).toBe('reservada'); expect(db.markers.size).toBe(1);
    const freshClient = new SerproHttpClient({ authService: auth });
    await expect(freshClient.post('/Declarar', envelope())).rejects.toMatchObject({ code: 'SERPRO_CHAMADA_EM_ANDAMENTO' });
    await expect(guard.autorizarDespacho(authorization, db)).rejects.toMatchObject({ code: 'SERPRO_CHAMADA_EM_ANDAMENTO' });
    expect(axios.request).not.toHaveBeenCalled();
  });
  test('perda de resposta produz incerta; forçar não repete transporte', async () => {
    axios.request.mockRejectedValue({ isAxiosError: true, code: 'ECONNABORTED', message: 'synthetic lost response' });
    await expect(client.post('/Declarar', envelope(202610, true))).rejects.toMatchObject({ code: 'SERPRO_TIMEOUT' });
    await expect(comContextoSerpro({ forcar: true, userId: 'admin' }, () => client.post('/Declarar', envelope(202610, true)))).rejects.toMatchObject({ code: 'SERPRO_CHAMADA_EM_ANDAMENTO' });
    expect(db.rows[0].status).toBe('incerta'); expect(axios.request).toHaveBeenCalledTimes(1);
  });
  test('política alterada durante resposta tardia não é revalidada pelo HttpClient após HTTP', async () => {
    const policy = jest.requireMock('../CompanySerproPolicy.js').conferirPoliticaSerpro;
    let release, entered;
    const started = new Promise(resolve => { entered = resolve; });
    axios.request.mockImplementation(() => { entered(); return new Promise(resolve => { release = resolve; }); });
    const pending = client.post('/Declarar', envelope(202610, true));
    await started;
    const before = policy.mock.calls.length;
    policy.mockRejectedValue(Object.assign(new Error('synthetic revoked policy'), { code: 'SERPRO_EMPRESA_PAUSADA' }));
    release({ status: 200, data: { synthetic: 'late' }, headers: {} });
    await expect(pending).resolves.toEqual({ synthetic: 'late' });
    expect(policy).toHaveBeenCalledTimes(before); expect(db.rows[0].status).toBe('ok');
    // NOT an ACL test: current-user authorization is absent from this layer.
    expect(cached.size).toBe(0);
  });
  test.each([202611, 202612, 202701])('PA %s: guardas anteriores ao cache e transporte', async pa => {
    for (const transmit of [false, true]) await expect(client.post('/Declarar', envelope(pa, transmit))).rejects.toMatchObject({
      code: pa === 202701 ? 'FS12_HOMOLOGACAO_2027_PENDENTE' : 'FS12_INTEGRACAO_B33_PENDENTE',
    });
    expect(lerResposta).not.toHaveBeenCalled(); expect(db.rows).toEqual([]);
    expect(auth.authenticate).not.toHaveBeenCalled(); expect(axios.request).not.toHaveBeenCalled();
  });
});

// Exact identity extraction is independent of authorization: direct PA11/12/2027
// dispatch remains refused by the existing cases below/above without capability.
test.each([[202610, '2026-10'], [202611, '2026-11'], [202612, '2026-12'], [202701, '2027-01']])('canonical PA %s preserves bytes and cache signature', (pa, competencia) => {
  for (const value of [pa, String(pa)]) {
    const payload = envelope(value), before = JSON.stringify(payload);
    expect(guard.identificarChamada(payload, '/Declarar')).toMatchObject({ competencia, assinatura: cache.chaveResposta(payload, '/Declarar') });
    expect(JSON.stringify(payload)).toBe(before);
  }
});
test.each(['GERARDAS12', 'CONSDECLARACAO13'])('PA extraction for %s retains legacy alias contract', service => {
  const payload = envelope(202611, false, service);
  expect(guard.identificarChamada(payload, '/Consultar').competencia).toBeNull();
  payload.pedidoDados.dados = JSON.stringify({ pa: 202611, competencia: '2026-10' });
  const before = JSON.stringify(payload);
  expect(guard.identificarChamada(payload, '/Consultar')).toMatchObject({ competencia: '2026-10', assinatura: cache.chaveResposta(payload, '/Consultar') });
  expect(JSON.stringify(payload)).toBe(before);
});
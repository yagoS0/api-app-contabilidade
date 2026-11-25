// Existing components under doubles; no B33b coordinator is implemented here.
// The ledger double proves calls/CAS, not PostgreSQL isolation or rollback.
import axios from 'axios';
import { SerproHttpClient } from '../SerproHttpClient.js';
import { autorizarChamada, autorizarDespacho, concluirChamada } from '../SerproCallGuard.js';
import { lerResposta, guardarResposta } from '../SerproRespostaCache.js';
import { comContextoSerpro } from '../serproCallContext.js';
import { hashCalculo as hash } from '../../../notas/apuracao/v2/CalculoConfirmado.js';
import { prepararFs12ParaNovoCalculo, vincularFs12AoCalculo, consultarVinculoFs12DoCalculo, validarUsoFs12DoCalculo } from '../../../../modules/fiscal/application/vincularFs12AoCalculo.js';
import { planejarRemessaFs12 } from '../../../../modules/fiscal/domain/planejarRemessaFs12.js';
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
  axios.request.mockImplementation(async () => { expect(db.inTransaction).toBe(false); expect(db.markers.size).toBe(1); return { status: 200, data: { fixture: true }, headers: {} }; });
});
describe('observado: HttpClient e CallGuard reais; I/O e políticas adjacentes em doubles', () => {
  test.each([202611, 202612, 202701])('PA %s bloqueia antes de reserva, cache, auth e HTTP', async pa => {
    for (const transmitir of [false, true]) await expect(client.post('/Declarar', envelope(pa, transmitir))).rejects.toMatchObject({ code: pa === 202701 ? 'FS12_HOMOLOGACAO_2027_PENDENTE' : 'FS12_INTEGRACAO_B33_PENDENTE' });
    expect(db.rows).toEqual([]);
    for (const fn of [lerResposta, autorizarChamada, auth.authenticate, axios.request]) expect(fn).not.toHaveBeenCalled();
  });
  test('PA10 reserva antes da rede; ledger técnico não contém revisão FS12/cálculo', async () => {
    await comContextoSerpro({ acaoId: 'comando-fixture', userId: 'contador', origem: 'teste:b33b' }, () => client.post('/Declarar', envelope()));
    expect(db.rows).toHaveLength(1);
    // E2 correlates canonical PA in the technical ledger; legacy fiscal behavior stays unchanged.
    expect(db.rows[0]).toMatchObject({ acaoId: 'comando-fixture', portalClientId: 'portal-fixture', status: 'ok', competencia: '2026-10' });
    expect(db.rows[0].assinatura).toBe(jest.requireActual('../SerproRespostaCache.js').chaveResposta(envelope(), '/Declarar'));
    expect(axios.request.mock.calls[0][0].data).toEqual(envelope());
    expect(db.rows[0]).not.toHaveProperty('calculoId'); expect(db.rows[0]).not.toHaveProperty('revisaoFs12');
    expect(guardarResposta).toHaveBeenCalledTimes(1); expect(axios.request).toHaveBeenCalledTimes(1);
  });
  test('falha de reserva impede autenticação e HTTP', async () => {
    db.serproChamada.create.mockRejectedValue(new Error('fixture persistência'));
    await expect(client.post('/Declarar', envelope())).rejects.toMatchObject({ code: 'SERPRO_MEDICAO_INDISPONIVEL' });
    expect(auth.authenticate).not.toHaveBeenCalled(); expect(axios.request).not.toHaveBeenCalled();
  });
  test('auth falha antes da rede: abortada_auth, sem despacho', async () => {
    auth.authenticate.mockRejectedValue(Object.assign(new Error('fixture auth'), { code: 'AUTH' }));
    await expect(client.post('/Declarar', envelope())).rejects.toBeDefined();
    expect(db.rows[0].status).toBe('abortada_auth'); expect(db.markers.size).toBe(0); expect(axios.request).not.toHaveBeenCalled();
  });
  test.each(['timeout', 'cache', 'ledger'])('%s após despacho mantém bloqueio até com forçar', async failure => {
    if (failure === 'timeout') axios.request.mockRejectedValue({ isAxiosError: true, code: 'ECONNABORTED', message: 'timeout fixture' });
    if (failure === 'cache') guardarResposta.mockRejectedValue(new Error('fixture cache'));
    if (failure === 'ledger') db.serproChamada.updateMany.mockRejectedValue(new Error('fixture ledger'));
    await expect(client.post('/Declarar', envelope())).rejects.toMatchObject({ code: failure === 'timeout' ? 'SERPRO_TIMEOUT' : 'SERPRO_REGISTRO_INDETERMINADO' });
    expect(db.rows[0].status).toBe(failure === 'timeout' ? 'incerta' : 'reservada');
    await expect(comContextoSerpro({ forcar: true, userId: 'admin' }, () => client.post('/Declarar', envelope()))).rejects.toMatchObject({ code: 'SERPRO_CHAMADA_EM_ANDAMENTO' });
    expect(axios.request).toHaveBeenCalledTimes(1); expect(concluirChamada).toHaveBeenCalledTimes(failure === 'cache' ? 0 : 1);
  });
  test('política alterada durante autenticação recusa antes da rede sem resultado incerto', async () => {
    auth.authenticate.mockImplementation(async () => {
      jest.requireMock('../CompanySerproPolicy.js').conferirPoliticaSerpro.mockRejectedValueOnce(Object.assign(new Error('empresa pausada'), { code: 'SERPRO_EMPRESA_PAUSADA' }));
      return { accessToken: 'fixture' };
    });
    await expect(client.post('/Declarar', envelope())).rejects.toMatchObject({ code: 'SERPRO_EMPRESA_PAUSADA' });
    expect(db.rows[0].status).toBe('abortada_politica');
    expect(db.markers.size).toBe(0); expect(axios.request).not.toHaveBeenCalled(); expect(concluirChamada).not.toHaveBeenCalled();
  });
  test('marcador recusa segundo despacho da mesma reserva', async () => {
    const r = await guard.autorizarChamada({ payload: envelope(), rota: '/Declarar' }, db);
    await guard.autorizarDespacho(r, db);
    await expect(guard.autorizarDespacho(r, db)).rejects.toMatchObject({ code: 'SERPRO_CHAMADA_EM_ANDAMENTO' });
    expect(db.markers.size).toBe(1); expect(axios.request).not.toHaveBeenCalled();
  });
  test('índice PA11 continua independente do vínculo, conservando reserva/transporte', async () => {
    await client.post('/Consultar', envelope(202611, false, 'CONSDECLARACAO13'));
    expect(db.rows[0]).toMatchObject({ idServico: 'CONSDECLARACAO13', status: 'ok' }); expect(axios.request).toHaveBeenCalledTimes(1);
  });
});
function fs12Fixture() {
  const identidade = { portalClientId: 'p', companyId: 'c', cnpj: '00000000000100', competencia: '2026-11', dataAbertura: '2026-11-01' };
  const contexto = { empresaId: 'c', competenciaApuracao: '2026-11', inicioAtividade: '2026-11', regimeDoPeriodo: { empresaId: 'c', competencia: '2026-11', tipo: 'SIMPLES_NACIONAL', referencia: 'r1' } };
  const serie = [{ mes: '2026-11', valorCentavos: 0 }];
  const revisao = { ...identidade, id: 'r1', revisao: 1, origem: 'MANUAL_APURACAO', contexto, serie, serieHash: hash(serie), contextoRevisao: hash(contexto), politicaVersao: 'PGDAS-2026-B1.v1', autorId: 'u', confirmadoEm: '2026-11-17T12:00:00.000Z' };
  const calculo = { calculoId: 'calculo-1', portalClientId: 'p', competencia: '2026-11', fs12: { revisaoId: 'r1', revisao: 1, contextoHash: hash(contexto), politicaVersao: revisao.politicaVersao } };
  const rows = [];
  const p = { hash, autorizar: jest.fn(), lerContexto: jest.fn(async () => contexto), lerUltima: jest.fn(async () => revisao), lerCalculoConfirmado: jest.fn(async () => calculo),
    lerVinculo: jest.fn(async e => rows.find(r => r.portalClientId === e.portalClientId && r.companyId === e.companyId && r.competencia === e.competencia && r.calculoId === e.calculoId) || null),
    inserirVinculo: jest.fn(async data => { const row = { id: 'v1', ...data }; rows.push(row); return row; }) };
  return { identidade, contexto, revisao, p, rows, entrada: { autorId: 'u', portalClientId: 'p', competencia: '2026-11', calculoId: 'calculo-1', revisaoEsperada: 1, contextoHash: hash(contexto) }, deps: { transacionar: fn => fn(p) } };
}
describe('observado: B32 e B33a reais, sem coordenador novo', () => {
  test('preparo sem calculoId só lê; revisão substituída impede vínculo', async () => {
    const f = fs12Fixture(); const { calculoId, ...antesDoCalculo } = f.entrada;
    expect(await prepararFs12ParaNovoCalculo(antesDoCalculo, f.deps)).toMatchObject({ revisaoFs12: 1, autorizaEfeitoFiscal: false });
    expect(f.p.lerCalculoConfirmado).not.toHaveBeenCalled(); expect(f.p.inserirVinculo).not.toHaveBeenCalled();
    f.revisao.revisao = 2; f.revisao.id = 'r2';
    await expect(vincularFs12AoCalculo({ ...f.entrada, calculoId }, f.deps)).rejects.toMatchObject({ code: 'FS12_CALCULO_CONFLITO' }); expect(f.rows).toEqual([]);
  });
  test('snapshot substituído recusa uso; histórico conserva escopo e autorização atual', async () => {
    const f = fs12Fixture(); await vincularFs12AoCalculo(f.entrada, f.deps);
    f.p.lerCalculoConfirmado.mockRejectedValue(Object.assign(new Error('snapshot reaberto/substituído'), { code: 'FS12_CALCULO_CONFLITO' }));
    await expect(validarUsoFs12DoCalculo(f.entrada, f.deps)).rejects.toMatchObject({ code: 'FS12_CALCULO_CONFLITO' });
    expect(await consultarVinculoFs12DoCalculo(f.entrada, f.deps)).toMatchObject({ calculoId: 'calculo-1', revisaoFs12: 1 });
    expect(await consultarVinculoFs12DoCalculo({ ...f.entrada, competencia: '2026-12' }, f.deps)).toBeNull();
    f.p.lerContexto.mockResolvedValue({ ...f.contexto, empresaId: 'outra-company' });
    expect(await consultarVinculoFs12DoCalculo({ ...f.entrada, companyId: 'c' }, f.deps)).toBeNull();
    f.p.autorizar.mockRejectedValue(new Error('acesso revogado'));
    await expect(consultarVinculoFs12DoCalculo(f.entrada, f.deps)).rejects.toThrow('acesso revogado');
    expect(f.rows).toHaveLength(1); expect(axios.request).not.toHaveBeenCalled();
  });
  test('seleção B33a permanece null; revisão vigente independente alterada impede análise', () => {
    const f = fs12Fixture();
    const entrada = { identidade: f.identidade, contexto: f.contexto, revisaoManual: f.revisao, revisaoVigente: { ...f.revisao }, calculoExistente: null, historicoOficial: { ...f.identidade, estado: 'DESCONHECIDA', meses: [] } };
    const atual = planejarRemessaFs12(entrada);
    expect(atual.mesesPropostos).toBeNull(); expect(atual.autorizaEfeitoFiscal).toBe(false);
    expect(atual.impedimentos).toEqual(expect.arrayContaining(['PROTOCOLO_REMESSA_NAO_HOMOLOGADO', 'ORIGEM_OFICIAL_PRODUTIVA_INDISPONIVEL']));
    entrada.revisaoVigente = { ...entrada.revisaoVigente, revisao: 2, id: 'r2' };
    const obsoleto = planejarRemessaFs12(entrada);
    expect(obsoleto.impedimentos).toContain('REVISAO_MANUAL_NAO_VIGENTE_OU_NAO_COMPROVADA');
    expect(obsoleto.analiseCandidata).toBeNull(); expect(obsoleto.mesesPropostos).toBeNull(); expect(axios.request).not.toHaveBeenCalled();
  });
});

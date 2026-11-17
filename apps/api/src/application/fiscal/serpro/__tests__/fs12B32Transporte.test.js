import axios from 'axios';
import { SerproHttpClient } from '../SerproHttpClient.js';
import { PgdasSimulacaoService, buildDeclaracaoPayload } from '../PgdasSimulacaoService.js';
import { SerproPgdasdService } from '../SerproPgdasdService.js';
import { assinaturasSimulacao } from '../../../notas/apuracao/v2/PeriodosRecusadosService.js';
import { createHash } from 'node:crypto';
import { autorizarChamada, autorizarDespacho, concluirChamada } from '../SerproCallGuard.js';
import { lerResposta, guardarResposta } from '../SerproRespostaCache.js';
jest.mock('axios', () => ({ request: jest.fn(), isAxiosError: () => false }));
jest.mock('../SerproCallGuard.js', () => ({ autorizarChamada: jest.fn(), autorizarDespacho: jest.fn(), concluirChamada: jest.fn() }));
jest.mock('../SerproRespostaCache.js', () => ({ lerResposta: jest.fn(), guardarResposta: jest.fn(), chaveResposta: () => 'assinatura-canonica-local' }));
jest.mock('../SerproRuntimeSettings.js', () => ({ getResolvedSerproCredentials: jest.fn(async () => ({ baseUrl: 'https://invalid.test', timeoutMs: 1000 })) }));
jest.mock('../../automacaoCicloFiscalContext.js', () => ({ conferirTransporteCicloFiscal: jest.fn(), conferirContribuinteCicloFiscal: jest.fn() }));
const payload = dados => ({ pedidoDados: { idSistema: 'PGDASD', idServico: 'TRANSDECLARACAO11', dados: JSON.stringify(dados) } });
let auth, client;
beforeEach(() => {
  jest.resetAllMocks();
  auth = { authenticate: jest.fn(async () => ({ accessToken: 'test' })), buildHttpsAgent: jest.fn() };
  client = new SerproHttpClient({ authService: auth });
  lerResposta.mockResolvedValue(null);
  axios.request.mockResolvedValue({ status: 200, data: { ok: true } });
});
test.each([202611, 202612, 202701])('PA %s recusa antes de cache, reserva, custo, auth e HTTP, independentemente da intenção', async pa => {
  for (const indicadorTransmissao of [false, true]) {
    await expect(client.request({ path: 'https://invalid.test/Declarar', data: payload({ pa, indicadorTransmissao, forcar: true, autorizaEfeitoFiscal: true }), raw: true })).rejects.toMatchObject({ code: pa >= 202701 ? 'FS12_HOMOLOGACAO_2027_PENDENTE' : 'FS12_INTEGRACAO_B33_PENDENTE' });
  }
  for (const fn of [lerResposta, autorizarChamada, autorizarDespacho, concluirChamada, guardarResposta, auth.authenticate, auth.buildHttpsAgent, axios.request]) expect(fn).not.toHaveBeenCalled();
});
test.each([{ pa: 202610, _periodoApuracao: '202611' }, { pa: 202611, _periodoApuracao: '202610' }, {}, { pa: null }])('envelope %j não contorna proteção', async dados => {
  await expect(client.post('/Declarar', payload(dados))).rejects.toMatchObject({ code: 'FS12_COMPETENCIA_INVALIDA' });
  expect(autorizarChamada).not.toHaveBeenCalled(); expect(axios.request).not.toHaveBeenCalled();
});
test.each([{ pa: 202610 }, { _periodoApuracao: '202610' }])('legado %j mantém consulta ao cache existente', async dados => {
  lerResposta.mockResolvedValue({ salvo: true });
  await expect(client.post('/Declarar', payload(dados))).resolves.toEqual({ salvo: true });
  expect(lerResposta).toHaveBeenCalledTimes(1);
});
test.each(['CONSDECLARACAO13', 'GERARDAS12', 'GERARDASCOBRANCA17'])('serviço documental %s preservado', async idServico => {
  const p = payload({ pa: 202611 }); p.pedidoDados.idServico = idServico;
  lerResposta.mockResolvedValue({ documento: true });
  await expect(client.post('/Consultar', p)).resolves.toEqual({ documento: true });
});
test.each(['simular', 'transmitir'])('%s direto recusa antes do builder e adaptador injetado', async metodo => {
  const transmitirDeclaracao = jest.fn();
  const service = new PgdasSimulacaoService({ pgdasService: { transmitirDeclaracao } });
  await expect(service[metodo]({ competencia: '2026-11', atividades: [] })).rejects.toMatchObject({ code: 'FS12_INTEGRACAO_B33_PENDENTE' });
  expect(transmitirDeclaracao).not.toHaveBeenCalled();
});
test.each(['2026-11', '2026-12'])('construção e assinatura locais %s permanecem sem transporte', async competencia => {
  const declaracao = buildDeclaracaoPayload({ contribuinteCnpj: '12345678000195', competencia, atividades: [], indicadorTransmissao: false });
  const post = jest.fn((rota, p) => `${rota}|${p.pedidoDados.dados}`);
  const local = new SerproPgdasdService({ client: { post } });
  await expect(local.transmitirDeclaracao({ contratanteCnpj: '12345678000195', contribuinteCnpj: '12345678000195', periodoApuracao: competencia, declaracao })).resolves.toBe(`/Declarar|${JSON.stringify(declaracao)}`);
  expect(post).toHaveBeenCalledTimes(1); expect(axios.request).not.toHaveBeenCalled(); expect(autorizarChamada).not.toHaveBeenCalled();
  const envelopeEnviado = post.mock.calls[0][1];
  const hashes = await assinaturasSimulacao({ competencia, contratanteCnpj: '12345678000195', contribuinteCnpj: '12345678000195', atividades: [] });
  expect(hashes).toEqual(['assinatura-canonica-local', createHash('sha256').update(`/Declarar|${JSON.stringify(envelopeEnviado)}`).digest('hex')]);
  expect(axios.request).not.toHaveBeenCalled(); expect(autorizarChamada).not.toHaveBeenCalled();
});

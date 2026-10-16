import axios from "axios";
import { SerproHttpClient } from "../SerproHttpClient.js";
import { chaveResposta, lerResposta, guardarResposta, ehSimulacaoPgdas } from "../SerproRespostaCache.js";
import crypto from 'node:crypto';
import { comContextoSerpro } from "../serproCallContext.js";
import { prisma } from "../../../../infrastructure/db/prisma.js";
import { autorizarChamada, concluirChamada } from "../SerproCallGuard.js";
jest.mock("axios", () => ({ request: jest.fn(), isAxiosError: () => false }));
jest.mock("../SerproCallGuard.js", () => ({ autorizarDespacho: jest.fn(), autorizarChamada: jest.fn(async () => ({ id: "r1" })), concluirChamada: jest.fn() }));
jest.mock("../SerproRuntimeSettings.js", () => ({ getResolvedSerproCredentials: async () => ({ baseUrl: "https://invalid.test", timeoutMs: 10 }) }));
jest.mock("../../../../infrastructure/db/prisma.js", () => ({ prisma: { serproChamada: { findFirst: jest.fn() }, serproRespostaCache: { findUnique: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() } } }));
const payload = { contribuinte: { numero: "12345678000199" }, pedidoDados: { idServico: "GERARDAS12", dados: '{"periodoApuracao":"202608","campo":1}' } };
const cliente = () => new SerproHttpClient({ authService: { authenticate: async () => ({ accessToken: "test" }), buildHttpsAgent: async () => null } });
beforeEach(() => { jest.clearAllMocks(); prisma.serproChamada.findFirst.mockReset().mockResolvedValue(null); prisma.serproRespostaCache.findUnique.mockResolvedValue(null); prisma.serproRespostaCache.upsert.mockResolvedValue({}); axios.request.mockResolvedValue({ status: 200, data: { pdf: "fixture" }, headers: {} }); });
test("ordem de propriedades externa e do JSON interno não muda a assinatura", () => {
  expect(chaveResposta(payload, "/Emitir")).toBe(chaveResposta({ pedidoDados: { dados: '{"campo":1,"periodoApuracao":"202608"}', idServico: "GERARDAS12" }, contribuinte: payload.contribuinte }, "/Emitir"));
  expect(chaveResposta(payload, "/Emitir")).not.toBe(chaveResposta({ ...payload, contribuinte: { numero: "99999999000199" } }, "/Emitir"));
});
test("resposta persistida permite repetir processamento em outro client sem novo HTTP", async () => {
  const primeira = await cliente().post("/Emitir", payload);
  const row = prisma.serproRespostaCache.upsert.mock.calls[0][0].create;
  prisma.serproRespostaCache.findUnique.mockResolvedValue(row);
  expect(await cliente().post("/Emitir", payload)).toEqual(primeira);
  expect(axios.request).toHaveBeenCalledTimes(1);
  expect(autorizarChamada).toHaveBeenCalledTimes(1);
});

test('documento em cache continua disponível sob pausa, sem autenticar ou reservar', async () => {
  prisma.serproRespostaCache.findUnique.mockResolvedValue({ resposta: { pdf: 'salvo' }, expiraEm: new Date(Date.now() + 60000) });
  autorizarChamada.mockRejectedValue(Object.assign(new Error('Empresa pausada'), { code: 'SERPRO_EMPRESA_PAUSADA' }));
  const auth = { authenticate: jest.fn(), buildHttpsAgent: jest.fn() };
  try {
    expect(await new SerproHttpClient({ authService: auth }).post('/Emitir', payload)).toEqual({ pdf: 'salvo' });
    expect(autorizarChamada).not.toHaveBeenCalled();
    expect(auth.authenticate).not.toHaveBeenCalled();
    expect(axios.request).not.toHaveBeenCalled();
  } finally { autorizarChamada.mockResolvedValue({ id: 'r1' }); }
});
test("atualização explícita invalida a resposta e faz nova tentativa", async () => {
  prisma.serproRespostaCache.findUnique.mockResolvedValue({ resposta: { antiga: true }, expiraEm: new Date(Date.now() + 60000) });
  await comContextoSerpro({ atualizar: true }, () => cliente().post("/Emitir", payload));
  expect(prisma.serproRespostaCache.deleteMany).toHaveBeenCalledWith({ where: { chave: chaveResposta(payload, "/Emitir") } });
  expect(axios.request).toHaveBeenCalledTimes(1);
});
test("falha de gravação preserva reserva e não afirma finalização", async () => {
  prisma.serproRespostaCache.upsert.mockRejectedValueOnce(new Error("db"));
  await expect(cliente().post("/Emitir", payload)).rejects.toMatchObject({ code: "SERPRO_REGISTRO_INDETERMINADO" });
  expect(concluirChamada).not.toHaveBeenCalled(); expect(axios.request).toHaveBeenCalledTimes(1);
});
test("cache indisponível falha antes de gerar consumo", async () => {
  prisma.serproRespostaCache.findUnique.mockRejectedValueOnce(new Error("db"));
  await expect(cliente().post("/Emitir", payload)).rejects.toThrow("db");
  expect(axios.request).not.toHaveBeenCalled(); expect(autorizarChamada).not.toHaveBeenCalled();
});
test("expirado, transmissão e polling não usam resposta salva", async () => {
  prisma.serproRespostaCache.findUnique.mockResolvedValue({ resposta: {}, expiraEm: new Date(0) });
  expect(await lerResposta(payload, "/Emitir")).toBeNull();
  prisma.serproRespostaCache.findUnique.mockClear();
  for (const idServico of ["TRANSDECLARACAO11", "RELATORIOSITFIS92", "COMPARRECADACAO72"]) {
    const p = { pedidoDados: { idServico } };
    expect(await lerResposta(p, "/Emitir")).toBeNull();
    await guardarResposta(p, "/Emitir", { status: 200, data: {} });
  }
  expect(prisma.serproRespostaCache.findUnique).not.toHaveBeenCalled();
  expect(prisma.serproRespostaCache.upsert).not.toHaveBeenCalled();
});

const simulacao = { ...payload, pedidoDados: { idSistema: 'PGDASD', idServico: 'TRANSDECLARACAO11', dados: JSON.stringify({ pa: 202609, indicadorTransmissao: false, declaracao: { receitaPaCompetenciaInterno: 100 } }) } };

test('sucesso da simulação sobrevive à falha posterior do consumidor sem segundo HTTP', async () => {
  const resultado = { dados: JSON.stringify({ dasValor: 6 }) };
  axios.request.mockResolvedValueOnce({ status: 200, data: resultado });
  const consumidor = async () => { await cliente().post('/Declarar', simulacao); throw new Error('Falha ao salvar snapshot'); };
  await expect(consumidor()).rejects.toThrow('Falha ao salvar snapshot');
  const row = prisma.serproRespostaCache.upsert.mock.calls[0][0].create;
  expect(prisma.serproRespostaCache.upsert.mock.invocationCallOrder[0]).toBeLessThan(concluirChamada.mock.invocationCallOrder[0]);
  prisma.serproRespostaCache.findUnique.mockResolvedValue(row);
  expect(await cliente().post('/Declarar', simulacao)).toEqual(resultado);
  expect(axios.request).toHaveBeenCalledTimes(1); expect(autorizarChamada).toHaveBeenCalledTimes(1);
});

test.each([null, { resposta: {}, expiraEm: new Date(0) }])('cache ausente ou expirado com sucesso prévio bloqueia antes de HTTP: %j', row => {
  prisma.serproRespostaCache.findUnique.mockResolvedValue(row);
  prisma.serproChamada.findFirst.mockImplementation(async ({ where }) => where.status === 'ok' ? { id: 'sucesso' } : null);
  return expect(cliente().post('/Declarar', simulacao)).rejects.toMatchObject({ code: 'SERPRO_SIMULACAO_ANTERIOR_NAO_RECUPERAVEL' }).then(() => {
    expect(axios.request).not.toHaveBeenCalled(); expect(autorizarChamada).not.toHaveBeenCalled();
  });
});

test('sucesso com hash legado também impede repetição sem resposta recuperável', async () => {
  const legado = crypto.createHash('sha256').update(`/Declarar|${JSON.stringify(simulacao)}`).digest('hex');
  prisma.serproChamada.findFirst.mockImplementation(async ({ where }) => where.status === 'ok' && where.assinatura.in.includes(legado) ? { id: 'antiga' } : null);
  await expect(cliente().post('/Declarar', simulacao)).rejects.toMatchObject({ code: 'SERPRO_SIMULACAO_ANTERIOR_NAO_RECUPERAVEL' });
  expect(axios.request).not.toHaveBeenCalled();
});

test('atualizar não descarta resposta de simulação nem contorna bloqueio após expiração', async () => {
  const row = { resposta: { calculo: 6 }, expiraEm: new Date(Date.now() + 60000) };
  prisma.serproRespostaCache.findUnique.mockResolvedValue(row);
  expect(await comContextoSerpro({ atualizar: true }, () => cliente().post('/Declarar', simulacao))).toEqual(row.resposta);
  expect(prisma.serproRespostaCache.deleteMany).not.toHaveBeenCalled(); expect(axios.request).not.toHaveBeenCalled();
  prisma.serproRespostaCache.findUnique.mockResolvedValue({ ...row, expiraEm: new Date(0) });
  prisma.serproChamada.findFirst.mockImplementation(async ({ where }) => where.status === 'ok' ? { id: 'anterior' } : null);
  await expect(comContextoSerpro({ atualizar: true }, () => cliente().post('/Declarar', simulacao))).rejects.toMatchObject({ code: 'SERPRO_SIMULACAO_ANTERIOR_NAO_RECUPERAVEL' });
});

test.each(['empresa', 'competencia', 'folha', 'receita'])('%s alterada permite nova chamada, sem reaproveitar sucesso de outra assinatura', async campo => {
  const antiga = chaveResposta(simulacao, '/Declarar');
  prisma.serproChamada.findFirst.mockImplementation(async ({ where }) => where.status === 'ok' && where.httpStatus === 200 && where.idSistema === 'PGDASD' && where.idServico === 'TRANSDECLARACAO11' && where.rota === '/Declarar' && where.assinatura.in.includes(antiga) ? { id: 'anterior' } : null);
  const nova = JSON.parse(JSON.stringify(simulacao));
  const dados = JSON.parse(nova.pedidoDados.dados);
  if (campo === 'empresa') nova.contribuinte.numero = '99999999000199';
  if (campo === 'competencia') dados.pa = 202610;
  if (campo === 'folha') dados.declaracao.folhasSalario = [{ pa: 202608, valor: 6000 }];
  if (campo === 'receita') dados.declaracao.receitaPaCompetenciaInterno = 101;
  nova.pedidoDados.dados = JSON.stringify(dados);
  await expect(cliente().post('/Declarar', simulacao)).rejects.toMatchObject({ code: 'SERPRO_SIMULACAO_ANTERIOR_NAO_RECUPERAVEL' });
  await cliente().post('/Declarar', nova);
  expect(autorizarChamada).toHaveBeenCalledTimes(1); expect(axios.request).toHaveBeenCalledTimes(1);
});

test('reserva pendente não é ignorada mesmo com resposta em cache', async () => {
  prisma.serproRespostaCache.findUnique.mockResolvedValue({ resposta: {}, expiraEm: new Date(Date.now() + 60000) });
  prisma.serproChamada.findFirst.mockResolvedValue({ id: 'pendente' });
  await expect(cliente().post('/Declarar', simulacao)).rejects.toMatchObject({ code: 'SERPRO_CHAMADA_EM_ANDAMENTO' });
  expect(axios.request).not.toHaveBeenCalled();
});

test.each(['ledger', 'cache'])('falha na leitura de %s da simulação é explícita e não chama provedor', async local => {
  if (local === 'ledger') prisma.serproChamada.findFirst.mockRejectedValueOnce(new Error('DB'));
  else prisma.serproRespostaCache.findUnique.mockRejectedValueOnce(new Error('DB'));
  await expect(cliente().post('/Declarar', simulacao)).rejects.toMatchObject({ code: 'SERPRO_MEDICAO_INDISPONIVEL', status: 503 });
  expect(axios.request).not.toHaveBeenCalled(); expect(autorizarChamada).not.toHaveBeenCalled();
});

test('falha de gravação da resposta de simulação deixa reserva pendente e impede outra chamada', async () => {
  prisma.serproRespostaCache.upsert.mockRejectedValueOnce(new Error('DB'));
  await expect(cliente().post('/Declarar', simulacao)).rejects.toMatchObject({ code: 'SERPRO_REGISTRO_INDETERMINADO' });
  expect(concluirChamada).not.toHaveBeenCalled();
  prisma.serproChamada.findFirst.mockResolvedValue({ id: 'pendente' });
  await expect(cliente().post('/Declarar', simulacao)).rejects.toMatchObject({ code: 'SERPRO_CHAMADA_EM_ANDAMENTO' });
  expect(axios.request).toHaveBeenCalledTimes(1);
});

test.each([true, 'false', 0, null, undefined])('transmissão ou flag não booleana false jamais habilita cache: %j', indicadorTransmissao => {
  expect(ehSimulacaoPgdas({ ...simulacao, pedidoDados: { ...simulacao.pedidoDados, dados: JSON.stringify({ indicadorTransmissao }) } }, '/Declarar')).toBe(false);
});

test('sistema e rota também precisam corresponder ao contrato de simulação', () => {
  expect(ehSimulacaoPgdas(simulacao, '/Emitir')).toBe(false);
  expect(ehSimulacaoPgdas({ ...simulacao, pedidoDados: { ...simulacao.pedidoDados, idSistema: 'OUTRO' } }, '/Declarar')).toBe(false);
  expect(ehSimulacaoPgdas({ ...simulacao, pedidoDados: { ...simulacao.pedidoDados, dados: '{' } }, '/Declarar')).toBe(false);
});

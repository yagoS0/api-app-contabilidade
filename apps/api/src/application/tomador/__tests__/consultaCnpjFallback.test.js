import { consultarCnpj } from "../consultaCnpj.js";

const CNPJ = "12345678000190";
const OUTRO = "11222333000181";
const MUNICIPIOS = [["3304557", "Rio de Janeiro", "RJ"]];
const CADASTRO = { cnpj: CNPJ, razao_social: "EMPRESA SINTETICA", codigo_municipio_ibge: 3304557, codigo_municipio: 6001, municipio: "RIO DE JANEIRO", uf: "RJ", cep: "20040020", descricao_tipo_de_logradouro: "RUA", logradouro: "DE TESTE", numero: "10", bairro: "CENTRO" };
const resposta = (status, bruto = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => bruto });
const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const opcoes = fetchImpl => ({ fetchImpl, municipios: MUNICIPIOS, log });
afterEach(() => { jest.useRealTimers(); jest.clearAllMocks(); });

test.each([403, 429, 500, 502, 503])("BrasilAPI HTTP%s usa a fonte pública alternativa", async status => {
  const f = jest.fn().mockResolvedValueOnce(resposta(status)).mockResolvedValueOnce(resposta(200, CADASTRO));
  const r = await consultarCnpj(CNPJ, opcoes(f));
  expect(r).toMatchObject({ ok: true, cnpj: CNPJ, fonte: "MINHA_RECEITA", tomador: { nome: "EMPRESA SINTETICA", endereco: { cMun: "3304557", nro: "10" } }, bruto: CADASTRO });
  expect(f.mock.calls.map(([url]) => url)).toEqual([`https://brasilapi.com.br/api/cnpj/v1/${CNPJ}`, `https://minhareceita.org/${CNPJ}`]);
});

test("erro de rede pode recuperar pelo fallback sem repetir a primeira fonte", async () => {
  const f = jest.fn().mockRejectedValueOnce(new Error("rede caiu")).mockResolvedValueOnce(resposta(200, CADASTRO));
  expect(await consultarCnpj(CNPJ, opcoes(f))).toMatchObject({ ok: true, fonte: "MINHA_RECEITA" });
  expect(f).toHaveBeenCalledTimes(2);
});

test.each([400, 401, 404])("HTTP%s não dispara uma segunda consulta", async status => {
  const f = jest.fn().mockResolvedValue(resposta(status));
  expect((await consultarCnpj(CNPJ, opcoes(f))).ok).toBe(false);
  expect(f).toHaveBeenCalledTimes(1);
});

test("sucesso primário encerra a consulta sem fallback", async () => {
  const f = jest.fn().mockResolvedValue(resposta(200, CADASTRO));
  expect(await consultarCnpj(CNPJ, opcoes(f))).toMatchObject({ ok: true, fonte: "BRASILAPI" });
  expect(f).toHaveBeenCalledTimes(1);
});

test.each(["12345678909", "123", ""])("documento não consultável %s não alcança nenhuma fonte", async doc => {
  const f = jest.fn();
  expect((await consultarCnpj(doc, opcoes(f))).ok).toBe(false);
  expect(f).not.toHaveBeenCalled();
});

test.each([OUTRO, null, undefined, 12345678000190])("documento retornado não comprovável %s não fornece tomador", async cnpj => {
  const f = jest.fn().mockResolvedValue(resposta(200, { ...CADASTRO, cnpj }));
  const r = await consultarCnpj(CNPJ, opcoes(f));
  expect(r).toMatchObject({ ok: false, motivo: "resposta_invalida" });
  expect(r.tomador).toBeUndefined();
  expect(f).toHaveBeenCalledTimes(1);
});

test("fallback também recusa resposta de outro CNPJ", async () => {
  const f = jest.fn().mockResolvedValueOnce(resposta(403)).mockResolvedValueOnce(resposta(200, { ...CADASTRO, cnpj: OUTRO }));
  expect(await consultarCnpj(CNPJ, opcoes(f))).toMatchObject({ ok: false, motivo: "resposta_invalida" });
});

test("duas fontes indisponíveis preservam falha sem inventar cadastro", async () => {
  const f = jest.fn().mockResolvedValue(resposta(503));
  const r = await consultarCnpj(CNPJ, opcoes(f));
  expect(r).toMatchObject({ ok: false, motivo: "indisponivel" });
  expect(r.tomador).toBeUndefined();
  expect(f).toHaveBeenCalledTimes(2);
});

test("timeout da primeira fonte deixa tempo para a segunda e aborta a primeira", async () => {
  jest.useFakeTimers();
  const f = jest.fn().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce(resposta(200, CADASTRO));
  const fim = jest.fn();
  consultarCnpj(CNPJ, { ...opcoes(f), timeoutMs: 1000 }).then(fim);
  await jest.advanceTimersByTimeAsync(500);
  expect(fim).toHaveBeenCalledWith(expect.objectContaining({ ok: true, fonte: "MINHA_RECEITA" }));
  expect(f.mock.calls[0][1].signal.aborted).toBe(true);
});

test("o orçamento total inclui corpo JSON travado, mesmo se o fetch ignorar abort", async () => {
  jest.useFakeTimers();
  const f = jest.fn().mockResolvedValue({ ok: true, status: 200, json: () => new Promise(() => {}) });
  const fim = jest.fn();
  consultarCnpj(CNPJ, { ...opcoes(f), timeoutMs: 1000 }).then(fim);
  await jest.advanceTimersByTimeAsync(1000);
  expect(fim).toHaveBeenCalledWith(expect.objectContaining({ ok: false, motivo: "timeout" }));
  expect(f).toHaveBeenCalledTimes(2);
  expect(f.mock.calls.every(([, opts]) => opts.signal.aborted)).toBe(true);
});

test("o log identifica as fontes e o HTTP403 sem expor os dados retornados", async () => {
  const f = jest.fn().mockResolvedValueOnce(resposta(403)).mockResolvedValueOnce(resposta(200, CADASTRO));
  await consultarCnpj(CNPJ, opcoes(f));
  const registrado = JSON.stringify([log.info.mock.calls, log.warn.mock.calls]);
  expect(registrado).toContain("403");
  expect(registrado).toContain("MINHA_RECEITA");
  expect(registrado).not.toContain(CNPJ);
  expect(registrado).not.toContain("EMPRESA SINTETICA");
  expect(registrado).not.toContain("DE TESTE");
});

test("o teto continua oito segundos mesmo se o chamador pedir um minuto", async () => {
  jest.useFakeTimers();
  const f = jest.fn(() => new Promise(() => {}));
  const fim = jest.fn();
  consultarCnpj(CNPJ, { ...opcoes(f), timeoutMs: 60000 }).then(fim);
  await jest.advanceTimersByTimeAsync(7999);
  expect(fim).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  expect(fim).toHaveBeenCalledWith(expect.objectContaining({ ok: false, motivo: "timeout" }));
  expect(f).toHaveBeenCalledTimes(2);
});

test("cadastro parcial na alternativa conserva o nome e os campos faltantes", async () => {
  const parcial = { cnpj: "12.345.678/0001-90", razao_social: "EMPRESA SINTETICA" };
  const f = jest.fn().mockResolvedValueOnce(resposta(429)).mockResolvedValueOnce(resposta(200, parcial));
  const r = await consultarCnpj(CNPJ, opcoes(f));
  expect(r).toMatchObject({ ok: true, bruto: parcial, tomador: { nome: "EMPRESA SINTETICA", endereco: null } });
  expect(r.tomador.enderecoFaltantes).toContain("o CEP");
});

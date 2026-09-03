// A consulta de CNPJ do lado do servidor — sem rede, e ela NUNCA lança.

import { consultarCnpj, mascararCnpj, MOTIVOS, BRASILAPI_CNPJ_BASE } from "../consultaCnpj.js";

const MUNICIPIOS = [["3304557", "Rio de Janeiro", "RJ"]];
const BRUTO = {
  razao_social: "ACME LTDA", descricao_situacao_cadastral: "ATIVA",
  codigo_municipio_ibge: 3304557, municipio: "Rio de Janeiro", uf: "RJ",
  cep: "20040020", descricao_tipo_de_logradouro: "AVENIDA", logradouro: "RIO BRANCO", numero: "1", bairro: "CENTRO",
};

function fetchFalso(status, corpo, { lanca = null, json = true } = {}) {
  return jest.fn(async (_url, opts) => {
    if (lanca) throw lanca;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => { if (!json) throw new Error("not json"); return corpo; },
    };
  });
}

const silencio = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

beforeAll(() => {
  // ⚠ A rede é TRAVADA por construção: qualquer caminho que escapasse do `fetchImpl` cai aqui.
  globalThis.fetch = jest.fn(async () => { throw new Error("REDE PROIBIDA NO TESTE"); });
});

describe("o que NÃO sai", () => {
  it("⚠ CPF não se consulta — nenhuma chamada", async () => {
    const f = fetchFalso(200, BRUTO);
    const r = await consultarCnpj("123.456.789-09", { fetchImpl: f, log: silencio });
    expect(r).toEqual({ ok: false, motivo: MOTIVOS.CPF, mensagem: expect.stringMatching(/CPF não se consulta/), cnpj: null });
    expect(f).not.toHaveBeenCalled();
  });
  it("CNPJ incompleto — nenhuma chamada", async () => {
    const f = fetchFalso(200, BRUTO);
    expect((await consultarCnpj("1234", { fetchImpl: f, log: silencio })).motivo).toBe(MOTIVOS.CNPJ_INCOMPLETO);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("a chamada", () => {
  it("vai para a BrasilAPI com os 14 dígitos, e devolve o tomador provado contra a lista", async () => {
    const f = fetchFalso(200, BRUTO);
    const r = await consultarCnpj("12.345.678/0001-90", { fetchImpl: f, municipios: MUNICIPIOS, log: silencio });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe(`${BRASILAPI_CNPJ_BASE}/12345678000190`);
    expect(r.ok).toBe(true);
    expect(r.cnpj).toBe("12345678000190");
    expect(r.tomador.nome).toBe("ACME LTDA");
    expect(r.tomador.endereco.cMun).toBe("3304557");
  });

  it("404 → nao_encontrado; 5xx → indisponivel; corpo torto → resposta_invalida — nunca lança", async () => {
    expect((await consultarCnpj("12345678000190", { fetchImpl: fetchFalso(404, {}), log: silencio })).motivo).toBe(MOTIVOS.NAO_ENCONTRADO);
    expect((await consultarCnpj("12345678000190", { fetchImpl: fetchFalso(503, {}), log: silencio })).motivo).toBe(MOTIVOS.INDISPONIVEL);
    expect((await consultarCnpj("12345678000190", { fetchImpl: fetchFalso(200, null, { json: false }), log: silencio })).motivo).toBe(MOTIVOS.RESPOSTA_INVALIDA);
    expect((await consultarCnpj("12345678000190", { fetchImpl: fetchFalso(200, [1, 2]), log: silencio })).motivo).toBe(MOTIVOS.RESPOSTA_INVALIDA);
  });

  it("falha de rede → rede; abort → timeout", async () => {
    expect((await consultarCnpj("12345678000190", { fetchImpl: fetchFalso(0, null, { lanca: new Error("ECONNRESET") }), log: silencio })).motivo).toBe(MOTIVOS.REDE);
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect((await consultarCnpj("12345678000190", { fetchImpl: fetchFalso(0, null, { lanca: abort }), log: silencio })).motivo).toBe(MOTIVOS.TIMEOUT);
  });

  it("⚠ o log não carrega razão social nem endereço — só o CNPJ mascarado", async () => {
    const log = { info: jest.fn(), warn: jest.fn() };
    await consultarCnpj("12345678000190", { fetchImpl: fetchFalso(200, BRUTO), municipios: MUNICIPIOS, log });
    const registrado = JSON.stringify(log.info.mock.calls);
    expect(registrado).toContain("12.345.678/****-**");
    expect(registrado).not.toContain("ACME");
    expect(registrado).not.toContain("RIO BRANCO");
    expect(registrado).not.toContain("12345678000190");
  });

  it("mascararCnpj", () => {
    expect(mascararCnpj("12345678000190")).toBe("12.345.678/****-**");
    expect(mascararCnpj("123")).toBe("(cnpj fora de forma)");
  });
});

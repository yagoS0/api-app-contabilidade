import { consultarCep, MOTIVOS, VIACEP_BASE } from "../consultarCep.js";

const MUNICIPIOS = [["3304557", "Rio de Janeiro", "RJ"]];
const CEP = "20040020";
const RESPOSTA = {
  cep: "20040-020", localidade: "Rio de Janeiro", uf: "RJ", ibge: "3304557",
  logradouro: "Rua sintética", bairro: "Bairro sintético", complemento: "lado ímpar",
};
const resposta = (body = RESPOSTA, status = 200) => ({
  ok: status >= 200 && status < 300, status, json: jest.fn(async () => body),
});
const consulta = (body = RESPOSTA, extra = {}) => consultarCep(CEP, {
  municipios: MUNICIPIOS, fetchImpl: jest.fn(async () => resposta(body)), ...extra,
});
const fetchOriginal = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = jest.fn(async () => { throw new Error("REDE PROIBIDA NO TESTE"); });
});
afterAll(() => { globalThis.fetch = fetchOriginal; });
afterEach(() => { jest.useRealTimers(); });

describe("consulta de CEP sem rede real", () => {
  it.each(["20040020", "20040-020", " 20040-020 "])("normaliza %s e consulta uma única URL oficial", async (cep) => {
    const fetchImpl = jest.fn(async () => resposta());
    const r = await consultarCep(cep, { fetchImpl, municipios: MUNICIPIOS });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(`${VIACEP_BASE}/${CEP}/json/`, expect.objectContaining({
      method: "GET", headers: { Accept: "application/json" }, signal: expect.any(AbortSignal), redirect: "error",
    }));
    expect(r).toMatchObject({
      ok: true, fonte: "VIACEP", cep: CEP, municipioTexto: "Rio de Janeiro", uf: "RJ",
      endereco: { CEP, cMun: "3304557", xLgr: "Rua sintética", xBairro: "Bairro sintético", nro: null, xCpl: null },
      enderecoFaltantes: ["o número"], motivoMunicipio: null,
    });
  });

  it.each([null, undefined, "", "1234567", "123456789", "2004A0020", "2004 0020", "20040/020", "https://exemplo.invalid/20040020", {}, [CEP], true])("recusa entrada inválida %j sem consulta", async (cep) => {
    const fetchImpl = jest.fn();
    expect(await consultarCep(cep, { fetchImpl })).toMatchObject({ ok: false, motivo: MOTIVOS.CEP_INVALIDO, cep: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("não transforma complemento postal ou campos extras em número/complemento do imóvel", async () => {
    const r = await consulta({ ...RESPOSTA, numero: "900", nro: "900", xCpl: "apto 4" });
    expect(r.endereco.nro).toBeNull();
    expect(r.endereco.xCpl).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/lado ímpar|apto 4|900/);
    expect(r).not.toHaveProperty("bruto");
  });

  it("CEP genérico mantém município verificado e pede somente os campos ausentes", async () => {
    const r = await consulta({ ...RESPOSTA, logradouro: "", bairro: "" });
    expect(r.ok).toBe(true);
    expect(r.endereco).toEqual({ CEP, cMun: "3304557", xLgr: null, xBairro: null, nro: null, xCpl: null });
    expect(r.enderecoFaltantes).toEqual(expect.arrayContaining(["o logradouro", "o número", "o bairro"]));
    expect(r.enderecoFaltantes).not.toContain("o código IBGE do município");
  });

  it.each([
    ["sem IBGE", { ibge: "" }], ["IBGE inexistente", { ibge: "9999999" }],
    ["IBGE com caracteres inválidos", { ibge: "abc3304557" }],
    ["município diferente", { localidade: "Outra cidade" }], ["UF diferente", { uf: "SP" }],
  ])("%s preserva campos parciais sem afirmar cMun", async (_caso, alteracoes) => {
    const r = await consulta({ ...RESPOSTA, ...alteracoes });
    expect(r.ok).toBe(true);
    expect(r.endereco).toMatchObject({ CEP, cMun: null, xLgr: "Rua sintética", xBairro: "Bairro sintético" });
    expect(r.enderecoFaltantes).toContain("o código IBGE do município");
    expect(r.motivoMunicipio).toEqual(expect.any(String));
  });

  it("lista IBGE indisponível não permite aceitar o código retornado", async () => {
    const r = await consulta(RESPOSTA, { municipios: null });
    expect(r.endereco.cMun).toBeNull();
    expect(r.motivoMunicipio).toMatch(/lista oficial/);
  });

  it("verifica município e UF usando a mesma normalização do cadastro", async () => {
    const r = await consulta({ ...RESPOSTA, localidade: " RIO DE JANEIRO ", uf: "rj" });
    expect(r.endereco.cMun).toBe("3304557");
    expect(r.uf).toBe("RJ");
  });

  it("campos de endereço não textuais não viram texto aparentemente válido", async () => {
    const r = await consulta({ ...RESPOSTA, logradouro: { dado: "Rua" }, bairro: ["Bairro"] });
    expect(r.endereco.xLgr).toBeNull();
    expect(r.endereco.xBairro).toBeNull();
  });

  it.each([null, [], "texto", { ...RESPOSTA, cep: "99999-999" }, { ...RESPOSTA, cep: "abc20040020" }, { ...RESPOSTA, cep: undefined }])("descarta corpo inválido ou CEP divergente %j", async (body) => {
    const r = await consulta(body);
    expect(r).toMatchObject({ ok: false, motivo: MOTIVOS.RESPOSTA_INVALIDA, cep: CEP });
    expect(r).not.toHaveProperty("endereco");
  });

  it.each([true, "true"])("CEP inexistente sinalizado por erro=%j não oferece endereço", async (erro) => {
    expect(await consulta({ erro })).toMatchObject({ ok: false, motivo: MOTIVOS.NAO_ENCONTRADO });
  });

  it.each([[404, "nao_encontrado"], [400, "indisponivel"], [429, "indisponivel"], [503, "indisponivel"]])("HTTP %s não oferece dados", async (status, motivo) => {
    const res = resposta(RESPOSTA, status);
    expect(await consulta(RESPOSTA, { fetchImpl: async () => res })).toMatchObject({ ok: false, motivo });
    expect(res.json).not.toHaveBeenCalled();
  });

  it("JSON malformado e falha de transporte têm respostas distintas", async () => {
    expect(await consulta(RESPOSTA, { fetchImpl: async () => { throw new Error("ECONNRESET"); } }))
      .toMatchObject({ ok: false, motivo: MOTIVOS.REDE });
    expect(await consulta(RESPOSTA, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("não JSON"); } }) }))
      .toMatchObject({ ok: false, motivo: MOTIVOS.RESPOSTA_INVALIDA });
  });

  it.each(["fetch", "body"])("timeout cobre %s pendente mesmo se o transporte injetado ignorar abort", async (etapa) => {
    jest.useFakeTimers();
    let signal;
    const fetchImpl = jest.fn(async (_url, opts) => {
      signal = opts.signal;
      if (etapa === "fetch") return new Promise(() => {});
      return { ok: true, status: 200, json: () => new Promise(() => {}) };
    });
    const p = consultarCep(CEP, { fetchImpl, municipios: MUNICIPIOS, timeoutMs: 1000 });
    await jest.advanceTimersByTimeAsync(1000);
    expect(await p).toMatchObject({ ok: false, motivo: MOTIVOS.TIMEOUT });
    expect(signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("consumo do body compartilha o prazo do fetch, sem ganhar outro timeout", async () => {
    jest.useFakeTimers();
    const p = consulta(RESPOSTA, { timeoutMs: 1000, fetchImpl: async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      return { ok: true, status: 200, json: () => new Promise(() => {}) };
    } });
    await jest.advanceTimersByTimeAsync(1000);
    expect(await p).toMatchObject({ ok: false, motivo: MOTIVOS.TIMEOUT });
    expect(jest.getTimerCount()).toBe(0);
  });

  it("sucesso encerra o timer sem abortar um resultado concluído", async () => {
    jest.useFakeTimers();
    const fetchImpl = jest.fn(async () => resposta());
    expect((await consulta(RESPOSTA, { fetchImpl })).ok).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(10000);
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(false);
  });

  it("log nunca inclui endereço, CEP ou corpo do provedor", async () => {
    const log = { info: jest.fn(), warn: jest.fn() };
    await consulta(RESPOSTA, { log });
    await consulta({ ...RESPOSTA, cep: "99999-999" }, { log });
    const registrado = JSON.stringify([...log.info.mock.calls, ...log.warn.mock.calls]);
    expect(registrado).not.toMatch(/20040020|20040-020|Rua sintética|Bairro sintético|Rio de Janeiro|99999-999/);
  });
});

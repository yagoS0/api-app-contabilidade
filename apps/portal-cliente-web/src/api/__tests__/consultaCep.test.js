import { consultarCep } from "../real/cep";
import { createMockApi } from "../mock/mockApi";
import { createRealApi } from "../real/realApi";

const municipios = [["3550308", "São Paulo", "SP"]];
const bruto = { cep: "01001-000", logradouro: "Praça da Sé", bairro: "Sé", localidade: "São Paulo", uf: "SP", ibge: "3550308", complemento: "lado ímpar" };
const transporte = (body = bruto, status = 200) => jest.fn().mockResolvedValue({ ok: status === 200, status, json: async () => body });
const consultar = (fetchImpl, extra = {}) => consultarCep("01001-000", { fetchImpl, municipios, ...extra });

test("carrega a lista oficial do portal quando não recebe municípios", async () => {
  expect(await consultarCep("01001000", { fetchImpl: transporte() })).toMatchObject({ ok: true, endereco: { cMun: "3550308" } });
});

test("verifica município sem inventar número ou usar complemento postal", async () => {
  const fetchImpl = transporte();
  expect(await consultar(fetchImpl)).toMatchObject({ ok: true, endereco: { CEP: "01001000", cMun: "3550308", xLgr: "Praça da Sé", xBairro: "Sé", nro: null, xCpl: null } });
  expect(fetchImpl).toHaveBeenCalledWith("https://viacep.com.br/ws/01001000/json/", expect.objectContaining({ method: "GET", signal: expect.any(Object) }));
});

test.each(["123", "123456789", "abc01001000", "0100a000"])("recusa CEP inválido %s sem consultar", async (cep) => {
  const fetchImpl = transporte();
  expect(await consultarCep(cep, { fetchImpl })).toMatchObject({ ok: false, motivo: "cep_invalido" });
  expect(fetchImpl).not.toHaveBeenCalled();
});

test.each([{ ...bruto, ibge: "9999999" }, { ...bruto, localidade: "Santos" }, { ...bruto, uf: "RJ" }])("não aceita município divergente: %j", async (body) => {
  expect(await consultar(transporte(body))).toMatchObject({ ok: true, endereco: { cMun: null, xLgr: "Praça da Sé" } });
});

test.each([[{ erro: true }, "nao_encontrado"], [{ ...bruto, cep: "12345-678" }, "resposta_invalida"], [null, "resposta_invalida"]])("resposta inválida não cria endereço: %j", async (body, motivo) => {
  expect(await consultar(transporte(body))).toMatchObject({ ok: false, motivo });
});

test("falhas de serviço continuam resultados, sem lançar", async () => {
  expect(await consultar(transporte({}, 404))).toMatchObject({ ok: false, motivo: "nao_encontrado" });
  expect(await consultar(transporte({}, 503))).toMatchObject({ ok: false, motivo: "indisponivel" });
  expect(await consultar(jest.fn().mockRejectedValue(new Error("offline")))).toMatchObject({ ok: false, motivo: "rede" });
  expect(await consultar(jest.fn().mockResolvedValue({ ok: true, json: async () => { throw new Error("json"); } }))).toMatchObject({ ok: false, motivo: "resposta_invalida" });
});

test.each(["fetch", "json"])("prazo cobre transporte parado em %s", async (etapa) => {
  const travado = () => new Promise(() => {});
  const fetchImpl = etapa === "fetch" ? travado : async () => ({ ok: true, json: travado });
  expect(await consultar(fetchImpl, { timeoutMs: 10 })).toMatchObject({ ok: false, motivo: "timeout" });
});

test("mock e real expõem CEP; mock é determinista sem rede", async () => {
  const anterior = global.fetch;
  const rede = jest.fn(() => { throw new Error("rede proibida"); });
  global.fetch = rede;
  try {
    expect(typeof createRealApi().consultarCep).toBe("function");
    const api = createMockApi();
    expect(await api.consultarCep("01001-000")).toMatchObject({ ok: true, endereco: { cMun: "3550308", CEP: "01001000" } });
    expect(await api.consultarCep("99999999")).toMatchObject({ ok: false, motivo: "nao_encontrado" });
    expect(rede).not.toHaveBeenCalled();
  } finally { global.fetch = anterior; }
});

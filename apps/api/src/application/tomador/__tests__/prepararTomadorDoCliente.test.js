jest.mock("../../../config.js", () => ({ log: null }));
import { prepararTomadorDoCliente } from "../prepararTomadorDoCliente.js";
import { buscarTomadoresEmitidos } from "../../nfse/tomadorEmitido.js";
import { camposDeEnderecoDaReceita, enderecoDaReceita } from "../consultaTomador.js";

const DOC = "12345678000190";
const CPF = "52998224725";
const CEP = "20040020";
const OUTRO_CEP = "20040030";
const MUNICIPIOS = [["3304557", "Rio de Janeiro", "RJ"]];
const ENDERECO = { CEP, cMun: "3304557", xLgr: "Rua sintética antiga", nro: "12", xCpl: "sala 2", xBairro: "Bairro antigo" };
const SALVO = { documento: DOC, nome: "Tomador salvo", email: "salvo@example.invalid", ...ENDERECO, cep: CEP };
const BASE = { portalClientId: "portal-1", tomadorDoc: DOC };
const REDE_INDISPONIVEL = { ok: false, motivo: "indisponivel" };
const fetchOriginal = globalThis.fetch;

beforeAll(() => { globalThis.fetch = jest.fn(async () => { throw new Error("REDE PROIBIDA NO TESTE"); }); });
afterAll(() => { globalThis.fetch = fetchOriginal; });

function contexto(salvo = null, overrides = {}) {
  return {
    prisma: {}, resolveLegacyCompanyId: jest.fn(async () => "legacy-1"),
    buscarTomadoresEmitidos: jest.fn(async () => ({ tomadores: new Map(salvo ? [[salvo.documento, salvo]] : []), motivo: null })),
    consultarCnpj: jest.fn(async () => REDE_INDISPONIVEL), consultarCep: jest.fn(async () => REDE_INDISPONIVEL),
    municipiosIbgeOuNulo: jest.fn(async () => MUNICIPIOS), ...overrides,
  };
}

describe("tomador preparado a partir dos dados existentes", () => {
  it("memória usa a Company legada e só o documento solicitado", async () => {
    const deps = contexto(SALVO);
    const r = await prepararTomadorDoCliente(BASE, deps);
    expect(deps.resolveLegacyCompanyId).toHaveBeenCalledWith("portal-1");
    expect(deps.buscarTomadoresEmitidos).toHaveBeenCalledWith(expect.objectContaining({ companyId: "legacy-1", documentos: [DOC] }));
    expect(r).toMatchObject({ ok: true, campos: [], tomador: { nome: SALVO.nome, endereco: ENDERECO }, fontes: { memoria: true, cnpj: false, cep: false } });
    expect(deps.consultarCnpj).not.toHaveBeenCalled();
    expect(deps.consultarCep).not.toHaveBeenCalled();
  });

  it("duas empresas com o mesmo documento não compartilham memória", async () => {
    const findMany = jest.fn(async ({ where }) => where.companyId === "legacy-1" ? [SALVO] : []);
    const deps = contexto(null, { prisma: { tomadorEmitido: { findMany } }, buscarTomadoresEmitidos,
      resolveLegacyCompanyId: async (id) => id === "portal-1" ? "legacy-1" : "legacy-2" });
    const um = await prepararTomadorDoCliente(BASE, deps);
    const dois = await prepararTomadorDoCliente({ ...BASE, portalClientId: "portal-2" }, deps);
    expect(um.tomador.nome).toBe(SALVO.nome);
    expect(dois.tomador.nome).toBeFalsy();
    expect(findMany).toHaveBeenNthCalledWith(2, { where: { companyId: "legacy-2", documento: { in: [DOC] } } });
    expect(dois.fontes.memoria).toBe(false);
  });

  it("sem Company legada não lê tomador apenas pelo documento", async () => {
    const findMany = jest.fn();
    const deps = contexto(null, { prisma: { tomadorEmitido: { findMany } }, buscarTomadoresEmitidos,
      resolveLegacyCompanyId: async () => null });
    await prepararTomadorDoCliente(BASE, deps);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("dados manuais completos não consultam CNPJ nem CEP", async () => {
    const deps = contexto();
    const r = await prepararTomadorDoCliente({ ...BASE, tomadorNome: "Manual", endereco: ENDERECO }, deps);
    expect(r.ok).toBe(true);
    expect(deps.consultarCnpj).not.toHaveBeenCalled();
    expect(deps.consultarCep).not.toHaveBeenCalled();
    expect(deps.municipiosIbgeOuNulo).not.toHaveBeenCalled();
  });

  it("fontes representam campos usados, não apenas existência de cadastro sobrescrito", async () => {
    const deps = contexto(SALVO);
    const r = await prepararTomadorDoCliente({ ...BASE, tomadorNome: "Manual", tomadorEmail: "manual@example.invalid", endereco: ENDERECO }, deps);
    expect(r.fontes).toEqual({ memoria: false, cnpj: false, cep: false });
    expect(r.origens).toMatchObject({ tomadorNome: "manual", tomadorEmail: "manual", "endereco.CEP": "manual", "endereco.nro": "manual" });
  });

  it("preserva a origem de campos misturados legitimamente na mesma localização", async () => {
    const r = await prepararTomadorDoCliente({ ...BASE, tomadorNome: "Nome revisado", endereco: { nro: "19" } }, contexto(SALVO));
    expect(r.origens).toMatchObject({ tomadorNome: "manual", tomadorEmail: "memoria", "endereco.CEP": "memoria", "endereco.nro": "manual", "endereco.xLgr": "memoria" });
  });
});

describe("completar lacunas com CNPJ e CEP", () => {
  it("CNPJ parcial conserva seus campos e CEP completa município verificado", async () => {
    const deps = contexto(null, {
      consultarCnpj: jest.fn(async () => ({ ok: true, tomador: { nome: "Da consulta", endereco: null }, bruto: {
        cep: CEP, logradouro: "Rua da consulta", numero: "27", bairro: "Bairro da consulta", municipio: "Rio de Janeiro", uf: "RJ",
      } })),
      consultarCep: jest.fn(async () => ({ ok: true, endereco: { CEP, cMun: "3304557", xLgr: "Rua postal", xBairro: "Bairro postal", nro: null, xCpl: null } })),
    });
    const r = await prepararTomadorDoCliente(BASE, deps);
    expect(r).toMatchObject({ ok: true, tomador: { nome: "Da consulta", endereco: { CEP, cMun: "3304557", xLgr: "Rua da consulta", nro: "27" } }, fontes: { memoria: false, cnpj: true, cep: true } });
    expect(r.origens).toMatchObject({ tomadorNome: "cnpj", "endereco.CEP": "cnpj", "endereco.cMun": "cep", "endereco.nro": "cnpj" });
    expect(deps.consultarCep).toHaveBeenCalledWith(CEP, expect.objectContaining({ municipios: MUNICIPIOS }));
    expect(deps.municipiosIbgeOuNulo).toHaveBeenCalledTimes(1);
  });

  it("CPF nunca consulta CNPJ; CEP pode completar endereço sem fabricar nome ou número", async () => {
    const deps = contexto(null, { consultarCep: jest.fn(async () => ({ ok: true, endereco: { ...ENDERECO, nro: null, xCpl: null } })) });
    const r = await prepararTomadorDoCliente({ ...BASE, tomadorDoc: CPF, endereco: { CEP } }, deps);
    expect(deps.consultarCnpj).not.toHaveBeenCalled();
    expect(deps.consultarCep).toHaveBeenCalledTimes(1);
    expect(r.campos).toEqual(["tomadorNome", "endereco.nro"]);
    expect(r.tomador.nome).toBeFalsy();
    expect(r.tomador.endereco.nro).toBeFalsy();
  });

  it.each(["123", "11111111111"])("documento inválido %s não chega à memória ou consultas", async (tomadorDoc) => {
    const deps = contexto();
    expect(await prepararTomadorDoCliente({ ...BASE, tomadorDoc }, deps)).toMatchObject({ ok: false, motivo: "tomador_documento_invalido" });
    expect(deps.resolveLegacyCompanyId).not.toHaveBeenCalled();
    expect(deps.consultarCnpj).not.toHaveBeenCalled();
  });

  it("falha da consulta pede apenas nome e número ainda ausentes", async () => {
    const deps = contexto();
    const { nro, xCpl, ...endereco } = ENDERECO;
    const r = await prepararTomadorDoCliente({ ...BASE, endereco }, deps);
    expect(r.campos).toEqual(["tomadorNome", "endereco.nro"]);
    expect(r.mensagem).toMatch(/nome do tomador, o número/);
    expect(r.fontes).toEqual({ memoria: false, cnpj: false, cep: false });
    expect(r.avisos).toHaveLength(1);
  });

  it("falha da memória não afirma ausência de cadastro e mantém a preparação disponível", async () => {
    const deps = contexto(null, { buscarTomadoresEmitidos: async () => ({ tomadores: new Map(), motivo: "indisponível" }) });
    const r = await prepararTomadorDoCliente({ ...BASE, tomadorNome: "Manual", endereco: ENDERECO }, deps);
    expect(r.ok).toBe(true);
    expect(r.avisos.join(" ")).toMatch(/memória.*indisponível/i);
  });

  it("lista de municípios ausente é carregada uma vez, sem afirmar município verificado", async () => {
    const deps = contexto(null, {
      municipiosIbgeOuNulo: jest.fn(async () => null),
      consultarCnpj: jest.fn(async () => ({ ok: true, tomador: { nome: "Da consulta", endereco: null }, bruto: { cep: CEP, logradouro: "Rua", numero: "5", bairro: "Bairro" } })),
      consultarCep: jest.fn(async () => ({ ok: true, endereco: { CEP, cMun: null, xLgr: "Rua", xBairro: "Bairro" } })),
    });
    const r = await prepararTomadorDoCliente(BASE, deps);
    expect(r.campos).toEqual(["endereco.cMun"]);
    expect(deps.municipiosIbgeOuNulo).toHaveBeenCalledTimes(1);
    expect(r.fontes.cep).toBe(false); // A consulta respondeu, mas não acrescentou campo algum.
  });
});

describe("mudança de CEP não combina endereços diferentes", () => {
  it.each([CEP, null])("CEP manual diferente da memória (%s) descarta rua, número e complemento antigos", async (cepAnterior) => {
    const deps = contexto({ ...SALVO, cep: cepAnterior }, { consultarCep: jest.fn(async () => ({ ok: true, endereco: {
      CEP: OUTRO_CEP, cMun: "3304557", xLgr: "Rua nova", xBairro: "Bairro novo", nro: null, xCpl: null,
    } })) });
    const r = await prepararTomadorDoCliente({ ...BASE, endereco: { CEP: OUTRO_CEP } }, deps);
    expect(r.tomador.endereco).toMatchObject({ CEP: OUTRO_CEP, xLgr: "Rua nova", xBairro: "Bairro novo" });
    expect(r.tomador.endereco.nro).toBeFalsy();
    expect(r.tomador.endereco.xCpl).toBeFalsy();
    expect(r.campos).toEqual(["endereco.nro"]);
    expect(deps.consultarCep).toHaveBeenCalledTimes(1);
  });

  it("mesmo CEP com pontuação conserva endereço salvo", async () => {
    const deps = contexto(SALVO);
    const r = await prepararTomadorDoCliente({ ...BASE, endereco: { CEP: "20040-020" } }, deps);
    expect(r.ok).toBe(true);
    expect(r.tomador.endereco.nro).toBe("12");
    expect(deps.consultarCep).not.toHaveBeenCalled();
  });

  it("CEP novo descoberto no CNPJ não aproveita número/complemento de memória sem CEP", async () => {
    const deps = contexto({ ...SALVO, cep: null }, {
      consultarCnpj: jest.fn(async () => ({ ok: true, tomador: { nome: "Razão", endereco: { CEP: OUTRO_CEP, cMun: "3304557", xLgr: "Rua nova", xBairro: "Bairro novo" } } })),
    });
    const r = await prepararTomadorDoCliente(BASE, deps);
    expect(r.tomador.endereco).toMatchObject({ CEP: OUTRO_CEP, xLgr: "Rua nova" });
    expect(r.tomador.endereco.nro).toBeFalsy();
    expect(r.tomador.endereco.xCpl).toBeFalsy();
    expect(r.campos).toEqual(["endereco.nro"]);
    expect(r.origens).not.toHaveProperty("endereco.nro");
  });

  it("CNPJ de outro CEP não preenche lacunas do endereço salvo", async () => {
    const deps = contexto({ ...SALVO, xLgr: null, xBairro: null }, {
      consultarCnpj: jest.fn(async () => ({ ok: true, tomador: { nome: "Outra razão", endereco: { ...ENDERECO, CEP: OUTRO_CEP, xLgr: "Rua de outro CEP", xBairro: "Outro bairro" } } })),
      consultarCep: jest.fn(async () => ({ ok: true, endereco: { CEP, cMun: "3304557", xLgr: "Rua do CEP salvo", xBairro: "Bairro do CEP salvo" } })),
    });
    const r = await prepararTomadorDoCliente(BASE, deps);
    expect(r.tomador.endereco).toMatchObject({ CEP, xLgr: "Rua do CEP salvo", xBairro: "Bairro do CEP salvo", nro: "12" });
    expect(deps.consultarCep).toHaveBeenCalledWith(CEP, expect.any(Object));
    expect(r.fontes.cnpj).toBe(false);
  });

  it("CEP manual conflitante prevalece mesmo quando falta nome e CNPJ é consultado", async () => {
    const deps = contexto(null, {
      consultarCnpj: jest.fn(async () => ({ ok: true, tomador: { nome: "Razão consultada", endereco: ENDERECO } })),
      consultarCep: jest.fn(async () => ({ ok: true, endereco: { CEP: OUTRO_CEP, cMun: "3304557", xLgr: "Rua escolhida", xBairro: "Bairro escolhido" } })),
    });
    const r = await prepararTomadorDoCliente({ ...BASE, endereco: { CEP: OUTRO_CEP, nro: "98" } }, deps);
    expect(r.tomador.endereco).toMatchObject({ CEP: OUTRO_CEP, nro: "98", xLgr: "Rua escolhida" });
    expect(r.tomador.nome).toBe("Razão consultada");
    expect(r.origens).toMatchObject({ tomadorNome: "cnpj", "endereco.nro": "manual", "endereco.xLgr": "cep" });
  });

  it("CEP inválido não perde letras para virar outro código consultável", async () => {
    const deps = contexto(SALVO);
    const r = await prepararTomadorDoCliente({ ...BASE, endereco: { CEP: "2004A0020" } }, deps);
    expect(r.ok).toBe(false);
    expect(r.campos).toContain("endereco.CEP");
    expect(deps.consultarCep).not.toHaveBeenCalled();
    expect(r.tomador.endereco.xLgr).toBeFalsy();
  });
});

it("export parcial não altera o contrato antigo da consulta de CNPJ", () => {
  const bruto = { cep: CEP, logradouro: "Rua", numero: "3", bairro: "Centro", municipio: "Rio de Janeiro", uf: "RJ" };
  expect(camposDeEnderecoDaReceita(bruto, { municipios: MUNICIPIOS })).toMatchObject({ CEP, xLgr: "Rua", nro: "3", xBairro: "Centro", cMun: "" });
  expect(enderecoDaReceita(bruto, { municipios: MUNICIPIOS })).toMatchObject({ endereco: null, faltantes: ["o código IBGE do município"] });
  const completo = { ...bruto, codigo_municipio_ibge: "3304557" };
  expect(enderecoDaReceita(completo, { municipios: MUNICIPIOS }).endereco).toEqual(camposDeEnderecoDaReceita(completo, { municipios: MUNICIPIOS }));
});

jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
import { executarFerramenta, definicoes } from "../ferramentas/index.js";
import { prepararDadosFiscaisDoCliente } from "../../nfse/preparacaoFiscalDoCliente.js";

const DOC = "12345678000190";
const ENDERECO = { cMun: "3304557", CEP: "20040020", xLgr: "Rua de exemplo", nro: "10", xBairro: "Centro", xCpl: "Sala 2" };
const BASICOS = { tomadorDoc: DOC, descricao: "Serviços de exemplo", valor: 1000, competencia: "2026-09" };
const MUNICIPIOS = [["3304557", "Rio de Janeiro", "RJ"]];

function contexto({ salvo = null, das = 600, perfis = [] } = {}) {
  const client = {
    portalClient: { findUnique: jest.fn(async () => ({ id: "pc", companyId: "legacy" })) },
    company: { findUnique: jest.fn(async () => ({ id: "legacy", regimeTributario: "SIMPLES", codigoServicoNacional: "170601", codigosServicoNacional: ["170601"], codigoMunicipioIbge: "3304557" })) },
    cadastroFiscal: { findUnique: jest.fn(async () => null) },
    companyMonthlyCircular: { findMany: jest.fn(async () => das == null ? [] : [{ competencia: "2026-08", dasTotal: das }]) },
    portalInvoice: { aggregate: jest.fn(async () => ({ _sum: { total: 10000 } })) },
    tomadorEmitido: { findMany: jest.fn(async ({ where }) => where.companyId === "legacy" && where.documento.in.includes(DOC) && salvo ? [salvo] : []) },
  };
  return {
    sessao: { ok: true, portalClientId: "pc", userId: "u", papel: "CLIENT_ADMIN", permissoesAssistente: ["EMISSAO_NFSE"] },
    conversa: { id: "cv" }, prisma: client, agora: new Date("2026-09-09T15:00:00Z"),
    servicos: {
      autorizarEmissaoDoCliente: jest.fn(async () => ({ ok: true })),
      resolveLegacyCompanyId: jest.fn(async () => "legacy"),
      listarPerfisEmissao: jest.fn(async () => perfis),
      prepararDadosFiscaisDoCliente: (args, deps) => prepararDadosFiscaisDoCliente(args, { ...deps, perfisHabilitados: perfis.length > 0,
        resolverPerfil: async ({ perfilId }) => ({ temPerfil: Boolean(perfis.find(p => p.id === perfilId)), perfil: perfis.find(p => p.id === perfilId), perfisAtivos: perfis.length }) }),
      municipiosIbgeOuNulo: jest.fn(async () => MUNICIPIOS),
      consultarCnpj: jest.fn(async () => ({ ok: true, cnpj: DOC, tomador: { nome: "Tomador sintético", endereco: ENDERECO } })),
      consultarCep: jest.fn(async () => ({ ok: true, endereco: { ...ENDERECO, nro: null, xCpl: null } })),
      criarPendencia: jest.fn(async ({ corpo }) => ({ texto: corpo, codigo: "A7K2" })),
    },
    registrarPendencia: jest.fn(),
  };
}

let fetchAnterior;
beforeEach(() => { fetchAnterior = global.fetch; global.fetch = jest.fn(() => { throw new Error("Rede proibida: este teste não usa Claude nem consultas reais"); }); });
afterEach(() => { expect(global.fetch).not.toHaveBeenCalled(); global.fetch = fetchAnterior; });

test("quatro campos chegam ao resumo com CNPJ consultado e Simples resolvido no histórico do portal", async () => {
  const ctx = contexto();
  const r = await executarFerramenta("preparar_emissao", BASICOS, ctx);
  expect(r).toMatchObject({ ok: true, pendenciaCriada: true, codigo: "A7K2" });
  const pedido = ctx.servicos.criarPendencia.mock.calls[0][0];
  expect(pedido.payload).toMatchObject({ companyId: "pc", tomador: { doc: DOC, nome: "Tomador sintético", endereco: ENDERECO }, totTrib: { pTotTribSN: 6 } });
  expect(pedido.corpo).toContain("6,00%");
  expect(pedido.corpo).toContain("2026-08");
  expect(pedido.corpo).not.toContain("Regime declarado: não informado");
  expect(ctx.servicos.consultarCnpj).toHaveBeenCalledTimes(1);
  expect(ctx.servicos.consultarCep).not.toHaveBeenCalled();
});

test("tomador salvo dispensa ambas consultas e respeita escopo da empresa", async () => {
  const ctx = contexto({ salvo: { documento: DOC, nome: "Cliente anterior", ...ENDERECO, cep: ENDERECO.CEP } });
  const r = await executarFerramenta("preparar_emissao", BASICOS, ctx);
  expect(r.ok).toBe(true);
  expect(ctx.prisma.tomadorEmitido.findMany).toHaveBeenCalledWith({ where: { companyId: "legacy", documento: { in: [DOC] } } });
  expect(ctx.servicos.consultarCnpj).not.toHaveBeenCalled();
  expect(ctx.servicos.consultarCep).not.toHaveBeenCalled();
});

test("CNPJ indisponível: reaproveita coleta e completa CEP/número sem pedir bairro, cidade ou tributos", async () => {
  const ctx = contexto();
  ctx.servicos.consultarCnpj.mockResolvedValue({ ok: false, motivo: "indisponivel" });
  const primeiro = await executarFerramenta("preparar_emissao", { ...BASICOS, tomadorNome: "Tomador informado" }, ctx);
  expect(primeiro).toMatchObject({ ok: false, motivo: "DADOS_TOMADOR_PENDENTES" });
  expect(primeiro.camposParaPerguntar).toEqual(["endereco.CEP", "endereco.nro"]);
  expect(primeiro.mensagem).not.toContain("código IBGE");
  expect(ctx.servicos.criarPendencia).not.toHaveBeenCalled();
  const segundo = await executarFerramenta("preparar_emissao", { ...primeiro.dadosColetados, endereco: { CEP: ENDERECO.CEP, nro: "7655", xCpl: "Sala 219" } }, ctx);
  expect(segundo.ok).toBe(true);
  expect(ctx.servicos.consultarCnpj).toHaveBeenCalledTimes(1);
  expect(ctx.servicos.consultarCep).toHaveBeenCalledTimes(1);
  expect(ctx.servicos.criarPendencia.mock.calls[0][0].payload.tomador.endereco).toEqual({ ...ENDERECO, nro: "7655", xCpl: "Sala 219" });
});

test("quando só falta número, pergunta apenas número e preserva demais dados", async () => {
  const ctx = contexto();
  const r = await executarFerramenta("preparar_emissao", { ...BASICOS, tomadorNome: "Tomador", endereco: { CEP: ENDERECO.CEP } }, ctx);
  expect(r).toMatchObject({ ok: false, campos: ["endereco.nro"], dadosColetados: { descricao: BASICOS.descricao, valor: BASICOS.valor, endereco: { cMun: ENDERECO.cMun } } });
  expect(ctx.servicos.criarPendencia).not.toHaveBeenCalled();
});

test("CEP sem município verificável pede ajuda à equipe, sem exigir código técnico do cliente", async () => {
  const ctx = contexto();
  ctx.servicos.consultarCep.mockResolvedValue({ ok: false, motivo: "indisponivel" });
  const r = await executarFerramenta("preparar_emissao", { ...BASICOS, tomadorNome: "Tomador", endereco: { CEP: ENDERECO.CEP, nro: "10" } }, ctx);
  expect(r).toMatchObject({ ok: false, encaminharEscritorio: true });
  expect(r.camposParaPerguntar).not.toContain("endereco.cMun");
  expect(ctx.servicos.criarPendencia).not.toHaveBeenCalled();
});

test("sem percentual confiável do Simples recusa antes de resumo, consultas públicas ou confirmação", async () => {
  const ctx = contexto({ das: null });
  const r = await executarFerramenta("preparar_emissao", BASICOS, ctx);
  expect(r).toMatchObject({ ok: false, encaminharEscritorio: true, motivo: "NFSE_ALIQUOTA_SIMPLES_INDISPONIVEL" });
  expect(r.mensagem).toContain("você não precisa calcular");
  expect(ctx.servicos.consultarCnpj).not.toHaveBeenCalled();
  expect(ctx.servicos.criarPendencia).not.toHaveBeenCalled();
});

test("ausência de competência aparece resolvida no resumo e no payload", async () => {
  const ctx = contexto();
  const r = await executarFerramenta("preparar_emissao", { ...BASICOS, competencia: null }, ctx);
  expect(r.ok).toBe(true);
  const pedido = ctx.servicos.criarPendencia.mock.calls[0][0];
  expect(pedido.payload.competencia.toISOString()).toContain("2026-09-09");
  expect(pedido.corpo).not.toContain("Competência: não informada");
  const dataDoResumo = pedido.payload.competencia.toISOString().slice(0, 10);
  const corrigido = await executarFerramenta("preparar_emissao", { ...BASICOS, valor: 2000, competencia: dataDoResumo }, ctx);
  expect(corrigido.ok).toBe(true);
  expect(ctx.servicos.criarPendencia.mock.calls[1][0].payload.competencia.toISOString()).toContain(dataDoResumo);
  expect(ctx.servicos.criarPendencia.mock.calls[1][0].payload.servico.valorServicos).toBe(2000);
});

test("catálogo real de tomadores é objeto paginado, não array, e mantém endereço", async () => {
  const ctx = contexto();
  ctx.servicos.listarTomadoresEmitidos = async () => ({ tomadores: [{ documento: DOC, nome: "Salvo", ...ENDERECO, cep: ENDERECO.CEP }], total: 1 });
  const r = await executarFerramenta("tomadores_conhecidos", {}, ctx);
  expect(r.tomadores[0]).toMatchObject({ documento: DOC, endereco: ENDERECO, temEndereco: true });
});

test("memória indisponível não é anunciada como ausência de tomadores", async () => {
  const ctx = contexto();
  ctx.servicos.listarTomadoresEmitidos = async () => ({ tomadores: [], motivo: "banco indisponível" });
  expect(await executarFerramenta("tomadores_conhecidos", {}, ctx)).toMatchObject({ ok: true, tomadores: [], aviso: expect.stringContaining("não significa") });
});

test.each(["consultar_cnpj", "consultar_cep", "preparar_emissao"])("permissão revogada barra %s antes de qualquer leitura", async nome => {
  const ctx = contexto(); ctx.sessao.permissoesAssistente = [];
  expect(definicoes(ctx.sessao).map(f => f.name)).not.toContain(nome);
  expect((await executarFerramenta(nome, BASICOS, ctx)).motivo).toBe("FUNCAO_NAO_LIBERADA");
  expect(ctx.prisma.portalClient.findUnique).not.toHaveBeenCalled();
  expect(ctx.servicos.consultarCnpj).not.toHaveBeenCalled();
});

test("perfil único é escolhido; múltiplos perfis aguardam escolha mesmo com padrão", async () => {
  const perfil = { id: "p1", nome: "Serviço", codigoServicoNacional: "170601", padrao: true };
  const unico = contexto({ perfis: [perfil] });
  expect((await executarFerramenta("preparar_emissao", BASICOS, unico)).ok).toBe(true);
  expect(unico.servicos.criarPendencia.mock.calls[0][0].payload.perfilId).toBe("p1");
  const varios = contexto({ perfis: [perfil, { ...perfil, id: "p2", padrao: false }] });
  expect((await executarFerramenta("preparar_emissao", BASICOS, varios)).motivo).toBe("ESCOLHER_PERFIL_EMISSAO");
  expect(varios.servicos.criarPendencia).not.toHaveBeenCalled();
});

test("perfil sem retenção revela que a alíquota configurada não será destacada", async () => {
  const perfil = { id: "p1", nome: "Serviço", codigoServicoNacional: "170601", pAliq: 5, regApTribSN: "1" };
  const ctx = contexto({ perfis: [perfil] });
  const r = await executarFerramenta("preparar_emissao", BASICOS, ctx);
  expect(r.ok).toBe(true);
  expect(r.textoDeConfirmacao).toContain("Alíquota de ISS: 5,00%");
  expect(r.textoDeConfirmacao).toContain("não será informado como alíquota destacada");
});

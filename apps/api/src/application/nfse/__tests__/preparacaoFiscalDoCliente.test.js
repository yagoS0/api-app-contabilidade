jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
jest.mock("../../../config.js", () => ({ INTEGRACAO_PERFIL_EMISSAO_NFSE: false }));

import { prepararDadosFiscaisDoCliente, escolherAliquotaEfetivaDaSerie } from "../preparacaoFiscalDoCliente.js";
import { escolherAliquotaEfetiva as escolherNoPortal } from "../../../../../portal-cliente-web/src/features/emitir/lib/aliquotaEfetiva.js";

const pedido = { portalClientId: "portal-teste", competencia: "2026-09", servico: { descricao: "Consultoria", valorServicos: 1000, issRetido: false } };
function contexto({ regime = "LUCRO_PRESUMIDO", regimeCadastro = null, company: extras = {}, perfil = null, perfisAtivos = perfil ? 1 : 0, serie = [] } = {}) {
  const company = { id: "company-teste", regimeTributario: regime, codigoServicoNacional: "170601", codigosServicoNacional: ["170601", "170101"], codigoMunicipioIbge: "3304557", pTotTribFed: 11.33, pTotTribEst: null, pTotTribMun: 5, ...extras };
  const client = {
    portalClient: { findUnique: jest.fn(async () => ({ id: "portal-teste", companyId: "company-teste" })) },
    company: { findUnique: jest.fn(async () => company) },
    cadastroFiscal: { findUnique: jest.fn(async () => regimeCadastro ? { regime: regimeCadastro } : null) },
    perfilEmissaoNfse: { findMany: jest.fn(async () => [{ id: "p1", nome: "Consultoria" }, { id: "p2", nome: "Treinamento" }]) },
    companyMonthlyCircular: { findMany: jest.fn(async () => serie.map(l => ({ competencia: l.competencia, dasTotal: l.dasExtrato }))) },
    portalInvoice: { aggregate: jest.fn(async ({ where }) => ({ _sum: { total: serie.find(l => l.competencia === where.competencia.gte.toISOString().slice(0, 7))?.faturamento ?? null } })) },
  };
  return { client, resolverPerfil: jest.fn(async () => ({ temPerfil: Boolean(perfil), perfil, perfisAtivos, campos: {}, avisos: [] })), perfisHabilitados: false, agora: new Date("2026-09-09T12:00:00Z") };
}

test("não Simples reutiliza carga do cadastro e não pergunta taxa nem consulta histórico", async () => {
  const deps = contexto({ company: { pTotTribFed: { toString: () => "11.33" } } });
  const r = await prepararDadosFiscaisDoCliente(pedido, deps);
  expect(r).toMatchObject({ ok: true, pTotTribSN: null, cargaTributaria: { pTotTribFed: 11.33, pTotTribEst: 0, pTotTribMun: 5 }, servico: { codigoServicoNacional: "170601", aliquota: null, issRetido: false }, regime: { opSimpNac: "1", exigePTotTribSN: false } });
  expect(r.origens.pTotTribEst.fonte).toBe("REGRA_SERVICO_SEM_ICMS");
  expect(deps.client.companyMonthlyCircular.findMany).not.toHaveBeenCalled();
  expect(deps.resolverPerfil).not.toHaveBeenCalled();
});

test("perfil único usa alíquota e local configurados, vencendo o pedido", async () => {
  const perfil = { id: "p1", nome: "Serviço configurado", codigoServicoNacional: "170101", pAliq: { toString: () => "4.5" }, cLocPrestacao: "3550308" };
  const deps = { ...contexto({ regime: "SIMPLES", perfil }), perfisHabilitados: true };
  const r = await prepararDadosFiscaisDoCliente({ ...pedido, pTotTribSN: 6, servico: { ...pedido.servico, aliquota: 2, issRetido: true, cLocPrestacao: "3304557" } }, deps);
  expect(r).toMatchObject({ ok: true, perfil: { id: "p1" }, servico: { codigoServicoNacional: "170101", aliquota: 4.5, cLocPrestacao: "3550308" }, aliquotaDps: { informar: true, pAliq: "4.50" } });
  expect(deps.resolverPerfil).toHaveBeenCalledWith({ portalClientId: "portal-teste", perfilId: null, exigirDisponibilidade: true });
  expect(r.origens.aliquota.fonte).toBe("PERFIL");
});

test("dois perfis exigem escolha mesmo que o resolvedor devolva o padrão", async () => {
  const deps = { ...contexto({ perfil: { id: "p1", padrao: true }, perfisAtivos: 2 }), perfisHabilitados: true };
  const r = await prepararDadosFiscaisDoCliente(pedido, deps);
  expect(r).toMatchObject({ ok: false, motivo: "ESCOLHER_PERFIL_EMISSAO", encaminharEscritorio: false, perfis: [{ id: "p1" }, { id: "p2" }] });
  expect(deps.client.companyMonthlyCircular.findMany).not.toHaveBeenCalled();
});

test("escolha explícita dentre vários perfis resolve a nota", async () => {
  const deps = { ...contexto({ perfil: { id: "p2", nome: "Treinamento", codigoServicoNacional: "170601" }, perfisAtivos: 2 }), perfisHabilitados: true };
  expect((await prepararDadosFiscaisDoCliente({ ...pedido, perfilId: "p2" }, deps)).ok).toBe(true);
});

test.each([false, true])("perfil solicitado não some com flag=%s ou id indisponível", async flag => {
  const deps = { ...contexto(), perfisHabilitados: flag };
  expect(await prepararDadosFiscaisDoCliente({ ...pedido, perfilId: "de-outra-empresa" }, deps)).toMatchObject({ ok: false, motivo: "NFSE_PERFIL_INDISPONIVEL" });
});

test("falha de leitura dos perfis não vira ausência de configuração", async () => {
  const deps = { ...contexto(), perfisHabilitados: true };
  deps.resolverPerfil.mockRejectedValue(new Error("banco fora"));
  expect(await prepararDadosFiscaisDoCliente(pedido, deps)).toMatchObject({ ok: false, motivo: "DADOS_FISCAIS_INDISPONIVEIS", encaminharEscritorio: true });
});

test("regime fiscal prevalece sobre Company e preenche a taxa da mesma competência", async () => {
  const deps = contexto({ regime: "LUCRO_PRESUMIDO", regimeCadastro: "SIMPLES_NACIONAL", serie: [{ competencia: "2026-08", dasExtrato: 500, faturamento: 10000 }, { competencia: "2026-09", dasExtrato: 680, faturamento: 10000 }] });
  const r = await prepararDadosFiscaisDoCliente(pedido, deps);
  expect(r).toMatchObject({ ok: true, pTotTribSN: 6.8, regime: { rotuloDeclarado: "SIMPLES_NACIONAL", opSimpNac: "3", exigePTotTribSN: true }, origens: { regime: { fonte: "CADASTRO_FISCAL" }, pTotTribSN: { fonte: "EXTRATO_PGDASD", competencia: "2026-09", exata: true, dasExtrato: 680, faturamento: 10000 } } });
  expect(deps.client.companyMonthlyCircular.findMany.mock.calls[0][0].where).toEqual({ portalClientId: "portal-teste", competencia: { in: ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"] } });
  expect(deps.client.portalInvoice.aggregate).toHaveBeenCalledTimes(6);
  for (const [consulta] of deps.client.portalInvoice.aggregate.mock.calls) expect(consulta.where).toMatchObject({ clientId: "portal-teste", papel: "EMIT", statusEfetivo: "autorizada" });
  expect(r.avisos).toEqual([]);
});

test("sem competência apurada usa a última com prova e revela a competência de origem", async () => {
  const deps = contexto({ regime: "SIMPLES", serie: [{ competencia: "2026-07", dasExtrato: 600, faturamento: 10000 }, { competencia: "2026-08", dasExtrato: 700, faturamento: 10000 }, { competencia: "2026-09", dasExtrato: null, faturamento: 20000 }] });
  const r = await prepararDadosFiscaisDoCliente(pedido, deps);
  expect(r).toMatchObject({ ok: true, pTotTribSN: 7, origens: { pTotTribSN: { competencia: "2026-08", exata: false } } });
  expect(r.avisos[0]).toContain("2026-08");
  expect(r.avisos[0]).toContain("2026-09");
});

test.each([
  [], [{ competencia: "2026-09", dasExtrato: null, faturamento: 10000 }],
  [{ competencia: "2026-09", dasExtrato: 500, faturamento: 0 }], [{ competencia: "2026-09", dasExtrato: 0, faturamento: 10000 }],
].map(serie => [serie]))("sem extrato e receita positivos não inventa alíquota nem pergunta percentual", async serie => {
  const r = await prepararDadosFiscaisDoCliente(pedido, contexto({ regime: "SIMPLES", serie }));
  expect(r).toMatchObject({ ok: false, motivo: "NFSE_ALIQUOTA_SIMPLES_INDISPONIVEL", encaminharEscritorio: true });
  expect(r.mensagem).toContain("você não precisa calcular nem informar percentuais");
});

test("percentual explicitamente informado zero continua zero e não consulta série", async () => {
  const deps = contexto({ regime: "SIMPLES" });
  expect(await prepararDadosFiscaisDoCliente({ ...pedido, pTotTribSN: 0 }, deps)).toMatchObject({ ok: true, pTotTribSN: 0, origens: { pTotTribSN: { fonte: "PEDIDO" } } });
  expect(deps.client.portalInvoice.aggregate).not.toHaveBeenCalled();
});

test.each([-1, 101, "inválido"])("taxa informada inválida %s não vira confirmação", async pTotTribSN => {
  expect(await prepararDadosFiscaisDoCliente({ ...pedido, pTotTribSN }, contexto({ regime: "SIMPLES" }))).toMatchObject({ ok: false, motivo: "NFSE_ALIQUOTA_SIMPLES_INDISPONIVEL" });
});

test.each([null, 0, 1.7])("ISS retido sem taxa configurada válida %s pede conferência ao escritório", async pAliq => {
  const deps = { ...contexto({ regime: "SIMPLES", perfil: { id: "p1", codigoServicoNacional: "170601", pAliq } }), perfisHabilitados: true };
  const r = await prepararDadosFiscaisDoCliente({ ...pedido, pTotTribSN: 6, servico: { ...pedido.servico, issRetido: true } }, deps);
  expect(r).toMatchObject({ ok: false, encaminharEscritorio: true, pendencias: ["aliquota"] });
  expect(r.mensagem).toContain("escritório");
});

test("ISS sem retenção não exige alíquota e respeita proibição do campo no Simples", async () => {
  const deps = contexto({ regime: "SIMPLES" });
  expect(await prepararDadosFiscaisDoCliente({ ...pedido, pTotTribSN: 6 }, deps)).toMatchObject({ ok: true, servico: { aliquota: null, issRetido: false }, aliquotaDps: { informar: false } });
});

test.each(["2026-13", "2026-02-30", "amanhã"])("competência inválida %s não chega ao banco", async competencia => {
  const deps = contexto();
  expect(await prepararDadosFiscaisDoCliente({ ...pedido, competencia }, deps)).toMatchObject({ ok: false, motivo: "COMPETENCIA_INVALIDA", encaminharEscritorio: false });
  expect(deps.client.portalClient.findUnique).not.toHaveBeenCalled();
});

test("data padrão aparece no retorno e respeita o dia do atendimento no Brasil", async () => {
  const deps = { ...contexto(), agora: new Date("2026-09-10T01:00:00Z") };
  expect(await prepararDadosFiscaisDoCliente({ ...pedido, competencia: null }, deps)).toMatchObject({ ok: true, competencia: "2026-09-09", origens: { competencia: { fonte: "DATA_DO_ATENDIMENTO" } } });
});

test.each(["regime", "pTotTribFed", "pTotTribMun"])("cadastro incompleto %s recusa antes de confirmar", async campo => {
  const deps = contexto(campo === "regime" ? { regime: null } : { company: { [campo]: null } });
  expect(await prepararDadosFiscaisDoCliente(pedido, deps)).toMatchObject({ ok: false, encaminharEscritorio: true });
});

test("falha ao ler CadastroFiscal não cai silenciosamente no regime de Company", async () => {
  const deps = contexto(); deps.client.cadastroFiscal.findUnique.mockRejectedValue(new Error("indisponível"));
  expect(await prepararDadosFiscaisDoCliente(pedido, deps)).toMatchObject({ ok: false, motivo: "DADOS_FISCAIS_INDISPONIVEIS" });
});

test.each([
  [], [{ competencia: "2026-09", dasExtrato: 6, faturamento: 100, deReceita: 6 }],
  [{ competencia: "2026-08", dasExtrato: 4, faturamento: 100, deReceita: 4 }, { competencia: "2026-09", dasExtrato: 6, faturamento: 100, deReceita: 6 }],
  [{ competencia: "2026-07", dasExtrato: 3, faturamento: 100, deReceita: 3 }, { competencia: "2026-08", dasExtrato: 4, faturamento: 100, deReceita: 4 }],
  [{ competencia: "2026-09", dasExtrato: 0, faturamento: 100, deReceita: 0 }],
  [{ competencia: "2026-09", dasExtrato: 5, faturamento: 0, deReceita: 0 }],
  [{ competencia: "2026-09", dasExtrato: 5, faturamento: 100, deReceita: null }],
].map(serie => [serie]))("seleção tem a mesma resposta do portal para %j", serie => {
  const { valor, competencia, exata } = escolherNoPortal(serie, "2026-09");
  expect(escolherAliquotaEfetivaDaSerie(serie, "2026-09")).toEqual({ valor, competencia, exata });
});

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    obrigacao: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    portalClient: { findMany: jest.fn(async () => [{ id: "p1", razao: "Empresa" }]), findUnique: jest.fn(async () => null) },
    feriado: { findMany: jest.fn(async () => []) },
    guide: { findMany: jest.fn(async () => []) },
    apuracaoSnapshot: { findMany: jest.fn(async () => []) },
    companyMonthlyCircular: { findMany: jest.fn(async () => []) },
    marcoFiscal: { findMany: jest.fn(async () => []) },
    ocorrenciaObrigacao: {
      findMany: jest.fn(async () => []), findFirst: jest.fn(), findUnique: jest.fn(),
      createMany: jest.fn(async ({ data }) => ({ count: data.length })),
      deleteMany: jest.fn(async () => ({ count: 0 })), update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })),
    },
    $transaction: jest.fn(),
  },
}));

import { prisma } from "../../../infrastructure/db/prisma.js";
import { atualizar, atualizarOcorrencia, concluir, criar, dataCivil, normalizarEntrada, ocorrenciasDoPeriodo, sincronizarOcorrencias, situacaoDaOcorrencia } from "../ObrigacoesService.js";
import { calcularVencimentos } from "../gerarOcorrencias.js";
import { montarCalendarioDoMes } from "../../calendario/CalendarioFiscalService.js";

const date = (iso) => new Date(`${iso}T00:00:00Z`);
const tarefa = { nome: "Conferir documentos", tipo: "TAREFA", periodicidade: "AVULSA", dataInicio: "2026-09-10", dataFim: "2026-09-15" };
const ocorrencia = (over = {}) => ({
  id: "oc1", obrigacaoId: "ob1", dataInicio: date("2026-09-10"), dataFim: date("2026-09-15"), dataVencimento: date("2026-09-15"), status: "PENDENTE",
  obrigacao: { id: "ob1", portalClientId: "p1", nome: "Conferir documentos", tipo: "TAREFA", periodicidade: "AVULSA", portalClient: { razao: "Empresa" } },
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(new Date("2026-09-12T15:00:00Z"));
  prisma.ocorrenciaObrigacao.findMany.mockResolvedValue([]);
  prisma.ocorrenciaObrigacao.findFirst.mockResolvedValue(ocorrencia());
  prisma.$transaction.mockImplementation((fn) => fn(prisma));
});
afterEach(() => jest.useRealTimers());

describe("datas civis e prazo fiscal", () => {
  test.each(["2026-02-29", "2026-09-31", "2026-13-01", "2026-09-10T00:00:00-03:00", "10/09/2026", ""])("recusa data inválida %s", (iso) => {
    expect(() => dataCivil(iso)).toThrow();
  });
  test("ano bissexto e data igual não deslocam por fuso", () => {
    expect(dataCivil("2028-02-29").toISOString()).toBe("2028-02-29T00:00:00.000Z");
    expect(normalizarEntrada({ ...tarefa, dataInicio: "2026-09-15" }).dataInicio).toEqual(date("2026-09-15"));
  });
  test("recusa fim anterior ao início", () => {
    expect(() => normalizarEntrada({ ...tarefa, dataFim: "2026-09-09" })).toThrow(/fim/);
  });
  test("fim é prazo da tarefa; obrigação conserva fiscal independente", () => {
    expect(normalizarEntrada({ ...tarefa, dataVencimento: "2026-10-20" }).dataVencimento).toEqual(date("2026-09-15"));
    expect(normalizarEntrada({ ...tarefa, tipo: "OBRIGACAO", dataVencimento: "2026-09-20" }).dataVencimento).toEqual(date("2026-09-20"));
  });
  test("dia intermediário não vence a tarefa", () => {
    expect(situacaoDaOcorrencia(ocorrencia())).toBe("PENDENTE");
    expect(situacaoDaOcorrencia(ocorrencia(), date("2026-09-16"))).toBe("VENCIDA");
  });
});

describe("persistência e identidade", () => {
  test("cria uma ocorrência por tarefa em transação, com período explicitamente passado aceito", async () => {
    const registro = { id: "ob1", portalClientId: "p1", ...normalizarEntrada(tarefa) };
    prisma.obrigacao.create.mockResolvedValue(registro);
    prisma.obrigacao.findUnique.mockResolvedValue(registro);
    const out = await criar({ portalClientId: "p1", dados: tarefa });
    expect(out.criadas).toBe(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.ocorrenciaObrigacao.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ obrigacaoId: "ob1", dataInicio: date("2026-09-10"), dataFim: date("2026-09-15") }),
    ]);
  });
  test("sincronizar novamente não duplica nem substitui avulsa concluída", async () => {
    prisma.obrigacao.findUnique.mockResolvedValue({ id: "ob1", ...normalizarEntrada(tarefa) });
    prisma.ocorrenciaObrigacao.findMany.mockResolvedValue([ocorrencia({ status: "CONCLUIDA" })]);
    await sincronizarOcorrencias("ob1", prisma, { atualizarJanelas: true });
    expect(prisma.ocorrenciaObrigacao.createMany).not.toHaveBeenCalled();
    expect(prisma.ocorrenciaObrigacao.update).not.toHaveBeenCalled();
  });
  test("edição da janela mantém ID e vencimento fiscal da obrigação", async () => {
    prisma.ocorrenciaObrigacao.findFirst.mockResolvedValue(ocorrencia({ obrigacao: { tipo: "OBRIGACAO" } }));
    await atualizarOcorrencia({ portalIds: ["p1"], ocorrenciaId: "oc1", dados: { dataInicio: "2026-09-11", dataFim: "2026-09-17" } });
    const call = prisma.ocorrenciaObrigacao.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "oc1" });
    expect(call.data).not.toHaveProperty("dataVencimento");
    expect(call.data.dataFim).toEqual(date("2026-09-17"));
  });
  test("mover fim da tarefa move seu prazo final", async () => {
    await atualizarOcorrencia({ portalIds: ["p1"], ocorrenciaId: "oc1", dados: { dataFim: "2026-09-17" } });
    expect(prisma.ocorrenciaObrigacao.update.mock.calls[0][0].data.dataVencimento).toEqual(date("2026-09-17"));
    expect(prisma.obrigacao.update.mock.calls[0][0]).toEqual(expect.objectContaining({ where: { id: "ob1" }, data: expect.objectContaining({ dataFim: date("2026-09-17"), dataVencimento: date("2026-09-17") }) }));
  });
  test("escopo acompanha PATCH e ocorrência de outra empresa retorna 404", async () => {
    prisma.ocorrenciaObrigacao.findFirst.mockResolvedValue(null);
    await expect(atualizarOcorrencia({ portalIds: ["p1"], ocorrenciaId: "oc2", dados: tarefa })).rejects.toMatchObject({ status: 404 });
    expect(prisma.ocorrenciaObrigacao.findFirst.mock.calls[0][0].where).toEqual({ id: "oc2", obrigacao: { portalClientId: { in: ["p1"] } } });
    expect(prisma.ocorrenciaObrigacao.update).not.toHaveBeenCalled();
  });
  test("colisão com prazo de outro ciclo é conflito explicável, sem escrever o cadastro", async () => {
    prisma.ocorrenciaObrigacao.update.mockRejectedValueOnce({ code: "P2002" });
    await expect(atualizarOcorrencia({ portalIds: ["p1"], ocorrenciaId: "oc1", dados: { dataFim: "2026-10-20" } })).rejects.toMatchObject({ status: 409, code: "prazo_em_uso" });
    expect(prisma.obrigacao.update).not.toHaveBeenCalled();
  });
  test("concluída recusa edição de ocorrência e do cadastro avulso", async () => {
    prisma.ocorrenciaObrigacao.findFirst.mockResolvedValue(ocorrencia({ status: "CONCLUIDA" }));
    await expect(atualizarOcorrencia({ portalIds: ["p1"], ocorrenciaId: "oc1", dados: tarefa })).rejects.toMatchObject({ status: 409 });
    prisma.obrigacao.findFirst.mockResolvedValue({ id: "ob1", ...normalizarEntrada(tarefa) });
    await expect(atualizar({ portalIds: ["p1"], obrigacaoId: "ob1", dados: { dataFim: "2026-09-17" } })).rejects.toMatchObject({ status: 409 });
    expect(prisma.obrigacao.update).not.toHaveBeenCalled();
  });
  test("conclusão mantém proteção automática", async () => {
    prisma.ocorrenciaObrigacao.findUnique.mockResolvedValue(ocorrencia({ obrigacao: { portalClientId: "p1", verificador: "MES_FECHADO" } }));
    await expect(concluir({ portalIds: ["p1"], ocorrenciaId: "oc1" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("sobreposição no calendário", () => {
  test("mesmo ID nos seis dias, um total, prazo idêntico em todos os segmentos", async () => {
    prisma.ocorrenciaObrigacao.findMany.mockResolvedValue([ocorrencia()]);
    const out = await montarCalendarioDoMes({ portalIds: ["p1"], competencia: "2026-09" });
    const dias = out.dias.filter((d) => d.itens.length);
    expect(dias.map((d) => d.dia)).toEqual([10, 11, 12, 13, 14, 15]);
    expect(out.totais.obrigacoes).toBe(1);
    expect(new Set(dias.flatMap((d) => d.itens.map((i) => i.id)))).toEqual(new Set(["oc1"]));
    expect(dias.every((d) => d.itens[0].data === "2026-09-15")).toBe(true);
  });
  test("conclusão no dia 12 se reflete em todos os segmentos sem apagar histórico", async () => {
    prisma.ocorrenciaObrigacao.findMany.mockResolvedValue([ocorrencia({ status: "CONCLUIDA" })]);
    const out = await montarCalendarioDoMes({ portalIds: ["p1"], competencia: "2026-09" });
    const itens = out.dias.flatMap((d) => d.itens);
    expect(itens).toHaveLength(6);
    expect(itens.every((i) => i.resolvido && i.situacao === "CONCLUIDA")).toBe(true);
    expect(out.totais.obrigacoes).toBe(1);
  });
  test.each([
    ["2026-09-29", "2026-10-03", "2026-09", 2],
    ["2026-09-29", "2026-10-03", "2026-10", 3],
    ["2026-08-20", "2026-10-20", "2026-09", 30],
    ["2028-02-28", "2028-03-01", "2028-02", 2],
  ])("intervalo %s–%s aparece em %s (%i dias)", async (inicio, fim, competencia, dias) => {
    prisma.ocorrenciaObrigacao.findMany.mockResolvedValue([ocorrencia({ dataInicio: date(inicio), dataFim: date(fim), dataVencimento: date(fim) })]);
    const out = await montarCalendarioDoMes({ portalIds: ["p1"], competencia });
    expect(out.dias.filter((d) => d.itens.length)).toHaveLength(dias);
    const query = prisma.ocorrenciaObrigacao.findMany.mock.calls[0][0].where;
    expect(query.OR[0]).toEqual({ dataInicio: { lt: date(competencia === "2026-09" ? "2026-10-01" : competencia === "2026-10" ? "2026-11-01" : "2028-03-01") }, dataFim: { gte: date(`${competencia}-01`) } });
  });
  test("legado sem intervalo é um único dia", async () => {
    prisma.ocorrenciaObrigacao.findMany.mockResolvedValue([ocorrencia({ dataInicio: null, dataFim: null })]);
    const out = await montarCalendarioDoMes({ portalIds: ["p1"], competencia: "2026-09" });
    expect(out.dias.filter((d) => d.itens.length).map((d) => d.dia)).toEqual([15]);
  });
  test("filtro de empresa fora da carteira não consulta nem retorna ocorrência", async () => {
    expect(await ocorrenciasDoPeriodo({ portalIds: ["p1"], companyId: "p2", inicio: date("2026-09-01"), fim: date("2026-10-01") })).toEqual([]);
    expect(prisma.ocorrenciaObrigacao.findMany).not.toHaveBeenCalled();
  });
});

describe("preparação recorrente", () => {
  test("feriado e fim de semana ajustam vencimento; preparação usa dias corridos", () => {
    const [p] = calcularVencimentos({ periodicidade: "MENSAL", diaVencimento: 7, ajusteDiaUtil: "ANTECIPAR", diasPreparacao: 5 }, { inicio: { ano: 2026, mes: 9 }, quantidadeMeses: 1 }, (iso) => iso === "2026-09-07");
    expect(p.data).toEqual(date("2026-09-04"));
    expect(p.dataFim).toEqual(date("2026-09-04"));
    expect(p.dataInicio).toEqual(date("2026-08-30"));
  });
  test("alterar preparação preserva concluída e ID pendente, sem duplicar por dia", async () => {
    prisma.obrigacao.findUnique.mockResolvedValue({ id: "ob1", portalClientId: "p1", ...normalizarEntrada({ nome: "Fechar mês", periodicidade: "MENSAL", diaVencimento: 20, ajusteDiaUtil: "MANTER", diasPreparacao: 5 }) });
    prisma.ocorrenciaObrigacao.findMany.mockResolvedValue([
      ocorrencia({ id: "feita", dataVencimento: date("2026-09-20"), status: "CONCLUIDA", competenciaRef: "2026-08" }),
      ocorrencia({ id: "pendente", dataVencimento: date("2026-10-20"), competenciaRef: "2026-09" }),
    ]);
    await sincronizarOcorrencias("ob1", prisma, { atualizarJanelas: true });
    expect(prisma.ocorrenciaObrigacao.update.mock.calls.map(([x]) => x.where.id)).toEqual(["pendente"]);
    expect(prisma.ocorrenciaObrigacao.update.mock.calls[0][0].data.dataInicio).toEqual(date("2026-10-15"));
    expect(prisma.ocorrenciaObrigacao.createMany.mock.calls[0][0].data).toHaveLength(10);
  });
  test("worker preserva janela personalizada e não recria ciclo cujo prazo foi movido", async () => {
    prisma.obrigacao.findUnique.mockResolvedValue({ id: "ob1", portalClientId: "p1", ...normalizarEntrada({ nome: "Conferir", tipo: "TAREFA", periodicidade: "MENSAL", diaVencimento: 20, ajusteDiaUtil: "MANTER" }) });
    prisma.ocorrenciaObrigacao.findMany.mockResolvedValue([ocorrencia({ dataVencimento: date("2026-09-25"), competenciaRef: "2026-08", janelaPersonalizada: true })]);
    await sincronizarOcorrencias("ob1");
    expect(prisma.ocorrenciaObrigacao.update).not.toHaveBeenCalled();
    expect(prisma.ocorrenciaObrigacao.deleteMany).not.toHaveBeenCalled();
    expect(prisma.ocorrenciaObrigacao.createMany.mock.calls[0][0].data.some((x) => x.competenciaRef === "2026-08")).toBe(false);
  });
});


test('inativar é pausa e não apaga ocorrências nem exceções', async () => {
  prisma.obrigacao.findUnique.mockResolvedValue({ id: 'ob1', ativa: false });
  expect(await sincronizarOcorrencias('ob1')).toEqual({ criadas: 0, removidas: 0 });
  expect(prisma.ocorrenciaObrigacao.deleteMany).not.toHaveBeenCalled();
  expect(prisma.ocorrenciaObrigacao.update).not.toHaveBeenCalled();
  expect(prisma.ocorrenciaObrigacao.createMany).not.toHaveBeenCalled();
  await ocorrenciasDoPeriodo({ portalIds: ['p1'], inicio: date('2026-09-01'), fim: date('2026-10-01') });
  expect(prisma.ocorrenciaObrigacao.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ obrigacao: expect.objectContaining({ ativa: true }) }) }));
});

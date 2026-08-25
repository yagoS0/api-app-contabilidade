// ⚠⚠ "CLASSIFICAR COMPETÊNCIA" CLASSIFICAVA A EMPRESA INTEIRA.
//
// Achado ao mapear a aba Apuração a pedido do dono (25/08/2026). A query de `classificarItensV2`
// não filtrava por competência em lugar nenhum; o parâmetro só virava metadado da pendência, e o
// próprio JSDoc admitia ("apenas pra metadata da pendência"). O rótulo do botão prometia um escopo
// que o servidor não aplicava.
//
// ⚠ E não era inofensivo: com `force: true` o mesmo clique reclassificaria TODO o histórico da
// empresa — meses fechados e transmitidos inclusive.
//
// ⚠⚠ ESTE ARQUIVO É O PRIMEIRO TESTE QUE `ClassificadorService` TEM. Ele classifica a receita que
// decide o anexo, a alíquota e o DAS, e estava sem cobertura nenhuma.

jest.mock("../../../../../infrastructure/db/prisma.js", () => {
  const model = () => ({
    findMany: jest.fn(async () => []),
    findUnique: jest.fn(async () => null),
    findFirst: jest.fn(async () => null),
    count: jest.fn(async () => 0),
    create: jest.fn(async (a) => ({ id: "novo", ...(a?.data || {}) })),
    update: jest.fn(async (a) => ({ id: "x", ...(a?.data || {}) })),
    updateMany: jest.fn(async () => ({ count: 0 })),
  });
  return {
    prisma: {
      notaItem: model(), produtoServico: model(), regraClassificacao: model(),
      cadastroFiscal: model(), filaPendencia: model(), cnaeAnexo: model(),
      portalClient: model(), company: model(), atividadePgdasd: model(),
    },
  };
});

import { prisma } from "../../../../../infrastructure/db/prisma.js";
import { classificarItensV2 } from "../ClassificadorService.js";

const PORTAL = "pc-1";
const chamar = (opts) => classificarItensV2({ portalClientId: PORTAL, ...opts });
/** O `where` que foi de fato ao banco para BUSCAR os itens (a primeira chamada, não a contagem). */
const whereDaBusca = () => prisma.notaItem.findMany.mock.calls[0][0].where;

beforeEach(() => jest.clearAllMocks());

describe("⚠⚠ O ESCOPO — o botão diz competência, o servidor tem de aplicar competência", () => {
  it("com competência, a busca é RESTRITA ao mês civil daquela competência", async () => {
    await chamar({ competencia: "2026-07" });
    const w = whereDaBusca();
    expect(w.nota.clientId).toBe(PORTAL);
    expect(w.nota.competencia).toEqual({
      gte: new Date(Date.UTC(2026, 6, 1)),
      lt: new Date(Date.UTC(2026, 7, 1)),
    });
  });

  it("SEM competência, a empresa inteira — e isso continua intacto (é o que o lote quer)", async () => {
    await chamar({});
    expect(whereDaBusca().nota.competencia).toBeUndefined();
  });

  it("⚠ competência MALFORMADA não vira \"a empresa inteira\" em silêncio — vira escopo declarado", async () => {
    // Seria o pior dos dois mundos: a tela dizendo "competência" e o servidor varrendo tudo, sem
    // nada na resposta denunciando.
    const r = await chamar({ competencia: "julho" });
    expect(whereDaBusca().nota.competencia).toBeUndefined();
    expect(r.escopo).toEqual({ tipo: "EMPRESA", competencia: null });
  });

  it("o escopo aplicado VOLTA no resultado", async () => {
    expect((await chamar({ competencia: "2026-07" })).escopo).toEqual({ tipo: "COMPETENCIA", competencia: "2026-07" });
    expect((await chamar({})).escopo).toEqual({ tipo: "EMPRESA", competencia: null });
  });

  it("⚠ `force` continua respeitando o recorte — não é passe livre para o histórico", async () => {
    await chamar({ competencia: "2026-07", force: true });
    const w = whereDaBusca();
    expect(w.nota.competencia).toBeTruthy();
    // `force` só remove o filtro de "ainda não classificado", nunca o do mês.
    expect(w.tipoReceita).toBeUndefined();
  });

  it("sem `force`, só os não classificados entram", async () => {
    await chamar({ competencia: "2026-07" });
    expect(whereDaBusca().tipoReceita).toBeNull();
  });
});

describe("⚠⚠ NOTA SEM COMPETÊNCIA NÃO SOME EM SILÊNCIO", () => {
  // Em SQL, um intervalo NÃO casa com NULL. Filtrar por mês, sozinho, tornaria invisível para
  // sempre a nota que chegou sem competência — o defeito que a auditoria de notas já pagou aqui.
  it("elas são CONTADAS e devolvidas nomeadas", async () => {
    prisma.notaItem.count.mockResolvedValue(4);
    const r = await chamar({ competencia: "2026-07" });
    expect(r.foraDoEscopo).toEqual({ semCompetencia: 4, motivo: "SEM_COMPETENCIA_GRAVADA" });
  });

  it("⚠ a contagem sai do BANCO, não do tamanho da lista", async () => {
    prisma.notaItem.count.mockResolvedValue(9);
    await chamar({ competencia: "2026-07" });
    const wCount = prisma.notaItem.count.mock.calls[0][0].where;
    expect(wCount.nota).toEqual({ clientId: PORTAL, competencia: null });
  });

  it("sem recorte por mês não há \"fora do escopo\" — e o campo sai `null`, não zero", async () => {
    // Zero é uma afirmação ("conferi, não há nenhuma"); aqui a pergunta nem foi feita.
    const r = await chamar({});
    expect(r.foraDoEscopo).toBeNull();
    expect(prisma.notaItem.count).not.toHaveBeenCalled();
  });

  it("⚠ contagem que FALHA também sai `null` — nunca zero", async () => {
    prisma.notaItem.count.mockRejectedValue(new Error("banco caiu"));
    const r = await chamar({ competencia: "2026-07" });
    expect(r.foraDoEscopo).toBeNull();
  });
});

describe("⚠ o que não podia mudar junto", () => {
  it("classificar não escreve nada quando não há item nenhum", async () => {
    await chamar({ competencia: "2026-07" });
    expect(prisma.notaItem.updateMany).not.toHaveBeenCalled();
    expect(prisma.filaPendencia.create).not.toHaveBeenCalled();
  });

  it("portalClientId ausente recusa — nunca varre a base inteira", async () => {
    await expect(classificarItensV2({ competencia: "2026-07" })).rejects.toThrow(/portalClientId/);
  });
});

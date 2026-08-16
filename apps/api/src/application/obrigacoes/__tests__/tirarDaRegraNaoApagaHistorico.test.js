// "TIRAR DA REGRA" NÃO APAGA ENTREGA CONCLUÍDA.
//
// Reproduzido no navegador: concluir um vencimento de uma regra numa empresa (o chip vira "Vence
// 15/09/2026"), clicar em **"tirar da regra"** — sem nenhuma confirmação — e depois "devolver à
// regra": a obrigação voltava como **"Vencida · 14/08/2026"**. A conclusão tinha sumido.
//
// O caminho era `propagar` → `deleteMany` na obrigação fora de escopo, com as ocorrências caindo
// por `onDelete: Cascade` — inclusive as CONCLUÍDAS. A assimetria provava que não era decisão: a
// EXCLUSÃO da regra, que causa o mesmo estrago, pergunta duas vezes e avisa que não dá para
// desfazer; "tirar da regra" não perguntava nada.
//
// Sair da regra é afirmação sobre o FUTURO ("esta empresa não segue mais este prazo"), nunca sobre
// o que já foi feito.

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    regraObrigacao: { findUnique: jest.fn() },
    regraObrigacaoExcecao: { upsert: jest.fn(async () => ({})), deleteMany: jest.fn(async () => ({ count: 1 })) },
    portalClient: { findMany: jest.fn(), findUnique: jest.fn() },
    company: { findMany: jest.fn(async () => []) },
    obrigacao: {
      findMany: jest.fn(),
      findFirst: jest.fn(async () => null),
      create: jest.fn(async (args) => ({ id: "nova", ...args.data })),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 1 })),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
    ocorrenciaObrigacao: { findMany: jest.fn(async () => []) },
  },
}));

// A geração de ocorrências tem teste próprio (`ninguemNasceVencida`); aqui ela só não pode ir ao
// banco de mentira e atrapalhar a leitura do que `propagar` fez.
jest.mock("../ObrigacoesService.js", () => {
  const real = jest.requireActual("../ObrigacoesService.js");
  return { ...real, sincronizarOcorrencias: jest.fn(async () => ({ criadas: 0, removidas: 0 })) };
});

import { prisma } from "../../../infrastructure/db/prisma.js";
import { adicionarExcecao, propagar, removerExcecao } from "../RegrasObrigacaoService.js";

const REGRA = {
  id: "r1",
  nome: "EFD-Contribuições",
  categoria: "fiscal",
  periodicidade: "MENSAL",
  diaVencimento: 15,
  mesReferencia: null,
  defasagemMeses: 1,
  antecedenciaLembreteDias: 5,
  ajusteDiaUtil: "ANTECIPAR",
  cor: null,
  verificador: null,
  ativa: true,
  escopo: "TODAS",
  filtros: null,
  excecoes: [],
};

const PORTAL_IDS = ["alfa", "beta"];

/** Empresas visíveis; as que a regra alcança são as que sobram depois das exceções. */
function comEmpresas(...ids) {
  prisma.portalClient.findMany.mockResolvedValue(
    ids.map((id) => ({ id, razao: id.toUpperCase(), cnpj: null, temFolha: false, companyId: null })),
  );
}

function comObrigacoesDaRegra(...obrigacoes) {
  prisma.obrigacao.findMany.mockResolvedValue(obrigacoes);
}

/** As ocorrências CONCLUÍDAS que existem, por obrigação. */
function comConcluidas(...obrigacaoIds) {
  prisma.ocorrenciaObrigacao.findMany.mockResolvedValue(obrigacaoIds.map((obrigacaoId) => ({ obrigacaoId })));
}

const idsDe = (mock) => (mock.mock.calls[0]?.[0]?.where?.id?.in) || [];

beforeEach(() => {
  jest.clearAllMocks();
  prisma.regraObrigacao.findUnique.mockResolvedValue(REGRA);
  prisma.obrigacao.findFirst.mockResolvedValue(null);
  prisma.obrigacao.updateMany.mockImplementation(async (args) => ({ count: args.where.id.in.length }));
  prisma.obrigacao.deleteMany.mockImplementation(async (args) => ({ count: args.where.id.in.length }));
});

describe("propagar — a obrigação que sai do escopo", () => {
  it("⚠ COM entrega concluída: é DESVINCULADA, não apagada", async () => {
    comEmpresas("alfa");                                    // beta saiu do escopo
    comObrigacoesDaRegra(
      { id: "ob-alfa", portalClientId: "alfa", sobrescritaLocal: false },
      { id: "ob-beta", portalClientId: "beta", sobrescritaLocal: false },
    );
    comConcluidas("ob-beta");

    const efeito = await propagar({ regraId: "r1", portalIds: PORTAL_IDS });

    expect(prisma.obrigacao.deleteMany).not.toHaveBeenCalled();
    expect(prisma.obrigacao.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["ob-beta"] } },
      data: { regraId: null, sobrescritaLocal: false },
    });
    expect(efeito).toMatchObject({ desvinculadas: 1, removidas: 0 });
  });

  it("⚠ o CASCADE não chega perto da ocorrência concluída — o id nunca entra num delete", async () => {
    comEmpresas("alfa");
    comObrigacoesDaRegra({ id: "ob-beta", portalClientId: "beta", sobrescritaLocal: false });
    comConcluidas("ob-beta");

    await propagar({ regraId: "r1", portalIds: PORTAL_IDS });

    for (const chamada of prisma.obrigacao.deleteMany.mock.calls) {
      expect(chamada[0].where.id.in).not.toContain("ob-beta");
    }
  });

  it("SEM nada concluído: continua sendo apagada — não há histórico a preservar", async () => {
    comEmpresas("alfa");
    comObrigacoesDaRegra({ id: "ob-beta", portalClientId: "beta", sobrescritaLocal: false });
    comConcluidas();

    const efeito = await propagar({ regraId: "r1", portalIds: PORTAL_IDS });

    expect(idsDe(prisma.obrigacao.deleteMany)).toEqual(["ob-beta"]);
    expect(prisma.obrigacao.updateMany).not.toHaveBeenCalled();
    expect(efeito).toMatchObject({ desvinculadas: 0, removidas: 1 });
  });

  it("⚠ a decisão é POR OBRIGAÇÃO, não pelo lote: duas saindo juntas tomam caminhos diferentes", async () => {
    comEmpresas();                                          // ninguém no escopo: as duas saem
    comObrigacoesDaRegra(
      { id: "ob-alfa", portalClientId: "alfa", sobrescritaLocal: false },
      { id: "ob-beta", portalClientId: "beta", sobrescritaLocal: false },
    );
    comConcluidas("ob-beta");

    const efeito = await propagar({ regraId: "r1", portalIds: PORTAL_IDS });

    expect(idsDe(prisma.obrigacao.updateMany)).toEqual(["ob-beta"]);
    expect(idsDe(prisma.obrigacao.deleteMany)).toEqual(["ob-alfa"]);
    expect(efeito).toMatchObject({ desvinculadas: 1, removidas: 1 });
  });

  it("sobrescrita local segue intocada — nem apagada, nem desvinculada", async () => {
    comEmpresas("alfa");
    comObrigacoesDaRegra({ id: "ob-beta", portalClientId: "beta", sobrescritaLocal: true });
    comConcluidas();

    await propagar({ regraId: "r1", portalIds: PORTAL_IDS });

    expect(prisma.obrigacao.deleteMany).not.toHaveBeenCalled();
    expect(prisma.obrigacao.updateMany).not.toHaveBeenCalled();
  });
});

describe("o par de botões da tela", () => {
  it('⚠ "tirar da regra" numa empresa com entrega feita preserva a obrigação na empresa', async () => {
    prisma.regraObrigacao.findUnique.mockResolvedValue({
      ...REGRA, excecoes: [{ portalClientId: "beta" }],
    });
    comEmpresas("alfa", "beta");                            // beta só sai por ser exceção
    comObrigacoesDaRegra(
      { id: "ob-alfa", portalClientId: "alfa", sobrescritaLocal: false },
      { id: "ob-beta", portalClientId: "beta", sobrescritaLocal: false },
    );
    comConcluidas("ob-beta");

    const efeito = await adicionarExcecao({ portalIds: PORTAL_IDS, regraId: "r1", companyId: "beta" });

    expect(prisma.regraObrigacaoExcecao.upsert).toHaveBeenCalled();
    expect(prisma.obrigacao.deleteMany).not.toHaveBeenCalled();
    expect(efeito.desvinculadas).toBe(1);
  });

  it('⚠ "devolver à regra" REAPROVEITA a obrigação desvinculada — não cria uma segunda igual', async () => {
    comEmpresas("alfa", "beta");
    // Banco com memória curta, mas com memória: a readoção LIGA a órfã, e a propagação seguinte
    // tem de enxergá-la já ligada — é essa sequência que impede a segunda linha.
    const ligadas = [{ id: "ob-alfa", portalClientId: "alfa", sobrescritaLocal: false }];
    prisma.obrigacao.findMany.mockImplementation(async () => ligadas);
    // A órfã que ficou na empresa: mesmo nome, `regraId` nulo.
    prisma.obrigacao.findFirst.mockImplementation(async (args) =>
      args.where.regraId === null ? { id: "ob-beta" } : null);
    prisma.obrigacao.update.mockImplementation(async (args) => {
      ligadas.push({ id: args.where.id, portalClientId: "beta", sobrescritaLocal: false });
      return {};
    });

    const efeito = await removerExcecao({ portalIds: PORTAL_IDS, regraId: "r1", companyId: "beta" });

    expect(prisma.obrigacao.update).toHaveBeenCalledWith({
      where: { id: "ob-beta" },
      data: { regraId: "r1", sobrescritaLocal: false },
    });
    expect(efeito.readotada).toBe(true);
    // Sem a readoção nasceriam DUAS obrigações de mesmo nome na mesma empresa — o `@@unique`
    // não impede, porque o Postgres não compara NULLs.
    expect(prisma.obrigacao.create).not.toHaveBeenCalled();
  });

  it("sem órfã (nome mudou, ou nunca houve): a obrigação da regra é criada normalmente", async () => {
    comEmpresas("alfa", "beta");
    comObrigacoesDaRegra({ id: "ob-alfa", portalClientId: "alfa", sobrescritaLocal: false });
    prisma.obrigacao.findFirst.mockResolvedValue(null);

    const efeito = await removerExcecao({ portalIds: PORTAL_IDS, regraId: "r1", companyId: "beta" });

    expect(efeito.readotada).toBe(false);
    expect(prisma.obrigacao.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ portalClientId: "beta", regraId: "r1" }) }),
    );
  });
});

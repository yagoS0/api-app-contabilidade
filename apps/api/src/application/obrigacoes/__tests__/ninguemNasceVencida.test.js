// NINGUÉM NASCE VENCIDO.
//
// Reproduzido no navegador em 16/08/2026: uma regra com vencimento no dia 15 gravava, no ato, a
// ocorrência de 14/08 (15/08 é sábado, ANTECIPAR) para as CINCO empresas do escopo — que apareciam
// todas em vermelho, "Vencida · 14/08/2026", antes de qualquer trabalho existir. `situacaoDaOcorrencia`
// deriva VENCIDA de "pendente + data no passado", então bastava a ocorrência retroativa nascer.
//
// O que se trava aqui é a distinção entre as duas coisas que ficavam iguais na tela:
//   • VENCIDA porque o tempo passou sobre uma pendência que existiu — continua acontecendo;
//   • VENCIDA porque a ocorrência foi FABRICADA no passado — não acontece mais.

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    obrigacao: { findUnique: jest.fn() },
    portalClient: { findUnique: jest.fn(async () => ({ municipio: "Rio de Janeiro" })) },
    feriado: { findMany: jest.fn(async () => []) },
    ocorrenciaObrigacao: {
      findMany: jest.fn(async () => []),
      createMany: jest.fn(async () => ({ count: 0 })),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
  },
}));

import { prisma } from "../../../infrastructure/db/prisma.js";
import { sincronizarOcorrencias } from "../ObrigacoesService.js";

const OBRIGACAO = {
  id: "ob1",
  portalClientId: "pc1",
  ativa: true,
  periodicidade: "MENSAL",
  mesReferencia: null,
  diaVencimento: 15,
  ajusteDiaUtil: "ANTECIPAR",
  defasagemMeses: 1,
};

/** As datas que a chamada mandou CRIAR, em ISO. */
function datasCriadas() {
  const chamada = prisma.ocorrenciaObrigacao.createMany.mock.calls[0];
  if (!chamada) return [];
  return chamada[0].data.map((d) => d.dataVencimento.toISOString().slice(0, 10));
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(new Date("2026-08-16T09:30:00Z"));
  prisma.obrigacao.findUnique.mockResolvedValue(OBRIGACAO);
  prisma.ocorrenciaObrigacao.findMany.mockResolvedValue([]);
});

afterEach(() => { jest.useRealTimers(); });

describe("sincronizarOcorrencias — a ocorrência retroativa não é criada", () => {
  it("⚠ dia 15 cadastrado no dia 16: a primeira ocorrência é a de SETEMBRO", async () => {
    await sincronizarOcorrencias("ob1");
    const datas = datasCriadas();
    expect(datas).not.toContain("2026-08-14"); // era esta que nascia vencida
    expect(datas[0]).toBe("2026-09-15");
  });

  it("⚠ NENHUMA data criada é anterior a hoje — a garantia é sobre o conjunto, não sobre a primeira", async () => {
    await sincronizarOcorrencias("ob1");
    for (const iso of datasCriadas()) expect(iso >= "2026-08-16").toBe(true);
  });

  it("o vencimento que ainda não chegou continua entrando", async () => {
    prisma.obrigacao.findUnique.mockResolvedValue({ ...OBRIGACAO, diaVencimento: 20 });
    await sincronizarOcorrencias("ob1");
    expect(datasCriadas()[0]).toBe("2026-08-20");
  });

  it("⚠ ANUAL cujo mês já venceu NÃO fica sem vencimento nenhum — pega a do ano que vem", async () => {
    prisma.obrigacao.findUnique.mockResolvedValue({
      ...OBRIGACAO, periodicidade: "ANUAL", mesReferencia: 8,
    });
    await sincronizarOcorrencias("ob1");
    // Sem a busca fora da janela, `previstas` ficaria vazia e a obrigação nasceria muda: nem
    // pendência, nem prazo, nem nada na tela.
    expect(datasCriadas()).toEqual(["2027-08-13"]);
  });

  it("⚠ ESCOLHA EXPLÍCITA: com `incluirVencidoDoMes` a pendência em atraso é criada", async () => {
    // É o contador declarando, naquela empresa, que a entrega de fato não foi feita. O default é o
    // contrário, e a regra do escritório não oferece a opção.
    await sincronizarOcorrencias("ob1", prisma, { incluirVencidoDoMes: true });
    expect(datasCriadas()[0]).toBe("2026-08-14");
  });

  it("⚠ atraso REAL não é apagado: a varredura só olha de hoje em diante", async () => {
    // A ocorrência de julho, pendente e vencida de verdade, não entra em `existentes` (a query é
    // `gte: hoje`) e portanto nunca é candidata a remoção.
    await sincronizarOcorrencias("ob1");
    expect(prisma.ocorrenciaObrigacao.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ dataVencimento: { gte: new Date("2026-08-16T00:00:00Z") } }),
      }),
    );
  });

  it("a janela segue rolante: 12 meses de vencimentos a partir do próximo", async () => {
    await sincronizarOcorrencias("ob1");
    // 12 meses a partir de agosto, menos a data de agosto que já passou.
    expect(datasCriadas()).toHaveLength(11);
    expect(datasCriadas().at(-1)).toBe("2027-07-15");
  });
});

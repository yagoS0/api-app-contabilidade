// O CALENDÁRIO NÃO DISTINGUIA GUIA VENCIDA DE GUIA A VENCER — e a causa era o backend.
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// O DEFEITO
// ════════════════════════════════════════════════════════════════════════════════════════════
//
// O item de GUIA saía do `montarCalendarioDoMes` **sem o campo `data`**. O dia em que ele aparece na
// grade é a chave do `Map` (`porDia`), não um campo do item — e é o CAMPO que a tela lê para decidir
// o estado:
//
//   · `estaVencida(item)` → `Boolean(item.data) && item.data < hoje`
//   · `corDoItem(item)`   → `if (item.data && item.data > hoje) return COR.futura`
//
// Com `item.data` sempre `undefined`, as duas leituras caem no mesmo lugar: guia atrasada, guia de
// hoje e guia de daqui a três semanas saíam TODAS com a mesma cor, e a moldura de atraso era
// **inalcançável** — a primeira condição do `&&` nunca era verdadeira.
//
// ⚠ É o mesmo defeito que a Circular já teve de desmontar do lado dela: *"o vencimento é o que
// separa 'a vencer' de 'vencida'; vermelho gasto no prazo normal deixa de apontar o que realmente
// atrasou"*. Lá a correção foi carregar `vencimento` no `select`; aqui é emitir a data no item.
//
// ⚠ NADA MUDA NO GRID. A tela já sabia ler `item.data` — é o que a obrigação sempre entregou
// (`ObrigacoesService.ocorrenciasDoPeriodo` → `data: paraISO(oc.dataVencimento)`). A assimetria
// entre os dois itens é a prova de que não foi decisão, e é ela que estes testes medem.

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    portalClient: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null) },
    guide: { findMany: jest.fn(async () => []) },
    apuracaoSnapshot: { findMany: jest.fn(async () => []) },
    companyMonthlyCircular: { findMany: jest.fn(async () => []) },
    marcoFiscal: { findMany: jest.fn(async () => []) },
    feriado: { findMany: jest.fn(async () => []) },
    ocorrenciaObrigacao: { findMany: jest.fn(async () => []) },
  },
}));

import { prisma } from "../../../infrastructure/db/prisma.js";
import { montarCalendarioDoMes } from "../CalendarioFiscalService.js";
// A obrigação é o CONTROLE — o item que sempre teve `data`, no formato que a tela compara.
import { ocorrenciasDoPeriodo } from "../../obrigacoes/ObrigacoesService.js";

const COMPETENCIA = "2026-07";

const guia = (over = {}) => ({
  id: "g1",
  portalClientId: "p1",
  tipo: "SIMPLES",
  competencia: "2026-06",
  vencimento: new Date("2026-07-20T00:00:00.000Z"),
  valor: 1234.56,
  paymentStatus: "OPEN",
  ...over,
});

// Três guias no mesmo mês, em três posições diferentes em relação a "hoje" (2026-07-15).
const HOJE = "2026-07-15";
const GUIA_VENCIDA = guia({ id: "g-vencida", vencimento: new Date("2026-07-06T00:00:00.000Z") });
const GUIA_DE_HOJE = guia({ id: "g-hoje", vencimento: new Date("2026-07-15T00:00:00.000Z") });
const GUIA_FUTURA = guia({ id: "g-futura", vencimento: new Date("2026-07-31T00:00:00.000Z") });

// A ocorrência de obrigação, como o Prisma a devolve — o controle vem da MESMA função que a rota usa.
const OCORRENCIA = {
  id: "oc1",
  competenciaRef: "2026-06",
  dataVencimento: new Date("2026-07-20T00:00:00.000Z"),
  status: "PENDENTE",
  fonteConclusao: null,
  obrigacao: {
    id: "ob1", nome: "DCTFWeb", categoria: "FEDERAL", cor: null, verificador: null,
    regraId: null, portalClientId: "p1", periodicidade: "MENSAL", antecedenciaLembreteDias: 5,
    portalClient: { razao: "EMPRESA X" },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  prisma.portalClient.findMany.mockResolvedValue([{ id: "p1", razao: "EMPRESA X" }]);
  prisma.guide.findMany.mockResolvedValue([GUIA_VENCIDA, GUIA_DE_HOJE, GUIA_FUTURA]);
  prisma.ocorrenciaObrigacao.findMany.mockResolvedValue([OCORRENCIA]);
});

async function itens() {
  const out = await montarCalendarioDoMes({ portalIds: ["p1"], competencia: COMPETENCIA });
  expect(out.ok).toBe(true);
  const todos = out.dias.flatMap((d) => d.itens);
  return {
    guias: todos.filter((i) => i.tipo === "guia"),
    obrigacoes: todos.filter((i) => i.tipo === "obrigacao"),
    porId: new Map(todos.filter((i) => i.tipo === "guia").map((i) => [i.id, i])),
  };
}

describe("o item de GUIA leva o vencimento no campo `data`", () => {
  it("as três guias chegam com `data` preenchida", async () => {
    const { guias } = await itens();
    expect(guias).toHaveLength(3);
    for (const g of guias) expect(g.data).toBeTruthy();
  });

  it("a `data` é o vencimento, no formato `YYYY-MM-DD` que a tela compara com hoje", async () => {
    const { porId } = await itens();
    expect(porId.get("g-vencida").data).toBe("2026-07-06");
    expect(porId.get("g-hoje").data).toBe("2026-07-15");
    expect(porId.get("g-futura").data).toBe("2026-07-31");
  });

  it("a `data` do item é a MESMA do dia da grade onde ele foi pendurado", async () => {
    const out = await montarCalendarioDoMes({ portalIds: ["p1"], competencia: COMPETENCIA });
    for (const dia of out.dias) {
      for (const item of dia.itens) {
        if (item.tipo === "guia") expect(item.data).toBe(dia.data);
      }
    }
  });
});

describe("A ASSIMETRIA — a obrigação é o controle e sempre teve `data`", () => {
  it("guia e obrigação usam o MESMO formato de data", async () => {
    const { guias, obrigacoes } = await itens();
    expect(obrigacoes).toHaveLength(1);
    const formato = /^\d{4}-\d{2}-\d{2}$/;
    expect(obrigacoes[0].data).toMatch(formato);
    for (const g of guias) expect(g.data).toMatch(formato);
  });

  it("o formato é o de `ocorrenciasDoPeriodo` — a mesma função, não uma segunda escrita", async () => {
    const [oc] = await ocorrenciasDoPeriodo({
      portalIds: ["p1"],
      inicio: new Date(Date.UTC(2026, 6, 1)),
      fim: new Date(Date.UTC(2026, 7, 1)),
    });
    const { obrigacoes } = await itens();
    expect(obrigacoes[0].data).toBe(oc.data);
  });
});

describe("O QUE A TELA PASSA A CONSEGUIR DECIDIR (as leituras do grid, aplicadas aqui)", () => {
  // As duas leituras de `renderCalendarioGrid.jsx`, copiadas só para MEDIR o efeito — a regra
  // continua morando lá; o que faltava era o dado chegar.
  const estaVencida = (item, hoje) => !item.resolvido && Boolean(item.data) && item.data < hoje;
  const ehFutura = (item, hoje) => Boolean(item.data) && item.data > hoje;

  it("a guia atrasada é reconhecida como vencida (a moldura de atraso deixa de ser inalcançável)", async () => {
    const { porId } = await itens();
    expect(estaVencida(porId.get("g-vencida"), HOJE)).toBe(true);
  });

  it("a guia que vence HOJE não é vencida nem futura — vence hoje ainda é a vencer", async () => {
    const { porId } = await itens();
    const g = porId.get("g-hoje");
    expect(estaVencida(g, HOJE)).toBe(false);
    expect(ehFutura(g, HOJE)).toBe(false);
  });

  it("a guia de daqui a duas semanas é futura, e não pinta de vermelho", async () => {
    const { porId } = await itens();
    expect(ehFutura(porId.get("g-futura"), HOJE)).toBe(true);
    expect(estaVencida(porId.get("g-futura"), HOJE)).toBe(false);
  });

  it("as três deixam de ser indistinguíveis — três estados diferentes para três guias", async () => {
    const { porId } = await itens();
    const estado = (g) => (estaVencida(g, HOJE) ? "vencida" : ehFutura(g, HOJE) ? "futura" : "hoje");
    expect([
      estado(porId.get("g-vencida")),
      estado(porId.get("g-hoje")),
      estado(porId.get("g-futura")),
    ]).toEqual(["vencida", "hoje", "futura"]);
  });

  it("guia PAGA continua resolvida — `resolvido` não foi tocado", async () => {
    prisma.guide.findMany.mockResolvedValue([guia({ id: "g-paga", paymentStatus: "PAID" })]);
    const { porId } = await itens();
    expect(porId.get("g-paga").resolvido).toBe(true);
    expect(porId.get("g-paga").data).toBe("2026-07-20");
  });
});

describe("o que NÃO mudou no item da guia", () => {
  it("os campos que já saíam continuam saindo, com os mesmos valores", async () => {
    prisma.guide.findMany.mockResolvedValue([guia()]);
    const { porId } = await itens();
    expect(porId.get("g1")).toMatchObject({
      tipo: "guia",
      id: "g1",
      titulo: "SIMPLES",
      companyId: "p1",
      empresa: "EMPRESA X",
      competencia: "2026-06",
      valor: 1234.56,
      resolvido: false,
    });
  });

  it("o total de guias do mês continua o mesmo", async () => {
    const out = await montarCalendarioDoMes({ portalIds: ["p1"], competencia: COMPETENCIA });
    expect(out.totais.guias).toBe(3);
  });
});

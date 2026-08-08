// PRINCIPAL, JUROS E MULTA SÃO LANÇAMENTOS SEPARADOS — regra do dono, sem teste até aqui.
//
// O defeito relatado: INSS pago em atraso saía num bloco só. A causa não estava no modal — o modal
// mandava `papel` certinho. O serviço REMAPEAVA as linhas e **descartava o campo `papel`** antes de
// chamar `separarPorPapel`, que então via toda linha sem papel, tratava tudo como principal, achava
// um grupo só e caía no caminho do lançamento único. O modal estava certo o tempo todo.
//
// Por que isso importa além da estética: juros e multa NÃO são passivo previdenciário. Debitá-los
// em "INSS a Recolher" junto com o principal amortiza o passivo por mais do que foi provisionado e
// enterra despesa do mês do pagamento dentro dele.

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const criados = [];
  const tx = {
    accountingEntry: {
      create: jest.fn(async ({ data }) => {
        const entry = { id: `e${criados.length + 1}`, ...data, lines: data.lines?.createMany?.data || [] };
        criados.push(entry);
        return entry;
      }),
    },
    guide: {
      // A baixa começa reservando a guia (updateMany condicional) — ver `baixaInssDuplicada.test.js`.
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async () => ({})),
    },
  };
  return {
    __criados: criados,
    __tx: tx,
    prisma: {
      guide: { findFirst: jest.fn() },
      accountingEntry: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
      chartOfAccount: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (cb) => cb(tx)),
    },
  };
});

jest.mock("../fechamentoContabil.js", () => ({ isMonthClosed: jest.fn(async () => false) }));

import { prisma, __criados } from "../../../infrastructure/db/prisma.js";
import { gerarPagamentoInssFromGuide } from "../InssPagamentoService.js";

const VENCIMENTO = new Date("2026-07-20T00:00:00Z");
const EM_DIA = new Date("2026-07-18T00:00:00Z");
const EM_ATRASO = new Date("2026-08-04T00:00:00Z");

function guiaInss({ valor = 1000 } = {}) {
  return {
    id: "g1", tipo: "INSS", competencia: "2026-06", valor,
    lancamentoId: null, baixada: false, vencimento: VENCIMENTO,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  __criados.length = 0;
  prisma.guide.findFirst.mockResolvedValue(guiaInss());
});

describe("baixa do INSS pelo modal (papel marcado)", () => {
  const linhasDoModal = [
    { conta: "211", tipo: "D", valor: 800, papel: "PRINCIPAL" },
    { conta: "501", tipo: "D", valor: 120, papel: "JUROS" },
    { conta: "506", tipo: "D", valor: 80, papel: "MULTA" },
    { conta: "111", tipo: "C", valor: 1000 },
  ];

  it("três papéis viram TRÊS lançamentos — era isto que o `papel` descartado quebrava", async () => {
    const r = await gerarPagamentoInssFromGuide({
      portalClientId: "p1", guideId: "g1", dataPagamento: EM_ATRASO, lines: linhasDoModal,
    });
    expect(r.ok).toBe(true);
    expect(__criados).toHaveLength(3);
  });

  it("cada lançamento fecha D=C sozinho — senão o cadeado do fechamento trava o mês", async () => {
    await gerarPagamentoInssFromGuide({
      portalClientId: "p1", guideId: "g1", dataPagamento: EM_ATRASO, lines: linhasDoModal,
    });
    for (const entry of __criados) {
      const d = entry.lines.filter((l) => l.tipo === "D").reduce((s, l) => s + l.valor, 0);
      const c = entry.lines.filter((l) => l.tipo === "C").reduce((s, l) => s + l.valor, 0);
      expect(Math.abs(d - c)).toBeLessThan(0.01);
    }
  });

  it("`papel` NÃO vai para o banco — não é coluna de AccountingEntryLine", async () => {
    await gerarPagamentoInssFromGuide({
      portalClientId: "p1", guideId: "g1", dataPagamento: EM_ATRASO, lines: linhasDoModal,
    });
    for (const entry of __criados) {
      for (const linha of entry.lines) expect(linha).not.toHaveProperty("papel");
    }
  });

  it("componente zerado não gera lançamento", async () => {
    await gerarPagamentoInssFromGuide({
      portalClientId: "p1", guideId: "g1", dataPagamento: EM_ATRASO,
      lines: [
        { conta: "211", tipo: "D", valor: 1000, papel: "PRINCIPAL" },
        { conta: "501", tipo: "D", valor: 0, papel: "JUROS" },
        { conta: "111", tipo: "C", valor: 1000 },
      ],
    });
    expect(__criados).toHaveLength(1);
  });

  it("linha sem papel conta como principal (regra documentada)", async () => {
    await gerarPagamentoInssFromGuide({
      portalClientId: "p1", guideId: "g1", dataPagamento: EM_ATRASO,
      lines: [
        { conta: "211", tipo: "D", valor: 600, papel: "PRINCIPAL" },
        { conta: "213", tipo: "D", valor: 400 },
        { conta: "111", tipo: "C", valor: 1000 },
      ],
    });
    expect(__criados).toHaveLength(1);
  });
});

describe("baixa automática a partir do comprovante", () => {
  it("rateio confiável gera os três lançamentos, sem o modal", async () => {
    const r = await gerarPagamentoInssFromGuide({
      portalClientId: "p1", guideId: "g1", dataPagamento: EM_ATRASO,
      rateio: { principal: 800, juros: 120, multa: 80 },
    });
    expect(r.ok).toBe(true);
    expect(__criados).toHaveLength(3);
    // Juros e multa vão para as contas de acréscimo, não para "INSS a Recolher".
    const contasD = __criados.flatMap((e) => e.lines.filter((l) => l.tipo === "D").map((l) => l.conta));
    expect(contasD).toEqual(expect.arrayContaining(["501", "506"]));
  });

  it("⚠ guia em ATRASO sem rateio NÃO gera lançamento", async () => {
    // O `guide.valor` de uma guia em atraso já embute juros e multa. Lançar esse total contra
    // "INSS a Recolher" amortizaria o passivo por mais do que foi provisionado. Sem saber a
    // divisão, a resposta certa é não lançar.
    const r = await gerarPagamentoInssFromGuide({
      portalClientId: "p1", guideId: "g1", dataPagamento: EM_ATRASO,
    });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe("sem_rateio_do_acrescimo");
    expect(__criados).toHaveLength(0);
  });

  it("pago EM DIA sem rateio segue com um lançamento só — ali não há acréscimo a separar", async () => {
    const r = await gerarPagamentoInssFromGuide({
      portalClientId: "p1", guideId: "g1", dataPagamento: EM_DIA,
    });
    expect(r.ok).toBe(true);
    expect(__criados).toHaveLength(1);
  });

  it("guia sem vencimento não é presumida em atraso", async () => {
    prisma.guide.findFirst.mockResolvedValue({ ...guiaInss(), vencimento: null });
    const r = await gerarPagamentoInssFromGuide({
      portalClientId: "p1", guideId: "g1", dataPagamento: EM_ATRASO,
    });
    expect(r.ok).toBe(true);
    expect(__criados).toHaveLength(1);
  });
});

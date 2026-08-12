// A GUARDA DO DAS PRECISA DISTINGUIR **JUROS** DE **RETIFICADORA** — e não distinguia.
//
// O defeito relatado pelo dono: reconsultado o extrato depois de uma retificadora, "para a receita
// ele atualizou após a retificação, mas o do imposto ele NÃO atualizou, mantendo o valor de antes".
//
// A causa: `upsertGeneratedEntry` tem UM ramo especial para `DAS_SIMPLES` que preserva as linhas e
// só carimba `recalculated*`. Ele foi escrito para o **documento de arrecadação recalculado depois
// do vencimento** (juros/multa não são imposto do mês e não podem inflar a provisão) — mas
// disparava também quando o número novo vinha da **DECLARAÇÃO**, onde ele É a verdade.
//
// ⚠ ESTES TESTES NÃO PEDEM A REMOÇÃO DA GUARDA. Metade deles exige que ela continue mordendo no
// caminho da guia. O que eles travam é a DISTINÇÃO — e o default conservador, para que uma chamada
// nova escrita amanhã nasça com a guarda ligada em vez de sobrescrevendo a provisão.
//
// O terceiro bloco trava o defeito que tornava a guarda INCONDICIONAL na prática: o "valor
// anterior" era a soma de TODAS as linhas (D **e** C), isto é, o dobro — então "o valor mudou" era
// verdade sempre, mesmo numa reconsulta que não mudou nada.

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: { $transaction: jest.fn() },
}));

import { prisma } from "../../../infrastructure/db/prisma.js";
import {
  generateEntriesFromCircular,
  FONTE_VALOR_EXTRATO,
  FONTE_VALOR_GUIA,
} from "../AccountingEntryGeneratorService.js";

const PORTAL = "p1";
const COMP = "2026-06";

let tx;
let entriesPorEvento;
let circular;

function linhasDe(valor) {
  return [
    { conta: "553", tipo: "D", valor, ordem: 0 },
    { conta: "211", tipo: "C", valor, ordem: 1 },
  ];
}

beforeEach(() => {
  jest.clearAllMocks();

  circular = {
    id: "c1",
    portalClientId: PORTAL,
    competencia: COMP,
    receitaServicos: 0,
    receitaVendasSemST: 0,
    receitaVendasComST: 0,
    dasTotal: null,
    metadata: {},
  };
  entriesPorEvento = {};

  tx = {
    portalClient: { findUnique: jest.fn(async () => ({ id: PORTAL, razao: "ACME LTDA", cnpj: "00000000000191" })) },
    companyMonthlyCircular: {
      findUnique: jest.fn(async () => circular),
      update: jest.fn(async () => circular),
    },
    accountingEntryRule: { findFirst: jest.fn(async () => null) },
    accountingHistorico: { findFirst: jest.fn(async () => null) },
    accountingEntry: {
      findFirst: jest.fn(async ({ where }) => entriesPorEvento[where.eventType] || null),
      update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })),
      create: jest.fn(async ({ data }) => ({ id: "novo", ...data })),
    },
    accountingEntryLine: {
      deleteMany: jest.fn(async () => ({ count: 2 })),
      createMany: jest.fn(async () => ({ count: 2 })),
    },
  };

  prisma.$transaction.mockImplementation(async (fn) => fn(tx));
});

function acaoDe(resultado, eventType) {
  return (resultado.generatedEntries || []).find((g) => g.eventType === eventType)?.action || null;
}
const dadosDoUpdate = () => tx.accountingEntry.update.mock.calls[0]?.[1]?.data ?? tx.accountingEntry.update.mock.calls[0]?.[0]?.data;

describe("retificadora: o extrato manda no imposto", () => {
  it("⚠ DAS pelo EXTRATO com valor novo: as LINHAS acompanham (é a verdade declarada)", async () => {
    circular.dasTotal = 1200;
    entriesPorEvento.DAS_SIMPLES = { id: "e-das", status: "RASCUNHO", tipo: "PROVISAO", circularId: "c1", ruleId: null, eventType: "DAS_SIMPLES", lines: linhasDe(1000), baixas: [] };

    const r = await generateEntriesFromCircular({ portalClientId: PORTAL, competencia: COMP, fonteValor: FONTE_VALOR_EXTRATO });

    expect(acaoDe(r, "DAS_SIMPLES")).toBe("updated");
    expect(dadosDoUpdate()).not.toHaveProperty("recalculatedAt");
    expect(tx.accountingEntryLine.deleteMany).toHaveBeenCalled();
    expect(tx.accountingEntryLine.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([expect.objectContaining({ tipo: "D", valor: 1200 })]),
      }),
    );
  });

  it("a RECEITA sempre acompanhou — é a metade que já funcionava, e continua", async () => {
    circular.receitaServicos = 9000;
    entriesPorEvento.RECEITA_SERVICO = { id: "e-rec", status: "RASCUNHO", tipo: "RECEITA", circularId: "c1", ruleId: null, eventType: "RECEITA_SERVICO", lines: linhasDe(7000), baixas: [] };

    const r = await generateEntriesFromCircular({ portalClientId: PORTAL, competencia: COMP, fonteValor: FONTE_VALOR_EXTRATO });

    expect(acaoDe(r, "RECEITA_SERVICO")).toBe("updated");
    expect(tx.accountingEntryLine.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ tipo: "D", valor: 9000 })]) }),
    );
  });
});

describe("⚠ a guarda CONTINUA valendo para o recálculo de juros da guia", () => {
  it("DAS pela GUIA com valor novo: preserva as linhas e só sinaliza", async () => {
    circular.dasTotal = 1180.5; // principal + juros/multa do documento vencido
    entriesPorEvento.DAS_SIMPLES = { id: "e-das", status: "RASCUNHO", tipo: "PROVISAO", circularId: "c1", ruleId: null, eventType: "DAS_SIMPLES", lines: linhasDe(1000), baixas: [] };

    const r = await generateEntriesFromCircular({ portalClientId: PORTAL, competencia: COMP, fonteValor: FONTE_VALOR_GUIA });

    expect(acaoDe(r, "DAS_SIMPLES")).toBe("recalculated");
    const data = dadosDoUpdate();
    expect(data.recalculatedFromValor).toBeCloseTo(1000, 2);
    expect(data.recalculatedToValor).toBeCloseTo(1180.5, 2);
    // O ponto da guarda: as LINHAS não são tocadas.
    expect(tx.accountingEntryLine.deleteMany).not.toHaveBeenCalled();
    expect(tx.accountingEntryLine.createMany).not.toHaveBeenCalled();
  });

  it("⚠ o DEFAULT é conservador: sem declarar a fonte, a guarda fica LIGADA", async () => {
    circular.dasTotal = 1180.5;
    entriesPorEvento.DAS_SIMPLES = { id: "e-das", status: "RASCUNHO", tipo: "PROVISAO", circularId: "c1", ruleId: null, eventType: "DAS_SIMPLES", lines: linhasDe(1000), baixas: [] };

    const r = await generateEntriesFromCircular({ portalClientId: PORTAL, competencia: COMP });

    expect(acaoDe(r, "DAS_SIMPLES")).toBe("recalculated");
    expect(tx.accountingEntryLine.createMany).not.toHaveBeenCalled();
  });

  it("a correção MANUAL do contador continua vencendo a guarda", async () => {
    circular.dasTotal = 900;
    entriesPorEvento.DAS_SIMPLES = { id: "e-das", status: "RASCUNHO", tipo: "PROVISAO", circularId: "c1", ruleId: null, eventType: "DAS_SIMPLES", lines: linhasDe(1000), baixas: [] };

    const r = await generateEntriesFromCircular({ portalClientId: PORTAL, competencia: COMP, edicaoManual: true });

    expect(acaoDe(r, "DAS_SIMPLES")).toBe("updated");
    expect(tx.accountingEntryLine.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ tipo: "D", valor: 900 })]) }),
    );
  });
});

describe("⚠ o valor do lançamento é a soma dos DÉBITOS, não das duas pernas", () => {
  it("reconsulta sem mudança nenhuma é NOOP — não carimba 'recalculada' à toa", async () => {
    circular.dasTotal = 1000;
    entriesPorEvento.DAS_SIMPLES = { id: "e-das", status: "RASCUNHO", tipo: "PROVISAO", circularId: "c1", ruleId: null, eventType: "DAS_SIMPLES", lines: linhasDe(1000), baixas: [] };

    const r = await generateEntriesFromCircular({ portalClientId: PORTAL, competencia: COMP, fonteValor: FONTE_VALOR_GUIA });

    expect(acaoDe(r, "DAS_SIMPLES")).toBe("noop");
    expect(tx.accountingEntry.update).not.toHaveBeenCalled();
    expect(tx.accountingEntryLine.createMany).not.toHaveBeenCalled();
  });

  it("o 'valor anterior' registrado é o do lançamento, nunca o dobro dele", async () => {
    circular.dasTotal = 1180.5;
    entriesPorEvento.DAS_SIMPLES = { id: "e-das", status: "RASCUNHO", tipo: "PROVISAO", circularId: "c1", ruleId: null, eventType: "DAS_SIMPLES", lines: linhasDe(1000), baixas: [] };

    await generateEntriesFromCircular({ portalClientId: PORTAL, competencia: COMP, fonteValor: FONTE_VALOR_GUIA });

    // Em produção este campo saiu 2× o valor em 55 de 89 provisões de DAS — a assinatura do defeito.
    expect(dadosDoUpdate().recalculatedFromValor).not.toBeCloseTo(2000, 2);
  });
});

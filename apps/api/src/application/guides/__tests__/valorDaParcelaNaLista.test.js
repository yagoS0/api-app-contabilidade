// ⚠⚠ O VALOR DA PARCELA É O DELA — e o do DAS depende de QUEM está lendo (30/08/2026)
//
// > Dono, com o print na tela: *"há um bug entre o valor da parcela e o do Simples Nacional (…)
// > aparece como se o parcelamento fosse uma retificada do Simples Nacional, o que não é verdade;
// > o único valor que deveria aparecer ali é o de 323,83."*
//
// `listGuidesByCompany` troca o valor de toda guia `tipo: "SIMPLES"` pelo `dasTotal` do extrato do
// PGDAS-D. ⚠⚠ **A PARCELA DE PARCELAMENTO É GRAVADA COMO `tipo: "SIMPLES"`, idêntica ao DAS** — só
// `parcelamentoId` as separa —, então ela pegava o DAS do mês, ganhava o badge "↻" e um `title`
// afirmando *"recalculada pelo SERPRO"*. Medido antes do conserto: 3 parcelas, TODAS liberadas ao
// cliente (ERISANGELA 06 e 07/2026, ALESSANDRO NIGRO 07/2026).
//
// ⚠ A regra já existia nesta casa: `rotuloGuia` diz que o **parcelamento decide ANTES do tipo**.

// ⚠ `jest.mock` com fábrica interna e `__db` de saída — o molde desta casa
// (`parcelamento/__tests__/atosParcelamento.test.js`). O Jest proíbe a fábrica de referenciar
// variável de fora, e `unstable_mockModule` + top-level await não parseia nesta configuração.
jest.mock("../../../infrastructure/db/prisma.js", () => {
  const db = {
    guide: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    companyMonthlyCircular: { findMany: jest.fn(async () => []) },
    // ⚠ A listagem passou a carregar o estado de ENVIO (05/09/2026) — uma query para a página
    // inteira. Sem o dublê, o teste morre num `findMany` de um model que ele não conhecia.
    envioGuia: { findMany: jest.fn(async () => []) },
  };
  return { __db: db, prisma: { ...db, $transaction: (ops) => Promise.all(ops) } };
});

import { __db } from "../../../infrastructure/db/prisma.js";
import { PUBLICO, listGuidesByCompany } from "../GuideService.js";

const { guide, companyMonthlyCircular } = __db;

const DAS = {
  id: "g-das", tipo: "SIMPLES", competencia: "2026-07", valor: 1437.15, valorOriginal: 1437.15,
  parcelamentoId: null,
};
const PARCELA = {
  id: "g-parc", tipo: "SIMPLES", competencia: "2026-07", valor: 323.83, valorOriginal: 323.83,
  // ⚠ É ESTE campo, e só ele, que distingue a parcela do DAS.
  parcelamentoId: "parc-1", numeroParcela: 8,
};

function comBanco(guias, dasTotal) {
  guide.findMany.mockResolvedValue(guias);
  guide.count.mockResolvedValue(guias.length);
  companyMonthlyCircular.findMany.mockResolvedValue(
    dasTotal == null ? [] : [{ competencia: "2026-07", dasTotal }]
  );
}

const ler = (publico) => listGuidesByCompany({ portalClientId: "pc-1", publico });

beforeEach(() => { jest.clearAllMocks(); });

describe("⚠⚠ a PARCELA nunca recebe o valor do DAS", () => {
  it("o valor dela é o dela, e não há badge de recálculo", async () => {
    comBanco([PARCELA], 1437.15);
    const { items } = await ler(PUBLICO.ESCRITORIO);
    expect(items[0].valor).toBe(323.83);
    // ⚠⚠ Sem isto o `title` da tela afirma "guia recalculada pelo SERPRO" sobre um documento que
    // nunca foi recalculado — afirmação falsa sobre peça fiscal, e ela chegava ao cliente.
    expect(items[0].valorRecalculado ?? null).toBeNull();
  });

  it("⚠ e o DAS do MESMO mês continua sendo enriquecido — a exclusão é da parcela, não do tipo", async () => {
    comBanco([DAS, PARCELA], 1400);
    const { items } = await ler(PUBLICO.ESCRITORIO);
    const das = items.find((g) => g.id === "g-das");
    const parcela = items.find((g) => g.id === "g-parc");
    expect(das.valor).toBe(1400);            // o extrato
    expect(das.valorRecalculado).toBe(1437.15); // o de cobrança, no badge
    expect(parcela.valor).toBe(323.83);
    expect(parcela.valorRecalculado ?? null).toBeNull();
  });

  it("⚠ a parcela nem entra na consulta do extrato — não se busca o que não se usa", async () => {
    comBanco([PARCELA], 1437.15);
    await ler(PUBLICO.ESCRITORIO);
    expect(companyMonthlyCircular.findMany).not.toHaveBeenCalled();
  });
});

describe("⚠⚠ o CLIENTE vê quanto PAGAR; o escritório vê o extrato", () => {
  it("guia recalculada: o cliente vê o valor da GUIA, o escritório vê o do extrato", async () => {
    // ⚠ O extrato é MENOR que a cobrança numa guia com juros e multa. Mostrá-lo ao cliente diria
    // que ele deve menos do que deve.
    comBanco([{ ...DAS, valor: 1500 }], 1437.15);
    expect((await ler(PUBLICO.CLIENTE)).items[0].valor).toBe(1500);
    const escritorio = (await ler(PUBLICO.ESCRITORIO)).items[0];
    expect(escritorio.valor).toBe(1437.15);
    expect(escritorio.valorRecalculado).toBe(1500);
  });

  it("⚠⚠ guia SEM valor: o extrato preenche o vazio, para os DOIS — `R$ 0,00` afirmaria que não se deve nada", async () => {
    // Medido: 36 guias de DAS na carteira estão com `valor: 0,00`; ali o extrato é o único número
    // que existe, e ele É o DAS do mês.
    comBanco([{ ...DAS, valor: 0, valorOriginal: null }], 630);
    expect((await ler(PUBLICO.CLIENTE)).items[0].valor).toBe(630);
    expect((await ler(PUBLICO.ESCRITORIO)).items[0].valor).toBe(630);
  });

  it("⚠⚠ o cliente NUNCA recebe `valorRecalculado` — os dois valores são material do contador", async () => {
    // Mesma regra que a linha digitável já segue: o cliente não vê os dois lados da divergência.
    comBanco([{ ...DAS, valor: 1500 }], 1437.15);
    expect((await ler(PUBLICO.CLIENTE)).items[0].valorRecalculado ?? null).toBeNull();
  });

  it("⚠⚠ o DEFAULT é o público estreito — chamador que esquecer não vaza material do contador", async () => {
    comBanco([{ ...DAS, valor: 1500 }], 1437.15);
    const { items } = await listGuidesByCompany({ portalClientId: "pc-1" });
    expect(items[0].valor).toBe(1500);
    expect(items[0].valorRecalculado ?? null).toBeNull();
  });
});

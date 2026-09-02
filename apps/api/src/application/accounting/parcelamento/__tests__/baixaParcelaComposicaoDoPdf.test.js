// A COMPOSIÇÃO QUE O DAS **PROVA** — o outro lado da F2.6.
//
// ⚠ O PONTO DE PARTIDA ERA UM ENGANO, E ELE FOI MEDIDO (20/08/2026). A F2.6 nasceu da leitura de
// que "o DAS não trouxe a composição". Abrindo o PDF real da mesma parcela
// (`ExibirDAS-18082026_134133_07_2026.pdf`, ALESSANDRO NIGRO, PARCSN nº 2, parcela 7/19,
// R$ 332,65), a tabela "Composição do Documento de Arrecadação" está lá, completa: seis tributos
// com CÓDIGO DE RECEITA, principal, multa e juros, somando exatamente o total do documento.
//
// O dado nunca faltou. Faltavam duas ligações:
//
//   1. o `pdf-reader` só colhia aquela tabela quando tipava o documento como DARF — e o DAS, que
//      é tipado SIMPLES, caía num `refine_simples` que lia apenas o VALOR TOTAL;
//   2. a via de upload por empresa (`uploadGuideForPortalClient`) engolia a falha do parser num
//      `catch {}` mudo, e gravava `extracted` só com os metadados digitados pelo contador — a
//      assinatura exata da guia de produção: `{tipo, valor, uploadHash, vencimento, competencia,
//      sourceFileName}`.
//
// Estes testes fixam o que acontece DEPOIS das duas ligações: a composição do PDF é PROVA, entra
// pela mesma porta do `TributoParcela`, e a declaração manual volta a ser o que sempre foi — o
// caminho de quando não há documento.

jest.mock("../../../../infrastructure/db/prisma.js", () => {
  const criados = [];
  const tx = {
    mapaContaTributo: { findFirst: jest.fn(async () => null) },
    accountingEntry: {
      create: jest.fn(async ({ data }) => {
        const entry = { id: `e${criados.length + 1}`, ...data, lines: data.lines?.createMany?.data || [] };
        criados.push(entry);
        return entry;
      }),
    },
    guide: {
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async () => ({})),
    },
  };
  return {
    __criados: criados,
    __tx: tx,
    prisma: {
      guide: { findFirst: jest.fn() },
      accountingEntry: { findFirst: jest.fn(async () => null) },
      parcelamento: { findUnique: jest.fn() },
      tributoParcela: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (cb) => cb(tx)),
    },
  };
});

const mockIsMonthClosed = jest.fn(async () => false);
jest.mock("../../fechamentoContabil.js", () => ({ isMonthClosed: (...a) => mockIsMonthClosed(...a) }));

import { prisma, __tx, __criados } from "../../../../infrastructure/db/prisma.js";
import { gerarPagamentoParcelaFromGuide } from "../ParcelamentoV2Service.js";
import { normalizeParcelaDTO } from "../contracts.js";

// ⚠ NÚMEROS TRANSCRITOS DO PDF, não inventados. `pdfplumber` sobre
// `ExibirDAS-18082026_134133_07_2026.pdf` devolve a tabela nesta ordem e com estes valores.
// Σ principal 246,79 · Σ multa 49,35 · Σ juros 36,51 · Σ total 332,65 — os mesmos da linha "Totais".
const COMPOSICAO_DO_DAS = [
  { codigo: "1004", denominacao: "COFINS - SIMPLES NACIONAL", principal: 31.64, multa: 6.33, juros: 4.68, total: 42.65, periodoApuracao: "06/2025" },
  { codigo: "1002", denominacao: "CSLL - SIMPLES NACIONAL", principal: 8.64, multa: 1.73, juros: 1.28, total: 11.65, periodoApuracao: "06/2025" },
  { codigo: "1006", denominacao: "INSS - SIMPLES NACIONAL", principal: 107.10, multa: 21.42, juros: 15.85, total: 144.37, periodoApuracao: "06/2025" },
  { codigo: "1001", denominacao: "IRPJ - SIMPLES NACIONAL", principal: 9.87, multa: 1.97, juros: 1.46, total: 13.30, periodoApuracao: "06/2025" },
  { codigo: "1010", denominacao: "ISS - SIMPLES NACIONAL", principal: 82.67, multa: 16.53, juros: 12.23, total: 111.43, periodoApuracao: "06/2025" },
  { codigo: "1005", denominacao: "PIS - SIMPLES NACIONAL", principal: 6.87, multa: 1.37, juros: 1.01, total: 9.25, periodoApuracao: "06/2025" },
];

const GUIA_BASE = {
  id: "g-upload", parcelamentoId: "parc1", numeroParcela: 7, lancamentoId: null,
  competencia: "2026-07", vencimento: new Date("2026-07-31T00:00:00Z"), valor: 332.65,
};
// O `extracted` DE PRODUÇÃO — sem composição. É o estado que a F2.6 mediu.
const EXTRACTED_SEM_COMPOSICAO = {
  tipo: "SIMPLES", valor: 332.65, uploadHash: "abc", vencimento: "2026-07-31",
  competencia: "2026-07", sourceFileName: "ExibirDAS-18082026_134133_07_2026.pdf",
};
const EXTRACTED_COM_COMPOSICAO = { ...EXTRACTED_SEM_COMPOSICAO, composicao: COMPOSICAO_DO_DAS };

const PARCELAMENTO = {
  id: "parc1", tipo: "PARCSN", kind: "SIMPLES", numParcelas: 19,
  aberturaEntryId: "abertura1", configPagamento: null,
};

const DECLARADA = { principal: 300.15, juros: 22.5, multa: 10, totalConferido: 332.65 };

function guiaCom(extracted, extra = {}) {
  return { ...GUIA_BASE, extracted, ...extra };
}

beforeEach(() => {
  jest.clearAllMocks();
  __criados.length = 0;
  prisma.accountingEntry.findFirst.mockResolvedValue(null);
  prisma.parcelamento.findUnique.mockResolvedValue({ ...PARCELAMENTO });
  prisma.tributoParcela.findMany.mockResolvedValue([]);
  __tx.guide.updateMany.mockResolvedValue({ count: 1 });
  mockIsMonthClosed.mockResolvedValue(false);
});

const baixar = (extra = {}) => gerarPagamentoParcelaFromGuide({
  portalClientId: "p1", guideId: "g-upload",
  dataPagamento: new Date("2026-08-18T00:00:00Z"),
  ...extra,
});

const papeis = () => __criados.map((e) => e.tipoLinha);
const somaPorPapel = (papel) => Math.round(
  __criados.filter((e) => e.tipoLinha === papel).reduce((s, e) => s + Number(e.lines[0].valor), 0) * 100,
) / 100;

describe("a composição do PDF baixa a parcela sozinha", () => {
  it("com `extracted.composicao`, a baixa sai SEM ninguém declarar nada", async () => {
    prisma.guide.findFirst.mockResolvedValue(guiaCom(EXTRACTED_COM_COMPOSICAO));
    const r = await baixar();
    expect(r.ok).toBe(true);
    expect(r.pagamentoId).toBeTruthy();
    // O desfecho da via declarada NÃO aparece — não houve declaração.
    expect(r.composicaoDeclarada).toBeUndefined();
  });

  // A régua: sem a composição, o comportamento medido em produção continua igual.
  it("sem `extracted.composicao`, continua `sem_composicao` — nada mudou para quem não tem o dado", async () => {
    prisma.guide.findFirst.mockResolvedValue(guiaCom(EXTRACTED_SEM_COMPOSICAO));
    const r = await baixar();
    expect(r).toEqual({ skipped: true, reason: "sem_composicao" });
    expect(__criados).toHaveLength(0);
  });
});

// ⚠ A REGRA INEGOCIÁVEL DO DONO: não mudar a FORMA do lançamento contábil.
describe("a forma do lançamento é a MESMA — principal amortiza, juros e multa vão às contas de sempre", () => {
  it("D PARC · D JUROS · D MULTA por tributo / C CAIXA único, com os totais do documento", async () => {
    prisma.guide.findFirst.mockResolvedValue(guiaCom(EXTRACTED_COM_COMPOSICAO));
    await baixar();

    // Seis tributos × três papéis + um crédito de caixa. Mesma forma da via SERPRO, que também
    // devolve UMA linha por tributo (`serproParcelamentoMap` achata `discriminacoesDebito`).
    expect(papeis().filter((p) => p === "CAIXA")).toHaveLength(1);
    expect(papeis()[papeis().length - 1]).toBe("CAIXA");
    expect(new Set(papeis())).toEqual(new Set(["PARC", "JUROS", "MULTA", "CAIXA"]));

    // Os totais são os da linha "Totais" do próprio DAS — conferidos à mão.
    expect(somaPorPapel("PARC")).toBe(246.79);
    expect(somaPorPapel("MULTA")).toBe(49.35);
    expect(somaPorPapel("JUROS")).toBe(36.51);
    expect(somaPorPapel("CAIXA")).toBe(332.65);
  });

  it("o histórico NÃO leva \"(composição declarada)\" — ninguém declarou nada", async () => {
    prisma.guide.findFirst.mockResolvedValue(guiaCom(EXTRACTED_COM_COMPOSICAO));
    await baixar();
    for (const entry of __criados) {
      expect(String(entry.historico)).not.toContain("composição declarada");
    }
  });
});

// ⚠ O SINAL INVERTIDO DA F2.6. Lá, `codigoTributo` NULO em toda linha é o que grava, em SQL e sem
// coluna nova, "esta baixa teve a decomposição declarada". Aqui ele vem PREENCHIDO com o código de
// receita que o documento imprime — e é isso que faz a mesma consulta distinguir as duas origens.
describe("prova × declaração sobrevive no `codigoTributo`", () => {
  it("baixa pelo PDF: toda linha de tributo carrega o código de receita do documento", async () => {
    prisma.guide.findFirst.mockResolvedValue(guiaCom(EXTRACTED_COM_COMPOSICAO));
    await baixar();
    const linhasDeTributo = __criados.filter((e) => e.tipoLinha !== "CAIXA");
    expect(linhasDeTributo.length).toBeGreaterThan(0);
    for (const entry of linhasDeTributo) {
      expect(entry.lines[0].codigoTributo).toMatch(/^\d{4}$/);
    }
    const codigos = new Set(linhasDeTributo.map((e) => e.lines[0].codigoTributo));
    expect(codigos).toEqual(new Set(["1001", "1002", "1004", "1005", "1006", "1010"]));
  });

  it("baixa declarada: `codigoTributo` continua NULO — a distinção não foi apagada", async () => {
    prisma.guide.findFirst.mockResolvedValue(guiaCom(EXTRACTED_SEM_COMPOSICAO));
    await baixar({ composicaoDeclarada: DECLARADA });
    for (const entry of __criados) {
      expect(entry.lines[0].codigoTributo).toBeNull();
    }
  });
});

// ⚠ A ORDEM PROVA → DECLARAÇÃO É A MESMA DE SEMPRE, com uma terceira fonte documental na fila.
describe("a declaração não passa por cima do documento", () => {
  it("com composição no PDF, a declaração é RECUSADA com `composicao_ja_existe`", async () => {
    prisma.guide.findFirst.mockResolvedValue(guiaCom(EXTRACTED_COM_COMPOSICAO));
    const r = await baixar({ composicaoDeclarada: DECLARADA });
    expect(r).toEqual({ skipped: true, reason: "composicao_ja_existe" });
    expect(__criados).toHaveLength(0);
  });

  it("`TributoParcela` (já persistida) continua vencendo a composição do PDF", async () => {
    prisma.guide.findFirst.mockResolvedValue(guiaCom(EXTRACTED_COM_COMPOSICAO));
    prisma.tributoParcela.findMany.mockResolvedValue([
      { codigoTributo: "DAS", nomeTributo: "DAS", principal: 246.79, multa: 49.35, juros: 36.51, total: 332.65 },
    ]);
    await baixar();
    // Uma linha de tributo só (a do banco), não seis.
    expect(papeis()).toEqual(["PARC", "JUROS", "MULTA", "CAIXA"]);
    expect(__criados[0].lines[0].codigoTributo).toBe("DAS");
  });
});

// ⚠ A CONFERÊNCIA CONTRA O TOTAL DA GUIA. É a mesma exigência que a F2.6 faz ao contador
// (`totalConferido`), aplicada ao PARSER: leitura parcial não vira lançamento.
describe("composição que não fecha com o total da guia NÃO é prova", () => {
  const PARCIAL = COMPOSICAO_DO_DAS.slice(0, 3); // 42,65 + 11,65 + 144,37 = 198,67 ≠ 332,65

  it("recusa com `sem_composicao` e NOMEIA o motivo", async () => {
    prisma.guide.findFirst.mockResolvedValue(
      guiaCom({ ...EXTRACTED_SEM_COMPOSICAO, composicao: PARCIAL }),
    );
    const r = await baixar();
    expect(r).toEqual({ skipped: true, reason: "sem_composicao", motivoDocumento: "composicao_nao_confere" });
    expect(__criados).toHaveLength(0);
  });

  it("e o caminho da DECLARAÇÃO continua aberto — é exatamente para isso que ele existe", async () => {
    prisma.guide.findFirst.mockResolvedValue(
      guiaCom({ ...EXTRACTED_SEM_COMPOSICAO, composicao: PARCIAL }),
    );
    const r = await baixar({ composicaoDeclarada: DECLARADA });
    expect(r.ok).toBe(true);
    expect(r.composicaoDeclarada).toEqual({ principal: 300.15, juros: 22.5, multa: 10, total: 332.65 });
  });

  it("guia sem `valor` não tem contra o que conferir — a composição é aceita como está", async () => {
    prisma.guide.findFirst.mockResolvedValue(
      guiaCom(EXTRACTED_COM_COMPOSICAO, { valor: null }),
    );
    const r = await baixar();
    expect(r.ok).toBe(true);
    expect(somaPorPapel("CAIXA")).toBe(332.65);
  });
});

// ⚠ ITEM SEM CÓDIGO NÃO É PROVA DOCUMENTAL — é o formato da DECLARAÇÃO, e deixá-lo entrar por aqui
// faria uma baixa declarada se passar por documental (e travar a declaração real com
// `composicao_ja_existe`).
describe("composição sem código de receita não conta como documento", () => {
  it("cai em `sem_composicao`, não em prova", async () => {
    prisma.guide.findFirst.mockResolvedValue(guiaCom({
      ...EXTRACTED_SEM_COMPOSICAO,
      composicao: [{ principal: 300.15, multa: 10, juros: 22.5, total: 332.65 }],
    }));
    const r = await baixar();
    expect(r).toEqual({ skipped: true, reason: "sem_composicao" });
  });
});

// ⚠ O MESMO CÓDIGO EM COMPETÊNCIAS DIFERENTES — soma, nunca substituição.
//
// Medido na parcela 9/41 do PARCSN nº 2 da ERISANGELA (`ExibirDAS-11082026_105544_08_2026.pdf`,
// R$ 327,50): a composição traz DEZ linhas e apenas SEIS códigos distintos, porque a parcela
// consolida 12/2024 e 05/2025. `TributoParcela` tem `@@unique([guideId, codigoTributo])` e o
// `upsert` roda em laço — sem agregar, a segunda linha de cada código SOBRESCREVIA a primeira em
// silêncio e a composição persistida ficava menor que a parcela.
// -------------------------------------------------------------------------------------------------
// ⚠⚠ O NORMALIZADOR NÃO PODE DERRUBAR OS IDENTIFICADORES DA PARCELA (02/09/2026).
//
// ⚠⚠ ELE DERRUBAVA, E POR DOIS MESES. `mapearParcela` extrai `numeroDas` e `numeroParcelamento` do
// DETPAGTOPARC165 — dado oficial do SERPRO —, e `normalizeParcelaDTO` montava um objeto NOVO sem
// essas duas chaves. Sumiam sem erro nenhum: o mesmo "campo fora do serializador" que este projeto
// já pagou três vezes, agora dentro de uma integração fiscal.
//
// ⚠⚠ O CUSTO NÃO ERA SÓ A LINHA VERMELHA: `serproParcelamentoContract.test.js` é um GATE —
// *"enquanto este teste não passa verde, a flag fica OFF"* —, e ele estava vermelho desde
// 25/06/2026. A suíte reportava "1 failed" e todo mundo lia isso como paisagem.
// -------------------------------------------------------------------------------------------------
describe("⚠⚠ normalizeParcelaDTO PRESERVA os identificadores — eles sumiam em silêncio", () => {
  const { normalizeParcelaDTO: normalizar } = require("../contracts.js");

  it("⚠⚠ `numeroDas` sobrevive à normalização", () => {
    const r = normalizar({ numeroDas: "07181817050461249", tributos: [] });
    expect(r.numeroDas).toBe("07181817050461249");
  });

  it("⚠⚠⚠ e ele é STRING, nunca número — o DAS tem zero à esquerda", () => {
    // `Number("07181817050461249")` come o zero E estoura a precisão de inteiro seguro: o documento
    // sairia diferente do que o SERPRO mandou, e ninguém veria.
    const r = normalizar({ numeroDas: "07181817050461249", tributos: [] });
    expect(typeof r.numeroDas).toBe("string");
    expect(r.numeroDas.startsWith("0")).toBe(true);
  });

  it("⚠ `numeroParcelamento` também sobrevive, e também como string", () => {
    const r = normalizar({ numeroParcelamento: 9102, tributos: [] });
    expect(r.numeroParcelamento).toBe("9102");
  });

  it("⚠ ausente é `null`, e vazio também — nunca `undefined` nem string em branco", () => {
    // ⚠ `undefined` viajaria para um `update` do Prisma como "não mexer", que aqui seria a mentira
    // conveniente: o campo não veio porque o SERPRO não mandou, e isso é uma informação.
    for (const v of [undefined, null, "", "   "]) {
      const r = normalizar({ numeroDas: v, numeroParcelamento: v, tributos: [] });
      expect(r.numeroDas).toBeNull();
      expect(r.numeroParcelamento).toBeNull();
    }
  });

  it("⚠ o resto do DTO não mudou — acrescentar chave é aditivo", () => {
    const r = normalizar({ numeroParcela: "01", anoMesParcela: 201806, tributos: [] });
    expect(r.numeroParcela).toBe(1);
    expect(r.anoMesParcela).toBe("201806");
    expect(r.valorTotal).toBe(0);
  });
});

describe("agregação por código (normalizeParcelaDTO)", () => {
  const COMPOSICAO_ERISANGELA = [
    { codigo: "1001", principal: 0.02, multa: 0, juros: 0, total: 0.02 },
    { codigo: "1002", principal: 0.03, multa: 0, juros: 0, total: 0.03 },
    { codigo: "1004", principal: 0.07, multa: 0.01, juros: 0.01, total: 0.09 },
    { codigo: "1006", principal: 0.25, multa: 0.05, juros: 0.05, total: 0.35 },
    { codigo: "1010", principal: 0.18, multa: 0.03, juros: 0.03, total: 0.24 },
    { codigo: "1001", principal: 47.55, multa: 9.51, juros: 7.65, total: 64.71 },
    { codigo: "1002", principal: 36.50, multa: 7.30, juros: 5.87, total: 49.67 },
    { codigo: "1004", principal: 49.35, multa: 9.87, juros: 7.93, total: 67.15 },
    { codigo: "1005", principal: 10.69, multa: 2.14, juros: 1.72, total: 14.55 },
    { codigo: "1010", principal: 96.03, multa: 19.21, juros: 15.45, total: 130.69 },
  ];

  it("dez linhas viram seis tributos, e NENHUM centavo se perde", () => {
    const parcela = normalizeParcelaDTO({ tributos: COMPOSICAO_ERISANGELA });
    expect(parcela.tributos).toHaveLength(6);
    expect(parcela.valorTotal).toBe(327.50);
    const irpj = parcela.tributos.find((t) => t.codigoTributo === "1001");
    expect(irpj).toMatchObject({ principal: 47.57, multa: 9.51, juros: 7.65, total: 64.73 });
  });

  it("a ordem da primeira aparição é preservada", () => {
    const { tributos } = normalizeParcelaDTO({ tributos: COMPOSICAO_ERISANGELA });
    expect(tributos.map((t) => t.codigoTributo)).toEqual(["1001", "1002", "1004", "1006", "1010", "1005"]);
  });

  it("códigos distintos não são tocados (a via SERPRO continua idêntica)", () => {
    const { tributos } = normalizeParcelaDTO({
      tributos: [
        { codigoTributo: "IRPJ", principal: 17.11, multa: 3.42, juros: 4.51, total: 25.04 },
        { codigoTributo: "CSLL", principal: 17.42, multa: 3.48, juros: 4.59, total: 25.49 },
      ],
    });
    expect(tributos).toHaveLength(2);
    expect(tributos[0].total).toBe(25.04);
  });
});

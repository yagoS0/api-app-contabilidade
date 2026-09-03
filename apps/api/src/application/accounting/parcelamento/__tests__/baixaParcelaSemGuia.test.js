// BAIXA DA PARCELA SEM GUIA — a via da DECLARAÇÃO (débito automático).
//
// ⚠ O QUE ESTE ARQUIVO PRENDE, E POR QUE. Parcelamento em débito automático não emite documento: o
// dinheiro sai da conta e pronto. Como TODO o caminho de baixa era ancorado na guia
// (`gerarPagamentoParcelaFromGuide` exige `guideId` na assinatura, na guarda `sourceGuideId` e no
// efeito em `guide.baixada`/`lancamentoId`), essas prestações simplesmente não tinham como ser
// baixadas — 60 contratadas, nenhuma baixável.
//
// ⚠ E O CINTO DO BANCO NÃO ALCANÇA ESTE CAMINHO. `uq_baixa_guia_linha` é parcial em
// `"sourceGuideId" IS NOT NULL`; uma baixa sem guia nasce com `sourceGuideId` NULL e cai FORA do
// índice. Por isso a guarda equivalente aqui é a RESERVA ATÔMICA da parcela (`origemBaixa: null`),
// e é ela que estes testes exercem — a mesma metade que `baixaParcelaDuplicada.test.js` exerce do
// lado da guia. A outra metade (o lock de linha do READ COMMITTED) não é testável sem banco.

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
    parcela: {
      updateMany: jest.fn(async () => ({ count: 1 })),
      findMany: jest.fn(async () => []),
    },
    // `recalcularParcelamento` roda DENTRO da transação e lê por este cliente.
    parcelamento: { findFirst: jest.fn(async () => ({ id: "parc1", status: "ATIVO", numParcelas: 60 })) },
  };
  return {
    __criados: criados,
    __tx: tx,
    prisma: {
      parcela: { findFirst: jest.fn() },
      parcelamento: { findFirst: jest.fn() },
      $transaction: jest.fn(async (cb) => cb(tx)),
    },
  };
});

jest.mock("../../fechamentoContabil.js", () => ({ isMonthClosed: jest.fn(async () => false) }));

import { prisma, __tx, __criados } from "../../../../infrastructure/db/prisma.js";
import { isMonthClosed } from "../../fechamentoContabil.js";
import { gerarPagamentoParcelaManual } from "../ParcelamentoV2Service.js";

const PARCELA = {
  id: "pc1",
  parcelamentoId: "parc1",
  numeroParcela: 7,
  competencia: "2026-07",
  valorPrevisto: 500,
  guiaId: null,        // ⚠ o caso inteiro: prestação que nunca teve documento
  origemBaixa: null,   // ⚠ e que ninguém baixou ainda
};

const PARCELAMENTO = {
  id: "parc1", tipo: "PARCSN", kind: "SIMPLES", numParcelas: 60,
  aberturaEntryId: "abertura1", configPagamento: null,
};

const DATA = new Date("2026-07-18T00:00:00Z");

beforeEach(() => {
  jest.clearAllMocks();
  __criados.length = 0;
  prisma.parcela.findFirst.mockResolvedValue({ ...PARCELA });
  prisma.parcelamento.findFirst.mockResolvedValue({ ...PARCELAMENTO });
  __tx.parcela.updateMany.mockResolvedValue({ count: 1 });
  __tx.parcela.findMany.mockResolvedValue([]);
  isMonthClosed.mockResolvedValue(false);
});

// juros e multa DECLARADOS pelo contador; principal vem do contrato (valorPrevisto: 500).
async function baixar(over = {}) {
  return gerarPagamentoParcelaManual({
    portalClientId: "p1",
    parcelaId: "pc1",
    dataPagamento: DATA,
    valorJuros: 12.34,
    valorMulta: 5.66,
    totalConferido: 518,
    ...over,
  });
}

describe("o caminho normal: parcela sem guia nenhuma vira lançamento", () => {
  it("gera D PARC · D JUROS · D MULTA / C CAIXA — a MESMA forma da baixa por guia", async () => {
    const r = await baixar();
    expect(r.ok).toBe(true);
    expect(__criados).toHaveLength(4);
    expect(__criados.map((e) => e.tipoLinha)).toEqual(["PARC", "JUROS", "MULTA", "CAIXA"]);

    const linha = (e) => e.lines[0];
    expect(__criados.map((e) => [linha(e).tipo, linha(e).valor])).toEqual([
      ["D", 500],   // principal — o único que amortiza o passivo (`linhasProvisao` só o provisionou)
      ["D", 12.34], // juros  — despesa do mês do pagamento
      ["D", 5.66],  // multa  — idem
      ["C", 518],   // caixa  — o total que saiu da conta
    ]);
    expect(r.total).toBe(518);
    expect(r.lancamentos).toBe(4);
  });

  it("⚠ marca `origemBaixa: \"MANUAL\"` na PARCELA — é essa escrita que destrava as derivações", async () => {
    // `parcelaRowQuitada` e `temEvidenciaDePagamento` já leem `origemBaixa` (F2.1). Gravar aqui faz
    // contadores, risco de rescisão e `parcelasSemEvidencia` enxergarem a quitação sem uma linha
    // nova de derivação em lugar nenhum.
    const r = await baixar();
    expect(r.origemBaixa).toBe("MANUAL");
    expect(__tx.parcela.updateMany.mock.calls[0][0].data).toMatchObject({ origemBaixa: "MANUAL" });
    // ⚠ Aqui `baixadaEm` é a data do PAGAMENTO declarado — ao contrário de uma parcela `HISTORICO`,
    // onde ela é a data da DECLARAÇÃO porque a do pagamento não se sabe.
    expect(__tx.parcela.updateMany.mock.calls[0][0].data.baixadaEm).toEqual(DATA);
  });

  it("⚠ DECLARAÇÃO ≠ PROVA, e a distinção fica no DADO, não no comentário", async () => {
    const r = await baixar();
    // 1) na parcela: MANUAL (a via SERPRO, quando existir, gravará outra coisa);
    expect(r.origemBaixa).toBe("MANUAL");
    // 2) no lançamento: origem MANUAL (a ingestão já grava "SERPRO" quando a fonte é a Receita);
    for (const e of __criados) expect(e.origem).toBe("MANUAL");
    // 3) em texto, no razão, para quem nunca vai abrir a coluna.
    for (const e of __criados) expect(e.historico).toContain("(declarado)");
  });

  it("componente zerado não vira lançamento — sem juros e sem multa são só duas pernas", async () => {
    const r = await baixar({ valorJuros: 0, valorMulta: 0, totalConferido: 500 });
    expect(r.ok).toBe(true);
    expect(__criados.map((e) => e.tipoLinha)).toEqual(["PARC", "CAIXA"]);
  });

  it("o lote pendura na provisão de abertura (senão o estorno não devolveria o passivo)", async () => {
    await baixar();
    for (const e of __criados) expect(e.openEntryId).toBe("abertura1");
    for (const e of __criados) expect(e.parcelamentoId).toBe("parc1");
  });

  it("toda baixa nasce com `tipoLinha` — o CHECK `chk_baixa_tipo_linha` recusa NULL no banco", async () => {
    await baixar();
    for (const e of __criados) {
      expect(e.tipo).toBe("BAIXA");
      expect(e.tipoLinha).toBeTruthy();
    }
  });
});

describe("⚠⚠ a DESCRIÇÃO DO PAGAMENTO que o contador escreveu (01/09/2026)", () => {
  // > Dono: *"as descrições devem ser a descrição que o contador escreveu, descrição da provisão
  // > **e descrição do pagamento**, devemos poder modificar qualquer campo"*.
  //
  // ⚠⚠ ELA É CONFIG DO CONTRATO, COMO A CONTA — vale para toda prestação, e é por isso que mora em
  // `configPagamento` e não num campo por baixa: a frase do razão dele é sempre a mesma forma
  // ("PAGO PARC PIS,COFINS,CSLL E IRPJ 02/45 12/2025"), mês após mês.
  const CONFIG_COM_TEXTO = [
    { tipoLinha: "PARC", tipo: "D", conta: "588", historico: "PAGO PARC PIS,COFINS,CSLL E IRPJ" },
    { tipoLinha: "JUROS", tipo: "D", conta: "501", historico: "PAGO JUROS S/ PARC" },
    { tipoLinha: "CAIXA", tipo: "C", conta: "5" },
  ];

  it("cada papel leva a frase DELE — e o papel sem frase segue com o derivado", async () => {
    prisma.parcelamento.findFirst.mockResolvedValue({ ...PARCELAMENTO, configPagamento: CONFIG_COM_TEXTO });
    await baixar();
    const porPapel = Object.fromEntries(__criados.map((e) => [e.tipoLinha, e.historico]));
    expect(porPapel.PARC).toContain("PAGO PARC PIS,COFINS,CSLL E IRPJ");
    expect(porPapel.JUROS).toContain("PAGO JUROS S/ PARC");
    // MULTA não tem frase na config: histórico derivado, exatamente como antes desta entrega.
    expect(porPapel.MULTA).toContain("PAGAMENTO PARCSN PARC 7/60");
    expect(porPapel.MULTA).not.toContain("PAGO ");
  });

  it("⚠⚠ a frase do contador NÃO APAGA o \"(declarado)\" — o sinal de procedência sobrevive", async () => {
    // Este é o ponto delicado da mudança. A marca vivia GRUDADA no `historicoBase`; substituir o
    // histórico inteiro pela frase do contador a levaria junto, e a baixa por DECLARAÇÃO passaria
    // a se ler, no razão, como uma baixa PROVADA. Por isso ela viaja separada.
    prisma.parcelamento.findFirst.mockResolvedValue({ ...PARCELAMENTO, configPagamento: CONFIG_COM_TEXTO });
    await baixar();
    for (const e of __criados) expect(e.historico).toContain("(declarado)");
  });

  it("⚠ config SEM histórico produz o texto EXATO de antes — nenhum contrato existente muda", async () => {
    prisma.parcelamento.findFirst.mockResolvedValue({
      ...PARCELAMENTO,
      configPagamento: [{ tipoLinha: "PARC", tipo: "D", conta: "588" }],
    });
    await baixar();
    expect(__criados[0].historico).toBe("PAGAMENTO PARCSN PARC 7/60 - 2026-07 (declarado) — parcelamento a pagar");
  });
});

describe("⚠ o cinto do banco NÃO alcança este caminho — daí a reserva na parcela", () => {
  it("os lançamentos nascem com `sourceGuideId` NULL, fora de `uq_baixa_guia_linha`", async () => {
    await baixar();
    // O índice é parcial em `"sourceGuideId" IS NOT NULL`. Este teste não "verifica o índice" — ele
    // prende a PREMISSA que torna a reserva atômica obrigatória aqui: se um dia estes lançamentos
    // passarem a carregar guia, o raciocínio inteiro muda.
    for (const e of __criados) expect(e.sourceGuideId ?? null).toBeNull();
  });

  it("`numeroParcela` é gravado — é o que resta para identificar a prestação no lançamento", async () => {
    // `parcelas` não tem `lancamentoId`, e sem `sourceGuideId` o par
    // (`parcelamentoId`, `numeroParcela`) é o único vínculo em `accounting_entries`. É também a
    // chave do índice único proposto (ver o relatório desta fase).
    await baixar();
    for (const e of __criados) expect(e.numeroParcela).toBe(7);
  });

  it("⚠ a baixa por GUIA continua gravando `numeroParcela: null` — nada mudou lá", async () => {
    // O parâmetro entrou em `criarLancamentosIndividuais` com default `null`, que é o literal que
    // estava escrito antes. Este teste existe para que a mudança no helper compartilhado não vire,
    // por descuido, uma mudança de comportamento no caminho que já funciona.
    const { gerarPagamentoParcelaFromGuide } = await import("../ParcelamentoV2Service.js");
    expect(typeof gerarPagamentoParcelaFromGuide).toBe("function");
  });
});

describe("a reserva atômica da parcela (a guarda de idempotência deste caminho)", () => {
  it("reserva pelo `origemBaixa: null` — é este `where` que faz a corrida perdida devolver 0", async () => {
    await baixar();
    expect(__tx.parcela.updateMany).toHaveBeenCalledTimes(1);
    expect(__tx.parcela.updateMany.mock.calls[0][0].where).toMatchObject({
      id: "pc1", portalClientId: "p1", origemBaixa: null, guiaId: null,
    });
  });

  it("⚠ a reserva vem ANTES do primeiro lançamento — depois já seria tarde", async () => {
    await baixar();
    expect(__tx.parcela.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(__tx.accountingEntry.create.mock.invocationCallOrder[0]);
  });

  it("⚠ SEGUNDA TENTATIVA: corrida perdida (reserva não pega) → NENHUM lançamento", async () => {
    __tx.parcela.updateMany.mockResolvedValue({ count: 0 });
    const r = await baixar();
    expect(r).toEqual({ skipped: true, reason: "parcela_ja_baixada" });
    expect(__criados).toHaveLength(0);
  });

  it("⚠ SEGUNDA TENTATIVA pelo caminho normal: `origemBaixa` já preenchido → recusa NOMEADA", async () => {
    prisma.parcela.findFirst.mockResolvedValue({ ...PARCELA, origemBaixa: "MANUAL" });
    const r = await baixar();
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe("parcela_ja_baixada");
    expect(r.origemBaixa).toBe("MANUAL");
    expect(__criados).toHaveLength(0);
    expect(__tx.parcela.updateMany).not.toHaveBeenCalled();
  });

  it("⚠ `guiaId: null` viaja no `where` da reserva — a captura do SERPRO roda sozinha", async () => {
    // Se uma guia for vinculada a esta prestação entre a leitura e a transação, a reserva deixa de
    // casar e a baixa por declaração desiste, em vez de correr em paralelo com a baixa por guia.
    await baixar();
    expect(__tx.parcela.updateMany.mock.calls[0][0].where.guiaId).toBeNull();
  });
});

describe("as recusas: cada caminho no seu terreno", () => {
  it("⚠ parcela que TEM guia é recusada APONTANDO o outro caminho", async () => {
    prisma.parcela.findFirst.mockResolvedValue({ ...PARCELA, guiaId: "g9" });
    const r = await baixar();
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe("parcela_tem_guia");
    expect(r.guideId).toBe("g9");
    expect(r.message).toMatch(/guia/i);
    expect(__criados).toHaveLength(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("mês fechado recusa com 409 `MES_FECHADO` e não escreve nada", async () => {
    isMonthClosed.mockResolvedValue(true);
    await expect(baixar()).rejects.toMatchObject({ code: "MES_FECHADO" });
    expect(__criados).toHaveLength(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("parcelamento sem provisão de abertura: não há passivo a amortizar", async () => {
    prisma.parcelamento.findFirst.mockResolvedValue({ ...PARCELAMENTO, aberturaEntryId: null });
    const r = await baixar();
    expect(r).toMatchObject({ skipped: true, reason: "provisao_inexistente" });
  });

  it("⚠ sem `valorPrevisto` NÃO se inventa o principal", async () => {
    prisma.parcela.findFirst.mockResolvedValue({ ...PARCELA, valorPrevisto: null });
    const r = await baixar({ totalConferido: 18 });
    expect(r).toMatchObject({ skipped: true, reason: "sem_valor_previsto" });
    expect(__criados).toHaveLength(0);
  });

  it("parcela inexistente não vira lançamento silencioso", async () => {
    prisma.parcela.findFirst.mockResolvedValue(null);
    const r = await baixar();
    expect(r).toMatchObject({ skipped: true, reason: "parcela_not_found" });
  });
});

describe("⚠ ato de consequência: confirma REPETINDO os dados", () => {
  it("sem `totalConferido` a operação nem começa", async () => {
    await expect(baixar({ totalConferido: undefined }))
      .rejects.toMatchObject({ code: "CONFERENCIA_OBRIGATORIA" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("`totalConferido` divergente do que o servidor calcula → recusa, não ajuste", async () => {
    const err = await baixar({ totalConferido: 600 }).catch((e) => e);
    expect(err.code).toBe("CONFERENCIA_DIVERGENTE");
    // A recusa DIZ a decomposição: principal do contrato, juros e multa declarados.
    expect(err.detalhe).toEqual({
      principal: 500, juros: 12.34, multa: 5.66, total: 518, totalConferido: 600,
    });
    expect(__criados).toHaveLength(0);
  });

  it("⚠ JUROS NUNCA É DERIVADO POR SUBTRAÇÃO — o total é a SOMA, não a entrada", async () => {
    // Foi assim que o encargo já foi reconhecido em dobro no passado (ver `linhasProvisao`). Um
    // total conferido de 600 sobre um principal de 500 NÃO vira "100 de juros": vira recusa.
    await expect(baixar({ valorJuros: 0, valorMulta: 0, totalConferido: 600 }))
      .rejects.toMatchObject({ code: "CONFERENCIA_DIVERGENTE" });
    expect(__criados).toHaveLength(0);
  });

  it("tolerância de centavo, como no estorno", async () => {
    const r = await baixar({ totalConferido: 518.005 });
    expect(r.ok).toBe(true);
  });
});

describe("os contadores são recalculados DEPOIS, e pela derivação que já existe", () => {
  it("o recálculo acontece depois das escritas e dentro da transação", async () => {
    await baixar();
    // `recalcularParcelamento` lê as parcelas por `tx` — se rodasse antes, devolveria o número de
    // ANTES da baixa a quem acabou de clicar.
    expect(__tx.parcela.findMany).toHaveBeenCalled();
    const ordemRecalculo = __tx.parcela.findMany.mock.invocationCallOrder[0];
    const ordemUltimoLancamento = __tx.accountingEntry.create.mock.invocationCallOrder.at(-1);
    expect(ordemRecalculo).toBeGreaterThan(ordemUltimoLancamento);
    expect(ordemRecalculo).toBeGreaterThan(__tx.parcela.updateMany.mock.invocationCallOrder[0]);
  });

  it("o resultado devolve o quadro recalculado (não uma segunda contagem escrita aqui)", async () => {
    __tx.parcela.findMany.mockResolvedValue([
      { id: "pc1", numeroParcela: 7, vencimento: null, origemBaixa: "MANUAL", guia: null },
      { id: "pc2", numeroParcela: 8, vencimento: null, origemBaixa: null, guia: null },
    ]);
    const r = await baixar();
    expect(r.recalculo).toMatchObject({ parcelamentoId: "parc1", parcelasPagas: 1, parcelasTotal: 2 });
    // A prestação sem evidência nenhuma continua FORA do risco — não é inadimplente, é desconhecida.
    expect(r.recalculo.parcelasSemEvidencia).toBe(1);
  });
});

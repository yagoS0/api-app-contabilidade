// F2.6 — A PARCELA QUE TEM GUIA E NÃO TEM COMPOSIÇÃO: o vão entre as duas telas.
//
// ⚠ O CASO É REAL E FOI MEDIDO EM PRODUÇÃO (20/08/2026). ALESSANDRO NIGRO LTDA, PARCSN nº 2,
// competência 2026-07, R$ 332,65, guia `PAID` vinda de UPLOAD
// (`ExibirDAS-18082026_134133_07_2026.pdf`). `TributoParcela` para aquela guia: ZERO. O `extracted`
// da guia tem só `{tipo, valor, uploadHash, vencimento, competencia, sourceFileName}` — nenhum
// `principal`, `multa`, `juros` ou `composicao`. Não é isolado: a parcela de 2026-08 da mesma
// empresa e a de outra empresa estão no mesmo estado.
//
// ⚠ O VÃO. `gerarPagamentoParcelaFromGuide` recusava com `sem_composicao`; a baixa por DECLARAÇÃO
// (`gerarPagamentoParcelaManual`) recusa toda prestação que TEM guia (`parcela_tem_guia`), e essa
// recusa é deliberada — as guardas de idempotência das duas vias são diferentes e nenhuma enxerga a
// outra. Resultado: não havia caminho nenhum, e o contrato inteiro ficava não baixável.
//
// O que estes testes fixam é a saída E as travas que não podem cair junto com ela.

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

// ⚠ O prefixo `mock` no nome é EXIGÊNCIA do jest: a fábrica de `jest.mock` não pode referenciar
// variável de fora do escopo, exceto as que começam com `mock`.
const mockIsMonthClosed = jest.fn(async () => false);
jest.mock("../../fechamentoContabil.js", () => ({ isMonthClosed: (...a) => mockIsMonthClosed(...a) }));

import { prisma, __tx, __criados } from "../../../../infrastructure/db/prisma.js";
import { gerarPagamentoParcelaFromGuide } from "../ParcelamentoV2Service.js";

// A guia do dono: parcela 2, competência 2026-07, R$ 332,65, paga, por upload.
const GUIA = {
  id: "g-upload", parcelamentoId: "parc1", numeroParcela: 2, lancamentoId: null,
  competencia: "2026-07", vencimento: new Date("2026-07-20T00:00:00Z"),
};
const PARCELAMENTO = {
  id: "parc1", tipo: "PARCSN", kind: "SIMPLES", numParcelas: 60,
  aberturaEntryId: "abertura1", configPagamento: null,
};

// A composição que o contador LÊ NO DAS e declara. Soma exatamente o valor da guia.
const DECLARADA = { principal: 300.15, juros: 22.5, multa: 10, totalConferido: 332.65 };

beforeEach(() => {
  jest.clearAllMocks();
  __criados.length = 0;
  prisma.guide.findFirst.mockResolvedValue({ ...GUIA });
  prisma.accountingEntry.findFirst.mockResolvedValue(null);
  prisma.parcelamento.findUnique.mockResolvedValue({ ...PARCELAMENTO });
  // ⚠ ZERO — é o estado medido. Toda a fase existe por causa deste array vazio.
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
const porPapel = (papel) => __criados.find((e) => e.tipoLinha === papel);

describe("o vão: parcela com guia e sem composição", () => {
  // A régua da fase. Sem a declaração, nada mudou — e é isso que o dono via.
  it("sem composição declarada, continua recusando com `sem_composicao` (e nada é lançado)", async () => {
    const r = await baixar();
    expect(r).toEqual({ skipped: true, reason: "sem_composicao" });
    expect(__criados).toHaveLength(0);
    expect(__tx.guide.updateMany).not.toHaveBeenCalled();
  });

  it("COM a composição declarada, a baixa sai — é a saída que não existia", async () => {
    const r = await baixar({ composicaoDeclarada: DECLARADA });
    expect(r.ok).toBe(true);
    expect(r.pagamentoId).toBeTruthy();
    expect(r.composicaoDeclarada).toEqual({ principal: 300.15, juros: 22.5, multa: 10, total: 332.65 });
  });
});

// ⚠ TRAVA 3 — A FORMA DO LANÇAMENTO NÃO MUDA. Regra escrita do dono: não mudar a forma dos
// lançamentos contábeis sem pedido explícito. Principal amortiza a provisão (`D PARC`); juros e
// multa vão para as contas que `linhasPagamento` já define; o total credita o caixa.
describe("a forma do lançamento é a MESMA da baixa por documento", () => {
  it("D PARC · D JUROS · D MULTA / C CAIXA — nem conta nova, nem componente colapsado", async () => {
    await baixar({ composicaoDeclarada: DECLARADA });
    expect(papeis()).toEqual(["PARC", "JUROS", "MULTA", "CAIXA"]);
    expect(porPapel("PARC").lines[0]).toMatchObject({ tipo: "D", valor: 300.15 });
    expect(porPapel("JUROS").lines[0]).toMatchObject({ tipo: "D", valor: 22.5 });
    expect(porPapel("MULTA").lines[0]).toMatchObject({ tipo: "D", valor: 10 });
    expect(porPapel("CAIXA").lines[0]).toMatchObject({ tipo: "C", valor: 332.65 });
  });

  it("componente zerado NÃO vira lançamento — igual ao caminho do documento", async () => {
    await baixar({ composicaoDeclarada: { principal: 332.65, juros: 0, multa: 0, totalConferido: 332.65 } });
    expect(papeis()).toEqual(["PARC", "CAIXA"]);
  });

  it("o lote continua amarrado à provisão de abertura e à guia", async () => {
    await baixar({ composicaoDeclarada: DECLARADA });
    for (const e of __criados) {
      expect(e.openEntryId).toBe("abertura1");
      expect(e.sourceGuideId).toBe("g-upload");
      expect(e.tipo).toBe("BAIXA");
      expect(e.subtipo).toBe("PARC_PARCSN");
      expect(e.statusPagamento).toBe("PAGO");
    }
  });

  it("a reserva atômica da guia continua vindo ANTES do primeiro lançamento", async () => {
    await baixar({ composicaoDeclarada: DECLARADA });
    expect(__tx.guide.updateMany.mock.calls[0][0].where).toMatchObject({ id: "g-upload", lancamentoId: null });
    expect(__tx.guide.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(__tx.accountingEntry.create.mock.invocationCallOrder[0]);
  });

  it("corrida perdida: nenhum lançamento, mesmo com composição declarada", async () => {
    __tx.guide.updateMany.mockResolvedValue({ count: 0 });
    const r = await baixar({ composicaoDeclarada: DECLARADA });
    expect(r).toEqual({ skipped: true, reason: "ja_baixada" });
    expect(__criados).toHaveLength(0);
  });
});

// ⚠ TRAVA 2 — DECLARAÇÃO NÃO É PROVA, E A DISTINÇÃO TEM DE SOBREVIVER NO DADO, não no comentário.
describe("declaração × prova: a distinção fica GRAVADA", () => {
  it("o histórico do razão diz que a composição foi declarada", async () => {
    await baixar({ composicaoDeclarada: DECLARADA });
    for (const e of __criados) expect(e.historico).toContain("(composição declarada)");
  });

  it("a baixa por DOCUMENTO não carrega essa marca — senão a distinção não distinguiria nada", async () => {
    prisma.tributoParcela.findMany.mockResolvedValue([
      { codigoTributo: "DAS", nomeTributo: "DAS", principal: 300.15, multa: 10, juros: 22.5, total: 332.65 },
    ]);
    await baixar();
    expect(__criados.length).toBeGreaterThan(0);
    for (const e of __criados) expect(e.historico).not.toContain("declarada");
  });

  it("`origem` continua MANUAL — o nível 2 da distinção, que a via SERPRO vai preencher com SERPRO", async () => {
    await baixar({ composicaoDeclarada: DECLARADA });
    for (const e of __criados) expect(e.origem).toBe("MANUAL");
  });

  // ⚠ O NULO É O SINAL, e é SQL sem DDL: `sourceGuideId IS NOT NULL AND tipoLinha IN
  // ('PARC','JUROS','MULTA') AND codigoTributo IS NULL` é "a decomposição desta baixa foi
  // declarada". Baixa vinda do documento carrega o código/nome do tributo em cada linha.
  it("as linhas nascem SEM `codigoTributo` — não houve documento de onde lê-lo", async () => {
    await baixar({ composicaoDeclarada: DECLARADA });
    for (const e of __criados) {
      expect(e.codigoTributo).toBeNull();
      expect(e.lines[0].codigoTributo).toBeNull();
    }
  });

  it("vindo do documento, o código do tributo VIAJA nas linhas", async () => {
    prisma.tributoParcela.findMany.mockResolvedValue([
      { codigoTributo: "DAS", nomeTributo: "DAS", principal: 300.15, multa: 10, juros: 22.5, total: 332.65 },
    ]);
    await baixar();
    expect(porPapel("PARC").codigoTributo).toBe("DAS");
  });
});

// ⚠ TRAVA 1 — NÃO DERIVAR O ACRÉSCIMO POR SUBTRAÇÃO. É assim que o encargo já foi reconhecido em
// dobro neste projeto. O total é a SOMA, conferida contra o que a tela mostrou.
describe("a conta fecha para frente, e nada é deduzido por subtração", () => {
  it("total conferido divergente é RECUSADO — o servidor não ajusta nada para fechar", async () => {
    await expect(baixar({
      composicaoDeclarada: { principal: 300.15, juros: 22.5, multa: 10, totalConferido: 332.65 + 5 },
    })).rejects.toMatchObject({ code: "CONFERENCIA_DIVERGENTE" });
    expect(__criados).toHaveLength(0);
  });

  it("total conferido ausente é RECUSADO — confirmar sem repetir os dados é confirmar o quê?", async () => {
    await expect(baixar({
      composicaoDeclarada: { principal: 300.15, juros: 22.5, multa: 10 },
    })).rejects.toMatchObject({ code: "CONFERENCIA_OBRIGATORIA" });
    expect(__criados).toHaveLength(0);
  });

  // ⚠ A TENTAÇÃO EXATA QUE A TRAVA PROÍBE: mandar só principal e total, esperando que o servidor
  // deduza `juros = total - principal`. Ele não deduz — ele recusa.
  it("principal + total (sem juros/multa) NÃO vira `juros = total − principal`", async () => {
    await expect(baixar({
      composicaoDeclarada: { principal: 300.15, totalConferido: 332.65 },
    })).rejects.toMatchObject({ code: "CONFERENCIA_DIVERGENTE" });
    expect(__criados).toHaveLength(0);
  });

  it("o valor da guia NÃO é usado para completar a composição", async () => {
    // 100 + 0 + 0 = 100, e a guia vale 332,65. O servidor lança 100 — ele não sabe, nem inventa, o
    // que faltaria para chegar a 332,65. Quem confere o documento é o contador, na tela.
    const r = await baixar({ composicaoDeclarada: { principal: 100, totalConferido: 100 } });
    expect(r.ok).toBe(true);
    expect(porPapel("CAIXA").lines[0].valor).toBe(100);
    expect(papeis()).toEqual(["PARC", "CAIXA"]);
  });

  it("principal ausente ou zero é RECUSADO — ele não se inventa, e vazio não é zero aqui", async () => {
    expect(await baixar({ composicaoDeclarada: { totalConferido: 0 } }))
      .toEqual({ skipped: true, reason: "principal_invalido" });
    expect(await baixar({ composicaoDeclarada: { principal: 0, totalConferido: 0 } }))
      .toEqual({ skipped: true, reason: "principal_invalido" });
    expect(__criados).toHaveLength(0);
  });

  it("juros/multa vazios SÃO zero — parcela paga em dia não tem acréscimo, e isso é o caso comum", async () => {
    const r = await baixar({ composicaoDeclarada: { principal: 332.65, totalConferido: 332.65 } });
    expect(r.ok).toBe(true);
    expect(r.composicaoDeclarada).toEqual({ principal: 332.65, juros: 0, multa: 0, total: 332.65 });
  });

  it("acréscimo negativo é RECUSADO", async () => {
    expect(await baixar({ composicaoDeclarada: { principal: 300, juros: -1, totalConferido: 299 } }))
      .toEqual({ skipped: true, reason: "acrescimo_negativo" });
    expect(__criados).toHaveLength(0);
  });
});

// ⚠ A ORDEM PROVA → DECLARAÇÃO. É a mesma de `buildDTOsFromManual`: documento vence o que foi
// digitado. Aceitar a declaração por cima criaria a segunda fonte para um número que já tem uma.
describe("o documento vence a declaração", () => {
  it("havendo `TributoParcela`, a declaração é RECUSADA em vez de sobrescrever", async () => {
    prisma.tributoParcela.findMany.mockResolvedValue([
      { codigoTributo: "DAS", nomeTributo: "DAS", principal: 300.15, multa: 10, juros: 22.5, total: 332.65 },
    ]);
    const r = await baixar({ composicaoDeclarada: { principal: 1, juros: 0, multa: 0, totalConferido: 1 } });
    expect(r).toEqual({ skipped: true, reason: "composicao_ja_existe" });
    expect(__criados).toHaveLength(0);
  });

  it("havendo comprovante classificável, idem", async () => {
    const r = await baixar({
      classificacaoComprovante: { classificavel: true, tipo: "PARCELA_PARCELAMENTO", linhas: [] },
      composicaoDeclarada: { principal: 1, juros: 0, multa: 0, totalConferido: 1 },
    });
    expect(r).toEqual({ skipped: true, reason: "composicao_ja_existe" });
    expect(__criados).toHaveLength(0);
  });

  // ⚠ A recusa do documento vem ANTES da conferência da conta: dizer "seu total não bate" quando o
  // problema é que o comprovante chegou mandaria o contador conferir o DAS à toa.
  it("com documento presente, uma declaração mal somada devolve `composicao_ja_existe`, não divergência", async () => {
    prisma.tributoParcela.findMany.mockResolvedValue([
      { codigoTributo: "DAS", nomeTributo: "DAS", principal: 300.15, multa: 10, juros: 22.5, total: 332.65 },
    ]);
    const r = await baixar({ composicaoDeclarada: { principal: 10, juros: 0, multa: 0, totalConferido: 999 } });
    expect(r).toEqual({ skipped: true, reason: "composicao_ja_existe" });
  });
});

// ⚠ TRAVA 5 — MÊS FECHADO BLOQUEIA A BAIXA, e ela fica. A composição declarada não é uma porta
// lateral para gravar em competência fechada.
describe("mês fechado continua bloqueando", () => {
  it("recusa com MES_FECHADO e não lança nada", async () => {
    mockIsMonthClosed.mockResolvedValue(true);
    await expect(baixar({ composicaoDeclarada: DECLARADA }))
      .rejects.toMatchObject({ code: "MES_FECHADO" });
    expect(__criados).toHaveLength(0);
    expect(__tx.guide.updateMany).not.toHaveBeenCalled();
  });
});

// ⚠ AS GUARDAS ANTERIORES CONTINUAM VALENDO — a declaração não é um atalho por cima delas.
describe("as pré-condições da baixa não foram afrouxadas", () => {
  it("sem provisão de abertura, não há passivo a amortizar", async () => {
    prisma.parcelamento.findUnique.mockResolvedValue({ ...PARCELAMENTO, aberturaEntryId: null });
    expect(await baixar({ composicaoDeclarada: DECLARADA }))
      .toEqual({ skipped: true, reason: "provisao_inexistente" });
  });

  it("guia já baixada", async () => {
    prisma.guide.findFirst.mockResolvedValue({ ...GUIA, lancamentoId: "e0" });
    expect(await baixar({ composicaoDeclarada: DECLARADA }))
      .toEqual({ skipped: true, reason: "ja_baixada" });
  });

  it("guia que não é parcela", async () => {
    prisma.guide.findFirst.mockResolvedValue({ ...GUIA, parcelamentoId: null });
    expect(await baixar({ composicaoDeclarada: DECLARADA }))
      .toEqual({ skipped: true, reason: "nao_e_parcela" });
  });
});

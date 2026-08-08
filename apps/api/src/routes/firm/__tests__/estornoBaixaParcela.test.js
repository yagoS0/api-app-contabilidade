// ESTORNO DA BAIXA — a transição administrativa nomeada.
//
// ⚠ ESTE ARQUIVO MUDOU DE ASSUNTO, E O MOTIVO É O ASSUNTO. Ele cobria o estorno como EFEITO do
// `DELETE /entries/:entryId`: apagar o lançamento de baixa reabria a guia e devolvia a parcela à
// fila. O comportamento estava certo — e é o mesmo que continua sendo exigido aqui —, mas a forma
// deixava três coisas de fora:
//
//   · NÃO HAVIA MOTIVO. Desfazer uma baixa confirmada é o tipo de operação que alguém questiona
//     meses depois, e a resposta disponível era "alguém apagou".
//   · EM MÊS FECHADO NÃO HAVIA SAÍDA. O DELETE respondia 409 (corretamente), e o contador ficava
//     sem nenhum caminho legítimo para corrigir uma baixa errada de competência já encerrada.
//   · O ESTADO DA PARCELA pulava a máquina de estados por dentro de um `if`.
//
// O que se testa aqui, então: que o estorno em mês fechado NÃO DELETA e gera contra-lançamento na
// competência aberta; que motivo ausente é recusado; que a guia só reabre quando não sobra baixa; e
// que o recálculo do risco de rescisão é disparado.

jest.mock("../../../middlewares/requireFirmCompanyAccess.js", () => ({
  requireFirmCompanyAccess: () => (req, res, next) => {
    req.auth = { user: { id: "u1", role: "ACCOUNTANT" } };
    next();
  },
}));

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const tx = {
    accountingEntry: {
      create: jest.fn(async () => ({ id: "espelho1", historico: "ESTORNO x", competencia: "2026-09" })),
      delete: jest.fn(async () => ({})),
      deleteMany: jest.fn(async () => ({ count: 1 })),
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      update: jest.fn(async () => ({})),
    },
    guide: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      update: jest.fn(async (args) => ({ id: "g1", ...args.data })),
    },
    parcelamento: { findFirst: jest.fn(async () => null) },
    estornoBaixa: { create: jest.fn(async () => ({ id: "est1" })) },
  };
  return {
    __tx: tx,
    prisma: {
      accountingEntry: {
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => []),
        delete: jest.fn(async () => ({})),
      },
      guide: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
      parcelamento: { findFirst: jest.fn(async () => null) },
      companyMonthlyCircular: { findFirst: jest.fn(async () => null) },
      $transaction: jest.fn(async (cb) => cb(tx)),
    },
  };
});

jest.mock("../../../application/accounting/fechamentoContabil.js", () => ({
  isMonthClosed: jest.fn(async () => false),
}));

import express from "express";
import request from "supertest";
import { prisma, __tx } from "../../../infrastructure/db/prisma.js";
import { isMonthClosed } from "../../../application/accounting/fechamentoContabil.js";
import { createAccountingEntriesRouter } from "../accountingEntries.js";

const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function makeApp() {
  const app = express();
  app.use(express.json());
  const parent = express.Router();
  parent.use("/companies/:companyId", createAccountingEntriesRouter({ log }));
  app.use("/firm", parent);
  return app;
}

const MOTIVO = "baixa lançada na empresa errada";

// ⚠ SEM FAKE TIMERS. `jest.useFakeTimers()` congela os timers que o supertest usa para abrir e
// fechar o socket, e a suíte trava sem erro nenhum. A competência de hoje é DERIVADA aqui pela
// mesma regra do serviço (UTC, YYYY-MM) — o que se afirma é "a de hoje", não uma data literal.
const COMP_HOJE = (() => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
})();
// A competência da baixa é anterior e fixa; nenhum mês corrente pode coincidir com ela.
const COMP_BAIXA = "2020-07";

// A baixa de uma parcela: os DOIS vínculos na mesma linha (`openEntryId` = provisão de abertura do
// parcelamento, `sourceGuideId` = a guia da parcela).
const BAIXA_DE_PARCELA = {
  id: "b1",
  portalClientId: "p1",
  tipo: "BAIXA",
  status: "RASCUNHO",
  competencia: COMP_BAIXA,
  data: new Date("2020-07-15T00:00:00Z"),
  historico: "PAGAMENTO PARCSN PARC 3/60 - 2020-07 — parcelamento",
  subtipo: "PARC_PARCSN",
  origem: "MANUAL",
  eventType: null,
  openEntryId: "abertura1",
  sourceGuideId: "g1",
  parcelamentoId: "parc1",
  loteImportacao: "PARCV2-abcdef12-PAG-3",
  tipoLinha: "PARC",
  codigoTributo: "DAS",
  lines: [{ conta: "553", tipo: "D", valor: 392.58, ordem: 0, tipoLinha: "PARC", codigoTributo: "DAS" }],
};

const GUIA_DA_PARCELA = {
  id: "g1",
  paymentStatusSource: "MANUAL",
  paymentStatus: "PAID",
  lancamentoId: "b1",
  parcelamentoId: "parc1",
  numeroParcela: 3,
  parcelaEstado: "PAGA_A_CONFERIR",
  vencimento: new Date("2026-07-20T00:00:00Z"),
  valor: 392.58,
  tipo: "SIMPLES",
  competencia: COMP_BAIXA,
  baixada: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  isMonthClosed.mockResolvedValue(false);
  prisma.accountingEntry.findFirst.mockResolvedValue({ ...BAIXA_DE_PARCELA });
  prisma.accountingEntry.findMany.mockResolvedValue([{ ...BAIXA_DE_PARCELA }]); // o lote = só ela
  prisma.guide.findFirst.mockResolvedValue({ ...GUIA_DA_PARCELA });
  prisma.parcelamento.findFirst.mockResolvedValue({ id: "parc1", status: "ATIVO", numParcelas: 60 });
  prisma.guide.findMany.mockResolvedValue([{ ...GUIA_DA_PARCELA }]);
  // ⚠ DUAS CONSULTAS DIFERENTES caem no mesmo mock, e confundi-las esconde o teste:
  //   `id: { in: ids }`    → a RELEITURA do lote dentro da transação;
  //   `id: { notIn: ids }` → as baixas RESTANTES da guia (é ela que decide se a guia reabre).
  __tx.accountingEntry.findMany.mockImplementation(async (args) => (
    args?.where?.id?.notIn ? [] : [{ ...BAIXA_DE_PARCELA }]
  ));
  __tx.accountingEntry.findFirst.mockResolvedValue(null);
  __tx.guide.findFirst.mockResolvedValue({ ...GUIA_DA_PARCELA });
  __tx.guide.findMany.mockResolvedValue([{ ...GUIA_DA_PARCELA }]);
  __tx.parcelamento.findFirst.mockResolvedValue({ id: "parc1", status: "ATIVO", numParcelas: 60 });
});

const estornar = (body) => request(makeApp()).post("/firm/companies/p1/entries/b1/estorno").send(body);

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 1. MOTIVO OBRIGATÓRIO
// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("POST /entries/:entryId/estorno — motivo", () => {
  it("⚠ sem motivo, NÃO PASSA — e nada é lido nem escrito antes da recusa", async () => {
    const res = await estornar({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("MOTIVO_OBRIGATORIO");
    // A recusa vem ANTES de qualquer leitura: sem motivo a operação não começa.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.accountingEntry.findFirst).not.toHaveBeenCalled();
  });

  it("motivo em branco ou raso é o mesmo que motivo ausente", async () => {
    for (const motivo of ["", "   ", "x", "erro"]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await estornar({ motivo });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("MOTIVO_OBRIGATORIO");
    }
  });

  it("o motivo vai para a auditoria, com quem e quando", async () => {
    await estornar({ motivo: MOTIVO });
    expect(__tx.estornoBaixa.create).toHaveBeenCalledTimes(1);
    expect(__tx.estornoBaixa.create.mock.calls[0][0].data).toMatchObject({
      motivo: MOTIVO,
      estornadoPorUserId: "u1",
      entryIdOriginal: "b1",
      competenciaOriginal: COMP_BAIXA,
      // ⚠ CÓPIA, não referência: no modo DELECAO a linha original não existe mais depois do commit.
      historicoOriginal: BAIXA_DE_PARCELA.historico,
      valorOriginal: 392.58,
    });
  });

  it("⚠ o DELETE antigo não é mais atalho para o estorno — recusa apontando a rota", async () => {
    // Sem isto, a exigência do motivo seria contornável pelo verbo de antes.
    const res = await request(makeApp()).delete("/firm/companies/p1/entries/b1");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("USE_ESTORNO");
    expect(res.body.rota).toContain("/entries/b1/estorno");
    expect(prisma.accountingEntry.delete).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 2. MÊS FECHADO — CONTRA-LANÇAMENTO, NUNCA DELETE
// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("POST /entries/:entryId/estorno — mês fechado", () => {
  // Julho (competência da baixa) FECHADO; setembro (hoje) aberto.
  const fecharSoJulho = () => isMonthClosed.mockImplementation(async (_p, comp) => comp === COMP_BAIXA);

  it("⚠ NÃO DELETA o lançamento de mês fechado", async () => {
    fecharSoJulho();
    const res = await estornar({ motivo: MOTIVO });
    expect(res.status).toBe(200);
    expect(res.body.modo).toBe("CONTRA_LANCAMENTO");
    // É esta linha que impede a trava de mês fechado de virar letra morta por esta porta lateral.
    expect(__tx.accountingEntry.deleteMany).not.toHaveBeenCalled();
    expect(__tx.accountingEntry.delete).not.toHaveBeenCalled();
  });

  it("gera contra-lançamento ESPELHADO na competência ABERTA (a de hoje)", async () => {
    fecharSoJulho();
    await estornar({ motivo: MOTIVO });
    expect(__tx.accountingEntry.create).toHaveBeenCalledTimes(1);
    const data = __tx.accountingEntry.create.mock.calls[0][0].data;
    expect(data.competencia).toBe(COMP_HOJE); // hoje, não a da baixa
    expect(data.estornoDeEntryId).toBe("b1");
    // ⚠ O ESPELHO INVERTE OS LADOS na MESMA conta — o que desfaz um débito em 553 é um crédito em 553.
    expect(data.lines.createMany.data).toEqual([
      expect.objectContaining({ conta: "553", tipo: "C", valor: 392.58 }),
    ]);
  });

  it("⚠ o contra-lançamento NÃO é `tipo:\"BAIXA\"` — era o furo mais provável desta fase", async () => {
    fecharSoJulho();
    await estornar({ motivo: MOTIVO });
    const data = __tx.accountingEntry.create.mock.calls[0][0].data;
    // Como BAIXA ele colidiria com `uq_baixa_guia_linha`: em mês fechado a baixa original CONTINUA
    // na tabela, e o espelho repetiria (sourceGuideId, tipoLinha, codigoTributo) — que é, letra por
    // letra, a assinatura de uma baixa DUPLICADA. E `computeSaldoProvisao` o contaria como MAIS
    // amortização, levando o passivo para o lado errado em dobro.
    expect(data.tipo).toBe("ESTORNO");
    expect(data.sourceGuideId).toBe("g1");     // fica vinculado: as travas são parciais em tipo='BAIXA'
    expect(data.tipoLinha).toBe("PARC");        // o papel é COPIADO, não inventado
    expect(data.codigoTributo).toBe("DAS");
    // O lote do parcelamento só balanceia EM GRUPO; sem `parcelamentoId` o espelho apareceria como
    // lançamento desbalanceado e travaria o fechamento do mês seguinte.
    expect(data.parcelamentoId).toBe("parc1");
    // Só a baixa original carrega o evento — repetir violaria @@unique(portalClientId, competencia,
    // eventType, origem) no segundo estorno do mesmo evento no mesmo mês.
    expect(data.eventType).toBeNull();
  });

  it("⚠ e só ENTÃO a parcela volta à fila — os dois efeitos, na ordem", async () => {
    fecharSoJulho();
    await estornar({ motivo: MOTIVO });
    expect(__tx.guide.update).toHaveBeenCalled();
    expect(__tx.guide.update.mock.calls[0][0].data).toMatchObject({
      baixada: false, dataBaixa: null, lancamentoId: null, parcelaEstado: "ESTORNADA",
    });
  });

  it("⚠ mês CORRENTE também fechado: recusa explícita, nunca escolhe outra competência", async () => {
    isMonthClosed.mockResolvedValue(true);
    const res = await estornar({ motivo: MOTIVO });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("MES_CORRENTE_FECHADO");
    expect(res.body.competencia).toBe(COMP_HOJE);
    // Procurar "alguma competência aberta" seria escolher a data de um fato contábil por conveniência.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("mês ABERTO segue apagando (comportamento histórico, agora com auditoria)", async () => {
    const res = await estornar({ motivo: MOTIVO });
    expect(res.body.modo).toBe("DELECAO");
    expect(__tx.accountingEntry.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["b1"] }, portalClientId: "p1" },
    });
    expect(__tx.accountingEntry.create).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 3. A GUIA SÓ REABRE QUANDO NÃO SOBRA BAIXA
// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("POST /entries/:entryId/estorno — a guia volta à fila", () => {
  it("a parcela vai para ESTORNADA (não para o estado do calendário — o rastro fica)", async () => {
    await estornar({ motivo: MOTIVO });
    const data = __tx.guide.update.mock.calls[0][0].data;
    expect(data.parcelaEstado).toBe("ESTORNADA");
    expect(data).toMatchObject({ baixada: false, lancamentoId: null });
  });

  it("o pagamento MANUAL é desfeito junto; confirmação do SERPRO não", async () => {
    await estornar({ motivo: MOTIVO });
    expect(__tx.guide.update.mock.calls[0][0].data).toMatchObject({ paymentStatus: "OPEN" });

    jest.clearAllMocks();
    prisma.accountingEntry.findFirst.mockResolvedValue({ ...BAIXA_DE_PARCELA });
    prisma.accountingEntry.findMany.mockResolvedValue([{ ...BAIXA_DE_PARCELA }]);
    prisma.guide.findFirst.mockResolvedValue({ ...GUIA_DA_PARCELA, paymentStatusSource: "SERPRO" });
    prisma.guide.findMany.mockResolvedValue([{ ...GUIA_DA_PARCELA }]);
    prisma.parcelamento.findFirst.mockResolvedValue({ id: "parc1", status: "ATIVO", numParcelas: 60 });
    __tx.accountingEntry.findMany.mockImplementation(async (args) => (
      args?.where?.id?.notIn ? [] : [{ ...BAIXA_DE_PARCELA }]
    ));
    __tx.guide.findFirst.mockResolvedValue({ ...GUIA_DA_PARCELA, paymentStatusSource: "SERPRO" });
    __tx.guide.findMany.mockResolvedValue([{ ...GUIA_DA_PARCELA }]);
    __tx.parcelamento.findFirst.mockResolvedValue({ id: "parc1", status: "ATIVO", numParcelas: 60 });
    await estornar({ motivo: MOTIVO });
    // O dinheiro saiu e o comprovante existe: o que se desfaz é o LANÇAMENTO, não o fato.
    expect(__tx.guide.update.mock.calls[0][0].data.paymentStatus).toBeUndefined();
  });

  it("⚠ sobrando baixa fora do lote, a guia NÃO reabre — só o ponteiro é corrigido", async () => {
    // Uma baixa são até três lançamentos; reabrir com um deles ainda no razão deixaria lançamentos
    // órfãos debitando contas de uma guia "não paga" — pior que não reverter.
    __tx.accountingEntry.findMany.mockImplementation(async (args) => {
      if (args?.where?.id?.notIn) return [{ id: "b2" }]; // a busca por baixas RESTANTES
      return [{ ...BAIXA_DE_PARCELA }];                  // a releitura do lote
    });
    await estornar({ motivo: MOTIVO });
    expect(__tx.guide.update).toHaveBeenCalledTimes(1);
    expect(__tx.guide.update.mock.calls[0][0].data).toEqual({ lancamentoId: "b2" });
  });

  it("⚠ o contra-lançamento não conta como baixa restante (senão a guia nunca reabriria)", async () => {
    isMonthClosed.mockImplementation(async (_p, comp) => comp === COMP_BAIXA);
    await estornar({ motivo: MOTIVO });
    const where = __tx.accountingEntry.findMany.mock.calls
      .map((c) => c[0]?.where)
      .find((w) => w?.id?.notIn);
    expect(where.tipo).toBe("BAIXA"); // o espelho é tipo ESTORNO e fica de fora por construção
    expect(__tx.guide.update.mock.calls[0][0].data.baixada).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 4. O RECÁLCULO É DISPARADO
// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("POST /entries/:entryId/estorno — recálculo do risco de rescisão", () => {
  it("⚠ o estorno DEVOLVE o quadro recalculado — não deixa para a próxima abertura de tela", async () => {
    // Três prestações vencidas e não quitadas depois do estorno = a regra da IN RFB 2.063/2022 (I).
    const vencida = (n) => ({
      id: `g${n}`, numeroParcela: n, vencimento: new Date(`2026-0${n}-20T00:00:00Z`),
      paymentStatus: "OPEN", baixada: false,
    });
    __tx.guide.findMany.mockResolvedValue([vencida(4), vencida(5), vencida(6), { ...GUIA_DA_PARCELA, paymentStatus: "OPEN", baixada: false }]);
    const res = await estornar({ motivo: MOTIVO });
    expect(res.status).toBe(200);
    expect(res.body.recalculo).toMatchObject({ parcelasPagas: 0, emAtraso: 4 });
    expect(res.body.recalculo.risco.nivel).toBe("rescindivel");
    // ⚠ A regra vem de `riscoRescisao.js`, com a citação marcada como NÃO conferida na fonte.
    expect(res.body.recalculo.risco.regra.id).toBe("IN_RFB_2063_2022_ART_18");
    expect(res.body.recalculo.risco.regra.citacaoConferida).toBe(false);
  });

  it("o nível de risco fica GRAVADO na auditoria — era o número que justificava a decisão", async () => {
    await estornar({ motivo: MOTIVO });
    const data = __tx.estornoBaixa.create.mock.calls[0][0].data;
    expect(data).toHaveProperty("riscoNivel");
    expect(data).toHaveProperty("riscoEmAtraso");
    expect(data.parcelaEstadoAnterior).toBe("PAGA_A_CONFERIR");
    expect(data.parcelaEstadoNovo).toBe("ESTORNADA");
  });

  it("o recálculo roda DEPOIS das escritas — o número é o do mundo já estornado", async () => {
    const ordem = [];
    __tx.guide.update.mockImplementation(async () => { ordem.push("guia"); return { id: "g1" }; });
    __tx.guide.findMany.mockImplementation(async () => { ordem.push("recalculo"); return [{ ...GUIA_DA_PARCELA }]; });
    await estornar({ motivo: MOTIVO });
    expect(ordem).toEqual(["guia", "recalculo"]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 5. ATO DE CONSEQUÊNCIA: CONFIRMA REPETINDO OS DADOS
// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("GET /entries/:entryId/estorno/preview", () => {
  it("mostra o que será desfeito COM VALORES, e nada é escrito", async () => {
    const res = await request(makeApp()).get("/firm/companies/p1/entries/b1/estorno/preview");
    expect(res.status).toBe(200);
    expect(res.body.modo).toBe("DELECAO");
    expect(res.body.totalEstornado).toBe(392.58);
    expect(res.body.lancamentos[0]).toMatchObject({ id: "b1", valor: 392.58 });
    expect(res.body.guia).toMatchObject({ parcelaEstado: "PAGA_A_CONFERIR", parcelaEstadoAposEstorno: "ESTORNADA" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("em mês fechado, o preview já avisa o modo e a competência do contra-lançamento", async () => {
    isMonthClosed.mockImplementation(async (_p, comp) => comp === COMP_BAIXA);
    const res = await request(makeApp()).get("/firm/companies/p1/entries/b1/estorno/preview");
    expect(res.body.modo).toBe("CONTRA_LANCAMENTO");
    expect(res.body.competenciaContraLancamento).toBe(COMP_HOJE);
  });

  it("⚠ o total conferido tem de bater — a baixa pode ter mudado entre a tela e o clique", async () => {
    const res = await estornar({ motivo: MOTIVO, totalConferido: 300 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("CONFERENCIA_DIVERGENTE");
    expect(res.body.totalEstornado).toBe(392.58);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("batendo, passa", async () => {
    const res = await estornar({ motivo: MOTIVO, totalConferido: 392.58 });
    expect(res.status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 6. O QUE NÃO É ESTORNO
// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("recusas de escopo", () => {
  it("lançamento que não é baixa não se estorna por aqui", async () => {
    prisma.accountingEntry.findFirst.mockResolvedValue({
      ...BAIXA_DE_PARCELA, tipo: "DESPESA", openEntryId: null, sourceGuideId: null,
    });
    const res = await estornar({ motivo: MOTIVO });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("NAO_E_BAIXA");
  });

  it("lançamento já exportado continua recusado", async () => {
    prisma.accountingEntry.findFirst.mockResolvedValue({ ...BAIXA_DE_PARCELA, status: "EXPORTADO" });
    const res = await estornar({ motivo: MOTIVO });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("lancamento_ja_exportado");
  });

  it("⚠ o lote é estornado inteiro ou nenhum: um exportado no meio recusa o conjunto", async () => {
    prisma.accountingEntry.findMany.mockResolvedValue([
      { ...BAIXA_DE_PARCELA },
      { ...BAIXA_DE_PARCELA, id: "b2", status: "EXPORTADO", historico: "… (juros)" },
    ]);
    const res = await estornar({ motivo: MOTIVO });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("LOTE_JA_EXPORTADO");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 7. O DELETE COMUM — a trava de mês fechado vale para TODO lançamento, e é intencional
// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("DELETE /entries/:entryId", () => {
  const DESPESA = {
    id: "x1", portalClientId: "p1", tipo: "DESPESA", status: "RASCUNHO", competencia: COMP_BAIXA,
    openEntryId: null, sourceGuideId: null,
  };

  it("lançamento comum em mês aberto segue apagando direto", async () => {
    prisma.accountingEntry.findFirst.mockResolvedValue(DESPESA);
    const res = await request(makeApp()).delete("/firm/companies/p1/entries/x1");
    expect(res.status).toBe(200);
    expect(prisma.accountingEntry.delete).toHaveBeenCalledWith({ where: { id: "x1" } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("⚠ mês fechado bloqueia o DELETE de QUALQUER tipo — não só de baixa, e é decisão do dono", async () => {
    // "Qualquer DELETE em competência fechada corrompe um saldo que já foi reportado." Restringir
    // esta trava às baixas reabriria, para todos os outros tipos, o buraco que ela fechou.
    isMonthClosed.mockResolvedValue(true);
    prisma.accountingEntry.findFirst.mockResolvedValue(DESPESA);
    const res = await request(makeApp()).delete("/firm/companies/p1/entries/x1");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("MES_FECHADO");
    // A competência é a DO LANÇAMENTO, não a de hoje.
    expect(isMonthClosed).toHaveBeenCalledWith("p1", COMP_BAIXA);
    expect(prisma.accountingEntry.delete).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 8. A PROVISÃO DE ABERTURA VOLTA A TER SALDO — os dois efeitos, não um ou outro
// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("POST /entries/:entryId/estorno — provisão de abertura", () => {
  it("a provisão é recalculada JUNTO com a reabertura da guia", async () => {
    __tx.accountingEntry.findFirst.mockResolvedValue({
      id: "abertura1", tipo: "PROVISAO",
      lines: [{ conta: "553", tipo: "D", valor: 1000, ordem: 0 }],
      baixas: [],
    });
    await estornar({ motivo: MOTIVO });
    expect(__tx.accountingEntry.update).toHaveBeenCalledTimes(1);
    expect(__tx.accountingEntry.update.mock.calls[0][0]).toMatchObject({
      where: { id: "abertura1" }, data: { statusPagamento: "ABERTO" },
    });
    expect(__tx.guide.update).toHaveBeenCalledTimes(1);
  });
});

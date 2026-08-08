// ESTORNO DA BAIXA — apagar o lançamento tem de DEVOLVER A PARCELA À FILA.
//
// ⚠ O defeito: o `DELETE /entries/:entryId` era um `if / else if`. A baixa da parcela nasce com os
// DOIS campos (`ParcelamentoV2Service`: `openEntryId` = a provisão de abertura do parcelamento,
// `sourceGuideId` = a guia da parcela), então ela casava o PRIMEIRO ramo — o do `openEntryId` — e
// nunca chegava ao ramo que reabre a guia.
//
// O estrago era silencioso e permanente: o lançamento sumia, mas a guia continuava `baixada:true`
// com `lancamentoId` apontando para um registro apagado (`Guide.lancamentoId` não tem FK — ninguém
// o anula). A parcela sumia da fila de pendentes de baixa (que exige `baixada:false`) e
// `gerarPagamentoParcelaFromGuide` respondia `ja_baixada` para sempre. Não havia caminho de tela
// que refizesse aquela baixa.
//
// ⚠ E UMA BAIXA TEM ATÉ TRÊS LANÇAMENTOS (principal, juros e multa são separados, em contas
// diferentes). Reabrir a guia ao apagar o primeiro deixaria dois lançamentos órfãos debitando
// contas de uma guia que voltou a "não paga" — pior que não reverter. Por isso a guia só volta
// quando não sobra nenhuma baixa dela.

jest.mock("../../../middlewares/requireFirmCompanyAccess.js", () => ({
  requireFirmCompanyAccess: () => (req, res, next) => {
    req.auth = { user: { id: "u1", role: "ACCOUNTANT" } };
    next();
  },
}));

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const tx = {
    accountingEntry: {
      delete: jest.fn(async () => ({})),
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      update: jest.fn(async () => ({})),
    },
    guide: {
      findFirst: jest.fn(async () => null),
      update: jest.fn(async () => ({})),
    },
  };
  return {
    __tx: tx,
    prisma: {
      accountingEntry: {
        findFirst: jest.fn(async () => null),
        delete: jest.fn(async () => ({})),
      },
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

// A baixa de uma parcela: os DOIS vínculos na mesma linha. É esta forma que o `if / else if` não
// sabia tratar.
const BAIXA_DE_PARCELA = {
  id: "b1",
  portalClientId: "p1",
  tipo: "BAIXA",
  status: "RASCUNHO",
  competencia: "2026-07",
  openEntryId: "abertura1",
  sourceGuideId: "g1",
};

const GUIA_DA_PARCELA = {
  id: "g1",
  paymentStatusSource: "MANUAL",
  lancamentoId: "b1",
  parcelamentoId: "parc1",
  parcelaEstado: "PAGA_A_CONFERIR",
  vencimento: new Date("2026-07-20T00:00:00Z"),
};

beforeEach(() => {
  jest.clearAllMocks();
  isMonthClosed.mockResolvedValue(false);
  prisma.accountingEntry.findFirst.mockResolvedValue({ ...BAIXA_DE_PARCELA });
  __tx.accountingEntry.findFirst.mockResolvedValue(null); // provisão de abertura não encontrada: ok
  __tx.accountingEntry.findMany.mockResolvedValue([]); // nenhuma baixa restante
  __tx.guide.findFirst.mockResolvedValue({ ...GUIA_DA_PARCELA });
});

describe("DELETE /entries/:entryId — baixa de parcela", () => {
  it("⚠ apagar a baixa REABRE a guia (era o ramo que o if/else nunca alcançava)", async () => {
    const res = await request(makeApp()).delete("/firm/companies/p1/entries/b1");
    expect(res.status).toBe(200);
    expect(__tx.guide.update).toHaveBeenCalledTimes(1);
    expect(__tx.guide.update.mock.calls[0][0].data).toMatchObject({
      baixada: false,
      dataBaixa: null,
      lancamentoId: null,
    });
  });

  it("a parcela volta ao estado do calendário — senão fica PAGA_A_CONFERIR sem lançamento", async () => {
    // Vencimento em 20/07/2026, já passado: a parcela estornada volta EM_ATRASO, visível de novo.
    await request(makeApp()).delete("/firm/companies/p1/entries/b1");
    expect(__tx.guide.update.mock.calls[0][0].data.parcelaEstado).toBe("EM_ATRASO");
  });

  it("o pagamento MANUAL é desfeito junto; confirmação do SERPRO não", async () => {
    await request(makeApp()).delete("/firm/companies/p1/entries/b1");
    expect(__tx.guide.update.mock.calls[0][0].data).toMatchObject({ paymentStatus: "OPEN" });

    jest.clearAllMocks();
    prisma.accountingEntry.findFirst.mockResolvedValue({ ...BAIXA_DE_PARCELA });
    __tx.accountingEntry.findMany.mockResolvedValue([]);
    __tx.guide.findFirst.mockResolvedValue({ ...GUIA_DA_PARCELA, paymentStatusSource: "SERPRO" });
    await request(makeApp()).delete("/firm/companies/p1/entries/b1");
    // O dinheiro saiu e o comprovante existe: o que se desfaz é o LANÇAMENTO, não o fato.
    expect(__tx.guide.update.mock.calls[0][0].data.paymentStatus).toBeUndefined();
  });

  it("a provisão de abertura TAMBÉM é recalculada — os dois efeitos, não um ou outro", async () => {
    __tx.accountingEntry.findFirst.mockResolvedValue({
      id: "abertura1", lines: [{ conta: "553", tipo: "C", valor: 1000, ordem: 0 }], baixas: [],
    });
    await request(makeApp()).delete("/firm/companies/p1/entries/b1");
    expect(__tx.accountingEntry.update).toHaveBeenCalledTimes(1);
    expect(__tx.accountingEntry.update.mock.calls[0][0].where).toEqual({ id: "abertura1" });
    expect(__tx.guide.update).toHaveBeenCalledTimes(1);
  });

  it("⚠ sobrando baixa do lote, a guia NÃO reabre — só o ponteiro é corrigido", async () => {
    // Apagou o principal, sobraram juros e multa. Reabrir aqui deixaria dois lançamentos órfãos.
    __tx.accountingEntry.findMany.mockResolvedValue([{ id: "b2" }, { id: "b3" }]);
    await request(makeApp()).delete("/firm/companies/p1/entries/b1");
    expect(__tx.guide.update).toHaveBeenCalledTimes(1);
    expect(__tx.guide.update.mock.calls[0][0].data).toEqual({ lancamentoId: "b2" });
  });

  it("sobrando baixa e o ponteiro apontando para outra, nada é tocado na guia", async () => {
    __tx.accountingEntry.findMany.mockResolvedValue([{ id: "b2" }]);
    __tx.guide.findFirst.mockResolvedValue({ ...GUIA_DA_PARCELA, lancamentoId: "b2" });
    await request(makeApp()).delete("/firm/companies/p1/entries/b1");
    expect(__tx.guide.update).not.toHaveBeenCalled();
  });

  it("⚠ mês fechado bloqueia o estorno (409) — e a competência é a DO LANÇAMENTO", async () => {
    isMonthClosed.mockResolvedValue(true);
    const res = await request(makeApp()).delete("/firm/companies/p1/entries/b1");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("MES_FECHADO");
    expect(isMonthClosed).toHaveBeenCalledWith("p1", "2026-07");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("lançamento já exportado continua recusado antes de tudo", async () => {
    prisma.accountingEntry.findFirst.mockResolvedValue({ ...BAIXA_DE_PARCELA, status: "EXPORTADO" });
    const res = await request(makeApp()).delete("/firm/companies/p1/entries/b1");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("lancamento_ja_exportado");
  });
});

describe("DELETE /entries/:entryId — lançamento comum", () => {
  it("segue apagando direto, sem transação", async () => {
    prisma.accountingEntry.findFirst.mockResolvedValue({
      id: "x1", portalClientId: "p1", tipo: "DESPESA", status: "RASCUNHO", competencia: "2026-07",
      openEntryId: null, sourceGuideId: null,
    });
    const res = await request(makeApp()).delete("/firm/companies/p1/entries/x1");
    expect(res.status).toBe(200);
    expect(prisma.accountingEntry.delete).toHaveBeenCalledWith({ where: { id: "x1" } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("POST /entries/:entryId/baixa — mês fechado", () => {
  const PROVISAO = {
    id: "prov1", portalClientId: "p1", tipo: "PROVISAO", subtipo: "DAS",
    competencia: "2026-06", statusPagamento: "ABERTO",
    // Provisão com principal de 1.000 (o saldo sai das linhas de DÉBITO).
    lines: [
      { conta: "553", tipo: "D", valor: 1000, ordem: 0 },
      { conta: "111", tipo: "C", valor: 1000, ordem: 1 },
    ],
    baixas: [],
  };

  it("⚠ 409 MES_FECHADO — era o único ato contábil sem a trava", async () => {
    prisma.accountingEntry.findFirst.mockResolvedValue(PROVISAO);
    isMonthClosed.mockResolvedValue(true);
    const res = await request(makeApp())
      .post("/firm/companies/p1/entries/prov1/baixa")
      .send({
        data: "2026-07-10",
        historico: "PAGO DAS - 06/2026",
        lines: [
          { conta: "553", tipo: "D", valor: 1000, papel: "PRINCIPAL" },
          { conta: "111", tipo: "C", valor: 1000 },
        ],
      });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("MES_FECHADO");
    // A competência é a da DATA DO PAGAMENTO, não a da provisão — mesma leitura das outras travas.
    expect(isMonthClosed).toHaveBeenCalledWith("p1", "2026-07");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("mês aberto continua passando (a trava não pode virar bloqueio geral)", async () => {
    prisma.accountingEntry.findFirst.mockResolvedValue(PROVISAO);
    isMonthClosed.mockResolvedValue(false);
    const res = await request(makeApp())
      .post("/firm/companies/p1/entries/prov1/baixa")
      .send({
        data: "2026-07-10",
        historico: "PAGO DAS - 06/2026",
        lines: [
          { conta: "553", tipo: "D", valor: 1000, papel: "PRINCIPAL" },
          { conta: "111", tipo: "C", valor: 1000 },
        ],
      });
    expect(res.status).not.toBe(409);
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});

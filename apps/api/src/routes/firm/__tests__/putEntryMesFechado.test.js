// A TRAVA DE MÊS FECHADO NO `PUT /entries/:entryId` — o buraco que sobrou entre o POST e o DELETE.
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// O DEFEITO, REPRODUZIDO NO NAVEGADOR
// ════════════════════════════════════════════════════════════════════════════════════════════
//
// Mês fechado, clique no ✎, R$ 60,00 → R$ 6.000,00: "Lançamento atualizado.", rodapé recalculado.
// Uma competência FECHADA foi alterada **sem nenhum rastro de reabertura** — que é, letra por
// letra, o estrago que a trava do DELETE existe para impedir:
//
//   *"qualquer DELETE em competência fechada corrompe um saldo que já foi reportado"* — dono.
//
// Editar não é mais brando que apagar. Trocar o valor de um lançamento de mês fechado muda o mesmo
// total que alguém já leu, com a vantagem perversa de deixar a linha lá, parecendo intacta.
// `POST /entries` recusava (409), `DELETE /entries/:id` recusava (409, com vinte linhas de
// comentário explicando por quê), e o verbo do meio passava.
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ SÃO DUAS COMPETÊNCIAS, E É POR ISSO QUE O TESTE INSISTE NELAS
// ════════════════════════════════════════════════════════════════════════════════════════════
//
// O PUT **recalcula** a competência a partir de `body.data`. Então há dois caminhos para o mesmo
// estrago, e olhar só um deles deixa o outro aberto:
//
//   · pela competência ATUAL — o lançamento já está no mês fechado; qualquer edição o altera, e
//     mover a data para um mês aberto **TIRA** um lançamento do mês fechado (o total do mês
//     fechado muda para menos);
//   · pela competência NOVA — o lançamento está num mês aberto e a data o **JOGA PARA DENTRO** do
//     mês fechado (o total do mês fechado muda para mais).
//
// Nenhuma das duas é ranhura: são as duas metades de "mover um lançamento entre meses".
//
// ⚠ ISTO ACRESCENTA GUARDA, NUNCA REMOVE. Os dois fluxos legítimos continuam sendo os mesmos do
// DELETE, e nenhum deles é afrouxar a trava: (1) REABRIR a competência — o ato fica gravado em
// `CompanyMonthlyCircular` — e então corrigir; (2) ESTORNAR na competência aberta.

jest.mock("../../../middlewares/requireFirmCompanyAccess.js", () => ({
  requireFirmCompanyAccess: () => (req, res, next) => {
    req.auth = { user: { id: "u1", role: "ACCOUNTANT" } };
    next();
  },
}));

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const tx = {
    accountingEntry: {
      update: jest.fn(async () => ({ id: "e1" })),
      findUnique: jest.fn(async () => ({ id: "e1", tipo: "DESPESA", competencia: "2026-04", lines: [] })),
    },
    accountingEntryLine: {
      createMany: jest.fn(async () => ({ count: 2 })),
      deleteMany: jest.fn(async () => ({ count: 2 })),
    },
  };
  return {
    __tx: tx,
    prisma: {
      chartOfAccount: { findMany: jest.fn(async () => []) },
      accountingEntry: { findFirst: jest.fn(async () => null), delete: jest.fn(async () => ({})) },
      accountingEntryLine: { findMany: jest.fn(async () => []) },
      accountingHistorico: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => ({ id: "h1" })),
        update: jest.fn(async () => ({ id: "h1" })),
      },
      $transaction: jest.fn(async (cb) => cb(tx)),
    },
  };
});

// A trava é a MESMA função dos outros dois verbos — o teste troca a resposta dela, não reimplementa
// a leitura de `CompanyMonthlyCircular.fechadoContabilEm`.
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

const FECHADA = "2026-03";
const ABERTA = "2026-04";

// O lançamento do relato: uma despesa de R$ 60,00 já gravada na competência fechada.
const despesaEmMesFechado = {
  id: "e1",
  portalClientId: "p1",
  competencia: FECHADA,
  data: new Date("2026-03-10T00:00:00.000Z"),
  historico: "Tarifa bancária",
  tipo: "DESPESA",
  subtipo: null,
  origem: "MANUAL",
  status: "RASCUNHO",
  tipoLinha: null,
  parcelamentoId: null,
};

const LINHAS_NOVAS = [
  { conta: "5", tipo: "D", valor: 6000 },
  { conta: "5", tipo: "C", valor: 6000 },
];

// O plano responde que as duas contas existem e são analíticas — para que a recusa medida seja a
// do mês fechado, e não a do plano de contas.
function planoAceitando() {
  prisma.chartOfAccount.findMany.mockResolvedValue([
    { codigo: "5", nome: "CAIXA", codigoCompleto: "111010001", analitica: true, portalClientId: null },
  ]);
}

function fecharApenas(...competencias) {
  const fechadas = new Set(competencias);
  isMonthClosed.mockImplementation(async (_pc, comp) => fechadas.has(comp));
}

beforeEach(() => {
  jest.clearAllMocks();
  planoAceitando();
  fecharApenas(FECHADA);
  prisma.accountingEntry.findFirst.mockResolvedValue(despesaEmMesFechado);
  __tx.accountingEntry.findUnique.mockResolvedValue({
    id: "e1", tipo: "DESPESA", competencia: FECHADA, historico: "Tarifa bancária", lines: [],
  });
});

const put = (body) => request(makeApp()).put("/firm/companies/p1/entries/e1").send(body);

function nadaFoiEscrito() {
  expect(prisma.$transaction).not.toHaveBeenCalled();
  expect(__tx.accountingEntry.update).not.toHaveBeenCalled();
  expect(__tx.accountingEntryLine.deleteMany).not.toHaveBeenCalled();
  expect(__tx.accountingEntryLine.createMany).not.toHaveBeenCalled();
}

describe("o caso reproduzido: editar o VALOR de um lançamento em competência fechada", () => {
  it("recusa com 409 MES_FECHADO nomeando a competência", async () => {
    const res = await put({ historico: "Tarifa bancária", lines: LINHAS_NOVAS });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("MES_FECHADO");
    expect(res.body.competencia).toBe(FECHADA);
  });

  it("NÃO escreve nada — a recusa vem antes da transação, não depois", async () => {
    await put({ historico: "Tarifa bancária", lines: LINHAS_NOVAS });
    nadaFoiEscrito();
  });

  it("a mensagem aponta as duas saídas legítimas (reabrir · estornar), como a do DELETE", async () => {
    const res = await put({ lines: LINHAS_NOVAS });
    expect(res.body.message).toMatch(/reabra/i);
    expect(res.body.message).toMatch(/estorn/i);
  });

  it("recusa mesmo sem `lines` no corpo — trocar só o histórico também altera o mês fechado", async () => {
    const res = await put({ historico: "Tarifa bancária (corrigido)" });
    expect(res.status).toBe(409);
    nadaFoiEscrito();
  });

  it("recusa mesmo sem `data` no corpo — o caminho não é só o da data", async () => {
    const res = await put({ status: "CONFIRMADO" });
    expect(res.status).toBe(409);
  });
});

describe("⚠ O CAMINHO PELA DATA — a competência NOVA é olhada junto com a atual", () => {
  it("JOGAR PARA DENTRO do mês fechado (de aberto para fechado) recusa, apontando a competência NOVA", async () => {
    prisma.accountingEntry.findFirst.mockResolvedValue({ ...despesaEmMesFechado, competencia: ABERTA });
    const res = await put({ data: "2026-03-15", lines: LINHAS_NOVAS });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("MES_FECHADO");
    expect(res.body.competencia).toBe(FECHADA);
    nadaFoiEscrito();
  });

  it("TIRAR do mês fechado (de fechado para aberto) recusa, apontando a competência ATUAL", async () => {
    const res = await put({ data: "2026-04-15", lines: LINHAS_NOVAS });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("MES_FECHADO");
    expect(res.body.competencia).toBe(FECHADA);
    nadaFoiEscrito();
  });

  it("as DUAS competências são perguntadas quando a data muda (só a antiga deixaria entrar)", async () => {
    prisma.accountingEntry.findFirst.mockResolvedValue({ ...despesaEmMesFechado, competencia: ABERTA });
    await put({ data: "2026-03-15", lines: LINHAS_NOVAS });
    const perguntadas = isMonthClosed.mock.calls.map(([, comp]) => comp);
    expect(perguntadas).toEqual(expect.arrayContaining([ABERTA, FECHADA]));
  });
});

describe("⚠ O QUE A TRAVA NÃO PODE ATRAPALHAR — mês aberto continua editável", () => {
  it("edição normal em competência ABERTA responde 200 e grava", async () => {
    fecharApenas(); // nenhuma competência fechada
    prisma.accountingEntry.findFirst.mockResolvedValue({ ...despesaEmMesFechado, competencia: ABERTA });
    __tx.accountingEntry.findUnique.mockResolvedValue({
      id: "e1", tipo: "DESPESA", competencia: ABERTA, historico: "Tarifa bancária",
      lines: [{ conta: "5", tipo: "D", valor: 6000 }, { conta: "5", tipo: "C", valor: 6000 }],
    });
    const res = await put({ historico: "Tarifa bancária", lines: LINHAS_NOVAS });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(__tx.accountingEntry.update).toHaveBeenCalled();
  });

  it("mover um lançamento entre DOIS meses abertos continua funcionando", async () => {
    fecharApenas();
    prisma.accountingEntry.findFirst.mockResolvedValue({ ...despesaEmMesFechado, competencia: ABERTA });
    __tx.accountingEntry.findUnique.mockResolvedValue({
      id: "e1", tipo: "DESPESA", competencia: "2026-05", historico: "Tarifa bancária", lines: [],
    });
    const res = await put({ data: "2026-05-02", lines: LINHAS_NOVAS });
    expect(res.status).toBe(200);
    expect(__tx.accountingEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ competencia: "2026-05" }) }),
    );
  });

  it("a correção de conta SINTÉTICA em mês ABERTO segue possível (a outra guarda continua a que decide)", async () => {
    fecharApenas();
    prisma.accountingEntry.findFirst.mockResolvedValue({ ...despesaEmMesFechado, competencia: ABERTA });
    prisma.accountingEntryLine.findMany.mockResolvedValue([{ conta: "357" }]);
    prisma.chartOfAccount.findMany.mockResolvedValue([
      { codigo: "5", nome: "CAIXA", codigoCompleto: "111010001", analitica: true, portalClientId: null },
      { codigo: "357", nome: "RECEITAS", codigoCompleto: "3", analitica: false, portalClientId: null },
    ]);
    __tx.accountingEntry.findUnique.mockResolvedValue({
      id: "e1", tipo: "DESPESA", competencia: ABERTA, historico: "Tarifa bancária", lines: [],
    });
    const res = await put({ lines: LINHAS_NOVAS });
    expect(res.status).toBe(200);
  });
});

describe("A SIMETRIA DOS TRÊS VERBOS — criar, editar e apagar respondem igual em mês fechado", () => {
  it("o DELETE, que já tinha a trava, continua respondendo 409 MES_FECHADO", async () => {
    const res = await request(makeApp()).delete("/firm/companies/p1/entries/e1");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("MES_FECHADO");
    expect(prisma.accountingEntry.delete).not.toHaveBeenCalled();
  });

  it("o POST, que já tinha a trava, continua recusando lançamento novo no mês fechado", async () => {
    const res = await request(makeApp())
      .post("/firm/companies/p1/entries")
      .send({ data: "2026-03-10", historico: "Nova despesa", tipo: "DESPESA", lines: LINHAS_NOVAS });
    expect(res.status).toBe(409);
    expect(String(res.body.error).toUpperCase()).toBe("MES_FECHADO");
  });
});

// A TRAVA DA CONTA SINTÉTICA — no BACKEND, que é onde ela tem de estar.
//
// A tela já avisava (`web: entries/lib/contaSintetica.js`), e aviso de tela não é guarda: quem
// chama a rota direto, ou com a aba aberta antes do plano ser reimportado, passava igual. O motivo
// de ter virado RECUSA é externo — o registro I250 da ECD exige `IND_CTA = "A"`, então o arquivo é
// recusado pelo PGE do Sped Contábil na entrega, longe do lançamento que causou o erro.
//
// ⚠ O QUE ESTE ARQUIVO PROTEGE, ACIMA DE TUDO, SÃO AS DUAS EXCEÇÕES:
//   1) `analitica: null` NÃO recusa (conta ainda não reimportada não tem resposta);
//   2) a trava não pode impedir a CORREÇÃO dos lançamentos que já estão em conta de agregação —
//      na edição só se recusa a sintética que o payload ACRESCENTA.

jest.mock("../../../middlewares/requireFirmCompanyAccess.js", () => ({
  requireFirmCompanyAccess: () => (req, res, next) => {
    req.auth = { user: { id: "u1", role: "ACCOUNTANT" } };
    next();
  },
}));

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const tx = {
    accountingEntry: {
      create: jest.fn(async () => ({ id: "e1" })),
      update: jest.fn(async () => ({ id: "e1" })),
      findUnique: jest.fn(async () => ({ id: "e1", tipo: "DESPESA", lines: [] })),
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
      accountingEntry: { findFirst: jest.fn(async () => null) },
      accountingEntryLine: { findMany: jest.fn(async () => []) },
      accountingHistorico: {
        findFirst: jest.fn(async () => null),
        // ⚠ `lookupAccountsFromHistorico` busca CANDIDATOS e escolhe o primeiro par valido; lista
        // vazia = esta empresa nao tem memoria, o mesmo que `findFirst -> null` ja dizia.
        findMany: jest.fn(async () => []),
        create: jest.fn(async () => ({ id: "h1" })),
        update: jest.fn(async () => ({ id: "h1" })),
      },
      $transaction: jest.fn(async (cb) => cb(tx)),
    },
  };
});

jest.mock("../../../application/accounting/fechamentoContabil.js", () => ({
  isMonthClosed: jest.fn(async () => false),
}));

// O import de Excel grava memória de histórico fora da transação — irrelevante para o gate.
jest.mock("../../../application/accounting/excelImport.js", () => ({
  parseExcelBuffer: jest.fn(() => []),
  findHistoricoMatches: jest.fn(async () => []),
  upsertHistoricoFromImport: jest.fn(async () => {}),
}));

import express from "express";
import request from "supertest";
import { prisma, __tx } from "../../../infrastructure/db/prisma.js";
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

// O plano de contas medido na base real: `357 RECEITAS` é a de 1º nível (completo "3"), com
// R$ 207.351,40 lançados; `5` é CAIXA - MATRIZ, analítica; `464` nunca foi reimportada.
const PLANO = [
  { codigo: "5", nome: "CAIXA - MATRIZ", codigoCompleto: "111010001", analitica: true, portalClientId: null },
  { codigo: "357", nome: "RECEITAS", codigoCompleto: "3", analitica: false, portalClientId: null },
  { codigo: "169", nome: "EQUIPAMENTOS DE INFORMATICA", codigoCompleto: "12308", analitica: false, portalClientId: null },
  { codigo: "464", nome: "CONTA NUNCA REIMPORTADA", codigoCompleto: null, analitica: null, portalClientId: null },
  { codigo: "365", nome: "RECEITAS DE PRESTACAO DE SERVICOS", codigoCompleto: "31102", analitica: true, portalClientId: null },
];

// ⚠ O MESMO mock atende TRÊS consultas diferentes (as contas das linhas, em `contasInexistentes`
// e no gate; e as filhas, na hora de montar as candidatas). Responder pelo `where` é o que impede
// o teste de passar por coincidência.
function planoRespondendoPorWhere() {
  prisma.chartOfAccount.findMany.mockImplementation(async (args) => {
    const where = args?.where || {};
    if (where.codigo?.in) return PLANO.filter((c) => where.codigo.in.includes(c.codigo));
    if (where.codigoCompleto?.startsWith) {
      const raiz = where.codigoCompleto.startsWith;
      return PLANO.filter((c) => c.codigoCompleto && c.codigoCompleto.startsWith(raiz));
    }
    return [];
  });
}

const URL = "/firm/companies/p1/entries";
const NOVO = (contaD, contaC) => ({
  data: "2026-08-05",
  historico: "TESTE",
  tipo: "DESPESA",
  lines: [
    { conta: contaD, tipo: "D", valor: 100 },
    { conta: contaC, tipo: "C", valor: 100 },
  ],
});

beforeEach(() => {
  jest.clearAllMocks();
  planoRespondendoPorWhere();
  __tx.accountingEntry.findUnique.mockResolvedValue({ id: "e1", tipo: "DESPESA", lines: [] });
});

describe("POST /entries — o lançamento NOVO em conta de agregação é recusado", () => {
  it("recusa com 400 `CONTA_SINTETICA`, nomeando a conta e a saída — e NÃO grava nada", async () => {
    const res = await request(makeApp()).post(URL).send(NOVO("5", "357"));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("CONTA_SINTETICA");
    expect(res.body.contas).toEqual(["357"]);
    expect(res.body.message).toContain("357 RECEITAS");
    expect(res.body.message).toContain("I250");
    expect(__tx.accountingEntry.create).not.toHaveBeenCalled();
  });

  it("a recusa traz as CANDIDATAS — as filhas diretas, para o contador escolher", async () => {
    const res = await request(makeApp()).post(URL).send(NOVO("5", "357"));
    // Filha direta de "3" no plano do teste: "31102" (365). As netas não entram.
    expect(res.body.candidatas["357"].map((c) => c.codigo)).toEqual(["365"]);
  });

  it("⚠ `analitica: null` NÃO é recusado — ausência nunca é resposta", async () => {
    const res = await request(makeApp()).post(URL).send(NOVO("5", "464"));
    expect(res.status).toBe(201);
    expect(__tx.accountingEntry.create).toHaveBeenCalled();
  });

  it("duas analíticas passam normalmente", async () => {
    const res = await request(makeApp()).post(URL).send(NOVO("5", "365"));
    expect(res.status).toBe(201);
  });
});

describe("⚠ POST /entries/import/excel — a porta por onde 4 dos 6 entraram", () => {
  // Travar só a tela de lançar deixaria aberta exatamente a origem da maioria dos casos reais
  // (`origem: "EXCEL"` nos lançamentos de FAST SHOP, PRINTI e RAIA DROGASIL medidos em produção).
  const linha = (rowIndex, contaDebito) => ({
    rowIndex, contaDebito, contaCredito: "5", valor: 100,
    descricao: `LINHA ${rowIndex}`, data: "2026-08-05", tipo: "DESPESA",
  });

  it("a linha com conta de agregação fica em `failed`, NOMEANDO a conta — e o resto do lote entra", async () => {
    const res = await request(makeApp())
      .post("/firm/companies/p1/entries/import/excel")
      .send({ transactions: [linha(0, "365"), linha(1, "169")] });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(1);
    expect(res.body.failed).toBe(1);
    expect(res.body.details.failed[0]).toMatchObject({ rowIndex: 1, reason: "conta_sintetica", contas: ["169"] });
    // ⚠ Recusar o LOTE seria trocar um defeito por outro: 1 linha errada não derruba 200 boas.
    expect(res.body.details.created[0].rowIndex).toBe(0);
  });

  it("⚠ conta com `analitica: null` importa normalmente", async () => {
    const res = await request(makeApp())
      .post("/firm/companies/p1/entries/import/excel")
      .send({ transactions: [linha(0, "464")] });
    expect(res.body.created).toBe(1);
    expect(res.body.failed).toBe(0);
  });
});

describe("⚠ PUT /entries — a trava NÃO pode impedir a correção dos lançamentos que já existem", () => {
  const ENTRY = {
    id: "e1", portalClientId: "p1", tipo: "RECEITA", status: "RASCUNHO",
    origem: "MANUAL", competencia: "2026-08", historico: "SERPRO", tipoLinha: null,
  };
  const EDITADO = (contaD, contaC) => ({
    data: "2026-08-05",
    historico: "SERPRO",
    lines: [
      { conta: contaD, tipo: "D", valor: 207351.4 },
      { conta: contaC, tipo: "C", valor: 207351.4 },
    ],
  });

  beforeEach(() => {
    prisma.accountingEntry.findFirst.mockResolvedValue({ ...ENTRY });
    // O lançamento gravado HOJE: uma perna na sintética 357.
    prisma.accountingEntryLine.findMany.mockResolvedValue([{ conta: "5" }, { conta: "357" }]);
  });

  it("A CORREÇÃO PASSA: trocar a sintética 357 pela analítica 365 é aceito", async () => {
    const res = await request(makeApp()).put(`${URL}/e1`).send(EDITADO("5", "365"));
    expect(res.status).toBe(200);
    expect(__tx.accountingEntryLine.createMany).toHaveBeenCalled();
  });

  it("editar SEM mexer na conta errada passa — a sintética não é NOVA ali", async () => {
    // Enquanto a analítica de destino não for decidida pelo contador (é decisão dele), corrigir
    // valor/data/histórico do lançamento não pode ficar bloqueado.
    const res = await request(makeApp()).put(`${URL}/e1`).send(EDITADO("5", "357"));
    expect(res.status).toBe(200);
  });

  it("mas ACRESCENTAR uma sintética que não estava lá é recusado", async () => {
    const res = await request(makeApp()).put(`${URL}/e1`).send(EDITADO("169", "357"));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("CONTA_SINTETICA");
    expect(res.body.contas).toEqual(["169"]);
    expect(__tx.accountingEntryLine.createMany).not.toHaveBeenCalled();
  });
});

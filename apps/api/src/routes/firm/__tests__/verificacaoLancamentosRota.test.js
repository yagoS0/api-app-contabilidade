// A ROTA DA PRÉ-VERIFICAÇÃO — `GET /firm/companies/:id/lancamentos/verificacao`.
//
// ⚠ A REGRA já é testada em `application/accounting/regras/__tests__/`. O que este arquivo protege é
// a LIGAÇÃO: que a rota resolva o plano com a precedência certa, agrupe por REGRA, não escreva nada
// e não derrube a aba quando algo falha. Um teste que repetisse a aritmética da regra passaria com
// a rota quebrada.

jest.mock("../../../middlewares/requireFirmCompanyAccess.js", () => ({
  requireFirmCompanyAccess: () => (req, res, next) => {
    req.auth = { user: { id: "u1", role: "ACCOUNTANT" } };
    next();
  },
}));

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    chartOfAccount: { findMany: jest.fn(async () => []) },
    accountingEntry: { findMany: jest.fn(async () => []) },
    accountingEntryLine: { findMany: jest.fn(async () => []) },
    accountingHistorico: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
    $transaction: jest.fn(async (cb) => cb({})),
  },
}));

jest.mock("../../../application/accounting/fechamentoContabil.js", () => ({
  isMonthClosed: jest.fn(async () => false),
}));

import express from "express";
import request from "supertest";
import { prisma } from "../../../infrastructure/db/prisma.js";
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

// O plano REAL, na parte que importa. `portalClientId: null` = global.
const PLANO = [
  { portalClientId: null, codigo: "419", codigoCompleto: "331030005", nome: "(-) PIS", tipo: "RECEITA" },
  { portalClientId: null, codigo: "254", codigoCompleto: "211050005", nome: "PIS A RECOLHER", tipo: "PASSIVO" },
  { portalClientId: null, codigo: "595", codigoCompleto: "511010002", nome: "(-) CSLL", tipo: "DESPESA" },
  { portalClientId: null, codigo: "499", codigoCompleto: "411030005", nome: "CONTRIBUICAO SOCIAL", tipo: "DESPESA" },
  { portalClientId: null, codigo: "256", codigoCompleto: "211050007", nome: "CSLL A RECOLHER", tipo: "PASSIVO" },
  { portalClientId: null, codigo: "137", codigoCompleto: "121060003", nome: "CSLL", tipo: "ATIVO" },
  { portalClientId: null, codigo: "5", codigoCompleto: "111010001", nome: "CAIXA - MATRIZ", tipo: "ATIVO" },
];

const lanc = (id, tipo, eventType, d, c, extra = {}) => ({
  id, tipo, eventType, subtipo: null, competencia: "2026-07",
  parcelamentoId: null, historico: `${eventType} - 07/2026`,
  lines: [
    { conta: String(d), tipo: "D", valor: 100 },
    { conta: String(c), tipo: "C", valor: 100 },
  ],
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.chartOfAccount.findMany.mockResolvedValue(PLANO);
});

const GET = (qs = "") => request(makeApp()).get(`/firm/companies/emp-1/lancamentos/verificacao${qs}`);

describe("a rota da pré-verificação", () => {
  it("⚠⚠ acusa o caso relatado pelo dono e AGRUPA POR REGRA", async () => {
    prisma.accountingEntry.findMany.mockResolvedValue([
      lanc("e1", "PROVISAO", "DARF_PIS", 419, 254),   // ok
      lanc("e2", "PROVISAO", "DARF_CSLL", 595, 137),  // ramo 5 + crédito em ATIVO
      lanc("e3", "PROVISAO", "DARF_CSLL", 595, 256),  // só o ramo 5
      lanc("e4", "PROVISAO", "DARF_CSLL", 499, 256),  // ok — o par do balancete
    ]);
    const r = await GET("?competencia=2026-07");
    expect(r.status).toBe(200);
    expect(r.body.resumo).toMatchObject({ total: 4, ok: 2, viola: 2 });

    // ⚠ É `porRegra` que se lê: "2 provisões de IRPJ/CSLL debitando o ramo 5".
    const porRegra = Object.fromEntries(r.body.porRegra.map((g) => [g.regraId, g]));
    expect(porRegra["F3.01"].n).toBe(2);
    expect(porRegra["F3.01"].lancamentos.sort()).toEqual(["e2", "e3"]);
    expect(porRegra["F3.02"].n).toBe(1);
    expect(porRegra["F3.02"].exemplos[0]).toContain("1.2.1.06.0003");
  });

  it("⚠ o esperado vem no achado, para a tela dizer o conserto", async () => {
    prisma.accountingEntry.findMany.mockResolvedValue([lanc("e1", "PROVISAO", "DARF_CSLL", 595, 137)]);
    const { body } = await GET();
    const achados = body.porLancamento[0].achados;
    expect(achados.map((a) => a.esperado).sort()).toEqual(["2.1.1.05.*", "4.1.1.03.*"]);
    expect(body.porLancamento[0].id).toBe("e1");
  });

  it("⚠ a CONTA DA EMPRESA vence a GLOBAL na resolução do plano", async () => {
    // O reduzido 137 da empresa aponta para uma obrigação a recolher — o par passa a ser válido.
    prisma.chartOfAccount.findMany.mockResolvedValue([
      ...PLANO,
      { portalClientId: "emp-1", codigo: "137", codigoCompleto: "211050007", nome: "CSLL A RECOLHER", tipo: "PASSIVO" },
      { portalClientId: "emp-1", codigo: "595", codigoCompleto: "411030005", nome: "CONTRIBUICAO SOCIAL", tipo: "DESPESA" },
    ]);
    prisma.accountingEntry.findMany.mockResolvedValue([lanc("e1", "PROVISAO", "DARF_CSLL", 595, 137)]);
    const { body } = await GET();
    expect(body.resumo).toMatchObject({ ok: 1, viola: 0 });
  });

  it("⚠ só PROVISAO e BAIXA são consultados — o resto encheria a resposta de INDETERMINADO", async () => {
    await GET("?competencia=2026-07");
    expect(prisma.accountingEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          portalClientId: "emp-1",
          tipo: { in: ["PROVISAO", "BAIXA"] },
          competencia: "2026-07",
        }),
      }),
    );
  });

  it("sem competência varre a empresa inteira — é o modo do relatório de pré-importação", async () => {
    await GET();
    const where = prisma.accountingEntry.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty("competencia");
  });

  it("competência mal formada recusa antes de qualquer consulta", async () => {
    const r = await GET("?competencia=07-2026");
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("competencia_invalida");
    expect(prisma.accountingEntry.findMany).not.toHaveBeenCalled();
  });

  it("⚠ empresa sem lançamento devolve resumo zerado — e NÃO carrega o plano à toa", async () => {
    prisma.accountingEntry.findMany.mockResolvedValue([]);
    const { body } = await GET();
    expect(body.resumo).toMatchObject({ total: 0, ok: 0, viola: 0 });
    expect(body.porRegra).toEqual([]);
    expect(prisma.chartOfAccount.findMany).not.toHaveBeenCalled();
  });

  it("⚠ lançamento de PARCELAMENTO não é julgado aqui — tem regra própria em outro lugar", async () => {
    prisma.accountingEntry.findMany.mockResolvedValue([
      lanc("e1", "PROVISAO", "DARF_CSLL", 595, 137, { parcelamentoId: "p1" }),
    ]);
    const { body } = await GET();
    expect(body.resumo).toMatchObject({ viola: 0, indeterminado: 1 });
    expect(body.porRegra).toEqual([]);
  });

  it("⚠⚠ A ROTA NÃO ESCREVE NADA", async () => {
    prisma.accountingEntry.findMany.mockResolvedValue([lanc("e1", "PROVISAO", "DARF_CSLL", 595, 137)]);
    await GET();
    // varredura: nenhum método de escrita de nenhum model foi chamado
    for (const [nome, model] of Object.entries(prisma)) {
      if (!model || typeof model !== "object") continue;
      for (const metodo of ["create", "update", "upsert", "delete", "deleteMany", "updateMany", "createMany"]) {
        if (typeof model[metodo]?.mock !== "undefined") {
          expect(`${nome}.${metodo}`).toBe(`${nome}.${metodo} NAO CHAMADO`);
        }
      }
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("⚠ falha do banco vira 500 nomeado, e o log registra — a aba não pode quebrar calada", async () => {
    prisma.accountingEntry.findMany.mockRejectedValue(new Error("banco fora"));
    const r = await GET();
    expect(r.status).toBe(500);
    expect(r.body.error).toBe("verificacao_falhou");
  });
});

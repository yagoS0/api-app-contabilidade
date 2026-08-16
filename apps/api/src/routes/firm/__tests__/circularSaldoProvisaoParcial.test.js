// O SALDO DA PROVISÃO PARCIAL NA CIRCULAR — e a assimetria que prova que não foi decisão.
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// O DEFEITO
// ════════════════════════════════════════════════════════════════════════════════════════════
//
// `entryToResponse` chama `computeSaldoProvisao(entry)`, e essa conta lê **as LINHAS das baixas**
// (`principalAbatidoDaBaixa` soma os débitos não-acréscimo de cada baixa pendurada em
// `openEntryId`). A query da Circular carregava as baixas com `select: { id: true }, take: 1`:
// sem `lines`, o abatido dá SEMPRE ZERO — e o saldo sai pelo valor CHEIO da provisão.
//
// O contador via, num IRPJ de R$ 3.000 com a 1ª quota de R$ 1.000 já paga: a célula "Parcial"
// (azul), o popover dizendo "Saldo a pagar R$ 3.000,00", e o "Total em aberto" do mês somando os
// R$ 3.000 inteiros. Nada na tela denunciava o erro — o número estava lá, redondo, e errado.
//
// ⚠ O MESMO `take: 1` causava um SEGUNDO sintoma, no mesmo lugar: uma guia tem até TRÊS baixas
// (principal, juros e multa são lançamentos separados — regra do dono), e "↩ Desfazer baixa"
// manda embora o LOTE. Com uma baixa de três chegando à tela, o menu prometia desfazer uma coisa
// e desfazia três — ou, pior, apagava uma e deixava duas órfãs com a provisão reaberta.
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// POR QUE ISTO É DEFEITO E NÃO ESCOLHA
// ════════════════════════════════════════════════════════════════════════════════════════════
//
// `accountingEntries.js` tem CINCO queries que carregam `baixas` para uma provisão. Quatro delas
// pedem `baixas: { include: { lines: … } }`. Só a da Circular pedia `select: { id: true }, take: 1`.
// É a assimetria que estes testes medem: `GET /entries/provisoes` é o CONTROLE — mesma provisão,
// mesmo `entryToResponse`, e ele sempre respondeu certo.

jest.mock("../../../middlewares/requireFirmCompanyAccess.js", () => ({
  requireFirmCompanyAccess: () => (req, res, next) => {
    req.auth = { user: { id: "u1", role: "ACCOUNTANT" } };
    next();
  },
}));

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    accountingEntry: { findMany: jest.fn(async () => []) },
    guide: { findMany: jest.fn(async () => []) },
    companyMonthlyCircular: { findMany: jest.fn(async () => []) },
  },
}));

import express from "express";
import request from "supertest";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { createAccountingEntriesRouter } from "../accountingEntries.js";
// A conta NÃO é reimplementada aqui — é a MESMA que a rota usa.
import { computeSaldoProvisao } from "../../../application/accounting/saldoProvisao.js";

const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function makeApp() {
  const app = express();
  app.use(express.json());
  const parent = express.Router();
  parent.use("/companies/:companyId", createAccountingEntriesRouter({ log }));
  app.use("/firm", parent);
  return app;
}

const COMP = "2026-03";

// ⚠ O MOCK OBEDECE AO `include`/`select`/`take` DA QUERY — sem isso o teste não prova nada.
// É exatamente o que o Prisma faz: `select: { id: true }` devolve SÓ o id (as `lines` e o `tipo`
// não vêm), e `take: 1` corta o resto do lote. Um mock que devolvesse o objeto inteiro qualquer
// que fosse o argumento passaria verde com a query defeituosa.
function baixasComoOPrismaDevolveria(argBaixas, baixas) {
  if (!argBaixas) return undefined;
  let lista = baixas;
  if (Number.isFinite(argBaixas.take)) lista = lista.slice(0, argBaixas.take);
  if (argBaixas.select) {
    const campos = Object.keys(argBaixas.select).filter((k) => argBaixas.select[k]);
    return lista.map((b) => Object.fromEntries(campos.map((c) => [c, b[c]])));
  }
  if (argBaixas.include?.lines) return lista.map((b) => ({ ...b, lines: b.lines || [] }));
  // `baixas: true` (nem select nem include): a relação vem sem as linhas dela.
  return lista.map(({ lines: _semLinhas, ...resto }) => resto);
}

// IRPJ de R$ 3.000 — a 1ª quota de R$ 1.000 paga, com juros e multa em lançamentos separados.
// 501 = juros, 506 = multa (`CONTAS_ACRESCIMO`): eles NÃO amortizam o passivo.
const LOTE_DA_QUOTA = [
  {
    id: "b-principal",
    tipo: "BAIXA",
    historico: "Pagamento IRPJ 1ª quota",
    lines: [
      { id: "bl1", conta: "231", tipo: "D", valor: 1000, ordem: 0 },
      { id: "bl2", conta: "111", tipo: "C", valor: 1000, ordem: 1 },
    ],
  },
  {
    id: "b-juros",
    tipo: "BAIXA",
    historico: "Pagamento IRPJ 1ª quota (juros)",
    lines: [
      { id: "bl3", conta: "501", tipo: "D", valor: 30, ordem: 0 },
      { id: "bl4", conta: "111", tipo: "C", valor: 30, ordem: 1 },
    ],
  },
  {
    id: "b-multa",
    tipo: "BAIXA",
    historico: "Pagamento IRPJ 1ª quota (multa)",
    lines: [
      { id: "bl5", conta: "506", tipo: "D", valor: 20, ordem: 0 },
      { id: "bl6", conta: "111", tipo: "C", valor: 20, ordem: 1 },
    ],
  },
];

const provisaoIrpj = {
  id: "e-irpj",
  portalClientId: "p1",
  competencia: COMP,
  tipo: "PROVISAO",
  subtipo: "IRPJ",
  eventType: "DARF_IRPJ",
  statusPagamento: "PARCIAL",
  lines: [
    { id: "l1", conta: "231", tipo: "D", valor: 3000, ordem: 0 },
    { id: "l2", conta: "112", tipo: "C", valor: 3000, ordem: 1 },
  ],
  baixas: LOTE_DA_QUOTA,
  sourceGuide: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  prisma.accountingEntry.findMany.mockImplementation(async (args) => {
    if (args?.where?.tipo !== "PROVISAO") return []; // RECEITA e BAIXA
    const baixas = baixasComoOPrismaDevolveria(args?.include?.baixas, LOTE_DA_QUOTA);
    return [{ ...provisaoIrpj, baixas }];
  });
  prisma.guide.findMany.mockResolvedValue([]);
  prisma.companyMonthlyCircular.findMany.mockResolvedValue([]);
});

const app = () => request(makeApp());

async function provisaoDaCircular() {
  const res = await app().get("/firm/companies/p1/entries/circular?year=2026");
  expect(res.status).toBe(200);
  return res.body.provisoes.find((p) => p.id === "e-irpj");
}

async function provisaoDaListagem() {
  const res = await app().get(`/firm/companies/p1/entries/provisoes?competencia=${COMP}`);
  expect(res.status).toBe(200);
  return res.body.data.find((p) => p.id === "e-irpj");
}

// A verdade contra a qual as duas telas são medidas: a conta que o projeto já tem, sobre o lote
// inteiro. Juros (501) e multa (506) ficam de fora do abatido de propósito.
const ESPERADO = computeSaldoProvisao({ lines: provisaoIrpj.lines, baixas: LOTE_DA_QUOTA });

describe("o número que o contador lê no popover da célula", () => {
  it("saldo, abatido e quotas da provisão PARCIAL vêm da conta única (R$ 3.000 − R$ 1.000)", async () => {
    const p = await provisaoDaCircular();
    expect(p).toBeDefined();
    expect(p.abatido).toBe(1000);
    expect(p.saldo).toBe(2000);
    expect(p.quotasPagas).toBe(3);
    expect(p.parcial).toBe(true);
  });

  it('o saldo NÃO é o valor cheio — era esse o sintoma ("Saldo a pagar R$ 3.000,00")', async () => {
    const p = await provisaoDaCircular();
    expect(p.saldo).not.toBe(3000);
  });

  it("juros (501) e multa (506) não amortizam o passivo — o abatido é só o principal", async () => {
    const p = await provisaoDaCircular();
    expect(p.abatido).toBe(1000); // e não 1.050
  });
});

describe("A ASSIMETRIA — `GET /entries/provisoes` é o controle e sempre respondeu certo", () => {
  it("a listagem de provisões responde o mesmo saldo/abatido que a Circular", async () => {
    const [circular, listagem] = [await provisaoDaCircular(), await provisaoDaListagem()];
    expect([circular.saldo, circular.abatido, circular.quotasPagas])
      .toEqual([listagem.saldo, listagem.abatido, listagem.quotasPagas]);
  });

  it("as duas respondem o que `computeSaldoProvisao` calcula sobre o lote inteiro", async () => {
    for (const p of [await provisaoDaCircular(), await provisaoDaListagem()]) {
      expect([p.saldo, p.abatido, p.quotasPagas])
        .toEqual([ESPERADO.saldo, ESPERADO.abatido, ESPERADO.quotasPagas]);
    }
  });

  it("a query da Circular pede as baixas COM as linhas, e sem `take` — igual às outras quatro", async () => {
    await provisaoDaCircular();
    const chamada = prisma.accountingEntry.findMany.mock.calls
      .map(([args]) => args)
      .find((args) => args?.where?.tipo === "PROVISAO" && args?.include?.baixas);
    expect(chamada).toBeDefined();
    expect(chamada.include.baixas.include?.lines).toBeTruthy();
    // `take` cortava o lote; `select` sem `lines` zerava o abatido. Nenhum dos dois volta.
    expect(chamada.include.baixas.take).toBeUndefined();
    expect(chamada.include.baixas.select).toBeUndefined();
  });
});

describe("⚠ UMA GUIA TEM ATÉ TRÊS BAIXAS — e `↩ Desfazer baixa` leva o LOTE", () => {
  it("as três baixas do lote chegam à tela (com `take: 1` chegava uma)", async () => {
    const p = await provisaoDaCircular();
    expect(p.baixas).toHaveLength(3);
    expect(p.baixas.map((b) => b.id).sort()).toEqual(["b-juros", "b-multa", "b-principal"]);
  });
});

describe("o que NÃO muda", () => {
  it("provisão sem baixa nenhuma continua com saldo = principal e `parcial` falso", async () => {
    prisma.accountingEntry.findMany.mockImplementation(async (args) => {
      if (args?.where?.tipo !== "PROVISAO") return [];
      return [{ ...provisaoIrpj, statusPagamento: "ABERTO", baixas: [] }];
    });
    const p = await provisaoDaCircular();
    expect(p.saldo).toBe(3000);
    expect(p.abatido).toBe(0);
    expect(p.parcial).toBe(false);
  });

  it("o ESTORNO pendurado na provisão devolve o passivo (a separação por `tipo` sobrevive)", async () => {
    const espelho = {
      id: "b-estorno",
      tipo: "ESTORNO",
      historico: "ESTORNO Pagamento IRPJ 1ª quota",
      lines: [
        { id: "el1", conta: "111", tipo: "D", valor: 1000, ordem: 0 },
        { id: "el2", conta: "231", tipo: "C", valor: 1000, ordem: 1 },
      ],
    };
    const lote = [LOTE_DA_QUOTA[0], espelho];
    prisma.accountingEntry.findMany.mockImplementation(async (args) => {
      if (args?.where?.tipo !== "PROVISAO") return [];
      return [{ ...provisaoIrpj, baixas: baixasComoOPrismaDevolveria(args?.include?.baixas, lote) }];
    });
    const p = await provisaoDaCircular();
    // O espelho anula a baixa: nada abatido, provisão inteira de volta ao aberto.
    expect(p.abatido).toBe(0);
    expect(p.saldo).toBe(3000);
    expect(p.quotasPagas).toBe(0);
  });
});

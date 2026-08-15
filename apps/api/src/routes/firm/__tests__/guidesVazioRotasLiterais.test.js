// ORDEM DE REGISTRO — a literal `DELETE /firm/guides/vazio` tem que vir ANTES do curinga
// `DELETE /firm/guides/:guideId`.
//
// ⚠ O defeito original: o curinga estava registrado primeiro. O Express casa na ORDEM DE REGISTRO, e
// o handler do curinga responde `404 guide_not_found` quando não acha a guia — nunca chama `next()`.
// Então TODO `DELETE /firm/guides/vazio` era lido como "excluir a guia de id `vazio`", não achava
// nada e devolvia um 404 que falava de uma guia inexistente. **Marcar funcionava; desmarcar nunca
// funcionou.**
//
// O sintoma não parecia de roteamento: o marcador VAZIO ficava preso, `computeGuideComplianceMap`
// seguia respondendo `ok: true` para aquele tributo, a empresa sumia do filtro de pendências e o
// card podia condensar em "✓ Guias concluídas" — com a guia que faltava de verdade nunca sendo
// cobrada. A guarda `mes_fechado` da rota literal também nunca chegava a rodar.
//
// Mesmo defeito e mesmo espírito de `parcelamentosRotasLiterais.test.js`
// (`/parcelamentos/contas-provisao` engolida por `/parcelamentos/:parcId`). Este teste guarda DUAS
// coisas: que a literal responde, e que o CURINGA CONTINUA FUNCIONANDO para um id de verdade — o
// conserto é a ordem, não a remoção de rota.
//
// ⚠ A PROVA DE QUE FOI A LITERAL QUE ATENDEU não é o status: é `prisma.guide.findFirst` NÃO ter sido
// chamado. Ele é a primeira coisa que o handler do curinga faz, e a literal não o usa. Reintroduzindo
// o curinga na frente, o 200 vira 404 e essa asserção quebra junto.

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const models = {};
  const raiz = {};
  const proxy = new Proxy(raiz, {
    get(alvo, prop) {
      if (typeof prop === "symbol") return alvo[prop];
      if (prop === "$transaction") return alvo.$transaction;
      if (prop === "$connect" || prop === "$disconnect") {
        if (!alvo[prop]) alvo[prop] = jest.fn(async () => {});
        return alvo[prop];
      }
      if (!models[prop]) {
        const metodos = {};
        models[prop] = new Proxy(metodos, {
          get(m, metodo) {
            if (typeof metodo === "symbol") return m[metodo];
            if (!m[metodo]) m[metodo] = jest.fn();
            return m[metodo];
          },
        });
      }
      return models[prop];
    },
  });
  raiz.$transaction = jest.fn(async (arg) => {
    if (typeof arg === "function") return arg(proxy);
    return Promise.all(arg);
  });
  return { prisma: proxy };
});

// O fechamento contábil é uma pergunta ao banco que não tem nada a dizer sobre ORDEM DE ROTA —
// fica fixo em "mês aberto" para o teste falar de roteamento.
jest.mock("../../../application/accounting/fechamentoContabil.js", () => {
  const real = jest.requireActual("../../../application/accounting/fechamentoContabil.js");
  return { ...real, isMonthClosed: jest.fn(async () => false) };
});

import request from "supertest";
import express from "express";
import { createFirmPortalRouter } from "../index.js";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { isMonthClosed } from "../../../application/accounting/fechamentoContabil.js";

const CONTADOR = { id: "user-contador", role: "contador", accountType: "FIRM", email: "contador@escritorio.com" };

function montarApp() {
  const app = express();
  app.use(express.json());
  app.locals.ensureAuthorized = async (req) => {
    req.auth = { user: { ...CONTADOR } };
    return true;
  };
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  app.use("/firm", createFirmPortalRouter({ ensureAuthorized: app.locals.ensureAuthorized, log }));
  return app;
}

describe("DELETE /firm/guides/vazio — a literal não é engolida pelo curinga /guides/:guideId", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    isMonthClosed.mockResolvedValue(false);
    app = montarApp();
  });

  test("desmarcar o VAZIO chega ao handler literal e remove o marcador", async () => {
    prisma.guide.deleteMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .delete("/firm/guides/vazio")
      .send({ portalClientId: "portal-1", tipo: "SIMPLES", competencia: "2026-07" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, removed: 1 });
    // A literal apaga por (empresa, tipo, competência, status VAZIO) — nunca por id de guia.
    expect(prisma.guide.deleteMany).toHaveBeenCalledWith({
      where: { portalClientId: "portal-1", tipo: "SIMPLES", competencia: "2026-07", status: "VAZIO" },
    });
    // ⚠ A prova de ordem: o curinga começa por aqui, e ele não chegou a rodar.
    expect(prisma.guide.findFirst).not.toHaveBeenCalled();
  });

  test("a guarda `mes_fechado` da literal volta a existir (antes ela era inalcançável)", async () => {
    isMonthClosed.mockResolvedValue(true);

    const res = await request(app)
      .delete("/firm/guides/vazio")
      .send({ portalClientId: "portal-1", tipo: "SIMPLES", competencia: "2026-07" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("mes_fechado");
    expect(prisma.guide.deleteMany).not.toHaveBeenCalled();
    expect(prisma.guide.findFirst).not.toHaveBeenCalled();
  });

  test("`vazio` no corpo/query também funciona pela querystring (o front manda assim)", async () => {
    prisma.guide.deleteMany.mockResolvedValue({ count: 0 });

    const res = await request(app)
      .delete("/firm/guides/vazio?portalClientId=portal-1&tipo=INSS&competencia=2026-07");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, removed: 0 });
    expect(prisma.guide.findFirst).not.toHaveBeenCalled();
  });

  // ⚠ O CAMINHO LEGÍTIMO DO CURINGA: mover a literal para a frente não pode ter tirado do ar a
  // exclusão de guia por id. Um id qualquer continua caindo no curinga.
  test("o curinga continua atendendo um guideId de verdade", async () => {
    prisma.guide.findFirst.mockResolvedValue(null);

    const res = await request(app).delete("/firm/guides/guide-123");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ ok: false, error: "guide_not_found" });
    expect(prisma.guide.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "guide-123" } }),
    );
    expect(prisma.guide.deleteMany).not.toHaveBeenCalled();
  });
});

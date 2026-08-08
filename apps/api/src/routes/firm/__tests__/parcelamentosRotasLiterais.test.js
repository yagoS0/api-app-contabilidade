// ORDEM DE REGISTRO — as rotas literais de `/parcelamentos/` têm que vir ANTES do curinga.
//
// ⚠ O defeito: `GET /parcelamentos/:parcId` estava registrado antes de
// `GET /parcelamentos/contas-provisao` e `GET /parcelamentos/parcelas-pendentes-baixa`. O Express casa
// na ORDEM DE REGISTRO, e o handler do curinga responde `404 parcelamento_not_found` quando não acha —
// nunca chama `next()`. Então "contas-provisao" e "parcelas-pendentes-baixa" eram lidos como se fossem
// um id de parcelamento e as duas rotas ficavam INALCANÇÁVEIS.
//
// O sintoma não parecia de roteamento: o painel de parcelas pendentes de baixa (aba Parcelamento) e o
// pré-preenchimento do modal de provisão recebiam um 404 de negócio, com uma mensagem que descrevia um
// parcelamento inexistente. É o mesmo cuidado que `/companies/annual` e `/companies/fechamento` já
// tomam com `/companies/:companyId` — este teste é o que impede a ordem de voltar a inverter.

jest.mock("../../../middlewares/requireFirmCompanyAccess.js", () => ({
  requireFirmCompanyAccess: () => (req, res, next) => {
    req.auth = { user: { id: "u1", role: "ACCOUNTANT" } };
    next();
  },
}));

// F2.1: a fila de pendentes passou a ser ancorada em `parcela` (a prestação) em vez de `guide`
// (o documento). Este teste é sobre ORDEM DE ROTA, não sobre a fonte — o mock acompanha a troca.
jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    parcela: { findMany: jest.fn(async () => []) },
  },
}));

jest.mock("../../../application/accounting/parcelamento/ParcelamentoV2Service.js", () => ({
  resolverContasProvisao: jest.fn(async () => ({ PARC_DAS: "", MULTA: "", JUROS: "", TOTAL: "" })),
}));

jest.mock("../../../application/accounting/ParcelamentoService.js", () => ({
  getParcelamento: jest.fn(async () => null),
}));

import express from "express";
import request from "supertest";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { resolverContasProvisao } from "../../../application/accounting/parcelamento/ParcelamentoV2Service.js";
import { getParcelamento } from "../../../application/accounting/ParcelamentoService.js";
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

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /parcelamentos/* — literais antes do curinga :parcId", () => {
  it("parcelas-pendentes-baixa NÃO é engolida pelo :parcId", async () => {
    prisma.parcela.findMany.mockResolvedValue([]);

    const res = await request(makeApp()).get("/firm/companies/p1/parcelamentos/parcelas-pendentes-baixa");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, parcelas: [] });
    // A prova de que foi o handler certo: o do curinga nem seria consultado.
    expect(prisma.parcela.findMany).toHaveBeenCalledTimes(1);
    expect(getParcelamento).not.toHaveBeenCalled();
  });

  it("contas-provisao NÃO é engolida pelo :parcId", async () => {
    const res = await request(makeApp()).get("/firm/companies/p1/parcelamentos/contas-provisao?tipo=PARCSN");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(resolverContasProvisao).toHaveBeenCalledWith({ portalClientId: "p1", tipoParcelamento: "PARCSN" });
    expect(getParcelamento).not.toHaveBeenCalled();
  });

  it("o curinga continua respondendo por um id de verdade", async () => {
    getParcelamento.mockResolvedValue({ id: "parc1", label: "Parcelamento" });

    const res = await request(makeApp()).get("/firm/companies/p1/parcelamentos/parc1");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: { id: "parc1", label: "Parcelamento" } });
    expect(getParcelamento).toHaveBeenCalledWith({ portalClientId: "p1", parcelamentoId: "parc1" });
  });
});

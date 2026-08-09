// ORDEM DE REGISTRO — as rotas literais de `/parcelamentos/` têm que vir ANTES de qualquer curinga.
//
// ⚠ O defeito original: `GET /parcelamentos/:parcId` estava registrado antes de
// `GET /parcelamentos/contas-provisao` e `GET /parcelamentos/parcelas-pendentes-baixa`. O Express casa
// na ORDEM DE REGISTRO, e o handler do curinga respondia `404 parcelamento_not_found` quando não achava —
// nunca chamava `next()`. Então "contas-provisao" e "parcelas-pendentes-baixa" eram lidos como se fossem
// um id de parcelamento e as duas rotas ficavam INALCANÇÁVEIS.
//
// O sintoma não parecia de roteamento: o painel de parcelas pendentes de baixa (aba Parcelamento) e o
// pré-preenchimento do modal de provisão recebiam um 404 de negócio, com uma mensagem que descrevia um
// parcelamento inexistente. É o mesmo cuidado que `/companies/annual` e `/companies/fechamento` já
// tomam com `/companies/:companyId`.
//
// ⚠ F2.3 — O CURINGA `GET /parcelamentos/:parcId` FOI REMOVIDO (rota órfã do V1, sem chamador), e é
// por isso que este teste continua existindo em vez de sumir junto: ele agora guarda DUAS coisas.
// Que as literais respondem, e que NENHUM curinga de um segmento voltou a ser registrado antes
// delas — o defeito não é da rota que saiu, é da ordem, e a ordem é o que se pode reintroduzir.

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

import express from "express";
import request from "supertest";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { resolverContasProvisao } from "../../../application/accounting/parcelamento/ParcelamentoV2Service.js";
import { createAccountingEntriesRouter } from "../accountingEntries.js";

const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function makeApp() {
  const app = express();
  app.use(express.json());
  const parent = express.Router();
  parent.use("/companies/:companyId", createAccountingEntriesRouter({ log }));
  app.use("/firm", parent);
  // Sentinela: se alguma rota do router responder, este 404 nunca é alcançado.
  app.use((req, res) => res.status(404).json({ ok: false, error: "no_route" }));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /parcelamentos/* — literais alcançáveis, sem curinga na frente", () => {
  it("parcelas-pendentes-baixa NÃO é engolida por um curinga", async () => {
    prisma.parcela.findMany.mockResolvedValue([]);

    const res = await request(makeApp()).get("/firm/companies/p1/parcelamentos/parcelas-pendentes-baixa");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, parcelas: [] });
    expect(prisma.parcela.findMany).toHaveBeenCalledTimes(1);
  });

  // A fila da prestação SEM GUIA — a literal nova. Mesma disciplina: ela é a única porta de onde
  // sai o `parcelaId` da baixa por declaração; engolida por um curinga, a baixa volta a ser
  // inalcançável e o sintoma seria um 404 falando de parcelamento inexistente.
  it("parcelas-sem-guia-pendentes NÃO é engolida por um curinga", async () => {
    prisma.parcela.findMany.mockResolvedValue([]);

    const res = await request(makeApp()).get("/firm/companies/p1/parcelamentos/parcelas-sem-guia-pendentes");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, parcelas: [] });
    expect(prisma.parcela.findMany).toHaveBeenCalledTimes(1);
  });

  it("contas-provisao NÃO é engolida por um curinga", async () => {
    const res = await request(makeApp()).get("/firm/companies/p1/parcelamentos/contas-provisao?tipo=PARCSN");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(resolverContasProvisao).toHaveBeenCalledWith({ portalClientId: "p1", tipoParcelamento: "PARCSN" });
  });

  // ⚠ F2.3 — A PROVA DE QUE O CURINGA SAIU. Um id qualquer não pode mais ser atendido por rota
  // nenhuma deste router: se alguém reintroduzir `GET /parcelamentos/:parcId`, este teste quebra —
  // e é aí que as duas literais acima voltam a correr risco de serem engolidas.
  it("um id solto não casa com rota nenhuma (o curinga do V1 foi removido)", async () => {
    const res = await request(makeApp()).get("/firm/companies/p1/parcelamentos/parc1");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ ok: false, error: "no_route" });
  });
});

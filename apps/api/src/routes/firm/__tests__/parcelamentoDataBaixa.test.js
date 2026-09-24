jest.mock("../../../middlewares/requireFirmCompanyAccess.js", () => ({
  requireFirmCompanyAccess: () => (req, res, next) => {
    req.auth = { user: { id: "u1", role: "ACCOUNTANT" } };
    next();
  },
}));
jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: { guide: { findFirst: jest.fn() }, parcela: { findMany: jest.fn() } },
}));
jest.mock("../../../application/accounting/parcelamento/ParcelamentoV2Service.js", () => ({
  gerarPagamentoParcelaFromGuide: jest.fn(async () => ({ ok: true })),
}));

import express from "express";
import request from "supertest";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { gerarPagamentoParcelaFromGuide } from "../../../application/accounting/parcelamento/ParcelamentoV2Service.js";
import { createAccountingEntriesRouter } from "../accountingEntries.js";

const app = express();
app.use(express.json());
const parent = express.Router();
parent.use("/companies/:companyId", createAccountingEntriesRouter({ log: { error: jest.fn() } }));
app.use("/firm", parent);
const baixar = (body) => request(app).post("/firm/companies/p1/parcelamentos/parcelas/g1/baixa").send(body);

beforeEach(() => {
  jest.clearAllMocks();
  prisma.guide.findFirst.mockResolvedValue({ extracted: {} });
});

test("fila de baixa mostra valor arrecadado sem substituir o valor do documento", async () => {
  prisma.parcela.findMany.mockResolvedValue([{ id: "p1", numeroParcela: 1, parcelamentoId: "c1",
    guia: { id: "g1", valor: 110, competencia: "2026-08", extracted: { comprovante: { confiavel: true, total: 100, dataArrecadacao: "20/08/2026" } } } }]);
  const res = await request(app).get("/firm/companies/p1/parcelamentos/parcelas-pendentes-baixa");
  expect(res.status).toBe(200);
  expect(res.body.parcelas[0]).toMatchObject({ valor: 100, valorDocumento: 110, comprovante: { dataArrecadacao: "20/08/2026" } });
  expect(prisma.parcela.findMany.mock.calls[0][0].where.portalClientId).toBe("p1");
  expect(prisma.parcela.findMany.mock.calls[0][0].take).toBeUndefined();
});

test("data declarada inválida não vira baixa hoje", async () => {
  const res = await baixar({ composicaoDeclarada: { principal: 100, totalConferido: 100 }, dataPagamento: "inválida" });
  expect(res.status).toBe(400);
  expect(res.body.error).toBe("data_invalida");
  expect(gerarPagamentoParcelaFromGuide).not.toHaveBeenCalled();
});

test("a data do comprovante prevalece sobre a declaração", async () => {
  prisma.guide.findFirst.mockResolvedValue({ extracted: { comprovante: { dataArrecadacao: "20/08/2026" } } });
  const res = await baixar({ composicaoDeclarada: { principal: 100, totalConferido: 100 }, dataPagamento: "inválida" });
  expect(res.status).toBe(201);
  expect(gerarPagamentoParcelaFromGuide).toHaveBeenCalledWith(expect.objectContaining({
    portalClientId: "p1", guideId: "g1", dataPagamento: expect.any(Date),
  }));
  expect(gerarPagamentoParcelaFromGuide.mock.calls[0][0].dataPagamento.toISOString().slice(0, 10)).toBe("2026-08-20");
});

test.each(["ilegível", "31/02/2026", "29/02/2026", "00/08/2026", "20/13/2026"])(
  "comprovante com data %s não cai em hoje nem na data declarada", async (dataArrecadacao) => {
    prisma.guide.findFirst.mockResolvedValue({ extracted: { comprovante: { dataArrecadacao } } });
    const res = await baixar({ composicaoDeclarada: { principal: 100, totalConferido: 100 }, dataPagamento: "2026-08-20" });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("comprovante");
    expect(gerarPagamentoParcelaFromGuide).not.toHaveBeenCalled();
  },
);

test("dia declarado impossível não é normalizado para outro mês", async () => {
  const res = await baixar({ composicaoDeclarada: { principal: 100, totalConferido: 100 }, dataPagamento: "2026-02-31" });
  expect(res.status).toBe(400);
  expect(gerarPagamentoParcelaFromGuide).not.toHaveBeenCalled();
});

test("comprovante sem data preserva a regra existente", async () => {
  prisma.guide.findFirst.mockResolvedValue({ extracted: { comprovante: {} } });
  expect((await baixar({})).status).toBe(201);
  expect(gerarPagamentoParcelaFromGuide.mock.calls[0][0]).not.toHaveProperty("dataPagamento");
});

test("comprovante com dia bissexto válido é aceito", async () => {
  prisma.guide.findFirst.mockResolvedValue({ extracted: { comprovante: { dataArrecadacao: "29/02/2024" } } });
  expect((await baixar({})).status).toBe(201);
  expect(gerarPagamentoParcelaFromGuide.mock.calls[0][0].dataPagamento.toISOString().slice(0, 10)).toBe("2024-02-29");
});

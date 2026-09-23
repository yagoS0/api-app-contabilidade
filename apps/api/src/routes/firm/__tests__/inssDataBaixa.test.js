jest.mock("../../../middlewares/requireFirmCompanyAccess.js", () => ({
  requireFirmCompanyAccess: () => (req, res, next) => {
    req.auth = { user: { id: "contador", role: "ACCOUNTANT" } };
    next();
  },
}));
jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: { guide: { findFirst: jest.fn() } } }));
jest.mock("../../../application/accounting/InssPagamentoService.js", () => ({
  gerarPagamentoInssFromGuide: jest.fn(async () => ({ ok: true })),
}));
jest.mock("../../../application/guides/GuidePaymentStatusService.js", () => ({
  ...jest.requireActual("../../../application/guides/GuidePaymentStatusService.js"),
  markGuidePaidManual: jest.fn(async () => ({ id: "guia" })),
}));

import express from "express";
import request from "supertest";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { gerarPagamentoInssFromGuide } from "../../../application/accounting/InssPagamentoService.js";
import { markGuidePaidManual } from "../../../application/guides/GuidePaymentStatusService.js";
import { createAccountingEntriesRouter } from "../accountingEntries.js";

const app = express();
app.use(express.json());
app.use("/companies/:companyId", createAccountingEntriesRouter({ log: { error: jest.fn() } }));
const baixar = data => request(app).post("/companies/empresa/guides/guia/inss-baixa").send({
  data, historico: "PAGO INSS",
  lines: [{ conta: "211", tipo: "D", valor: 1000, papel: "PRINCIPAL" }, { conta: "111", tipo: "C", valor: 1000 }],
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.guide.findFirst.mockResolvedValue({ id: "guia", tipo: "INSS" });
});

test("data impossível não vira março nem chama baixa ou confirmação", async () => {
  const r = await baixar("2026-02-31");
  expect(r.status).toBe(400);
  expect(r.body.error).toBe("data_invalida");
  expect(gerarPagamentoInssFromGuide).not.toHaveBeenCalled();
  expect(markGuidePaidManual).not.toHaveBeenCalled();
});

test.each(["2026-07-01", "2024-02-29"])("data válida %s permanece no mesmo dia na baixa e na guia", async data => {
  const r = await baixar(data);
  expect(r.status).toBe(201);
  const esperada = new Date(`${data}T00:00:00.000Z`);
  expect(gerarPagamentoInssFromGuide).toHaveBeenCalledWith(expect.objectContaining({ portalClientId: "empresa", guideId: "guia", dataPagamento: esperada }));
  expect(markGuidePaidManual).toHaveBeenCalledWith({ guideId: "guia", userId: "contador", pagoEm: esperada });
});

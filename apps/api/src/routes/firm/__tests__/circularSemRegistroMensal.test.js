import express from "express";
import request from "supertest";
jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {
  companyMonthlyCircular: { findUnique: jest.fn(async () => null) },
  accountingEntry: { findMany: jest.fn(async ({ where }) => where.origem ? [] : [{ id: "manual", portalClientId: where.portalClientId, competencia: where.competencia, tipo: "DESPESA", lines: [] }]) },
} }));
jest.mock("../../../middlewares/requireFirmCompanyAccess.js", () => ({
  requireFirmCompanyAccess: () => (req, res, next) => req.headers["x-acesso"] === "permitido" ? next() : res.status(403).json({ error: "forbidden" }),
}));
import { createAccountingEntriesRouter } from "../accountingEntries.js";
import { prisma } from "../../../infrastructure/db/prisma.js";
function app() {
  const a = express();
  a.use(express.json());
  a.use("/companies/:companyId", createAccountingEntriesRouter({ log: { error: jest.fn() } }));
  return a;
}
test("ausência mensal legítima mantém lançamentos manuais e não inventa circular", async () => {
  const r = await request(app()).get("/companies/empresa/circular/2026-10/accounting-entries").set("x-acesso", "permitido");
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ circular: null, entries: [], allEntries: [{ id: "manual" }] });
  expect(prisma.accountingEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ portalClientId: "empresa", competencia: "2026-10" }),
  }));
});
test("ausência mensal não dispensa autorização de acesso", async () => {
  prisma.accountingEntry.findMany.mockClear();
  const r = await request(app()).get("/companies/alheia/circular/2026-10/accounting-entries");
  expect(r.status).toBe(403);
  expect(prisma.accountingEntry.findMany).not.toHaveBeenCalled();
});

test("falha real de leitura não é circular vazia bem sucedida", async () => {
  prisma.companyMonthlyCircular.findUnique.mockRejectedValueOnce(new Error("leitura indisponível"));
  const r = await request(app()).get("/companies/empresa/circular/2026-10/accounting-entries").set("x-acesso", "permitido");
  expect(r.status).toBe(500); expect(r.body).not.toHaveProperty("allEntries");
});
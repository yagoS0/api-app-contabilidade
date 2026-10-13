jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: { companyFirmAccess: { findUnique: jest.fn() } } }));
jest.mock("../../../application/guides/CorrigirCompetenciaGuiaService.js", () => ({
  preverCorrecaoCompetenciaGuia: jest.fn(async args => args), corrigirCompetenciaGuia: jest.fn(async args => ({ ok: true, ...args })), CorrecaoCompetenciaError: class extends Error {},
}));
import express from "express";
import request from "supertest";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { corrigirCompetenciaGuia, preverCorrecaoCompetenciaGuia } from "../../../application/guides/CorrigirCompetenciaGuiaService.js";
import { createCorrigirCompetenciaGuiaRouter } from "../corrigirCompetenciaGuia.js";
function app(user = { id: "u", role: "contador" }) {
  const a = express(); a.use(express.json()); a.use((req, res, next) => { req.auth = { user }; next(); });
  a.use("/firm", createCorrigirCompetenciaGuiaRouter()); return a;
}
const path = "/firm/companies/A/guides/g/corrigir-competencia";
beforeEach(() => { jest.clearAllMocks(); prisma.companyFirmAccess.findUnique.mockResolvedValue({ role: "ACCOUNTANT", status: "ACTIVE" }); });
test.each([null, { role: "STAFF", status: "ACTIVE" }, { role: "ACCOUNTANT", status: "INACTIVE" }])("recusa conta sem acesso de contador ativo %j", async access => {
  prisma.companyFirmAccess.findUnique.mockResolvedValue(access);
  expect((await request(app()).get(path + "?competencia=2026-09")).status).toBe(403);
  expect((await request(app()).post(path).send({ competencia: "2026-09", revisao: "r" })).status).toBe(403);
  expect(corrigirCompetenciaGuia).not.toHaveBeenCalled(); expect(preverCorrecaoCompetenciaGuia).not.toHaveBeenCalled();
});
test("exige autenticação e usa autoria autenticada, não o corpo", async () => {
  expect((await request(app(null)).post(path).send({})).status).toBe(401);
  expect((await request(app()).post(path).send({ competencia: "2026-09", revisao: "r", userId: "outro", companyId: "B" })).status).toBe(200);
  expect(corrigirCompetenciaGuia).toHaveBeenCalledWith({ companyId: "A", guideId: "g", competencia: "2026-09", revisao: "r", userId: "u" });
});

import express from "express";
import request from "supertest";
jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
jest.mock("../../../middlewares/requireFirmCompanyAccess.js", () => ({ requireFirmCompanyAccess: () => (req, res, next) => {
  if (req.params.companyId !== "minha") return res.status(403).json({ error: "forbidden" });
  req.auth = { user: { id: "contador", role: "contador" } }; next();
} }));
jest.mock("../../../application/notas/apuracao/v2/FechamentoService.js", () => ({
  transmitirFechamento: jest.fn(async () => ({ numeroDeclaracao: "simulada" })),
  FechamentoError: class extends Error {},
}));
import { transmitirFechamento } from "../../../application/notas/apuracao/v2/FechamentoService.js";
import { manualTasks } from "../../../application/tasks/ManualTaskService.js";
import { createApuracaoV2Router } from "../apuracaoV2.js";

let execute, start;
function app() {
  const a = express(); a.use(express.json());
  a.use("/companies/:companyId", createApuracaoV2Router({ log: { warn: jest.fn() } })); return a;
}
beforeEach(() => {
  execute = null; transmitirFechamento.mockClear();
  start = jest.spyOn(manualTasks, "start").mockImplementation(async (_descriptor, run) => { execute = run; return { id: "task-1", newlyStarted: true }; });
});
afterEach(() => start.mockRestore());

test("nega empresa alheia antes de aceitar transmissão em segundo plano", async () => {
  await request(app()).post("/companies/alheia/fechamento/2026-09/transmitir").set("Prefer", "respond-async").send({ confirmCompetencia: "2026-09" }).expect(403);
  expect(start).not.toHaveBeenCalled(); expect(transmitirFechamento).not.toHaveBeenCalled();
});
test("a confirmação permanece obrigatória mesmo na execução adiada", async () => {
  await request(app()).post("/companies/minha/fechamento/2026-09/transmitir").set("Prefer", "respond-async").send({ confirmCompetencia: "2026-08" }).expect(202);
  expect((await execute(jest.fn())).statusCode).toBe(400); expect(transmitirFechamento).not.toHaveBeenCalled();
});
test("executa uma vez com empresa, competência e cálculo preservados após aceite", async () => {
  await request(app()).post("/companies/minha/fechamento/2026-09/transmitir").set("Prefer", "respond-async").send({ confirmCompetencia: "2026-09", calculoId: "calculo-1" }).expect(202);
  expect(transmitirFechamento).not.toHaveBeenCalled();
  const result = await execute(jest.fn()); expect(result.statusCode).toBe(200);
  expect(transmitirFechamento).toHaveBeenCalledTimes(1);
  expect(transmitirFechamento).toHaveBeenCalledWith({ portalClientId: "minha", competencia: "2026-09", userId: "contador", calculoId: "calculo-1" });
});
test("retificação exige a segunda confirmação sem transmitir nada", async () => {
  await request(app()).post("/companies/minha/fechamento/2026-09/retificar").set("Prefer", "respond-async").send({ confirmCompetencia: "2026-09" }).expect(202);
  expect((await execute(jest.fn())).body.error).toBe("confirm_retificar_required");
  expect(transmitirFechamento).not.toHaveBeenCalled();
});

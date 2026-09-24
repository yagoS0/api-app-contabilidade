jest.mock("../../config.js", () => ({ log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock("../../application/guides/GuideLockService.js", () => ({ acquireGuideLease: jest.fn() }));
jest.mock("../../application/fiscal/serpro/SerproRuntimeSettings.js", () => ({ getSerproRuntimeSettings: jest.fn() }));
jest.mock("../../application/fiscal/serpro/SerproPaymentConfirmationService.js", () => ({ runPaymentConfirmationOnce: jest.fn() }));
jest.mock("../../application/fiscal/serpro/SerproExecutionLogService.js", () => ({ createSerproExecutionLog: jest.fn() }));
jest.mock("../runRoutineLoop.js", () => ({ runRoutineLoop: jest.fn() }));
import { acquireGuideLease } from "../../application/guides/GuideLockService.js";
import { getSerproRuntimeSettings } from "../../application/fiscal/serpro/SerproRuntimeSettings.js";
import { runPaymentConfirmationOnce } from "../../application/fiscal/serpro/SerproPaymentConfirmationService.js";
import { createSerproExecutionLog } from "../../application/fiscal/serpro/SerproExecutionLogService.js";
import { runRoutineLoop } from "../runRoutineLoop.js";
import { runSerproPaymentConfirmationWorkerOnce, runSerproPaymentConfirmationWorkerLoop } from "../serproPaymentConfirmationWorker.js";

const lease = { assertActive: jest.fn(), release: jest.fn() };
beforeEach(() => {
  jest.clearAllMocks(); acquireGuideLease.mockResolvedValue(lease);
  getSerproRuntimeSettings.mockResolvedValue({ enabled: true, paymentConfirmationEnabled: true, paymentConfirmationCron: "0 8 25 * *" });
  runPaymentConfirmationOnce.mockResolvedValue({ total: 3, paid: 1, naoLocalizado: 1, indeterminados: 1, cobertura: "PARCIAL", errors: 0,
    results: [{ guideId: "g-a", status: "paid" }, { guideId: "g-b", status: "open" }, { guideId: "g-c", status: "INDETERMINADO" }] });
});
test("log e retorno conservam quantidade inconclusiva e identificação de cada documento", async () => {
  const r = await runSerproPaymentConfirmationWorkerOnce({ portalClientId: "empresa-a" });
  expect(r).toMatchObject({ total: 3, paid: 1, naoLocalizado: 1, indeterminados: 1, cobertura: "PARCIAL", skipped: false });
  expect(createSerproExecutionLog).toHaveBeenCalledWith(expect.objectContaining({
    worker: "serpro_payment_confirmation", summary: r,
  }));
  expect(runPaymentConfirmationOnce).toHaveBeenCalledWith(expect.objectContaining({ portalClientId: "empresa-a", competencia: null }));
  expect(lease.release).toHaveBeenCalledTimes(1);
});
test("consulta interrompida por perda da reserva não é registrada como conclusão", async () => {
  const assertActive = jest.fn(() => { throw Object.assign(new Error("Reserva perdida"), { code: "SCHEDULE_LEASE_LOST" }); });
  runPaymentConfirmationOnce.mockImplementation(async options => options.assertActive());
  await expect(runSerproPaymentConfirmationWorkerOnce({ assertActive })).rejects.toMatchObject({ code: "SCHEDULE_LEASE_LOST" });
  expect(createSerproExecutionLog).not.toHaveBeenCalled(); expect(lease.release).toHaveBeenCalledTimes(1);
});
test("instância sem reserva não executa chamadas nem registra verificação fictícia", async () => {
  acquireGuideLease.mockResolvedValue(null);
  expect(await runSerproPaymentConfirmationWorkerOnce()).toEqual({ skipped: true, reason: "lock_active" });
  expect(runPaymentConfirmationOnce).not.toHaveBeenCalled(); expect(createSerproExecutionLog).not.toHaveBeenCalled();
});
test("agenda usa a rotina de pagamentos e cobre períodos anteriores, sem reduzir ao mês anterior", async () => {
  await runSerproPaymentConfirmationWorkerLoop();
  const options = runRoutineLoop.mock.calls[0][0];
  expect(options).toMatchObject({ worker: "SERPRO_PAYMENT_CONFIRMATION_WORKER_ENABLED", routines: ["pagamento"] });
  await options.run({ competencia: "2026-08" });
  expect(runPaymentConfirmationOnce).toHaveBeenCalledWith(expect.objectContaining({ competencia: null }));
});

test("worker repassa o subconjunto de retentativa sem apagar observações anteriores", async () => {
  const retomadaPagamento = { guideIds: ["g-erro"], parcelaIds: [], concluidos: [{ guideId: "g-duvida", status: "indeterminado" }] };
  await runSerproPaymentConfirmationWorkerOnce({ retomadaPagamento });
  expect(runPaymentConfirmationOnce).toHaveBeenCalledWith(expect.objectContaining({ retomadaPagamento }));
});
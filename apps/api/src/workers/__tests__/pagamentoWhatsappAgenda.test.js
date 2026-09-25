
jest.mock("../../application/guides/SolicitarPagamentosWhatsappService.js", () => ({ solicitarPagamentosWhatsapp: jest.fn() }));
jest.mock("../../application/guides/GuideLockService.js", () => ({ acquireGuideLease: jest.fn() }));
jest.mock("../../application/fiscal/serpro/SerproRuntimeSettings.js", () => ({ getSerproRuntimeSettings: jest.fn() }));
jest.mock("../../application/fiscal/serpro/SerproPaymentConfirmationService.js", () => ({ runPaymentConfirmationOnce: jest.fn() }));
jest.mock("../../application/fiscal/serpro/SerproExecutionLogService.js", () => ({ createSerproExecutionLog: jest.fn() }));
jest.mock("../runRoutineLoop.js", () => ({ runRoutineLoop: jest.fn() }));
import { solicitarPagamentosWhatsapp } from "../../application/guides/SolicitarPagamentosWhatsappService.js";
import { acquireGuideLease } from "../../application/guides/GuideLockService.js";
import { getSerproRuntimeSettings } from "../../application/fiscal/serpro/SerproRuntimeSettings.js";
import { runPaymentConfirmationOnce } from "../../application/fiscal/serpro/SerproPaymentConfirmationService.js";
import { runRoutineLoop } from "../runRoutineLoop.js";
import { runSerproPaymentConfirmationWorkerLoop } from "../serproPaymentConfirmationWorker.js";
test("agenda independente solicita pagamentos com SERPRO desligado sem chamada fiscal", async () => {
 const release = jest.fn();
 acquireGuideLease.mockResolvedValue({assertActive:jest.fn(),release});
 getSerproRuntimeSettings.mockResolvedValue({enabled:false});
 solicitarPagamentosWhatsapp.mockResolvedValue({total:1,resultados:[{status:'ENVIADO'}]});
 runRoutineLoop.mockImplementation(async options => {
  expect(options.independent).toBe(true);
  expect(options.routines).toEqual(['pagamento']);
  return options.run({scheduledAt:'2026-09-25T12:00:00Z',assertActive:jest.fn()});
 });
 expect(await runSerproPaymentConfirmationWorkerLoop()).toMatchObject({skipped:false,serproSkipped:"serpro_disabled"});
 expect(solicitarPagamentosWhatsapp).toHaveBeenCalledWith(expect.objectContaining({scheduledAt:'2026-09-25T12:00:00Z'}));
 expect(runPaymentConfirmationOnce).not.toHaveBeenCalled();
 expect(release).toHaveBeenCalledTimes(1);
});

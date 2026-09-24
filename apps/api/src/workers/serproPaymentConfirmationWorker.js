import { comContextoSerpro, contextoSerproAtual } from "../application/fiscal/serpro/serproCallContext.js";
import { log } from "../config.js";
import { acquireGuideLease } from "../application/guides/GuideLockService.js";
import { getSerproRuntimeSettings } from "../application/fiscal/serpro/SerproRuntimeSettings.js";
import { runPaymentConfirmationOnce } from "../application/fiscal/serpro/SerproPaymentConfirmationService.js";
import { createSerproExecutionLog } from "../application/fiscal/serpro/SerproExecutionLogService.js";
import { runRoutineLoop } from "./runRoutineLoop.js";
import { previousCompetencia } from "./routineSchedule.js";

// Q40 Fase B: cron PRÓPRIO de confirmação de pagamento (PAGTOWEB). Independente da captura.
const LOCK_ID = "serpro_payment_confirmation_lock";
const LOCK_TTL_MS = 30 * 60 * 1000;
const LOOP_INTERVAL_MS = 60 * 1000;

export async function runSerproPaymentConfirmationWorkerOnce(options = {}) {
  const ctx = contextoSerproAtual();
  return comContextoSerpro({ ...ctx, origem: ctx.origem || "worker:serpro_pagamento" }, () => executarPagamento(options));
}
async function executarPagamento(options = {}) {
  const lease = await acquireGuideLease(LOCK_ID, LOCK_TTL_MS);
  if (!lease) return { skipped: true, reason: "lock_active" };
  try {
    const settings = await getSerproRuntimeSettings();
    if (!settings.enabled) return { skipped: true, reason: "serpro_disabled" };

    const startedAt = Date.now();
    const summary = await runPaymentConfirmationOnce({
      portalClientId: options.portalClientId || null,
      competencia: options.competencia || null,
      logger: log,
      assertActive: () => { lease.assertActive(); options.assertActive?.(); },
    });

    const result = { skipped: false, durationMs: Date.now() - startedAt, ...summary };
    await createSerproExecutionLog({
      worker: "serpro_payment_confirmation",
      createdAt: new Date().toISOString(),
      settings: {
        enabled: settings.enabled,
        paymentConfirmationEnabled: settings.paymentConfirmationEnabled,
        paymentConfirmationCron: settings.paymentConfirmationCron,
      },
      summary: result,
    });
    return result;
  } finally {
    await lease.release();
  }
}

export async function runSerproPaymentConfirmationWorkerLoop() {
  return runRoutineLoop({ worker: "SERPRO_PAYMENT_CONFIRMATION_WORKER_ENABLED", routines: ["pagamento"], run: (options) => runSerproPaymentConfirmationWorkerOnce({ ...options, competencia: null }) });
}

if (process.argv[1] && process.argv[1].endsWith("serproPaymentConfirmationWorker.js")) {
  const isOnce = process.argv.includes("--once");
  if (isOnce) {
    runSerproPaymentConfirmationWorkerOnce()
      .then((result) => {
        log.info({ result }, "serproPaymentConfirmationWorker --once finalizado");
        process.exit(0);
      })
      .catch((err) => {
        log.error({ err: err?.message || err }, "serproPaymentConfirmationWorker --once falhou");
        process.exit(1);
      });
  } else {
    runSerproPaymentConfirmationWorkerLoop().catch((err) => {
      log.error({ err: err?.message || err }, "serproPaymentConfirmationWorker loop fatal");
      process.exit(1);
    });
  }
}

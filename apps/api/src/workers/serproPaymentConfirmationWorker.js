import { log } from "../config.js";
import { tryAcquireGuideLock, releaseGuideLock } from "../application/guides/GuideLockService.js";
import { getSerproRuntimeSettings } from "../application/fiscal/serpro/SerproRuntimeSettings.js";
import { runPaymentConfirmationOnce } from "../application/fiscal/serpro/SerproPaymentConfirmationService.js";
import { createSerproExecutionLog } from "../application/fiscal/serpro/SerproExecutionLogService.js";
import { matchesCron } from "./cronMatch.js";

// Q40 Fase B: cron PRÓPRIO de confirmação de pagamento (PAGTOWEB). Independente da captura.
const LOCK_ID = "serpro_payment_confirmation_lock";
const LOCK_TTL_MS = 30 * 60 * 1000;
const LOOP_INTERVAL_MS = 60 * 1000;

export async function runSerproPaymentConfirmationWorkerOnce(options = {}) {
  const locked = await tryAcquireGuideLock(LOCK_ID, LOCK_TTL_MS);
  if (!locked) return { skipped: true, reason: "lock_active" };
  try {
    const settings = await getSerproRuntimeSettings();
    if (!settings.enabled) return { skipped: true, reason: "serpro_disabled" };

    const startedAt = Date.now();
    const summary = await runPaymentConfirmationOnce({
      portalClientId: options.portalClientId || null,
      competencia: options.competencia || null,
      logger: log,
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
    await releaseGuideLock(LOCK_ID);
  }
}

export async function runSerproPaymentConfirmationWorkerLoop() {
  let lastTickKey = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const settings = await getSerproRuntimeSettings();
      const now = new Date();
      const tickKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

      // Agenda da rotina `pagamento`. Cai no paymentConfirmation* legado se ela não existir.
      const cfgPag = settings.rotinas?.pagamento;
      const pagamentoLigado = cfgPag ? cfgPag.enabled !== false : settings.paymentConfirmationEnabled;
      const pagamentoBateu = cfgPag
        ? matchesCron(cfgPag.cron, now)
        : matchesCron(settings.paymentConfirmationCron, now);

      if (
        settings.enabled &&
        pagamentoLigado &&
        pagamentoBateu &&
        tickKey !== lastTickKey
      ) {
        lastTickKey = tickKey;
        const result = await runSerproPaymentConfirmationWorkerOnce();
        log.info({ result, tickKey }, "Ciclo do serproPaymentConfirmationWorker concluído");
      }
    } catch (err) {
      log.error({ err: err?.message || err }, "Erro no ciclo do serproPaymentConfirmationWorker");
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, LOOP_INTERVAL_MS));
  }
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

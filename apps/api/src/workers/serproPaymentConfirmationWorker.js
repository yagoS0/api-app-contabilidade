import { log } from "../config.js";
import { tryAcquireGuideLock, releaseGuideLock } from "../application/guides/GuideLockService.js";
import { getSerproRuntimeSettings } from "../application/fiscal/serpro/SerproRuntimeSettings.js";
import { runPaymentConfirmationOnce } from "../application/fiscal/serpro/SerproPaymentConfirmationService.js";
import { createSerproExecutionLog } from "../application/fiscal/serpro/SerproExecutionLogService.js";

// Q40 Fase B: cron PRÓPRIO de confirmação de pagamento (PAGTOWEB). Independente da captura.
const LOCK_ID = "serpro_payment_confirmation_lock";
const LOCK_TTL_MS = 30 * 60 * 1000;
const LOOP_INTERVAL_MS = 60 * 1000;

function parseCronField(field, value, min, max) {
  const raw = String(field || "*").trim();
  if (raw === "*") return true;
  return raw.split(",").some((part) => {
    const token = String(part || "").trim();
    if (!token) return false;
    const stepMatch = token.match(/^(\*|\d+-\d+|\d+)\/(\d+)$/);
    if (stepMatch) {
      const base = stepMatch[1];
      const step = Number(stepMatch[2]);
      if (!Number.isFinite(step) || step <= 0) return false;
      if (base === "*") return value >= min && value <= max && (value - min) % step === 0;
      if (base.includes("-")) {
        const [start, end] = base.split("-").map(Number);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
        return value >= start && value <= end && (value - start) % step === 0;
      }
      return value === Number(base);
    }
    if (token.includes("-")) {
      const [start, end] = token.split("-").map(Number);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
      return value >= start && value <= end;
    }
    const numeric = Number(token);
    return Number.isFinite(numeric) && numeric === value;
  });
}

function matchesCron(cronExpression, now = new Date()) {
  const parts = String(cronExpression || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 5) return false;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  return (
    parseCronField(minute, now.getMinutes(), 0, 59) &&
    parseCronField(hour, now.getHours(), 0, 23) &&
    parseCronField(dayOfMonth, now.getDate(), 1, 31) &&
    parseCronField(month, now.getMonth() + 1, 1, 12) &&
    parseCronField(dayOfWeek, now.getDay(), 0, 6)
  );
}

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

      if (
        settings.enabled &&
        settings.paymentConfirmationEnabled &&
        matchesCron(settings.paymentConfirmationCron, now) &&
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

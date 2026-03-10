import cron from "node-cron";
import { log } from "../config.js";
import { getGuideRuntimeSettings } from "../application/guides/GuideRuntimeSettings.js";
import { runGuideScheduledEmailWorkerOnce } from "./guideScheduledEmailWorker.js";

let scheduledTask = null;
let activeCronExpression = "";
let runningNow = false;

function stopCurrentTask() {
  if (!scheduledTask) return;
  scheduledTask.stop();
  if (typeof scheduledTask.destroy === "function") {
    scheduledTask.destroy();
  }
  scheduledTask = null;
}

async function runScheduledDispatch() {
  if (runningNow) {
    log.warn("guideScheduledEmailManager: execução ignorada (já em andamento)");
    return;
  }
  runningNow = true;
  try {
    const result = await runGuideScheduledEmailWorkerOnce();
    log.info({ result, cron: activeCronExpression }, "guideScheduledEmailManager: ciclo concluído");
  } catch (err) {
    log.error({ err: err?.message || err, cron: activeCronExpression }, "guideScheduledEmailManager: falha");
  } finally {
    runningNow = false;
  }
}

export async function applyGuideScheduleCron(cronExpression) {
  const normalized = String(cronExpression || "").trim();
  stopCurrentTask();
  activeCronExpression = "";
  if (!normalized) {
    log.info("guideScheduledEmailManager: agendamento desativado");
    return { enabled: false, cron: "" };
  }
  if (!cron.validate(normalized)) {
    const err = new Error("guide_schedule_cron_invalid");
    err.code = "GUIDE_SCHEDULE_CRON_INVALID";
    throw err;
  }
  scheduledTask = cron.schedule(
    normalized,
    () => {
      runScheduledDispatch().catch((err) => {
        log.error({ err: err?.message || err }, "guideScheduledEmailManager: erro inesperado");
      });
    },
    { timezone: process.env.TZ || "America/Sao_Paulo" }
  );
  activeCronExpression = normalized;
  log.info({ cron: activeCronExpression }, "guideScheduledEmailManager: agendamento ativado");
  return { enabled: true, cron: activeCronExpression };
}

export async function refreshGuideScheduleFromRuntime() {
  const runtime = await getGuideRuntimeSettings();
  return applyGuideScheduleCron(runtime.guideScheduleCron);
}

export async function startGuideScheduledEmailManager() {
  return refreshGuideScheduleFromRuntime();
}


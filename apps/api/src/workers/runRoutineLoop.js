import { getSerproRuntimeSettings } from "../application/fiscal/serpro/SerproRuntimeSettings.js";
import { log } from "../config.js";
import { recordWorkerHeartbeat, runScheduledRoutine } from "./scheduledRoutineService.js";

export async function runRoutineLoop({ worker, routines, run, independent = false }) {
  const heartbeat = () => recordWorkerHeartbeat(worker).catch((error) => log.error({ error: error.message, worker }, "Falha ao registrar atividade da rotina"));
  const timer = setInterval(heartbeat, 60000);
  timer.unref?.();
  try {
    while (true) {
      await heartbeat();
      try { await runRoutineTick({ routines, run, independent }); }
      catch (error) { log.error({ error: error.message, worker }, "Falha ao ler a agenda; nenhuma consulta adicional autorizada"); }
      // Local clock check only; no provider request outside the saved schedule.
      await new Promise((resolve) => setTimeout(resolve, 15000));
    }
  } finally { clearInterval(timer); }
}

export async function runRoutineTick({ routines, run, independent = false }) {
  const settings = await getSerproRuntimeSettings();
  const now = new Date();
  let queue = Promise.resolve();
  // Reserve every due routine at the configured minute, then process serially.
  // A slow DAS request must not make the same-time extrato/parcelamento disappear.
  await Promise.all(routines.map(async (routine) => {
    if (!independent && !settings.enabled) return;
    if (routine === "parcelamento" && process.env.INTEGRACAO_SERPRO_PARCELAMENTO !== "1") return;
    try {
      await runScheduledRoutine(routine, settings.rotinas?.[routine], (options) => {
        const task = queue.then(async () => {
          options.assertActive();
          const current = await getSerproRuntimeSettings();
          if ((!independent && !current.enabled)
            || current.rotinas?.[routine]?.enabled !== true
            || JSON.stringify(current.rotinas[routine]) !== JSON.stringify(settings.rotinas[routine])) {
            return { skipped: true, reason: "agenda_alterada" };
          }
          return run(options);
        });
        queue = task.catch(() => {});
        return task;
      }, { now });
    } catch (err) {
      log.error({ err: err?.message || err, routine }, "Falha na execução programada");
    }
  }));
}

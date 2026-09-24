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
      for (const routine of routines) {
        try {
          const settings = await getSerproRuntimeSettings();
          if (!independent && !settings.enabled) continue;
          if (routine === "parcelamento" && process.env.INTEGRACAO_SERPRO_PARCELAMENTO !== "1") continue;
          await runScheduledRoutine(routine, settings.rotinas?.[routine], run);
        } catch (err) {
          log.error({ err: err?.message || err, routine }, "Falha na execução programada");
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 60000));
    }
  } finally { clearInterval(timer); }
}

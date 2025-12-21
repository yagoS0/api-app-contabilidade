import { Router } from "express";

export function createRunRouter({ ensureAuthorized, RunLogStore, runState, run, log }) {
  const router = Router();

  async function executeRun(kind = "send") {
    if (runState.isRunning) {
      const err = new Error("already_running");
      err.code = "ALREADY_RUNNING";
      throw err;
    }
    runState.isRunning = true;
    runState.lastRunError = null;
    runState.lastRunStartedAt = new Date().toISOString();
    try {
      await RunLogStore.startRun(kind);
      await run();
    } catch (err) {
      runState.lastRunError = err;
      log.error({ err }, "Execução falhou");
      throw err;
    } finally {
      runState.isRunning = false;
      runState.lastRunFinishedAt = new Date().toISOString();
      await RunLogStore.finishRun({ error: runState.lastRunError });
    }
  }

  router.post("/run", async (req, res) => {
    if (!(await ensureAuthorized(req, res))) return;
    if (runState.isRunning) {
      return res.status(409).json({ error: "already_running" });
    }
    res.status(202).json({ status: "started" });
    executeRun().catch((err) => {
      if (err.code !== "ALREADY_RUNNING") {
        log.error({ err }, "Execução em background falhou");
      }
    });
  });

  return { router, executeRun };
}


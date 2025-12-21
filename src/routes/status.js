import { Router } from "express";

export function createStatusRouter({ ensureAuthorized, RunLogStore, runState, CRON_SCHEDULE }) {
  const router = Router();

  router.get("/healthz", (_req, res) => {
    res.status(200).send("ok");
  });

  router.get("/status", async (req, res) => {
    if (!(await ensureAuthorized(req, res))) return;
    const last = await RunLogStore.getLastRun();
    res.json({
      running: runState.isRunning || Boolean(last?.running),
      lastRunStartedAt: runState.lastRunStartedAt,
      lastRunFinishedAt: runState.lastRunFinishedAt,
      lastRunError:
        runState.lastRunError && typeof runState.lastRunError === "object"
          ? { message: runState.lastRunError.message }
          : runState.lastRunError || null,
      cron: CRON_SCHEDULE || null,
      messages: Array.isArray(last?.messages) ? last.messages : [],
      lastRunKind: last?.kind || null,
      lastRunStore: {
        startedAt: last?.startedAt || null,
        finishedAt: last?.finishedAt || null,
        error: last?.error || null,
        running: Boolean(last?.running),
      },
    });
  });

  return router;
}


import { Router } from "express";
import { prisma } from "../infrastructure/db/prisma.js";

export function createStatusRouter({ ensureAuthorized, RunLogStore, runState, CRON_SCHEDULE }) {
  const router = Router();

  router.get("/healthz", (_req, res) => {
    res.status(200).send("ok");
  });

  router.get("/readyz", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await prisma.appSetting.findFirst({ select: { key: true } }).catch(() => null);
      return res.status(200).json({ ok: true, db: "up" });
    } catch (err) {
      return res.status(503).json({
        ok: false,
        error: "db_unavailable",
        reason: err?.message || "database_not_ready",
      });
    }
  });

  router.get("/status", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
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


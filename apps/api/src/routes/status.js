import { Router } from "express";
import { prisma } from "../infrastructure/db/prisma.js";
import { GUIDE_PARSER_URL } from "../config.js";

function shouldCheckEmbeddedParser() {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/.*)?$/i.test(String(GUIDE_PARSER_URL || "").trim());
}

export function createStatusRouter({ ensureAuthorized, RunLogStore, runState, CRON_SCHEDULE }) {
  const router = Router();

  router.get("/healthz", (_req, res) => {
    res.status(200).send("ok");
  });

  router.get("/readyz", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await prisma.appSetting.findFirst({ select: { key: true } }).catch(() => null);
      if (shouldCheckEmbeddedParser()) {
        const parserUrl = String(GUIDE_PARSER_URL || "").trim().replace(/\/+$/, "");
        const parserResponse = await fetch(`${parserUrl}/health`, {
          signal: AbortSignal.timeout(3000),
        });
        if (!parserResponse.ok) {
          throw new Error(`embedded_parser_unhealthy_${parserResponse.status}`);
        }
      }
      return res.status(200).json({
        ok: true,
        db: "up",
        parser: shouldCheckEmbeddedParser() ? "up" : "not_checked",
      });
    } catch (err) {
      return res.status(503).json({
        ok: false,
        error: "service_not_ready",
        reason: err?.message || "service_not_ready",
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


import { Router } from "express";
import { prisma } from "../infrastructure/db/prisma.js";
import { PDF_READER_URL } from "../config.js";

async function checkPdfReaderHealth() {
  const url = String(PDF_READER_URL || "").trim().replace(/\/+$/, "");
  if (!url) throw new Error("pdf_reader_url_not_configured");
  const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`pdf_reader_unhealthy_${res.status}`);
  const body = await res.json().catch(() => ({}));
  if (body?.status !== "ok") throw new Error("pdf_reader_health_invalid_body");
  return "up";
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
      const pdfReader = await checkPdfReaderHealth();
      return res.status(200).json({
        ok: true,
        db: "up",
        pdfReader,
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

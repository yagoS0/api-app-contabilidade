import { Router } from "express";
import { prisma } from "../infrastructure/db/prisma.js";
import { dateToIso } from "../utils/serializers.js";
import { InvoiceSyncEngine } from "../application/sync/InvoiceSyncEngine.js";
import { ensurePortalClientAccess } from "./middlewares/portalAccess.js";

export function createPortalSyncRouter({ ensureAuthorized, log }) {
  const router = Router({ mergeParams: true });

  // POST /clients/:clientId/invoices/sync/start (idempotente)
  router.post("/start", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { clientId } = req.params || {};
    const body = req.body || {};
    const resetCursor = body.resetCursor === true || body.resetCursor === "true";
    const maxIterations =
      body.maxIterations !== undefined && body.maxIterations !== null
        ? Number(body.maxIterations)
        : undefined;

    try {
      const access = await ensurePortalClientAccess(req, res, clientId);
      if (!access.ok) return;
      const role = String(access.user?.role || "").toLowerCase();
      const isAdminLike = role === "admin" || role === "contador";
      if (resetCursor && !isAdminLike) {
        return res.status(403).json({ error: "forbidden_reset_cursor" });
      }

      const result = await InvoiceSyncEngine.start({
        clientId: String(clientId),
        resetCursor,
        maxIterations,
      });
      return res.json({
        jobId: result.jobId,
        state: result.state,
        queued: result.queued,
        reason: result.reason || null,
        resetCursor,
        maxIterations: maxIterations || undefined,
        sync: {
          lastSyncAt: dateToIso(result.sync?.lastSyncAt),
          stale: Boolean(result.sync?.stale),
        },
      });
    } catch (err) {
      if (err.code === "CLIENT_NOT_FOUND") return res.status(404).json({ error: "not_found" });
      log.error({ err, clientId }, "Falha ao iniciar sync");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // GET /clients/:clientId/invoices/sync/status/:jobId
  router.get("/status/:jobId", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { clientId, jobId } = req.params || {};
    try {
      const access = await ensurePortalClientAccess(req, res, clientId);
      if (!access.ok) return;
      const job = await prisma.portalInvoiceSyncJob.findFirst({
        where: { id: String(jobId), clientId: String(clientId) },
      });
      if (!job) return res.status(404).json({ error: "not_found" });
      return res.json({
        jobId: job.id,
        state: job.state,
        processed: job.processed,
        created: job.created,
        updated: job.updated,
        duplicates: job.duplicates,
        errors: job.errors,
        lastCursor: job.lastCursor?.toString?.() ?? (job.lastCursor ? String(job.lastCursor) : null),
        lastMessage: job.lastMessage || null,
      });
    } catch (err) {
      log.error({ err, clientId, jobId }, "Falha ao consultar status do sync");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // GET /clients/:clientId/invoices/sync/summary
  router.get("/summary", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { clientId } = req.params || {};
    try {
      const access = await ensurePortalClientAccess(req, res, clientId);
      if (!access.ok) return;
      const state = await prisma.portalSyncState.findUnique({
        where: { clientId: String(clientId) },
      });
      return res.json({
        lastSyncAt: dateToIso(state?.lastSyncAt),
        state: state?.state || "OK",
        stale: !state?.lastSyncAt || state?.state !== "OK",
        lastError: state?.lastError || null,
      });
    } catch (err) {
      log.error({ err, clientId }, "Falha ao consultar summary do sync");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // POST /clients/:clientId/invoices/:invoiceId/sync-status (pontual)
  // MVP: recalcula status apenas a partir dos eventos já gravados
  router.post("/:invoiceId/sync-status", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { clientId, invoiceId } = req.params || {};
    try {
      const access = await ensurePortalClientAccess(req, res, clientId);
      if (!access.ok) return;
      const inv = await prisma.portalInvoice.findFirst({
        where: { id: String(invoiceId), clientId: String(clientId) },
      });
      if (!inv) return res.status(404).json({ error: "not_found" });

      const latestEvent = await prisma.portalInvoiceEvent.findFirst({
        where: { clientId: String(clientId), invoiceId: String(invoiceId) },
        orderBy: { date: "desc" },
      });

      const before = inv.status;
      const after = latestEvent?.type ? String(latestEvent.type).toUpperCase() : before;

      if (after !== before) {
        await prisma.portalInvoice.update({ where: { id: inv.id }, data: { status: after } });
      }

      return res.json({ ok: true, before, after });
    } catch (err) {
      log.error({ err, clientId, invoiceId }, "Falha ao sync-status pontual");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}


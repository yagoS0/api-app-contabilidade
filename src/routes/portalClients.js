import { Router } from "express";
import { prisma } from "../infrastructure/db/prisma.js";
import { dateToIso } from "../utils/serializers.js";
import { buildPortalClientWhereForUser, ensurePortalClientAccess } from "./middlewares/portalAccess.js";

function normalizeCnpj(value) {
  return String(value || "").replace(/\D+/g, "");
}

function computeStale({ lastSyncAt, state }, staleAfterMs = 10 * 60 * 1000) {
  if (!lastSyncAt) return true;
  if (state && state !== "OK") return true;
  const ts = lastSyncAt instanceof Date ? lastSyncAt.getTime() : new Date(lastSyncAt).getTime();
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts > staleAfterMs;
}

async function getCertConfigured({ portalClientId }) {
  const portal = await prisma.portalClient.findUnique({
    where: { id: portalClientId },
    select: { companyId: true },
  });
  if (!portal?.companyId) return false;
  const company = await prisma.company.findUnique({
    where: { id: portal.companyId },
    select: { certStorageKey: true },
  });
  return Boolean(company?.certStorageKey);
}

export function createPortalClientsRouter({ ensureAuthorized, log }) {
  const router = Router();

  // GET /clients?search=&page=&limit=
  router.get("/", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { search, page, limit } = req.query || {};
    const take = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const pageNum = Math.max(Number(page) || 1, 1);
    const skip = (pageNum - 1) * take;

    const q = String(search || "").trim();
    const cnpjDigits = normalizeCnpj(q);

    const baseWhere = await buildPortalClientWhereForUser(req);
    if (baseWhere === null) return res.status(403).json({ error: "forbidden" });

    const where =
      q || cnpjDigits
        ? {
            ...baseWhere,
            OR: [
              ...(q ? [{ razao: { contains: q, mode: "insensitive" } }] : []),
              ...(cnpjDigits ? [{ cnpj: { contains: cnpjDigits } }] : []),
            ],
          }
        : baseWhere;

    try {
      const [items, total] = await prisma.$transaction([
        prisma.portalClient.findMany({
          where,
          orderBy: { razao: "asc" },
          skip,
          take,
          include: {
            syncState: true,
          },
        }),
        prisma.portalClient.count({ where }),
      ]);

      const data = (items || []).map((it) => {
        const sync = it.syncState || null;
        const lastSyncAt = sync?.lastSyncAt || null;
        const state = sync?.state || "OK";
        return {
          clientId: it.id,
          razao: it.razao,
          cnpj: it.cnpj,
          sync: {
            lastSyncAt: dateToIso(lastSyncAt),
            state,
            stale: computeStale({ lastSyncAt, state }),
          },
        };
      });

      return res.json({
        data,
        page: pageNum,
        limit: take,
        total,
      });
    } catch (err) {
      log.error({ err }, "Falha ao listar portal clients");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // GET /clients/:clientId
  router.get("/:clientId", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { clientId } = req.params || {};
    try {
      const access = await ensurePortalClientAccess(req, res, clientId);
      if (!access.ok) return;
      const client = await prisma.portalClient.findUnique({
        where: { id: String(clientId) },
        include: { syncState: true, integrationSettings: true },
      });
      if (!client) return res.status(404).json({ error: "not_found" });

      const sync = client.syncState || null;
      const lastSyncAt = sync?.lastSyncAt || null;
      const state = sync?.state || "OK";

      const certConfigured = await getCertConfigured({ portalClientId: client.id });
      const integrationStatus = certConfigured ? "OK" : "MISSING";

      return res.json({
        clientId: client.id,
        razao: client.razao,
        cnpj: client.cnpj,
        integrationStatus,
        sync: {
          lastSyncAt: dateToIso(lastSyncAt),
          state,
          stale: computeStale({ lastSyncAt, state }),
          lastError: sync?.lastError || null,
        },
      });
    } catch (err) {
      log.error({ err, clientId }, "Falha ao buscar portal client");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // GET /clients/:clientId/integration-settings
  router.get("/:clientId/integration-settings", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { clientId } = req.params || {};
    try {
      const access = await ensurePortalClientAccess(req, res, clientId);
      if (!access.ok) return;
      const settings = await prisma.portalIntegrationSettings.findUnique({
        where: { clientId: String(clientId) },
      });
      const certConfigured = await getCertConfigured({ portalClientId: String(clientId) });
      return res.json({
        provider: settings?.provider || "NFSENACIONAL",
        environment: settings?.environment || "PROD",
        certConfigured,
      });
    } catch (err) {
      log.error({ err, clientId }, "Falha ao buscar integration settings");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // PATCH /clients/:clientId/integration-settings
  router.patch("/:clientId/integration-settings", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { clientId } = req.params || {};
    const body = req.body || {};
    const provider = body.provider ? String(body.provider) : undefined;
    const environment = body.environment ? String(body.environment) : undefined;
    const certId = body.certId ? String(body.certId) : undefined;

    try {
      const access = await ensurePortalClientAccess(req, res, clientId);
      if (!access.ok) return;
      await prisma.portalIntegrationSettings.upsert({
        where: { clientId: String(clientId) },
        create: {
          clientId: String(clientId),
          provider: provider || "NFSENACIONAL",
          environment: environment || "PROD",
          certCompanyId: certId || null,
        },
        update: {
          ...(provider ? { provider } : {}),
          ...(environment ? { environment } : {}),
          ...(certId ? { certCompanyId: certId } : {}),
        },
      });
      return res.json({ ok: true });
    } catch (err) {
      log.error({ err, clientId }, "Falha ao atualizar integration settings");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}


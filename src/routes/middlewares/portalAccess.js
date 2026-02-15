import { prisma } from "../../infrastructure/db/prisma.js";

export function getAuthUser(req) {
  return req?.auth?.user || null;
}

export function isAdminLike(user) {
  const role = String(user?.role || "").toLowerCase();
  return role === "admin" || role === "contador";
}

export function isCliente(user) {
  const role = String(user?.role || "").toLowerCase();
  return role === "client" || role === "cliente";
}

export async function ensurePortalClientAccess(req, res, portalClientId) {
  const user = getAuthUser(req);
  if (!user) {
    res.status(401).json({ error: "unauthorized" });
    return { ok: false };
  }

  if (isAdminLike(user)) return { ok: true, user, access: { kind: "admin" } };

  const targetClientId = String(portalClientId);
  const [clientLink, firmLink] = await prisma.$transaction([
    prisma.companyClientUser.findUnique({
      where: { companyId_userId: { companyId: targetClientId, userId: String(user.id) } },
      select: { role: true, status: true },
    }),
    prisma.companyFirmAccess.findUnique({
      where: { companyId_userId: { companyId: targetClientId, userId: String(user.id) } },
      select: { role: true, status: true, scopes: true },
    }),
  ]);

  if (clientLink?.status === "ACTIVE") {
    return { ok: true, user, access: { kind: "client", ...clientLink } };
  }
  if (firmLink?.status === "ACTIVE") {
    return { ok: true, user, access: { kind: "firm", ...firmLink } };
  }

  if (!isCliente(user)) {
    res.status(403).json({ error: "forbidden" });
    return { ok: false };
  }

  const portal = await prisma.portalClient.findUnique({
    where: { id: targetClientId },
    select: { id: true, companyId: true },
  });
  if (!portal) {
    res.status(404).json({ error: "not_found" });
    return { ok: false };
  }
  if (!portal.companyId) {
    res.status(403).json({ error: "forbidden" });
    return { ok: false };
  }

  const company = await prisma.company.findFirst({
    where: { id: portal.companyId, clientId: String(user.id) },
    select: { id: true },
  });
  if (!company) {
    res.status(403).json({ error: "forbidden" });
    return { ok: false };
  }

  return { ok: true, user, access: { kind: "legacy_client_owner" } };
}

export async function buildPortalClientWhereForUser(req) {
  const user = getAuthUser(req);
  if (!user) return null;
  if (isAdminLike(user)) return {};
  const [clientLinks, firmLinks] = await prisma.$transaction([
    prisma.companyClientUser.findMany({
      where: { userId: String(user.id), status: "ACTIVE" },
      select: { companyId: true },
    }),
    prisma.companyFirmAccess.findMany({
      where: { userId: String(user.id), status: "ACTIVE" },
      select: { companyId: true },
    }),
  ]);

  let ids = [...clientLinks, ...firmLinks].map((i) => i.companyId).filter(Boolean);
  if (!ids.length && isCliente(user)) {
    const companies = await prisma.company.findMany({
      where: { clientId: String(user.id) },
      select: { id: true },
    });
    const legacyIds = companies.map((c) => c.id).filter(Boolean);
    if (legacyIds.length) {
      const portals = await prisma.portalClient.findMany({
        where: { companyId: { in: legacyIds } },
        select: { id: true },
      });
      ids = portals.map((p) => p.id);
    }
  }
  if (!ids.length) return { id: { in: [] } };
  return { id: { in: ids } };
}


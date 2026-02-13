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

  if (isAdminLike(user)) return { ok: true, user };

  if (!isCliente(user)) {
    res.status(403).json({ error: "forbidden" });
    return { ok: false };
  }

  const portal = await prisma.portalClient.findUnique({
    where: { id: String(portalClientId) },
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

  return { ok: true, user };
}

export async function buildPortalClientWhereForUser(req) {
  const user = getAuthUser(req);
  if (!user) return null;
  if (isAdminLike(user)) return {};
  if (!isCliente(user)) return null;

  const companies = await prisma.company.findMany({
    where: { clientId: String(user.id) },
    select: { id: true },
  });
  const ids = companies.map((c) => c.id).filter(Boolean);
  if (!ids.length) return { id: { in: [] } };
  return { companyId: { in: ids } };
}


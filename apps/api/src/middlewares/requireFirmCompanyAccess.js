import { prisma } from "../infrastructure/db/prisma.js";

const ROLE_WEIGHT = {
  STAFF: 1,
  ACCOUNTANT: 2,
  FIRM_ADMIN: 3,
};

function normalize(value) {
  return String(value || "").trim().toUpperCase();
}

function hasRequiredScopes(scopes, requiredScopes) {
  if (!requiredScopes || !requiredScopes.length) return true;
  if (!Array.isArray(scopes)) return false;
  const set = new Set(scopes.map((s) => normalize(s)));
  return requiredScopes.every((scope) => set.has(normalize(scope)));
}

export function requireFirmCompanyAccess(options = {}) {
  const { minRole = null, scopes = [] } = options;
  const min = minRole ? normalize(minRole) : null;
  const minWeight = min ? ROLE_WEIGHT[min] || 0 : 0;
  const requiredScopes = Array.isArray(scopes) ? scopes : [scopes];

  return async function requireFirmCompanyAccessMiddleware(req, res, next) {
    const user = req?.auth?.user;
    if (!user) return res.status(401).json({ error: "unauthorized" });

    const appRole = String(user.role || "").toLowerCase();
    if (appRole === "admin") {
      req.access = { role: "FIRM_ADMIN", status: "ACTIVE", scopes: ["*"] };
      return next();
    }

    const companyId = String(
      req.params.companyId || req.params.clientId || req.body?.companyId || ""
    ).trim();
    if (!companyId) return res.status(400).json({ error: "company_id_required" });

    const link = await prisma.companyFirmAccess.findUnique({
      where: {
        companyId_userId: {
          companyId,
          userId: String(user.id),
        },
      },
      select: { role: true, status: true, scopes: true },
    });

    if (!link || link.status !== "ACTIVE") {
      return res.status(403).json({ error: "forbidden" });
    }

    const currentWeight = ROLE_WEIGHT[normalize(link.role)] || 0;
    if (currentWeight < minWeight) {
      return res.status(403).json({ error: "insufficient_role" });
    }

    if (!hasRequiredScopes(link.scopes, requiredScopes)) {
      return res.status(403).json({ error: "scope_required" });
    }

    req.access = {
      role: normalize(link.role),
      status: link.status,
      scopes: Array.isArray(link.scopes) ? link.scopes : [],
    };
    return next();
  };
}


import { prisma } from "../infrastructure/db/prisma.js";

const ROLE_WEIGHT = {
  CLIENT_USER: 1,
  CLIENT_ADMIN: 2,
  OWNER: 3,
};

function normalize(value) {
  return String(value || "").trim().toUpperCase();
}

export function requireClientCompanyAccess(minRole) {
  const min = minRole ? normalize(minRole) : null;
  const minWeight = min ? ROLE_WEIGHT[min] || 0 : 0;

  return async function requireClientCompanyAccessMiddleware(req, res, next) {
    const user = req?.auth?.user;
    if (!user) return res.status(401).json({ error: "unauthorized" });

    const role = String(user.role || "").toLowerCase();
    if (role === "admin") {
      req.access = { role: "OWNER", status: "ACTIVE" };
      return next();
    }

    const companyId = String(
      req.params.companyId || req.params.clientId || req.body?.companyId || ""
    ).trim();
    if (!companyId) return res.status(400).json({ error: "company_id_required" });

    const link = await prisma.companyClientUser.findUnique({
      where: {
        companyId_userId: {
          companyId,
          userId: String(user.id),
        },
      },
      select: { role: true, status: true },
    });

    if (!link || link.status !== "ACTIVE") {
      return res.status(403).json({ error: "forbidden" });
    }

    const currentWeight = ROLE_WEIGHT[normalize(link.role)] || 0;
    if (currentWeight < minWeight) {
      return res.status(403).json({ error: "insufficient_role" });
    }

    req.access = { role: normalize(link.role), status: link.status };
    return next();
  };
}


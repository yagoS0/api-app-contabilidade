import { prisma } from "../../infrastructure/db/prisma.js";
import { GUIDE_COMPLIANCE_COMPETENCIA } from "../../config.js";

/**
 * Competência YYYY-MM usada para alertas de guia (env fixo ou mês civil anterior).
 */
export function getReferenceCompetencia(now = new Date()) {
  const forced = String(GUIDE_COMPLIANCE_COMPETENCIA || "").trim();
  if (/^\d{4}-\d{2}$/.test(forced)) return forced;

  const y = now.getFullYear();
  const m = now.getMonth();
  if (m === 0) return `${y - 1}-12`;
  const prev = m;
  return `${y}-${String(prev).padStart(2, "0")}`;
}

function isRegimeSimples(regimeTributario) {
  return String(regimeTributario || "")
    .trim()
    .toUpperCase() === "SIMPLES";
}

function normalizeRegimeFromLegacy(legacy) {
  if (!legacy || typeof legacy !== "object") return null;
  const r = legacy.regimeTributario ?? legacy.tipoTributario;
  return r != null ? String(r).trim() : null;
}

function getRequirements({ hasProlabore, regimeTributario }) {
  return {
    inssRequired: Boolean(hasProlabore),
    dasRequired: isRegimeSimples(regimeTributario),
  };
}

/**
 * @param {Array<{ portalId: string, hasProlabore: boolean, legacy: object | null }>} rows
 * @param {string} competencia YYYY-MM
 * @returns {Map<string, {
 *   competencia: string,
 *   inss: { required: boolean, ok: boolean },
 *   das: { required: boolean, ok: boolean },
 *   ok: boolean,
 *   expected: "INSS"|"SIMPLES"|null
 * }>}
 */
export async function computeGuideComplianceMap(rows, competencia) {
  const map = new Map();
  const needQuery = [];

  for (const row of rows) {
    const regime = normalizeRegimeFromLegacy(row.legacy);
    const req = getRequirements({
      hasProlabore: Boolean(row.hasProlabore),
      regimeTributario: regime,
    });
    const base = {
      competencia,
      inss: { required: req.inssRequired, ok: !req.inssRequired },
      das: { required: req.dasRequired, ok: !req.dasRequired },
      ok: !req.inssRequired && !req.dasRequired,
      // Mantém compatibilidade com front antigo.
      expected: req.inssRequired ? "INSS" : req.dasRequired ? "SIMPLES" : null,
    };
    map.set(row.portalId, base);
    if (req.inssRequired || req.dasRequired) needQuery.push(row.portalId);
  }

  if (!needQuery.length) return map;

  const portalIds = [...new Set(needQuery)];
  const guides = await prisma.guide.findMany({
    where: {
      portalClientId: { in: portalIds },
      competencia,
      status: "PROCESSED",
      tipo: { in: ["INSS", "SIMPLES"] },
    },
    select: { portalClientId: true, tipo: true },
  });

  const byPortal = new Map();
  for (const g of guides) {
    if (!g.portalClientId) continue;
    if (!byPortal.has(g.portalClientId)) byPortal.set(g.portalClientId, new Set());
    byPortal.get(g.portalClientId).add(String(g.tipo || "").toUpperCase());
  }

  for (const portalId of portalIds) {
    const current = map.get(portalId);
    if (!current) continue;
    const tipos = byPortal.get(portalId) || new Set();
    const inssOk = current.inss.required ? tipos.has("INSS") : true;
    const dasOk = current.das.required ? tipos.has("SIMPLES") : true;
    map.set(portalId, {
      ...current,
      inss: { ...current.inss, ok: inssOk },
      das: { ...current.das, ok: dasOk },
      ok: inssOk && dasOk,
    });
  }

  return map;
}

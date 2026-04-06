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

/**
 * @param {{ hasProlabore: boolean, regimeTributario: string | null | undefined }} input
 * @returns {"INSS" | "SIMPLES" | null}
 */
export function getExpectedGuideTipo({ hasProlabore, regimeTributario }) {
  if (hasProlabore) return "INSS";
  const regime = String(regimeTributario || "")
    .trim()
    .toUpperCase();
  if (regime === "SIMPLES") return "SIMPLES";
  return null;
}

function normalizeRegimeFromLegacy(legacy) {
  if (!legacy || typeof legacy !== "object") return null;
  const r = legacy.regimeTributario ?? legacy.tipoTributario;
  return r != null ? String(r).trim() : null;
}

/**
 * @param {Array<{ portalId: string, hasProlabore: boolean, legacy: object | null }>} rows
 * @param {string} competencia YYYY-MM
 * @returns {Map<string, { competencia: string, expected: "INSS"|"SIMPLES"|null, ok: boolean }>}
 */
export async function computeGuideComplianceMap(rows, competencia) {
  const map = new Map();
  const needQuery = [];

  for (const row of rows) {
    const regime = normalizeRegimeFromLegacy(row.legacy);
    const expected = getExpectedGuideTipo({
      hasProlabore: Boolean(row.hasProlabore),
      regimeTributario: regime,
    });
    if (!expected) {
      map.set(row.portalId, { competencia, expected: null, ok: true });
    } else {
      needQuery.push({ portalId: row.portalId, expected });
    }
  }

  if (!needQuery.length) return map;

  const portalIds = [...new Set(needQuery.map((r) => r.portalId))];
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

  for (const { portalId, expected } of needQuery) {
    const tipos = byPortal.get(portalId) || new Set();
    const ok = tipos.has(expected);
    map.set(portalId, { competencia, expected, ok });
  }

  return map;
}

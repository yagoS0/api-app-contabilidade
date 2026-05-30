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

function isRegimePresumido(regimeTributario) {
  const r = String(regimeTributario || "").trim().toUpperCase();
  return r === "LUCRO_PRESUMIDO" || r === "LUCRO_REAL";
}

function normalizeRegimeFromLegacy(legacy) {
  if (!legacy || typeof legacy !== "object") return null;
  const r = legacy.regimeTributario ?? legacy.tipoTributario;
  return r != null ? String(r).trim() : null;
}

function getRequirements({ hasProlabore, regimeTributario, hasParcDasAtivo }) {
  const presumido = isRegimePresumido(regimeTributario);
  return {
    inssRequired: Boolean(hasProlabore),
    dasRequired: isRegimeSimples(regimeTributario),
    // Tributos federais/municipais exclusivos das empresas Presumidas (LUCRO_PRESUMIDO/LUCRO_REAL).
    // Simplificação v1: todo presumido tem ISS. Refinar com flag de atividade não-serviço se necessário.
    irpjRequired: presumido,
    csllRequired: presumido,
    pisCofinsRequired: presumido,
    issRequired: presumido,
    // Parcelamento DAS — só "required" quando há parcelas em ABERTO na competência atual.
    // Tag PARC_DAS no Card da Home só aparece se a empresa tem parcelamento ativo.
    parcDasRequired: Boolean(hasParcDasAtivo),
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

  // Pre-query: empresas com parcelamento DAS ativo (qualquer parcela ABERTA na competência).
  // É feito antes para que `getRequirements` saiba se a tag PARC_DAS deve aparecer.
  const allPortalIds = rows.map((r) => r.portalId).filter(Boolean);
  let parcDasAtivoSet = new Set();
  if (allPortalIds.length > 0) {
    const parcEntries = await prisma.accountingEntry.findMany({
      where: {
        portalClientId: { in: allPortalIds },
        subtipo: "PARC_DAS",
        statusPagamento: "ABERTO",
        competencia,
      },
      select: { portalClientId: true },
    });
    parcDasAtivoSet = new Set(parcEntries.map((e) => e.portalClientId));
  }

  for (const row of rows) {
    const regime = normalizeRegimeFromLegacy(row.legacy);
    const hasParcDasAtivo = parcDasAtivoSet.has(row.portalId);
    const req = getRequirements({
      hasProlabore: Boolean(row.hasProlabore),
      regimeTributario: regime,
      hasParcDasAtivo,
    });
    const base = {
      competencia,
      inss: { required: req.inssRequired, ok: !req.inssRequired },
      das: { required: req.dasRequired, ok: !req.dasRequired },
      irpj: { required: req.irpjRequired, ok: !req.irpjRequired },
      csll: { required: req.csllRequired, ok: !req.csllRequired },
      pisCofins: { required: req.pisCofinsRequired, ok: !req.pisCofinsRequired },
      iss: { required: req.issRequired, ok: !req.issRequired },
      // Parcelamento DAS: required=true significa "tem parcela ABERTA";
      // ok=false enquanto não pagar (a tag aparece amarela/laranja no card).
      parcDas: { required: req.parcDasRequired, ok: !req.parcDasRequired },
      ok:
        !req.inssRequired && !req.dasRequired
        && !req.irpjRequired && !req.csllRequired
        && !req.pisCofinsRequired && !req.issRequired
        && !req.parcDasRequired,
      // Compatibilidade com front antigo (CompanyCard formato legado).
      expected: req.inssRequired ? "INSS" : req.dasRequired ? "SIMPLES" : null,
    };
    map.set(row.portalId, base);
    if (
      req.inssRequired || req.dasRequired
      || req.irpjRequired || req.csllRequired
      || req.pisCofinsRequired || req.issRequired
    ) needQuery.push(row.portalId);
  }

  if (!needQuery.length) return map;

  const portalIds = [...new Set(needQuery)];
  const guides = await prisma.guide.findMany({
    where: {
      portalClientId: { in: portalIds },
      competencia,
      status: "PROCESSED",
      tipo: { in: ["INSS", "SIMPLES", "IRPJ", "CSLL", "PIS", "COFINS", "ISS", "DARF"] },
    },
    select: { portalClientId: true, tipo: true, extracted: true },
  });

  // Para cada empresa, agrega os tipos presentes. DARF expande pelos códigos da composição
  // (ex: DARF com 2172+8109 → marca PIS_COFINS_HAS=true; com 2089 → IRPJ_HAS=true).
  const byPortal = new Map();
  const CODIGO_TO_GROUP = {
    "2089": "IRPJ", "2362": "IRPJ", "2456": "IRPJ", "0220": "IRPJ",
    "2372": "CSLL", "2484": "CSLL", "6012": "CSLL",
    "2172": "PIS_COFINS", "8109": "PIS_COFINS",
  };
  for (const g of guides) {
    if (!g.portalClientId) continue;
    if (!byPortal.has(g.portalClientId)) byPortal.set(g.portalClientId, new Set());
    const set = byPortal.get(g.portalClientId);
    const tipo = String(g.tipo || "").toUpperCase();
    set.add(tipo);
    // Quando o tipo agrupado (PIS/COFINS) entra individualmente, marca também o grupo.
    if (tipo === "PIS" || tipo === "COFINS") set.add("PIS_COFINS");
    // DARF: explode pela composição
    if (tipo === "DARF") {
      const composicao = Array.isArray(g.extracted?.composicao) ? g.extracted.composicao : [];
      for (const c of composicao) {
        const group = CODIGO_TO_GROUP[String(c.codigo || "")];
        if (group) set.add(group);
      }
    }
  }

  for (const portalId of portalIds) {
    const current = map.get(portalId);
    if (!current) continue;
    const tipos = byPortal.get(portalId) || new Set();
    const inssOk = current.inss.required ? tipos.has("INSS") : true;
    const dasOk = current.das.required ? tipos.has("SIMPLES") : true;
    const irpjOk = current.irpj.required ? tipos.has("IRPJ") : true;
    const csllOk = current.csll.required ? tipos.has("CSLL") : true;
    const pisCofinsOk = current.pisCofins.required ? tipos.has("PIS_COFINS") : true;
    const issOk = current.iss.required ? tipos.has("ISS") : true;
    map.set(portalId, {
      ...current,
      inss: { ...current.inss, ok: inssOk },
      das: { ...current.das, ok: dasOk },
      irpj: { ...current.irpj, ok: irpjOk },
      csll: { ...current.csll, ok: csllOk },
      pisCofins: { ...current.pisCofins, ok: pisCofinsOk },
      iss: { ...current.iss, ok: issOk },
      ok: inssOk && dasOk && irpjOk && csllOk && pisCofinsOk && issOk,
    });
  }

  return map;
}

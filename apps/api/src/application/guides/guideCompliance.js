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

function getRequirements({ hasProlabore, regimeTributario, hasParcDasAtivo, semFaturamento }) {
  const presumido = isRegimePresumido(regimeTributario);
  return {
    inssRequired: Boolean(hasProlabore),
    // Mês declarado SEM FATURAMENTO não exige DAS: sem receita não há guia a pagar, e a tag
    // vermelha ficaria acesa para sempre. É decisão do dono que a tag SUMA (não que fique amarela
    // como o "Vazio"). O lembrete de transmitir a declaração zerada não se perde: ele continua na
    // pendência de apuração do calendário, que não foi tocada.
    // Só afeta o DAS — folha, despesas e parcelas seguem exigidas, porque "sem faturamento"
    // afirma apenas que não houve receita.
    dasRequired: isRegimeSimples(regimeTributario) && semFaturamento !== true,
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

  // Pre-query simétrica à de cima: meses declarados SEM FATURAMENTO. Uma query para a carteira
  // inteira, não uma por empresa — mesmo molde do `GET /companies/annual`.
  let semFaturamentoSet = new Set();
  if (allPortalIds.length > 0) {
    const semFat = await prisma.companyMonthlyCircular.findMany({
      where: { portalClientId: { in: allPortalIds }, competencia, semFaturamento: true },
      select: { portalClientId: true },
    });
    semFaturamentoSet = new Set(semFat.map((c) => c.portalClientId));
  }

  for (const row of rows) {
    const regime = normalizeRegimeFromLegacy(row.legacy);
    const hasParcDasAtivo = parcDasAtivoSet.has(row.portalId);
    const req = getRequirements({
      hasProlabore: Boolean(row.hasProlabore),
      regimeTributario: regime,
      hasParcDasAtivo,
      semFaturamento: semFaturamentoSet.has(row.portalId),
    });
    // state por tributo (Q17): "present" (guia PROCESSED) | "vazio" (ausência confirmada)
    // | "missing" (falta) | "na" (não exigido). O front pinta verde/amarelo/vermelho.
    const node = (required) => ({ required, ok: !required, state: required ? "missing" : "na" });
    const base = {
      competencia,
      inss: node(req.inssRequired),
      das: node(req.dasRequired),
      irpj: node(req.irpjRequired),
      csll: node(req.csllRequired),
      pisCofins: node(req.pisCofinsRequired),
      iss: node(req.issRequired),
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
      // Q17: inclui marcadores VAZIO (ausência confirmada) além das guias PROCESSED.
      status: { in: ["PROCESSED", "VAZIO"] },
      // C5: "OUTRA" entra porque a captura do Lucro Presumido grava UMA DARF consolidada com
      // esse tipo (não pode ser split) — sem ela, as tags IRPJ/CSLL/PIS-COFINS do card ficavam
      // vermelhas mesmo com a guia capturada. A composição abaixo resolve o tributo de cada uma.
      tipo: { in: ["INSS", "SIMPLES", "IRPJ", "CSLL", "PIS", "COFINS", "ISS", "DARF", "OUTRA"] },
    },
    select: { portalClientId: true, tipo: true, status: true, extracted: true },
  });

  const CODIGO_TO_GROUP = {
    "2089": "IRPJ", "2362": "IRPJ", "2456": "IRPJ", "0220": "IRPJ",
    "2372": "CSLL", "2484": "CSLL", "6012": "CSLL",
    "2172": "PIS_COFINS", "8109": "PIS_COFINS",
  };
  // presentByPortal = guias PROCESSED; vazioByPortal = marcadores VAZIO.
  const presentByPortal = new Map();
  const vazioByPortal = new Map();
  const addTo = (mapp, portalId, key) => {
    if (!mapp.has(portalId)) mapp.set(portalId, new Set());
    mapp.get(portalId).add(key);
  };
  for (const g of guides) {
    if (!g.portalClientId) continue;
    const tipo = String(g.tipo || "").toUpperCase();
    const target = g.status === "VAZIO" ? vazioByPortal : presentByPortal;
    addTo(target, g.portalClientId, tipo);
    if (tipo === "PIS" || tipo === "COFINS") addTo(target, g.portalClientId, "PIS_COFINS");
    // DARF/OUTRA real (PROCESSED) explode pela composição; VAZIO não tem composição.
    // O `tributo` do extrato tem prioridade sobre o código (mesma regra do parser do DCTFWeb);
    // PIS e COFINS caem no mesmo grupo PIS_COFINS.
    if ((tipo === "DARF" || tipo === "OUTRA") && g.status === "PROCESSED") {
      const composicao = Array.isArray(g.extracted?.composicao) ? g.extracted.composicao : [];
      for (const c of composicao) {
        const t = String(c.tributo || "").toUpperCase();
        const group = (t === "PIS" || t === "COFINS")
          ? "PIS_COFINS"
          : (t === "IRPJ" || t === "CSLL")
            ? t
            : CODIGO_TO_GROUP[String(c.codigo || "")];
        if (group) addTo(presentByPortal, g.portalClientId, group);
      }
    }
  }

  // present vence vazio; vazio vence missing. ok = present || vazio (ambos "resolvem").
  const resolveNode = (node, presentHas, vazioHas) => {
    if (!node.required) return { ...node, ok: true, state: "na" };
    if (presentHas) return { ...node, ok: true, state: "present" };
    if (vazioHas) return { ...node, ok: true, state: "vazio" };
    return { ...node, ok: false, state: "missing" };
  };

  for (const portalId of portalIds) {
    const current = map.get(portalId);
    if (!current) continue;
    const pres = presentByPortal.get(portalId) || new Set();
    const vaz = vazioByPortal.get(portalId) || new Set();
    const inss = resolveNode(current.inss, pres.has("INSS"), vaz.has("INSS"));
    const das = resolveNode(current.das, pres.has("SIMPLES"), vaz.has("SIMPLES"));
    const irpj = resolveNode(current.irpj, pres.has("IRPJ"), vaz.has("IRPJ"));
    const csll = resolveNode(current.csll, pres.has("CSLL"), vaz.has("CSLL"));
    const pisCofins = resolveNode(current.pisCofins, pres.has("PIS_COFINS"), vaz.has("PIS_COFINS"));
    const iss = resolveNode(current.iss, pres.has("ISS"), vaz.has("ISS"));
    map.set(portalId, {
      ...current, inss, das, irpj, csll, pisCofins, iss,
      ok: inss.ok && das.ok && irpj.ok && csll.ok && pisCofins.ok && iss.ok,
    });
  }

  return map;
}

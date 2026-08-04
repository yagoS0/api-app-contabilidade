import { prisma } from "../../infrastructure/db/prisma.js";
import { GUIDE_COMPLIANCE_COMPETENCIA } from "../../config.js";
// Faturamento vem da MESMA função que a apuração usa. Duas definições de "o mês teve receita"
// fariam o chip da guia e o fechamento discordarem — com o contador no meio.
import { faturamentoEmitPorEmpresa } from "../notas/apuracao/v2/FechamentoService.js";

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
    // ⚠ "Mês sem faturamento" NÃO zera mais esta exigência.
    //
    // Antes ele fazia `dasRequired: false`, e a tag do DAS SUMIA da tela. A intenção era boa (não
    // deixar vermelho aceso para sempre), mas criou a ambiguidade que o redesign existe para matar:
    // chip ausente passou a significar DUAS coisas — "esta empresa não deve DAS" e "o contador
    // confirmou que não houve movimento". São coisas diferentes e o contador não tinha como saber
    // qual estava vendo.
    //
    // Agora a exigência continua, e o mês sem faturamento resolve o nó como `vazio` (cinza,
    // terminal) mais abaixo. Decisão do dono, que revoga a anterior de "sumir com a tag".
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
    });
    // Estado por tributo — o CICLO DE VIDA da guia, não só "tem ou não tem":
    //
    //                       ┌─→ gerada ─→ enviada        (terminais bons)
    //   missing ────────────┤
    //                       └─→ vazio                    (terminal: ausência confirmada)
    //
    // `conflito` = marcado vazio MAS há nota emitida na competência. Volta a exigir ação.
    // `na` = não exigido para o regime → o chip nem renderiza.
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
    // `id`, `emailStatus` e `emailSentAt` entram para a listagem poder distinguir "gerada" de
    // "enviada" e ENVIAR direto do chip — antes ela só sabia o agregado "3 de 5 enviadas", sem
    // saber quais. Nenhuma query nova: são colunas a mais na que já existia.
    select: {
      portalClientId: true, tipo: true, status: true, extracted: true,
      id: true, emailStatus: true, emailSentAt: true,
      vazioEm: true, vazioPor: true, vazioMotivo: true,
    },
  });

  // Faturamento da competência, uma query para a carteira inteira. É o que permite desmentir uma
  // marcação de "sem movimento" que envelheceu: nota emitida depois da marcação devolve o chip ao
  // vermelho. Mesma definição de faturamento da apuração — importada, não copiada.
  const faturamentoPorEmpresa = await faturamentoEmitPorEmpresa({ portalIds, competencia })
    .catch(() => new Map());

  const CODIGO_TO_GROUP = {
    "2089": "IRPJ", "2362": "IRPJ", "2456": "IRPJ", "0220": "IRPJ",
    "2372": "CSLL", "2484": "CSLL", "6012": "CSLL",
    "2172": "PIS_COFINS", "8109": "PIS_COFINS",
  };
  // presentByPortal = guias PROCESSED; vazioByPortal = marcadores VAZIO.
  // ⚠ Guardam o CARIMBO da guia (id, e-mail, auditoria do vazio), não só a chave: é dele que saem
  // o botão de enviar e o "quem marcou, quando" do popover.
  const presentByPortal = new Map();
  const vazioByPortal = new Map();
  const addTo = (mapp, portalId, key, stamp) => {
    if (!mapp.has(portalId)) mapp.set(portalId, new Map());
    // Primeiro a chegar vence: a query já vem ordenada de forma estável e um segundo marcador do
    // mesmo tributo não deveria existir.
    if (!mapp.get(portalId).has(key)) mapp.get(portalId).set(key, stamp);
  };
  for (const g of guides) {
    if (!g.portalClientId) continue;
    const tipo = String(g.tipo || "").toUpperCase();
    const target = g.status === "VAZIO" ? vazioByPortal : presentByPortal;
    const stamp = {
      guideId: g.id,
      emailStatus: g.emailStatus || null,
      emailSentAt: g.emailSentAt || null,
      vazioEm: g.vazioEm || null,
      vazioPor: g.vazioPor || null,
      vazioMotivo: g.vazioMotivo || null,
    };
    addTo(target, g.portalClientId, tipo, stamp);
    if (tipo === "PIS" || tipo === "COFINS") addTo(target, g.portalClientId, "PIS_COFINS", stamp);
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
        // ⚠ Os três grupos recebem o MESMO `guideId`: no Lucro Presumido é uma DARF só para
        // IRPJ+CSLL+PIS/COFINS. Quem renderiza precisa saber disso para não oferecer três botões
        // de enviar do mesmo documento.
        if (group) addTo(presentByPortal, g.portalClientId, group, stamp);
      }
    }
  }

  /**
   * Resolve o nó no ciclo de vida. Precedência: guia real > ausência confirmada > falta.
   *
   * ⚠ A PRECEDÊNCIA É ESCRITA AQUI, de propósito. Antes ela emergia de um `if` lá em cima
   * (`semFaturamento` zerava `required` e curto-circuitava tudo), e um marcador VAZIO de SIMPLES
   * na mesma competência ficava órfão: ignorado pelo compliance, invisível na matriz, mas visível
   * na tabela de guias. Dois estados coexistiam no banco e um vencia o outro em silêncio.
   */
  const resolveNode = (node, presente, vazio, { semFaturamento = false, faturamento = 0 } = {}) => {
    if (!node.required) return { ...node, ok: true, state: "na" };

    if (presente) {
      // Guia existe: falta enviá-la ou já foi. É esta distinção que a listagem não conseguia fazer.
      const enviada = String(presente.emailStatus || "").toUpperCase() === "SENT";
      return {
        ...node, ok: true, state: enviada ? "enviada" : "gerada",
        guideId: presente.guideId,
        emailStatus: presente.emailStatus,
        emailSentAt: presente.emailSentAt,
      };
    }

    // Ausência CONFIRMADA — pelo marcador da guia ou pela afirmação de mês sem faturamento.
    if (vazio || semFaturamento) {
      // Conflito: alguém afirmou "sem movimento" e depois entrou nota emitida na competência.
      // A afirmação envelheceu e volta a exigir ação — é o oposto de deixá-la calada.
      if (faturamento > 0) {
        return {
          ...node, ok: false, state: "conflito", faturamento,
          origem: vazio ? "guia_vazia" : "sem_faturamento",
          guideId: vazio?.guideId || null,
          vazioEm: vazio?.vazioEm || null,
          vazioPor: vazio?.vazioPor || null,
        };
      }
      return {
        ...node, ok: true, state: "vazio",
        origem: vazio ? "guia_vazia" : "sem_faturamento",
        guideId: vazio?.guideId || null,
        vazioEm: vazio?.vazioEm || null,
        vazioPor: vazio?.vazioPor || null,
        vazioMotivo: vazio?.vazioMotivo || null,
      };
    }

    return { ...node, ok: false, state: "missing" };
  };

  for (const portalId of portalIds) {
    const current = map.get(portalId);
    if (!current) continue;
    const pres = presentByPortal.get(portalId) || new Map();
    const vaz = vazioByPortal.get(portalId) || new Map();
    // "Mês sem faturamento" vale SÓ para o DAS: ele afirma ausência de receita, e receita é o que
    // gera o DAS. Folha, ISS e parcelas seguem exigidas.
    const semFat = semFaturamentoSet.has(portalId);
    const faturamento = faturamentoPorEmpresa.get(portalId) || 0;

    const inss = resolveNode(current.inss, pres.get("INSS"), vaz.get("INSS"), { faturamento });
    const das = resolveNode(current.das, pres.get("SIMPLES"), vaz.get("SIMPLES"), { semFaturamento: semFat, faturamento });
    const irpj = resolveNode(current.irpj, pres.get("IRPJ"), vaz.get("IRPJ"), { faturamento });
    const csll = resolveNode(current.csll, pres.get("CSLL"), vaz.get("CSLL"), { faturamento });
    const pisCofins = resolveNode(current.pisCofins, pres.get("PIS_COFINS"), vaz.get("PIS_COFINS"), { faturamento });
    const iss = resolveNode(current.iss, pres.get("ISS"), vaz.get("ISS"), { faturamento });
    map.set(portalId, {
      ...current, inss, das, irpj, csll, pisCofins, iss,
      ok: inss.ok && das.ok && irpj.ok && csll.ok && pisCofins.ok && iss.ok,
    });
  }

  return map;
}

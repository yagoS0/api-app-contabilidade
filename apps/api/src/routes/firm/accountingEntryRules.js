import { Router } from "express";
import { prisma } from "../../infrastructure/db/prisma.js";
import { isAdminLikeUser } from "../../application/guides/GuideScheduledEmailService.js";

const EVENT_RULE_DEFAULTS = {
  RECEITA_SIMPLES: {
    descriptionTemplate: "VR REF RECEITA BRUTA DO SIMPLES NACIONAL - {{competencia}}",
    debitAccountCode: "5",
    creditAccountCode: "301",
    amountSource: "receita_bruta",
    entryDateStrategy: "LAST_DAY_OF_MONTH",
  },
  DAS_SIMPLES: {
    descriptionTemplate: "VR REF DAS SIMPLES NACIONAL - {{competencia}}",
    debitAccountCode: "401",
    creditAccountCode: "5",
    amountSource: "das_total",
    entryDateStrategy: "DUE_DATE",
  },
  BAIXA_DAS_SIMPLES: {
    // Sem contas default — contador deve configurar (passivo a quitar / banco)
    descriptionTemplate: "PAGAMENTO DAS SIMPLES NACIONAL - {{competencia}}",
    debitAccountCode: "",
    creditAccountCode: "",
    amountSource: "das_total",
    entryDateStrategy: "MANUAL",
  },
  // INSS_DCTFWEB removido: INSS é lançado manualmente via folha/pró-labore.
};

// Metadados de eventTypes expostos para o frontend (rotulagem e agrupamento).
const EVENT_TYPE_METADATA = {
  RECEITA_SIMPLES:    { label: "Receita do Simples Nacional", group: "RECEITA" },
  DAS_SIMPLES:        { label: "Provisão DAS Simples",        group: "PROVISAO" },
  BAIXA_DAS_SIMPLES:  { label: "Pagamento da DAS Simples",    group: "BAIXA" },
};

// Mapa de provisão → eventType de baixa correspondente
export const PROVISAO_TO_BAIXA_EVENT = {
  DAS_SIMPLES: "BAIXA_DAS_SIMPLES",
};

function normalizeScope(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "COMPANY" ? "COMPANY" : "GLOBAL";
}

function normalizeEventType(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "sim"].includes(normalized)) return true;
  if (["false", "0", "no", "nao"].includes(normalized)) return false;
  return Boolean(value);
}

function serializeRule(rule) {
  return {
    id: rule.id,
    companyId: rule.portalClientId || null,
    scope: rule.scope,
    eventType: rule.eventType,
    descriptionTemplate: rule.descriptionTemplate,
    debitAccountCode: rule.debitAccountCode,
    creditAccountCode: rule.creditAccountCode,
    amountSource: rule.amountSource,
    entryDateStrategy: rule.entryDateStrategy,
    isActive: rule.isActive,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

function readCompanyId(req) {
  return String(req.params.companyId || req.params.clientId || "").trim();
}

function requireManager(req, res) {
  if (!isAdminLikeUser(req.auth?.user)) {
    res.status(403).json({ error: "forbidden" });
    return false;
  }
  return true;
}

function buildRuleData(body, { scope, companyId }) {
  const eventType = normalizeEventType(body.eventType);
  if (!eventType) return { error: "eventType_required" };

  const defaults = EVENT_RULE_DEFAULTS[eventType] || {};
  const descriptionTemplate = String(body.descriptionTemplate || defaults.descriptionTemplate || "").trim();
  const debitAccountCode = String(body.debitAccountCode || defaults.debitAccountCode || "").trim();
  const creditAccountCode = String(body.creditAccountCode || defaults.creditAccountCode || "").trim();
  const amountSource = String(body.amountSource || defaults.amountSource || "").trim();
  const entryDateStrategy = String(body.entryDateStrategy || defaults.entryDateStrategy || "LAST_DAY_OF_MONTH")
    .trim()
    .toUpperCase();

  if (!descriptionTemplate) return { error: "descriptionTemplate_required" };
  if (!debitAccountCode) return { error: "debitAccountCode_required" };
  if (!creditAccountCode) return { error: "creditAccountCode_required" };
  if (!amountSource) return { error: "amountSource_required" };

  if (![
    "LAST_DAY_OF_MONTH",
    "DUE_DATE",
    "SYNC_DATE",
    "MANUAL",
  ].includes(entryDateStrategy)) {
    return { error: "entryDateStrategy_invalid" };
  }

  return {
    scope,
    portalClientId: scope === "COMPANY" ? companyId : null,
    eventType,
    descriptionTemplate,
    debitAccountCode,
    creditAccountCode,
    amountSource,
    entryDateStrategy,
    isActive: normalizeBoolean(body.isActive, true),
  };
}

function listRulesWhere({ scope, companyId }) {
  return scope === "COMPANY"
    ? { portalClientId: companyId }
    : { portalClientId: null };
}

export function createAccountingEntryRulesRouter({ log }) {
  const router = Router({ mergeParams: true });

  // GET /event-types — retorna metadata de todos os eventTypes suportados
  router.get("/event-types", async (_req, res) => {
    const data = Object.entries(EVENT_TYPE_METADATA).map(([key, meta]) => {
      const defaults = EVENT_RULE_DEFAULTS[key] || {};
      return {
        key,
        label: meta.label,
        group: meta.group,
        defaults: {
          descriptionTemplate: defaults.descriptionTemplate || "",
          debitAccountCode: defaults.debitAccountCode || "",
          creditAccountCode: defaults.creditAccountCode || "",
          amountSource: defaults.amountSource || "",
          entryDateStrategy: defaults.entryDateStrategy || "LAST_DAY_OF_MONTH",
        },
      };
    });
    return res.json({ data });
  });

  router.get("/global", async (req, res) => {
    if (!requireManager(req, res)) return;
    const rules = await prisma.accountingEntryRule.findMany({
      where: { portalClientId: null },
      orderBy: [{ eventType: "asc" }, { createdAt: "asc" }],
    });
    return res.json({ data: rules.map(serializeRule) });
  });

  router.post("/global", async (req, res) => {
    if (!requireManager(req, res)) return;
    const payload = buildRuleData(req.body || {}, { scope: "GLOBAL", companyId: null });
    if (payload.error) return res.status(400).json({ error: payload.error });

    try {
      const rule = await prisma.accountingEntryRule.create({ data: payload });
      return res.status(201).json({ ok: true, rule: serializeRule(rule) });
    } catch (err) {
      log.error({ err }, "Erro ao criar regra global de lançamento");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  router.get("/", async (req, res) => {
    const companyId = readCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "company_id_required" });
    const rules = await prisma.accountingEntryRule.findMany({
      where: listRulesWhere({ scope: "COMPANY", companyId }),
      orderBy: [{ isActive: "desc" }, { eventType: "asc" }, { createdAt: "asc" }],
    });
    return res.json({ data: rules.map(serializeRule) });
  });

  router.post("/", async (req, res) => {
    const companyId = readCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "company_id_required" });
    if (!requireManager(req, res)) return;

    const payload = buildRuleData(req.body || {}, { scope: "COMPANY", companyId });
    if (payload.error) return res.status(400).json({ error: payload.error });

    try {
      const rule = await prisma.accountingEntryRule.create({ data: payload });
      return res.status(201).json({ ok: true, rule: serializeRule(rule) });
    } catch (err) {
      log.error({ err, companyId }, "Erro ao criar regra da empresa");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  router.put("/:ruleId", async (req, res) => {
    if (!requireManager(req, res)) return;

    const companyId = readCompanyId(req);
    const ruleId = String(req.params.ruleId || "").trim();
    if (!ruleId) return res.status(400).json({ error: "rule_id_required" });

    const existing = await prisma.accountingEntryRule.findUnique({ where: { id: ruleId } });
    if (!existing) return res.status(404).json({ error: "rule_not_found" });
    if (companyId && existing.portalClientId !== companyId) {
      return res.status(403).json({ error: "forbidden" });
    }

    const payload = buildRuleData(req.body || {}, {
      scope: existing.portalClientId ? "COMPANY" : "GLOBAL",
      companyId: existing.portalClientId,
    });
    if (payload.error) return res.status(400).json({ error: payload.error });

    try {
      const rule = await prisma.accountingEntryRule.update({
        where: { id: ruleId },
        data: {
          scope: payload.scope,
          portalClientId: payload.portalClientId,
          eventType: payload.eventType,
          descriptionTemplate: payload.descriptionTemplate,
          debitAccountCode: payload.debitAccountCode,
          creditAccountCode: payload.creditAccountCode,
          amountSource: payload.amountSource,
          entryDateStrategy: payload.entryDateStrategy,
          isActive: payload.isActive,
        },
      });
      return res.json({ ok: true, rule: serializeRule(rule) });
    } catch (err) {
      log.error({ err, ruleId }, "Erro ao atualizar regra de lançamento");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  router.patch("/:ruleId/deactivate", async (req, res) => {
    if (!requireManager(req, res)) return;

    const companyId = readCompanyId(req);
    const ruleId = String(req.params.ruleId || "").trim();
    if (!ruleId) return res.status(400).json({ error: "rule_id_required" });

    const existing = await prisma.accountingEntryRule.findUnique({ where: { id: ruleId } });
    if (!existing) return res.status(404).json({ error: "rule_not_found" });
    if (companyId && existing.portalClientId !== companyId) {
      return res.status(403).json({ error: "forbidden" });
    }

    const rule = await prisma.accountingEntryRule.update({
      where: { id: ruleId },
      data: { isActive: false },
    });
    return res.json({ ok: true, rule: serializeRule(rule) });
  });

  return router;
}

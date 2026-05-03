import { prisma } from "../../infrastructure/db/prisma.js";
import { normalizeCompetencia } from "../guides/guideContract.js";

const EVENT_DEFINITIONS = Object.freeze({
  RECEITA_SIMPLES: {
    tipo: "RECEITA",
    subtipo: null,
    statusPagamento: "NA",
    amountSource: "receita_bruta",
  },
  DAS_SIMPLES: {
    tipo: "PROVISAO",
    subtipo: "DAS",
    statusPagamento: "ABERTO",
    amountSource: "das_total",
  },
  INSS_DCTFWEB: {
    tipo: "PROVISAO",
    subtipo: "INSS",
    statusPagamento: "ABERTO",
    amountSource: "inss_total",
  },
});

const DEFAULT_RULE_FALLBACKS = Object.freeze({
  RECEITA_SIMPLES: {
    descriptionTemplate: "VR REF RECEITA BRUTA DO SIMPLES NACIONAL - {{competencia}}",
    debitAccountCode: "5",
    creditAccountCode: "301",
    entryDateStrategy: "LAST_DAY_OF_MONTH",
  },
  DAS_SIMPLES: {
    descriptionTemplate: "VR REF DAS SIMPLES NACIONAL - {{competencia}}",
    debitAccountCode: "401",
    creditAccountCode: "5",
    entryDateStrategy: "DUE_DATE",
  },
  INSS_DCTFWEB: {
    descriptionTemplate: "VR REF INSS DCTFWEB - {{competencia}}",
    debitAccountCode: "420",
    creditAccountCode: "5",
    entryDateStrategy: "DUE_DATE",
  },
});

const AMOUNT_SOURCE_FIELD_MAP = Object.freeze({
  receita_bruta: "receitaBruta",
  receitaBruta: "receitaBruta",
  das_total: "dasTotal",
  dasTotal: "dasTotal",
  inss_total: "inssTotal",
  inssTotal: "inssTotal",
});

function parseDecimal(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.includes(",") ? Number(raw.replace(/\./g, "").replace(",", ".")) : Number(raw);
  return Number.isFinite(normalized) ? normalized : null;
}

function formatCompetenciaLabel(competencia) {
  const normalized = normalizeCompetencia(competencia);
  if (!normalized) return null;
  const [yyyy, mm] = normalized.split("-");
  return `${mm}/${yyyy}`;
}

function applyTemplate(template, context) {
  return String(template || "")
    .replace(/\{\{\s*competencia\s*\}\}/gi, context.competenciaLabel || context.competencia || "")
    .replace(/\{\{\s*companyName\s*\}\}/gi, context.companyName || "")
    .replace(/\{\{\s*cnpj\s*\}\}/gi, context.cnpj || "");
}

function getLastDayOfMonth(competencia) {
  const normalized = normalizeCompetencia(competencia);
  if (!normalized) return null;
  const [yyyy, mm] = normalized.split("-");
  const year = Number(yyyy);
  const month = Number(mm);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
}

function resolveEntryDate({ strategy, competencia, circular, now }) {
  const normalizedStrategy = String(strategy || "LAST_DAY_OF_MONTH").toUpperCase();
  if (normalizedStrategy === "SYNC_DATE") return now;
  if (normalizedStrategy === "MANUAL") return now;

  if (normalizedStrategy === "DUE_DATE") {
    const dueDateRaw =
      circular?.metadata?.dueDates?.[circular?.eventType || ""] ||
      circular?.metadata?.dueDates?.[circular?.amountSource || ""] ||
      circular?.metadata?.vencimento ||
      circular?.metadata?.dueDate ||
      null;
    if (dueDateRaw) {
      const dueDate = new Date(dueDateRaw);
      if (!Number.isNaN(dueDate.getTime())) return dueDate;
    }
  }

  return getLastDayOfMonth(competencia) || now;
}

function sumEntryLines(lines) {
  return (lines || []).reduce((total, line) => total + Number(line?.valor || 0), 0);
}

function resolveAmount(circular, amountSource) {
  const field = AMOUNT_SOURCE_FIELD_MAP[amountSource] || amountSource;
  return parseDecimal(circular?.[field]);
}

function buildEventsFromCircular(circular) {
  const events = [];
  for (const [eventType, definition] of Object.entries(EVENT_DEFINITIONS)) {
    const amount = resolveAmount(circular, definition.amountSource);
    if (amount != null && amount > 0) {
      events.push({
        eventType,
        amount,
        amountSource: definition.amountSource,
        tipo: definition.tipo,
        subtipo: definition.subtipo,
        statusPagamento: definition.statusPagamento,
        circularField: AMOUNT_SOURCE_FIELD_MAP[definition.amountSource],
      });
    }
  }
  return events;
}

async function resolveRule(tx, { portalClientId, eventType }) {
  const companyRule = await tx.accountingEntryRule.findFirst({
    where: {
      portalClientId,
      eventType,
      isActive: true,
    },
  });
  if (companyRule) return companyRule;

  const globalRule = await tx.accountingEntryRule.findFirst({
    where: {
      portalClientId: null,
      eventType,
      isActive: true,
    },
  });
  if (globalRule) return globalRule;

  const fallback = DEFAULT_RULE_FALLBACKS[eventType];
  if (!fallback) return null;
  return {
    id: null,
    descriptionTemplate: fallback.descriptionTemplate,
    debitAccountCode: fallback.debitAccountCode,
    creditAccountCode: fallback.creditAccountCode,
    entryDateStrategy: fallback.entryDateStrategy,
  };
}

function findChangedValue(existingEntry, nextEntry) {
  if (!existingEntry) return true;
  return (
    existingEntry.data?.getTime?.() !== nextEntry.data.getTime() ||
    String(existingEntry.historico || "") !== String(nextEntry.historico || "") ||
    String(existingEntry.tipo || "") !== String(nextEntry.tipo || "") ||
    String(existingEntry.circularId || "") !== String(nextEntry.circularId || "") ||
    String(existingEntry.ruleId || "") !== String(nextEntry.ruleId || "") ||
    String(existingEntry.eventType || "") !== String(nextEntry.eventType || "") ||
    Math.abs(Number(sumEntryLines(existingEntry.lines || [])) - Number(nextEntry.amount || 0)) > 0.01
  );
}

async function upsertGeneratedEntry(tx, { existingEntry, portalClientId, circular, rule, event, company, now }) {
  const context = {
    competencia: circular.competencia,
    competenciaLabel: formatCompetenciaLabel(circular.competencia),
    companyName: company.razao,
    cnpj: company.cnpj,
  };
  const historico = applyTemplate(rule.descriptionTemplate, context);
  const data = resolveEntryDate({
    strategy: rule.entryDateStrategy,
    competencia: circular.competencia,
    circular: { ...circular, amountSource: event.amountSource, eventType: event.eventType },
    now,
  });

  const nextEntry = {
    portalClientId,
    circularId: circular.id,
    ruleId: rule.id,
    eventType: event.eventType,
    data,
    competencia: circular.competencia,
    historico,
    tipo: event.tipo,
    subtipo: event.subtipo || null,
    origem: "SERPRO",
    loteImportacao: `SERPRO-${circular.competencia}`,
    status: "RASCUNHO",
    statusPagamento: event.statusPagamento || "NA",
    amount: event.amount,
  };

  if (existingEntry) {
    if (existingEntry.status === "EXPORTADO") {
      return {
        action: "divergence",
        entry: existingEntry,
        divergenceMessage: `Lançamento de ${event.eventType} já exportado; divergência registrada para revisão.`,
      };
    }

    const changed = findChangedValue(existingEntry, nextEntry);
    if (!changed) {
      return { action: "noop", entry: existingEntry };
    }

    const updated = await tx.accountingEntry.update({
      where: { id: existingEntry.id },
      data: {
        circularId: circular.id,
        ruleId: rule.id,
        eventType: event.eventType,
        data,
        competencia: circular.competencia,
        historico,
        tipo: event.tipo,
        subtipo: event.subtipo || null,
        origem: "SERPRO",
        loteImportacao: `SERPRO-${circular.competencia}`,
        status: "RASCUNHO",
        statusPagamento: event.statusPagamento || "NA",
      },
    });

    await tx.accountingEntryLine.deleteMany({ where: { entryId: updated.id } });
    await tx.accountingEntryLine.createMany({
      data: [
        { entryId: updated.id, conta: rule.debitAccountCode, tipo: "D", valor: event.amount, ordem: 0 },
        { entryId: updated.id, conta: rule.creditAccountCode, tipo: "C", valor: event.amount, ordem: 1 },
      ],
    });

    return { action: "updated", entry: updated };
  }

  const created = await tx.accountingEntry.create({
    data: {
      portalClientId,
      circularId: circular.id,
      ruleId: rule.id,
      eventType: event.eventType,
      data,
        competencia: circular.competencia,
        historico,
        tipo: event.tipo,
        subtipo: event.subtipo || null,
        origem: "SERPRO",
        loteImportacao: `SERPRO-${circular.competencia}`,
        status: "RASCUNHO",
        statusPagamento: event.statusPagamento || "NA",
        lines: {
        createMany: {
          data: [
            { conta: rule.debitAccountCode, tipo: "D", valor: event.amount, ordem: 0 },
            { conta: rule.creditAccountCode, tipo: "C", valor: event.amount, ordem: 1 },
          ],
        },
      },
    },
    include: { lines: { orderBy: { ordem: "asc" } } },
  });

  return { action: "created", entry: created };
}

export async function generateEntriesFromCircular({ portalClientId, competencia, now = new Date() }) {
  const normalizedPortalClientId = String(portalClientId || "").trim();
  const normalizedCompetencia = normalizeCompetencia(competencia);
  if (!normalizedPortalClientId) {
    const err = new Error("portal_company_id_required");
    err.code = "PORTAL_COMPANY_ID_REQUIRED";
    throw err;
  }
  if (!normalizedCompetencia) {
    const err = new Error("competencia_required");
    err.code = "COMPETENCIA_REQUIRED";
    throw err;
  }

  return prisma.$transaction(async (tx) => {
    const company = await tx.portalClient.findUnique({
      where: { id: normalizedPortalClientId },
      select: { id: true, razao: true, cnpj: true },
    });
    if (!company) {
      const err = new Error("portal_company_not_found");
      err.code = "PORTAL_COMPANY_NOT_FOUND";
      throw err;
    }

    const circular = await tx.companyMonthlyCircular.findUnique({
      where: {
        portalClientId_competencia: {
          portalClientId: normalizedPortalClientId,
          competencia: normalizedCompetencia,
        },
      },
    });

    if (!circular) {
      return {
        ok: false,
        reason: "circular_not_found",
        portalClientId: normalizedPortalClientId,
        competencia: normalizedCompetencia,
      };
    }

    const events = buildEventsFromCircular(circular);
    const generatedEntries = [];
    const skipped = [];
    const divergences = [];

    for (const event of events) {
      // eslint-disable-next-line no-await-in-loop
      const rule = await resolveRule(tx, { portalClientId: normalizedPortalClientId, eventType: event.eventType });
      if (!rule) {
        skipped.push({
          eventType: event.eventType,
          reason: "missing_rule",
        });
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const existingEntry = await tx.accountingEntry.findFirst({
        where: {
          portalClientId: normalizedPortalClientId,
          competencia: normalizedCompetencia,
          eventType: event.eventType,
          origem: "SERPRO",
        },
        include: { lines: { orderBy: { ordem: "asc" } } },
      });

      // eslint-disable-next-line no-await-in-loop
      const outcome = await upsertGeneratedEntry(tx, {
        existingEntry,
        portalClientId: normalizedPortalClientId,
        circular,
        rule,
        event,
        company,
        now,
      });

      if (outcome.action === "created" || outcome.action === "updated" || outcome.action === "noop") {
        generatedEntries.push({
          eventType: event.eventType,
          action: outcome.action,
          entryId: outcome.entry?.id || null,
        });
      }
      if (outcome.action === "divergence") {
        divergences.push({
          eventType: event.eventType,
          entryId: outcome.entry?.id || null,
          message: outcome.divergenceMessage,
        });
      }
    }

    const hasDivergence = divergences.length > 0 || skipped.length > 0;
    await tx.companyMonthlyCircular.update({
      where: { id: circular.id },
      data: {
        hasAccountingDivergence: hasDivergence,
        accountingDivergenceMessage: hasDivergence
          ? [...divergences.map((item) => item.message), ...skipped.map((item) => `Evento ${item.eventType}: regra ausente`)].join("; ")
          : null,
      },
    });

    const refreshedCircular = await tx.companyMonthlyCircular.findUnique({
      where: { id: circular.id },
    });

    return {
      ok: true,
      portalClientId: normalizedPortalClientId,
      competencia: normalizedCompetencia,
      circular: refreshedCircular,
      events,
      generatedEntries,
      skipped,
      divergences,
    };
  });
}

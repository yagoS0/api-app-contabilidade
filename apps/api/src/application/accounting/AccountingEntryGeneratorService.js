import { prisma } from "../../infrastructure/db/prisma.js";
import { normalizeCompetencia } from "../guides/guideContract.js";

// INSS_DCTFWEB removido: INSS deve ser lançado manualmente em conjunto com folha/pró-labore.
//
// Eventos de RECEITA suportam múltiplas atividades do PGDAS-D:
//  - RECEITA_SERVICO       — agregado de todos os serviços (Anexo III/IV/V — não separa)
//  - RECEITA_VENDA_SEM_ST  — vendas sem substituição tributária
//  - RECEITA_VENDA_COM_ST  — vendas com substituição tributária (ICMS-ST)
//
// Cada definição traz `descriptionTemplate` e `entryDateStrategy` (defaults pro lançamento).
// Contas D/C NÃO têm fallback hardcoded — vêm do `AccountingHistorico` da empresa
// (memória aprendida do primeiro preenchimento manual pelo contador). Exceção: `DAS_SIMPLES`
// tem fallback (`DEFAULT_ACCOUNTS_DAS`) por ser tributo padronizado.
const EVENT_DEFINITIONS = Object.freeze({
  RECEITA_SERVICO: {
    tipo: "RECEITA",
    subtipo: null,
    statusPagamento: "NA",
    amountSource: "receita_servicos",
    descriptionTemplate: "VR REF RECEITA SERVIÇOS - SIMPLES NACIONAL - {{competencia}}",
    entryDateStrategy: "LAST_DAY_OF_MONTH",
  },
  RECEITA_VENDA_SEM_ST: {
    tipo: "RECEITA",
    subtipo: null,
    statusPagamento: "NA",
    amountSource: "receita_vendas_sem_st",
    descriptionTemplate: "VR REF RECEITA VENDAS S/ ST - SIMPLES NACIONAL - {{competencia}}",
    entryDateStrategy: "LAST_DAY_OF_MONTH",
  },
  RECEITA_VENDA_COM_ST: {
    tipo: "RECEITA",
    subtipo: null,
    statusPagamento: "NA",
    amountSource: "receita_vendas_com_st",
    descriptionTemplate: "VR REF RECEITA VENDAS C/ ST - SIMPLES NACIONAL - {{competencia}}",
    entryDateStrategy: "LAST_DAY_OF_MONTH",
  },
  DAS_SIMPLES: {
    tipo: "PROVISAO",
    subtipo: "DAS",
    statusPagamento: "ABERTO",
    amountSource: "das_total",
    descriptionTemplate: "VR REF DAS SIMPLES NACIONAL - {{competencia}}",
    entryDateStrategy: "DUE_DATE",
  },
});

// Sem fallback hardcoded: TODOS os eventos (incluindo DAS_SIMPLES) começam com contas D/C vazias
// e aguardam o 1º preenchimento manual pelo contador. O auto-save no PUT/POST de entries memoriza
// o par (eventType, empresa) no AccountingHistorico; sync seguinte da mesma empresa auto-preenche.

const AMOUNT_SOURCE_FIELD_MAP = Object.freeze({
  receita_bruta: "receitaBruta",
  receitaBruta: "receitaBruta",
  receita_servicos: "receitaServicos",
  receitaServicos: "receitaServicos",
  receita_vendas_sem_st: "receitaVendasSemST",
  receitaVendasSemST: "receitaVendasSemST",
  receita_vendas_com_st: "receitaVendasComST",
  receitaVendasComST: "receitaVendasComST",
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

export function formatCompetenciaLabel(competencia) {
  const normalized = normalizeCompetencia(competencia);
  if (!normalized) return null;
  const [yyyy, mm] = normalized.split("-");
  return `${mm}/${yyyy}`;
}

export function applyTemplate(template, context) {
  // Q9: tokens novos para parcelamentos. Usados em templates kind=PARCELAMENTO_*.
  // Tokens não encontrados no context viram string vazia (não quebra o template padrão).
  return String(template || "")
    .replace(/\{\{\s*competencia\s*\}\}/gi, context.competenciaLabel || context.competencia || "")
    .replace(/\{\{\s*companyName\s*\}\}/gi, context.companyName || "")
    .replace(/\{\{\s*cnpj\s*\}\}/gi, context.cnpj || "")
    .replace(/\{\{\s*numeroParcela\s*\}\}/gi, context.numeroParcela != null ? String(context.numeroParcela).padStart(2, "0") : "")
    .replace(/\{\{\s*numParcelas\s*\}\}/gi, context.numParcelas != null ? String(context.numParcelas) : "")
    .replace(/\{\{\s*numEntradas\s*\}\}/gi, context.numEntradas != null ? String(context.numEntradas) : "")
    .replace(/\{\{\s*numParcelasRestantes\s*\}\}/gi, context.numParcelasRestantes != null ? String(context.numParcelasRestantes) : "")
    .replace(/\{\{\s*periodosReferenciados\s*\}\}/gi, context.periodosReferenciados || "");
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

/**
 * Resolve a regra (AccountingEntryRule) explicitamente cadastrada pela empresa ou globalmente.
 * Se nenhuma regra existir, monta uma virtual a partir de EVENT_DEFINITIONS contendo
 * `descriptionTemplate` e `entryDateStrategy` (defaults) — mas SEM contas D/C definidas.
 * As contas D/C ficam por conta do lookup em `AccountingHistorico` (memória do contador),
 * com fallback hardcoded apenas para `DAS_SIMPLES`.
 */
export async function resolveRule(tx, { portalClientId, eventType }) {
  const companyRule = await tx.accountingEntryRule.findFirst({
    where: { portalClientId, eventType, isActive: true },
  });
  if (companyRule) return companyRule;

  const globalRule = await tx.accountingEntryRule.findFirst({
    where: { portalClientId: null, eventType, isActive: true },
  });
  if (globalRule) return globalRule;

  const definition = EVENT_DEFINITIONS[eventType];
  if (!definition) return null;
  return {
    id: null,
    descriptionTemplate: definition.descriptionTemplate,
    debitAccountCode: null, // será resolvido por lookupAccountsFromHistorico
    creditAccountCode: null,
    entryDateStrategy: definition.entryDateStrategy,
  };
}

/**
 * Lookup do par (contaDebito, contaCredito) memorizado no AccountingHistorico para
 * (companyPortalClientId + eventType). Usado pela primeira vez quando o contador edita
 * um entry automático e preenche as contas — auto-save grava aqui; sync seguinte reusa.
 */
export async function lookupAccountsFromHistorico(tx, { portalClientId, eventType }) {
  if (!portalClientId || !eventType) return {};
  const h = await tx.accountingHistorico.findFirst({
    where: {
      companyPortalClientId: String(portalClientId),
      eventType,
      OR: [{ contaDebito: { not: null } }, { contaCredito: { not: null } }],
    },
    orderBy: [{ usageCount: "desc" }, { updatedAt: "desc" }],
    select: { contaDebito: true, contaCredito: true },
  });
  if (!h) return {};
  return {
    debitAccountCode: h.contaDebito || null,
    creditAccountCode: h.contaCredito || null,
  };
}

function findChangedValue(existingEntry, nextEntry) {
  if (!existingEntry) return true;
  // `data` e `historico` são considerados editáveis pelo contador após a criação;
  // não disparam re-update pelo worker. Apenas mudanças em valor/relação geram update.
  return (
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

  // Resolução das contas D/C — ordem de prioridade:
  //   1. Regra explícita (AccountingEntryRule) já trouxe contas → usa
  //   2. Memória do AccountingHistorico (empresa + eventType)   → usa
  //   3. Vazio "" → contador preenche manualmente; auto-save memoriza
  let debitConta = rule.debitAccountCode || null;
  let creditConta = rule.creditAccountCode || null;
  if (!debitConta && !creditConta) {
    const memorized = await lookupAccountsFromHistorico(tx, {
      portalClientId,
      eventType: event.eventType,
    });
    debitConta = memorized.debitAccountCode || null;
    creditConta = memorized.creditAccountCode || null;
  }
  debitConta = debitConta || "";
  creditConta = creditConta || "";

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

    // DAS_SIMPLES: ao recalcular, manter valor/lines/data/historico originais e apenas marcar como recalculada
    const previousAmount = sumEntryLines(existingEntry.lines || []);
    const amountChanged = Math.abs(Number(previousAmount) - Number(event.amount || 0)) > 0.01;
    if (event.eventType === "DAS_SIMPLES" && amountChanged) {
      const updated = await tx.accountingEntry.update({
        where: { id: existingEntry.id },
        data: {
          circularId: circular.id,
          ruleId: rule.id,
          eventType: event.eventType,
          competencia: circular.competencia,
          tipo: event.tipo,
          subtipo: event.subtipo || null,
          origem: "SERPRO",
          loteImportacao: `SERPRO-${circular.competencia}`,
          status: "RASCUNHO",
          statusPagamento: event.statusPagamento || "NA",
          recalculatedAt: now,
          recalculatedFromValor: previousAmount,
          recalculatedToValor: event.amount,
          recalculatedNotes: `Guia recalculada após vencimento. Valor original mantido no lançamento; valor atualizado disponível na circular.`,
          // data, historico, lines preservados — flag de recálculo é indicada via badge no UI
        },
      });
      return { action: "recalculated", entry: updated };
    }

    // Campos `data` e `historico` são preservados (editáveis pelo contador).
    // Worker só atualiza valor/lines + metadados estruturais.
    const updated = await tx.accountingEntry.update({
      where: { id: existingEntry.id },
      data: {
        circularId: circular.id,
        ruleId: rule.id,
        eventType: event.eventType,
        competencia: circular.competencia,
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
        { entryId: updated.id, conta: debitConta, tipo: "D", valor: event.amount, ordem: 0 },
        { entryId: updated.id, conta: creditConta, tipo: "C", valor: event.amount, ordem: 1 },
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
            { conta: debitConta, tipo: "D", valor: event.amount, ordem: 0 },
            { conta: creditConta, tipo: "C", valor: event.amount, ordem: 1 },
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

      if (
        outcome.action === "created" ||
        outcome.action === "updated" ||
        outcome.action === "recalculated" ||
        outcome.action === "noop"
      ) {
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

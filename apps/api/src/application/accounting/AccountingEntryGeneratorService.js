import { prisma } from "../../infrastructure/db/prisma.js";
import { normalizeCompetencia } from "../guides/guideContract.js";
import { tipoLinhaDaBaixa } from "./tipoLinhaBaixa.js";

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
    // Q11.3: lançamento de provisão = último dia do mês ANTERIOR ao vencimento.
    // Ex: DAS vence 20/05/2026 → provisão lançada 30/04/2026.
    entryDateStrategy: "LAST_DAY_BEFORE_DUE_DATE",
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

// Q11.3: dado um vencimento (Date), retorna o último dia do mês ANTERIOR a esse vencimento.
// Ex: due=03/06/2026 → result=31/05/2026.
// `new Date(Date.UTC(year, month, 0))` retorna o último dia do mês anterior (mês=0 = dezembro do ano anterior).
export function getLastDayOfMonthBeforeDueDate(dueDate) {
  if (!dueDate) return null;
  const d = dueDate instanceof Date ? dueDate : new Date(dueDate);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0, 23, 59, 59, 999));
}

function pickDueDateFromCircular(circular) {
  return (
    circular?.metadata?.dueDates?.[circular?.eventType || ""] ||
    circular?.metadata?.dueDates?.[circular?.amountSource || ""] ||
    circular?.metadata?.vencimento ||
    circular?.metadata?.dueDate ||
    null
  );
}

function resolveEntryDate({ strategy, competencia, circular, now }) {
  const normalizedStrategy = String(strategy || "LAST_DAY_OF_MONTH").toUpperCase();
  if (normalizedStrategy === "SYNC_DATE") return now;
  if (normalizedStrategy === "MANUAL") return now;

  // Q11.3: estratégia padrão pra provisão — vencimento - 1 mês → último dia desse mês.
  // Usada por DAS_SIMPLES (era DUE_DATE) e por toda nova provisão derivada de guia com vencimento.
  if (normalizedStrategy === "LAST_DAY_BEFORE_DUE_DATE") {
    const dueDateRaw = pickDueDateFromCircular(circular);
    const result = getLastDayOfMonthBeforeDueDate(dueDateRaw);
    if (result) return result;
    // fallback: último dia da competência (provisão clássica)
    return getLastDayOfMonth(competencia) || now;
  }

  if (normalizedStrategy === "DUE_DATE") {
    const dueDateRaw = pickDueDateFromCircular(circular);
    if (dueDateRaw) {
      const dueDate = new Date(dueDateRaw);
      if (!Number.isNaN(dueDate.getTime())) return dueDate;
    }
  }

  return getLastDayOfMonth(competencia) || now;
}

// Contas de acréscimo: juros/multa NÃO amortizam o passivo, então não contam como principal
// abatido. Mesmos códigos usados no cálculo de saldo da Circular (routes/firm/accountingEntries.js).
const CONTA_JUROS_GEN = "501";
const CONTA_MULTA_GEN = "506";

// Status de uma provisão que JÁ TEM baixas, dado um principal novo. Sem isto, atualizar o valor
// de uma provisão baixada a jogava de volta pra ABERTO (o worker sobrescrevia o status), e uma
// provisão corrigida pra menor ficava eternamente PARCIAL com a diferença "em aberto".
function statusPelasBaixas(baixas, principalNovo) {
  const abatido = (baixas || []).reduce((total, b) => total + (b.lines || [])
    .filter((l) => String(l.tipo).toUpperCase() === "D"
      && ![CONTA_JUROS_GEN, CONTA_MULTA_GEN].includes(String(l.conta || "").trim()))
    .reduce((s, l) => s + Number(l.valor || 0), 0), 0);
  const abat = Math.round(abatido * 100) / 100;
  if (abat <= 0.009) return null;                                  // sem baixa → mantém o padrão
  return abat + 0.01 >= Number(principalNovo || 0) ? "PAGO" : "PARCIAL";
}

// ⚠ O VALOR DE UM LANÇAMENTO É A SOMA DAS LINHAS DE **DÉBITO**, NUNCA A DE TODAS.
//
// Este gerador escreve sempre um par balanceado (D=valor, C=valor). Somar as duas pernas devolvia
// **o dobro** do valor — e esse número alimentava as duas comparações do arquivo:
//   • `findChangedValue`  → `2×valor ≠ valor` é verdade SEMPRE, então `noop` era inalcançável e
//     toda sincronia reescrevia as linhas;
//   • `amountChanged` (o gatilho da guarda do DAS) → também SEMPRE verdadeiro, então a guarda de
//     recálculo disparava a CADA reconsulta, mesmo com o valor idêntico.
// A prova está gravada em produção: `recalculatedFromValor` é **exatamente 2×** a soma dos débitos
// do lançamento em 55 de 89 provisões de DAS (ex.: ATIM 2026-02, `3.063,86 = 2 × 1.531,93`).
// Mesma leitura de `statusPelasBaixas`, logo acima: quem responde "quanto vale" é o débito.
function valorDoLancamento(lines) {
  return (lines || [])
    .filter((line) => String(line?.tipo || "").toUpperCase() === "D")
    .reduce((total, line) => total + Number(line?.valor || 0), 0);
}

// De onde veio o número que está na circular — e é isso que decide se ele é a VERDADE do imposto
// ou um total que já pode carregar juros/multa.
//
//  • `EXTRATO` — `syncPgdasByCompetencia`: `dasTotal` sai do PDF da DECLARAÇÃO transmitida à
//    Receita (imposto APURADO). Retificadora entra por aqui, e o valor novo é a verdade declarada.
//  • `GUIA`    — `capturePgdasGuideForCompany`: `dasTotal` sai do documento de arrecadação, que
//    **depois do vencimento vem recalculado com juros e multa**. Aí o valor novo NÃO é o imposto
//    do mês, e a provisão tem de continuar valendo o principal.
export const FONTE_VALOR_EXTRATO = "EXTRATO";
export const FONTE_VALOR_GUIA = "GUIA";

// Frente B: amountSource → chave do tributo em `circular.acrescimos`.
const AMOUNT_SOURCE_TO_TRIBUTO = Object.freeze({
  das_total: "DAS", dasTotal: "DAS",
  inss_total: "INSS", inssTotal: "INSS",
});

function resolveAmount(circular, amountSource) {
  // Frente B: quando há split principal/juros/multa (guia recalculada após vencimento),
  // a PROVISÃO usa o PRINCIPAL (valor original) — os juros/multa ficam só destacados na circular.
  const tributo = AMOUNT_SOURCE_TO_TRIBUTO[amountSource];
  if (tributo && circular?.acrescimos && typeof circular.acrescimos === "object") {
    const principal = parseDecimal(circular.acrescimos?.[tributo]?.principal);
    if (principal != null) return principal;
  }
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
  if (h) {
    return {
      debitAccountCode: h.contaDebito || null,
      creditAccountCode: h.contaCredito || null,
    };
  }
  // Q50: fallback GLOBAL (companyPortalClientId null) — empresa nova ainda não tem memória própria,
  // mas herda o padrão do escritório já no primeiro extrato (não vem mais com contas vazias).
  const g = await tx.accountingHistorico.findFirst({
    where: {
      companyPortalClientId: null,
      eventType,
      OR: [{ contaDebito: { not: null } }, { contaCredito: { not: null } }],
    },
    orderBy: [{ usageCount: "desc" }, { updatedAt: "desc" }],
    select: { contaDebito: true, contaCredito: true },
  });
  if (!g) return {};
  return {
    debitAccountCode: g.contaDebito || null,
    creditAccountCode: g.contaCredito || null,
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
    Math.abs(Number(valorDoLancamento(existingEntry.lines || [])) - Number(nextEntry.amount || 0)) > 0.01
  );
}

async function upsertGeneratedEntry(tx, { edicaoManual = false, fonteValor = FONTE_VALOR_GUIA, existingEntry, portalClientId, circular, rule, event, company, now }) {
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
    const previousAmount = valorDoLancamento(existingEntry.lines || []);
    const amountChanged = Math.abs(Number(previousAmount) - Number(event.amount || 0)) > 0.01;
    // Recálculo AUTOMÁTICO do SERPRO (juros/multa após vencimento): preserva o lançamento
    // original e só sinaliza. Correção MANUAL do contador NÃO entra aqui — se ele alterou o
    // valor é porque o anterior estava errado, então as linhas têm que acompanhar (senão a
    // baixa do valor certo deixa a diferença em aberto como PARCIAL).
    //
    // ⚠ E a DECLARAÇÃO também não entra. A guarda existe para o documento de arrecadação
    // recalculado depois do vencimento — não para a RETIFICADORA, em que o extrato traz o imposto
    // NOVO porque a declaração mudou. Sem distinguir a fonte, ela tratava a verdade declarada à
    // Receita como se fosse acréscimo a ignorar: a receita entrava (ramo genérico, abaixo) e o
    // imposto ficava congelado no valor anterior — com o número novo gravado em
    // `recalculatedToValor`, isto é, LIDO e descartado. Medido em produção (12/08/2026,
    // `scripts/diag-retificadora-imposto.mjs`).
    //
    // A distinção NÃO é "o valor subiu": juros e retificadora são indistinguíveis pelo número.
    // Quem sabe é a FONTE do dado — extrato (declaração) × guia (documento com acréscimo).
    const fonteEhDeclaracao = String(fonteValor || "").toUpperCase() === FONTE_VALOR_EXTRATO;
    if (event.eventType === "DAS_SIMPLES" && amountChanged && !edicaoManual && !fonteEhDeclaracao) {
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
        // Com baixa já lançada, o status vem do confronto com o principal NOVO — não pode ser
        // sobrescrito cegamente (era o que ressuscitava provisão paga como ABERTO).
        statusPagamento: statusPelasBaixas(existingEntry.baixas, event.amount)
          || event.statusPagamento
          || "NA",
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
        // `EVENT_DEFINITIONS` só emite RECEITA e PROVISAO hoje — mas `BAIXA_DAS_SIMPLES` já existe
        // como eventType em `accountingEntryRules.js`, e uma entrada nova nesse mapa faria este
        // caminho gravar BAIXA sem papel, violando o CHECK `chk_baixa_tipo_linha` em produção.
        tipoLinha: tipoLinhaDaBaixa(event.tipo),
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

// `edicaoManual`: o contador CORRIGIU o valor na Circular (o novo valor é a verdade). Sem isso, o
// DAS cai na regra de recálculo automático, que preserva as linhas antigas de propósito.
//
// `fonteValor`: de onde veio o número da circular — `EXTRATO` (declaração transmitida, inclusive
// RETIFICADORA) ou `GUIA` (documento de arrecadação, que pode vir recalculado com juros).
// ⚠ O DEFAULT é `GUIA`, o conservador: quem não declara a fonte mantém a guarda ligada. Trocar o
// default faria toda chamada nova nascer sobrescrevendo a provisão, que é justamente o estrago
// que a guarda existe para impedir.
export async function generateEntriesFromCircular({ portalClientId, competencia, now = new Date(), edicaoManual = false, fonteValor = FONTE_VALOR_GUIA }) {
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
        include: {
          lines: { orderBy: { ordem: "asc" } },
          // Necessário pra recalcular o status quando o valor muda (provisão já baixada).
          baixas: { include: { lines: true } },
        },
      });

      // eslint-disable-next-line no-await-in-loop
      const outcome = await upsertGeneratedEntry(tx, {
        edicaoManual,
        fonteValor,
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

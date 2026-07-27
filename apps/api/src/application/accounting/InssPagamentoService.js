// Q34 — Pagamento do INSS: ao confirmar a guia INSS como paga, gera a BAIXA contábil.
// Ciclo do INSS: provisão = lançamento de folha/pró-labore (C INSS a Recolher); pagamento = esta baixa
// (D INSS a Recolher / C Caixa). A conta "INSS a Recolher" vem da folha do mês (decisão do dono).
// Espelha o padrão de gerarPagamentoParcelaFromGuide (ParcelamentoV2Service.js).

import { prisma } from "../../infrastructure/db/prisma.js";
import { isMonthClosed } from "./fechamentoContabil.js";
import { PAYROLL_TEMPLATES } from "./payrollTemplate.js";

function competenciaFromDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function norm(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s\-_/]+/g, " ")
    .trim();
}

function competenciaLabel(competencia) {
  const m = String(competencia || "").match(/^(\d{4})-(\d{2})$/);
  return m ? `${m[2]}/${m[1]}` : String(competencia || "");
}

// Acha a conta "INSS a Recolher" creditada na folha/pró-labore da competência (linha C cujo
// histórico cita INSS — o template grava "VR REF INSS S/..."). Fallback: nome da conta no plano
// de contas batendo com os accountHints de INSS do payrollTemplate. "" se não achar.
export async function resolveInssAccountFromFolha(portalClientId, competencia) {
  const folhas = await prisma.accountingEntry.findMany({
    where: { portalClientId, competencia: String(competencia), tipo: "FOLHA" },
    select: { lines: { select: { conta: true, tipo: true, historico: true } } },
    orderBy: { createdAt: "desc" },
  });
  for (const f of folhas) {
    for (const l of f.lines || []) {
      if (l.tipo === "C" && String(l.conta || "").trim() && norm(l.historico).includes("inss")) {
        return String(l.conta).trim();
      }
    }
  }
  // Fallback: plano de contas por nome (hints de INSS do template de folha).
  const hints = (PAYROLL_TEMPLATES.FOLHA.lines.find((x) => x.role === "inss")?.accountHints || []).map(norm);
  return matchAccountByHints(portalClientId, hints);
}

// Caixa da baixa: resolve pelos creditAccountHints (caixa/banco) do template de folha. "" se não achar.
export async function resolveCaixaAccount(portalClientId) {
  const hints = (PAYROLL_TEMPLATES.FOLHA.baixa?.creditAccountHints || []).map(norm);
  return matchAccountByHints(portalClientId, hints);
}

async function matchAccountByHints(portalClientId, normalizedHints) {
  if (!normalizedHints.length) return "";
  const raw = await prisma.chartOfAccount.findMany({
    where: { OR: [{ portalClientId: String(portalClientId) }, { portalClientId: null }] },
    select: { codigo: true, nome: true, portalClientId: true },
  });
  // empresa tem prioridade sobre global no mesmo código
  const byCodigo = new Map();
  for (const acc of raw) {
    const ex = byCodigo.get(acc.codigo);
    if (!ex || (acc.portalClientId && !ex.portalClientId)) byCodigo.set(acc.codigo, acc);
  }
  const accounts = [...byCodigo.values()].map((a) => ({ ...a, _norm: norm(a.nome) }));
  for (const h of normalizedHints) {
    const f = accounts.find((a) => a._norm === h);
    if (f) return f.codigo;
  }
  for (const h of normalizedHints) {
    const f = accounts.find((a) => a._norm.startsWith(h));
    if (f) return f.codigo;
  }
  for (const h of normalizedHints) {
    const f = accounts.find((a) => a._norm.includes(h));
    if (f) return f.codigo;
  }
  return "";
}

/**
 * Gera a baixa do INSS a partir da guia confirmada como paga.
 * D INSS a Recolher (conta da folha do mês) / C Caixa — valor da guia, data = pagamento (ou hoje).
 * Idempotente; lança erro `MES_FECHADO` se o mês do pagamento estiver fechado.
 *
 * Q47: aceita override manual do modal "Dar baixa" da Circular:
 *  - `lines` (array {conta, tipo, valor}) → usa essas partidas em vez de resolver contas automaticamente;
 *  - `historico` → texto do lançamento (senão usa o padrão "PAGO INSS - MM/AAAA").
 * Sem override (fluxo automático do confirm-payment), resolve conta INSS/caixa da folha como antes.
 */
export async function gerarPagamentoInssFromGuide({ portalClientId, guideId, dataPagamento, historico, lines, userId }) {
  void userId; // reservado p/ auditoria futura
  const guide = await prisma.guide.findFirst({
    where: { id: String(guideId), portalClientId },
    select: { id: true, tipo: true, competencia: true, valor: true, lancamentoId: true, baixada: true },
  });
  if (!guide) return { skipped: true, reason: "guide_not_found" };
  if (String(guide.tipo || "").toUpperCase() !== "INSS") return { skipped: true, reason: "nao_e_inss" };
  if (guide.lancamentoId || guide.baixada) return { skipped: true, reason: "ja_baixada" };

  const baixaExistente = await prisma.accountingEntry.findFirst({
    where: { sourceGuideId: guide.id, tipo: "BAIXA" }, select: { id: true },
  });
  if (baixaExistente) return { skipped: true, reason: "ja_baixada" };

  const valor = round2(guide.valor);
  if (!Number.isFinite(valor) || valor <= 0) return { skipped: true, reason: "sem_valor" };

  const data = dataPagamento ? new Date(dataPagamento) : new Date();
  const competenciaPag = competenciaFromDate(data);
  if (await isMonthClosed(portalClientId, competenciaPag)) {
    const err = new Error(`Mês ${competenciaPag} fechado — reabra antes de baixar o INSS.`);
    err.code = "MES_FECHADO";
    throw err;
  }

  // Principal, juros e multa viram LANÇAMENTOS INDEPENDENTES (decisão do dono), cada um
  // balanceado contra o caixa. Antes tudo virava um lançamento só, debitando o TOTAL contra
  // "INSS a Recolher" — o que amortizava o passivo por mais do que foi provisionado: juros e
  // multa não são passivo previdenciário, são despesa do mês do pagamento.
  //
  // O papel vem marcado do modal (não é derivado da conta, porque o contador pode trocá-la).
  // Componente zerado não gera lançamento.
  function separarPorPapel(linhasEntrada) {
    const debitos = linhasEntrada.filter((l) => String(l.tipo || "").toUpperCase() === "D");
    const credito = linhasEntrada.find((l) => String(l.tipo || "").toUpperCase() === "C");
    const contaCaixaInput = String(credito?.conta || "").trim();

    const grupos = [];
    for (const papel of ["PRINCIPAL", "JUROS", "MULTA"]) {
      // Linha sem papel (adicionada à mão no modal) conta como principal.
      const doGrupo = debitos.filter((l) => {
        const p = String(l.papel || "").toUpperCase();
        return papel === "PRINCIPAL" ? (!p || p === "PRINCIPAL") : p === papel;
      });
      const total = round2(doGrupo.reduce((s, l) => s + (Number(l.valor) || 0), 0));
      if (!doGrupo.length || total <= 0) continue;
      grupos.push({ papel, debitos: doGrupo, total, contaCaixa: contaCaixaInput });
    }
    return grupos;
  }

  // Override manual (modal da Circular) tem prioridade; senão resolve as contas da folha do mês.
  const hasOverride = Array.isArray(lines) && lines.length > 0;
  let contaInss = null;
  let contaCaixa = null;
  let entryLines;
  if (hasOverride) {
    entryLines = lines.map((l, i) => ({
      conta: String(l.conta || "").trim(),
      tipo: String(l.tipo || "").toUpperCase() === "C" ? "C" : "D",
      valor: round2(l.valor),
      ordem: i,
    }));
  } else {
    // Conta "INSS a Recolher" vem da folha da competência da guia (decisão do dono); caixa por hints.
    contaInss = await resolveInssAccountFromFolha(portalClientId, guide.competencia);
    contaCaixa = await resolveCaixaAccount(portalClientId);
    entryLines = [
      { conta: contaInss || "", tipo: "D", valor, ordem: 0 },
      { conta: contaCaixa || "", tipo: "C", valor, ordem: 1 },
    ];
  }
  const historicoFinal = String(historico || "").trim() || `PAGO INSS - ${competenciaLabel(guide.competencia)}`;

  // Sem papéis marcados (fluxo automático, sem modal) segue lançamento único — não há juros/multa
  // separados pra dividir.
  const grupos = hasOverride ? separarPorPapel(entryLines) : [];
  const separar = grupos.length > 1;

  const SUFIXO_HISTORICO = { PRINCIPAL: "", JUROS: " (juros)", MULTA: " (multa)" };

  return prisma.$transaction(async (tx) => {
    const base = {
      portalClientId,
      sourceGuideId: guide.id,
      data,
      competencia: competenciaPag,
      tipo: "BAIXA",
      subtipo: "INSS",
      origem: "MANUAL",
      loteImportacao: `INSS-PAG-${guide.id.slice(0, 8)}`,
      status: "RASCUNHO",
      statusPagamento: "PAGO",
    };

    if (!separar) {
      const entry = await tx.accountingEntry.create({
        data: { ...base, historico: historicoFinal, lines: { createMany: { data: entryLines } } },
        include: { lines: true },
      });
      await tx.guide.update({
        where: { id: guide.id },
        data: { baixada: true, dataBaixa: data, lancamentoId: entry.id },
      });
      return { ok: true, pagamentoId: entry.id, lancamentos: 1, contaInss: contaInss || null, contaCaixa: contaCaixa || null };
    }

    const criados = [];
    for (const g of grupos) {
      const linhasGrupo = [
        ...g.debitos.map((l, i) => ({ conta: String(l.conta || "").trim(), tipo: "D", valor: round2(l.valor), ordem: i })),
        // Cada lançamento credita o caixa pelo SEU total → fecha D=C sozinho.
        { conta: g.contaCaixa, tipo: "C", valor: g.total, ordem: g.debitos.length },
      ];
      const entry = await tx.accountingEntry.create({
        data: { ...base, historico: `${historicoFinal}${SUFIXO_HISTORICO[g.papel] || ""}`, lines: { createMany: { data: linhasGrupo } } },
        include: { lines: true },
      });
      criados.push({ papel: g.papel, id: entry.id, valor: g.total });
    }

    // A guia aponta para o lançamento do PRINCIPAL (é o que amortiza o passivo); os demais
    // continuam ligados a ela por sourceGuideId.
    const principal = criados.find((c) => c.papel === "PRINCIPAL") || criados[0];
    await tx.guide.update({
      where: { id: guide.id },
      data: { baixada: true, dataBaixa: data, lancamentoId: principal.id },
    });
    return {
      ok: true,
      pagamentoId: principal.id,
      lancamentos: criados.length,
      detalhe: criados,
      contaInss: contaInss || null,
      contaCaixa: contaCaixa || null,
    };
  });
}

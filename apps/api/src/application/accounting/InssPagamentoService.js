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

  return prisma.$transaction(async (tx) => {
    const entry = await tx.accountingEntry.create({
      data: {
        portalClientId,
        sourceGuideId: guide.id,
        data,
        competencia: competenciaPag,
        historico: historicoFinal,
        tipo: "BAIXA",
        subtipo: "INSS",
        origem: "MANUAL",
        loteImportacao: `INSS-PAG-${guide.id.slice(0, 8)}`,
        status: "RASCUNHO",
        statusPagamento: "PAGO",
        lines: { createMany: { data: entryLines } },
      },
      include: { lines: true },
    });
    await tx.guide.update({
      where: { id: guide.id },
      data: { baixada: true, dataBaixa: data, lancamentoId: entry.id },
    });
    return { ok: true, pagamentoId: entry.id, contaInss: contaInss || null, contaCaixa: contaCaixa || null };
  });
}

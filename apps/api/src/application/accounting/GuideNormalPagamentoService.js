// Pagamento de guia NORMAL (DARF/DAS/LP consolidada — não-parcela, não-INSS): ao confirmar a guia
// como paga, gera a BAIXA contábil E marca as provisões da guia como PAGO (a Circular fica verde/✅).
// Molde: InssPagamentoService.gerarPagamentoInssFromGuide.
//
// A baixa reverte a provisão: D <tributo a recolher> (a conta CREDITADA na provisão) / C Caixa.
// Guia LP consolidada tem N provisões (1 por tributo) → 1 lançamento de baixa com N débitos + 1 crédito
// (caixa, total). Contas em branco quando ainda não aprendidas (padrão do sistema).

import { prisma } from "../../infrastructure/db/prisma.js";
import { isMonthClosed } from "./fechamentoContabil.js";
import { resolveCaixaAccount } from "./InssPagamentoService.js";

function competenciaFromDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function competenciaLabel(competencia) {
  const m = String(competencia || "").match(/^(\d{4})-(\d{2})$/);
  return m ? `${m[2]}/${m[1]}` : String(competencia || "");
}

/**
 * Gera a baixa de uma guia normal e marca as provisões vinculadas como PAGO.
 * Idempotente (skip se já baixada); lança `MES_FECHADO` se o mês do pagamento estiver fechado.
 */
export async function gerarPagamentoNormalFromGuide({ portalClientId, guideId, dataPagamento, userId }) {
  void userId; // reservado p/ auditoria
  const guide = await prisma.guide.findFirst({
    where: { id: String(guideId), portalClientId },
    select: { id: true, tipo: true, competencia: true, valor: true, lancamentoId: true, baixada: true, parcelamentoId: true },
  });
  if (!guide) return { skipped: true, reason: "guide_not_found" };
  if (guide.parcelamentoId) return { skipped: true, reason: "e_parcela" };
  if (String(guide.tipo || "").toUpperCase() === "INSS") return { skipped: true, reason: "e_inss" };
  if (guide.lancamentoId || guide.baixada) return { skipped: true, reason: "ja_baixada" };

  const baixaExistente = await prisma.accountingEntry.findFirst({
    where: { sourceGuideId: guide.id, tipo: "BAIXA" }, select: { id: true },
  });
  if (baixaExistente) return { skipped: true, reason: "ja_baixada" };

  // Provisões desta guia → cada uma dá a conta do tributo a recolher (linha C) + o valor.
  const provisoes = await prisma.accountingEntry.findMany({
    where: { sourceGuideId: guide.id, tipo: "PROVISAO" },
    select: { lines: { select: { conta: true, tipo: true, valor: true } } },
  });

  const debitos = [];
  let total = 0;
  for (const p of provisoes) {
    const cLine = (p.lines || []).find((l) => l.tipo === "C"); // tributo a recolher
    const somaD = (p.lines || []).filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
    const v = round2(cLine?.valor != null ? cLine.valor : somaD);
    if (!Number.isFinite(v) || v <= 0) continue;
    debitos.push({ conta: String(cLine?.conta || "").trim(), valor: v });
    total += v;
  }

  // Fallback: sem provisões → 1 débito com o valor da guia (conta em branco, aprende depois).
  let valorTotal = round2(total);
  if (!debitos.length) {
    const vg = round2(guide.valor);
    if (Number.isFinite(vg) && vg > 0) { debitos.push({ conta: "", valor: vg }); valorTotal = vg; }
  }
  if (!debitos.length || valorTotal <= 0) {
    // Ainda assim marca as provisões (se houver) como PAGO — a Circular precisa refletir o "confirmado".
    await prisma.accountingEntry.updateMany({
      where: { sourceGuideId: guide.id, tipo: "PROVISAO" }, data: { statusPagamento: "PAGO" },
    });
    return { skipped: true, reason: "sem_valor" };
  }

  const data = dataPagamento ? new Date(dataPagamento) : new Date();
  const competenciaPag = competenciaFromDate(data);
  if (await isMonthClosed(portalClientId, competenciaPag)) {
    const err = new Error(`Mês ${competenciaPag} fechado — reabra antes de baixar a guia.`);
    err.code = "MES_FECHADO";
    throw err;
  }

  const contaCaixa = await resolveCaixaAccount(portalClientId);
  const entryLines = debitos.map((d, i) => ({ conta: d.conta, tipo: "D", valor: d.valor, ordem: i }));
  entryLines.push({ conta: contaCaixa || "", tipo: "C", valor: valorTotal, ordem: entryLines.length });

  const historicoFinal = `PAGO ${String(guide.tipo || "GUIA").toUpperCase()} - ${competenciaLabel(guide.competencia)}`;

  return prisma.$transaction(async (tx) => {
    const entry = await tx.accountingEntry.create({
      data: {
        portalClientId,
        sourceGuideId: guide.id,
        data,
        competencia: competenciaPag,
        historico: historicoFinal,
        tipo: "BAIXA",
        subtipo: String(guide.tipo || "OUTRA").toUpperCase(),
        origem: "MANUAL",
        loteImportacao: `GUIA-PAG-${guide.id.slice(0, 8)}`,
        status: "RASCUNHO",
        statusPagamento: "PAGO",
        lines: { createMany: { data: entryLines } },
      },
      include: { lines: true },
    });
    // Circular "confirmado": marca as provisões da guia como PAGO (pinta verde/✅).
    await tx.accountingEntry.updateMany({
      where: { sourceGuideId: guide.id, tipo: "PROVISAO" }, data: { statusPagamento: "PAGO" },
    });
    await tx.guide.update({
      where: { id: guide.id },
      data: { baixada: true, dataBaixa: data, lancamentoId: entry.id },
    });
    return { ok: true, pagamentoId: entry.id, contaCaixa: contaCaixa || null, debitos: debitos.length };
  });
}

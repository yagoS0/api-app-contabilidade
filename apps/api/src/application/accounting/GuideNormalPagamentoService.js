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
import { subtiposDaGuiaNaCircular } from "./GuideToProvisionService.js";

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
 * Marca como PAGO as provisões que a Circular exibe para esta guia.
 *
 * Casa por `sourceGuideId` E, como FALLBACK, por competência + subtipo. O fallback existe porque a
 * provisão do DAS/Simples é criada pelo caminho do extrato PGDAS, não a partir da guia, então nasce
 * com `sourceGuideId = null` — só o vínculo por id fazia o UPDATE atingir ZERO linhas e a guia
 * ficava "Paga" na tabela de Guias mas sem ✅ na Circular (a Circular lê
 * `AccountingEntry.statusPagamento`, não `Guide.paymentStatus`).
 *
 * O fallback é restrito ao que a célula da Circular representa (mesma empresa, mesma competência,
 * mesmo subtipo) e só toca provisões ainda EM ABERTO/PARCIAL — nunca reescreve algo já quitado.
 *
 * @returns {Promise<number>} quantas provisões foram marcadas
 */
async function marcarProvisoesPagas(client, { portalClientId, guide }) {
  const porId = await client.accountingEntry.updateMany({
    where: { sourceGuideId: guide.id, tipo: "PROVISAO" },
    data: { statusPagamento: "PAGO" },
  });
  if (porId.count > 0) return porId.count;

  const subtipos = subtiposDaGuiaNaCircular(guide);
  if (!subtipos.length || !guide.competencia) return 0;

  const porCompetencia = await client.accountingEntry.updateMany({
    where: {
      portalClientId,
      tipo: "PROVISAO",
      competencia: guide.competencia,
      subtipo: { in: subtipos },
      statusPagamento: { in: ["ABERTO", "PARCIAL"] },
    },
    data: { statusPagamento: "PAGO" },
  });
  return porCompetencia.count;
}

/**
 * Gera a baixa de uma guia normal e marca as provisões vinculadas como PAGO.
 * Idempotente (skip se já baixada); lança `MES_FECHADO` se o mês do pagamento estiver fechado.
 */
export async function gerarPagamentoNormalFromGuide({ portalClientId, guideId, dataPagamento, userId }) {
  void userId; // reservado p/ auditoria
  const guide = await prisma.guide.findFirst({
    where: { id: String(guideId), portalClientId },
    // `extracted` entra por causa de subtiposDaGuiaNaCircular (usa a composição por tributo).
    select: {
      id: true, tipo: true, competencia: true, valor: true, lancamentoId: true, baixada: true,
      parcelamentoId: true, extracted: true,
    },
  });
  if (!guide) return { skipped: true, reason: "guide_not_found" };
  if (guide.parcelamentoId) return { skipped: true, reason: "e_parcela" };
  if (String(guide.tipo || "").toUpperCase() === "INSS") return { skipped: true, reason: "e_inss" };

  // Já baixada: NÃO cria lançamento de novo, mas ainda assim garante que a Circular reflita o
  // pago. Sem isso, uma guia que baixou antes desta correção (ou uma 2ª confirmação) saía daqui
  // sem nunca marcar a provisão — a guia ficava "Paga" e a Circular seguia vermelha.
  if (guide.lancamentoId || guide.baixada) {
    const n = await marcarProvisoesPagas(prisma, { portalClientId, guide });
    return { skipped: true, reason: "ja_baixada", provisoesMarcadas: n };
  }

  const baixaExistente = await prisma.accountingEntry.findFirst({
    where: { sourceGuideId: guide.id, tipo: "BAIXA" }, select: { id: true },
  });
  if (baixaExistente) {
    const n = await marcarProvisoesPagas(prisma, { portalClientId, guide });
    return { skipped: true, reason: "ja_baixada", provisoesMarcadas: n };
  }

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
    const n = await marcarProvisoesPagas(prisma, { portalClientId, guide });
    return { skipped: true, reason: "sem_valor", provisoesMarcadas: n };
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
    const provisoesMarcadas = await marcarProvisoesPagas(tx, { portalClientId, guide });
    await tx.guide.update({
      where: { id: guide.id },
      data: { baixada: true, dataBaixa: data, lancamentoId: entry.id },
    });
    return {
      ok: true, pagamentoId: entry.id, contaCaixa: contaCaixa || null,
      debitos: debitos.length, provisoesMarcadas,
    };
  });
}

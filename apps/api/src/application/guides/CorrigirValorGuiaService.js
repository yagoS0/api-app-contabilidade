import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../../infrastructure/db/prisma.js";
import { getGuidePdfBuffer } from "./GuideService.js";
import { lerLinhaDigitavelDoPdf } from "./lerLinhaDigitavelDoPdf.js";
import { competenciasFechadas } from "../accounting/fechamentoContabil.js";

export class CorrecaoValorError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; }
}
const recusar = (code, message, status) => { throw new CorrecaoValorError(code, message, status); };
const centavos = value => Math.round(Number(value) * 100);
function valorValido(valor) {
  if (!["number", "string"].includes(typeof valor) || !/^\d+(\.\d{1,2})?$/.test(String(valor)) || !Number.isSafeInteger(centavos(valor)) || centavos(valor) <= 0) recusar("valor_invalido", "Informe o valor positivo da guia, com até duas casas decimais.", 400);
  return centavos(valor) / 100;
}
async function carregar(db, companyId, guideId, novoValor) {
  const g = await db.guide.findFirst({ where: { id: guideId, portalClientId: companyId }, include: {
    accountingEntries: { include: { lines: { orderBy: { id: "asc" } }, baixas: { select: { id: true } } }, orderBy: { id: "asc" } },
    tributosParcela: { select: { id: true } },
  } });
  if (!g) recusar("guia_nao_encontrada", "Guia não encontrada.", 404);
  if (g.tipo !== "OUTRA" || g.parcelamentoId || g.tributosParcela.length || g.status !== "PROCESSED" || !g.competencia) recusar("correcao_exige_revisao", "Esta guia exige revisão da composição antes de alterar o valor.");
  if (g.baixada || g.paymentStatus === "PAID" || g.paymentConfirmedAt || g.clienteConfirmouEm || g.comprovantePdfFileId) recusar("guia_com_pagamento", "A guia tem registro de pagamento e exige revisão contábil.");
  const entradas = g.accountingEntries;
  if (entradas.length > 1) recusar("provisao_composta", "Há mais de um lançamento vinculado. Revise a composição antes de corrigir.");
  for (const e of entradas) {
    if (e.portalClientId !== companyId || e.status !== "RASCUNHO" || e.tipo !== "PROVISAO" || e.statusPagamento === "PAGO" || e.baixas.length || e.parcelamentoId || e.circularId || e.openEntryId || e.estornoDeEntryId) recusar("provisao_nao_editavel", "O lançamento vinculado exige revisão contábil antes da correção.");
    if (e.lines.length !== 2 || e.lines.filter(l => l.tipo === "D").length !== 1 || e.lines.filter(l => l.tipo === "C").length !== 1 || centavos(e.lines[0].valor) !== centavos(e.lines[1].valor) || ![centavos(g.valor), centavos(novoValor)].includes(centavos(e.lines[0].valor))) recusar("provisao_divergente", "Os valores do lançamento não correspondem à guia. Revise o lançamento.");
  }
  if ((await competenciasFechadas(companyId, [g.competencia, ...entradas.map(e => e.competencia)], db)).size) recusar("competencia_fechada", "A competência está fechada e não permite esta correção.");
  const revisao = createHash("sha256").update(JSON.stringify(g)).digest("hex");
  return { g, revisao };
}

export async function preverCorrecaoValorGuia({ companyId, guideId, valor }, { db = prisma, carregarPdf = getGuidePdfBuffer, ler = lerLinhaDigitavelDoPdf } = {}) {
  const novoValor = valorValido(valor);
  const { g, revisao } = await carregar(db, companyId, guideId, novoValor);
  const pdf = await carregarPdf(g);
  const leitura = await ler(pdf, { valorTotal: novoValor, vencimento: g.vencimento });
  if (!leitura.linhaDigitavel || leitura.linhaDigitavelMotivo) recusar("pdf_nao_confirma_valor", "O PDF original não confirmou este valor pela linha digitável. Corrija após revisar o documento.");
  return { guideId, companyId, valorAtual: Number(g.valor), novoValor, revisao, lancamentosAfetados: g.accountingEntries.length,
    pdfPreservado: true, linhaConfirmada: true, _leitura: leitura };
}

export async function corrigirValorGuia({ companyId, guideId, valor, revisao, userId }, deps = {}) {
  const db = deps.db || prisma;
  if (!userId || !revisao) recusar("revisao_obrigatoria", "Confira a prévia antes de corrigir a guia.", 400);
  const previa = await preverCorrecaoValorGuia({ companyId, guideId, valor }, deps);
  if (revisao !== previa.revisao) recusar("guia_alterada", "A guia ou o lançamento mudou. Abra uma nova prévia.");
  try {
    return await db.$transaction(async tx => {
      const atual = await carregar(tx, companyId, guideId, previa.novoValor);
      if (atual.revisao !== revisao) recusar("guia_alterada", "A guia ou o lançamento mudou. Abra uma nova prévia.");
      const alterada = await tx.guide.updateMany({ where: { id: guideId, portalClientId: companyId, updatedAt: atual.g.updatedAt }, data: {
        valor: previa.novoValor, ...previa._leitura, reviewedByUserId: userId, reviewedAt: new Date(),
      } });
      if (alterada.count !== 1) recusar("guia_alterada", "A guia mudou. Abra uma nova prévia.");
      for (const e of atual.g.accountingEntries) {
        await tx.accountingEntryLine.updateMany({ where: { entryId: e.id }, data: { valor: previa.novoValor } });
        await tx.accountingEntry.update({ where: { id: e.id }, data: {
          recalculatedAt: new Date(), recalculatedFromValor: e.lines[0].valor, recalculatedToValor: previa.novoValor,
          recalculatedNotes: "Correção de cadastro conferida contra o PDF original da guia.",
        } });
      }
      await tx.appSetting.create({ data: { key: `guide_value_correction:${randomUUID()}`, value: {
        companyId, guideId, userId, valorAnterior: previa.valorAtual, valorCorrigido: previa.novoValor,
        revisao, em: new Date().toISOString(), lancamentos: atual.g.accountingEntries.map(e => e.id), pdfPreservado: true,
      } } });
      return { ok: true, guideId, valor: previa.novoValor, lancamentosAfetados: atual.g.accountingEntries.length };
    }, { isolationLevel: "Serializable" });
  } catch (e) {
    if (e.code === "P2034") recusar("guia_alterada", "Houve uma alteração simultânea. Abra uma nova prévia.");
    throw e;
  }
}

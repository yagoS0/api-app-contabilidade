import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../../infrastructure/db/prisma.js";
import { competenciasFechadas } from "../accounting/fechamentoContabil.js";

export class CorrecaoCompetenciaError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; }
}
const recusar = (code, message, status) => { throw new CorrecaoCompetenciaError(code, message, status); };
function validar(competencia) {
  if (typeof competencia !== "string" || !/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(competencia)) {
    recusar("competencia_invalida", "Informe uma competência válida (mês e ano).", 400);
  }
}
async function carregar(db, companyId, guideId, competencia) {
  validar(competencia);
  const g = await db.guide.findFirst({ where: { id: guideId, portalClientId: companyId }, select: {
    id: true, portalClientId: true, competencia: true, tipo: true, status: true, updatedAt: true,
    valor: true, vencimento: true, hash: true, extracted: true, paymentStatus: true,
    baixada: true, paymentConfirmedAt: true, clienteConfirmouEm: true, comprovantePdfFileId: true,
    liberadaCliente: true, emailStatus: true, emailSentAt: true, parcelamentoId: true, lancamentoId: true,
    parcela: { select: { id: true } },
    _count: { select: { accountingEntries: true, composicoesParcelamento: true, tributosParcela: true, taxDocuments: true, envios: true } },
  } });
  if (!g) recusar("guia_nao_encontrada", "Guia não encontrada.", 404);
  if (g.status !== "PROCESSED" || !g.competencia) recusar("guia_nao_processada", "Complete o cadastro da guia antes de corrigir a competência.");
  if (g.competencia === competencia) recusar("competencia_igual", "Esta já é a competência cadastrada.", 400);
  if (g.parcelamentoId || g.parcela || g._count.composicoesParcelamento || g._count.tributosParcela) recusar("guia_parcelada", "Esta guia está vinculada a um parcelamento. Revise o vínculo na aba Parcelamento antes de corrigir.");
  if (g.baixada || g.paymentStatus === "PAID" || g.paymentConfirmedAt || g.clienteConfirmouEm || g.comprovantePdfFileId) recusar("guia_com_pagamento", "A guia tem confirmação de pagamento. Revise o pagamento antes de corrigir a competência.");
  if (g.lancamentoId || g._count.accountingEntries || g._count.taxDocuments) recusar("guia_contabilizada", "A guia tem lançamentos ou documentos fiscais vinculados. Revise esses vínculos antes de corrigir a competência.");
  if (g.liberadaCliente || g.emailSentAt || ["SENDING", "SENT"].includes(g.emailStatus) || g._count.envios) recusar("guia_com_envio", "A guia já foi liberada ou tem histórico de envio. Revise a entrega ao cliente antes de corrigir a competência.");
  if ((await competenciasFechadas(companyId, [g.competencia, competencia], db)).size) recusar("competencia_fechada", "A competência atual ou a nova está fechada. Reabra o mês antes de corrigir.");
  const duplicada = await db.guide.findFirst({ where: { portalClientId: companyId, competencia, tipo: g.tipo, parcelamentoId: null, id: { not: guideId } }, select: { id: true } });
  if (duplicada) recusar("guia_duplicada", "Já existe uma guia deste imposto na competência escolhida. Confira as guias antes de corrigir.");
  return { g, revisao: createHash("sha256").update(JSON.stringify([g, competencia])).digest("hex") };
}
export async function preverCorrecaoCompetenciaGuia(args, { db = prisma } = {}) {
  const { g, revisao } = await carregar(db, args.companyId, args.guideId, args.competencia);
  return { companyId: args.companyId, guideId: g.id, competenciaAtual: g.competencia, novaCompetencia: args.competencia, revisao };
}
export async function corrigirCompetenciaGuia({ companyId, guideId, competencia, revisao, userId }, { db = prisma } = {}) {
  if (!userId || !revisao) recusar("revisao_obrigatoria", "Confira a alteração antes de salvar.", 400);
  try {
    return await db.$transaction(async tx => {
      const { g, revisao: atual } = await carregar(tx, companyId, guideId, competencia);
      if (atual !== revisao) recusar("guia_alterada", "A guia foi alterada. Confira novamente antes de salvar.");
      const em = new Date();
      const resultado = await tx.guide.updateMany({ where: { id: guideId, portalClientId: companyId, updatedAt: g.updatedAt }, data: {
        competencia, extracted: { ...(g.extracted || {}), competencia }, reviewedAt: em, reviewedByUserId: userId,
      } });
      if (resultado.count !== 1) recusar("guia_alterada", "A guia foi alterada. Confira novamente antes de salvar.");
      await tx.appSetting.create({ data: { key: `guide_competencia_correction:${randomUUID()}`, value: {
        companyId, guideId, userId, competenciaAnterior: g.competencia, competenciaCorrigida: competencia,
        competenciaExtraidaAnterior: g.extracted?.competencia ?? null, em: em.toISOString(), revisao, pdfPreservado: true,
      } } });
      return { ok: true, guideId, competencia };
    }, { isolationLevel: "Serializable" });
  } catch (e) {
    if (e.code === "P2034") recusar("guia_alterada", "Houve uma alteração simultânea. Confira novamente antes de salvar.");
    throw e;
  }
}

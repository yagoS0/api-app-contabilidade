import { prisma } from "../../infrastructure/db/prisma.js";

// A conferência é comum à liberação no portal e a todos os transportes de cobrança.
export function bloqueioEnvioParcela(guide) {
  const recusa = (code, message) => ({ code, message, status: 409, guideId: guide?.id });
  if (guide?.extracted?.conferenciaDocumentoPendente === true) return recusa(
    "PARCELA_DOCUMENTO_PENDENTE", "Confira o documento desta parcela na aba Parcelamento antes de liberar ou enviar ao cliente.");
  if (!guide?.parcelamentoId) return null;
  if (guide.paymentStatus === "PAID" || guide.baixada || guide.parcela?.pagamentoStatus === "CONFIRMADO" || guide.parcela?.origemBaixa || guide.parcela?.baixadaEm) return recusa(
    "PARCELA_PAGA", "Esta parcela tem pagamento confirmado e não pode ser enviada como cobrança.");
  if (guide.parcelamento?.formaPagamento === "DEBITO_AUTOMATICO") return recusa(
    "PARCELA_DEBITO_AUTOMATICO", "Este parcelamento está em débito automático. Consulte o pagamento da parcela antes de enviar uma cobrança.");
  if (guide.parcelamento?.status === "EXCLUIDO") return recusa(
    "PARCELAMENTO_EXCLUIDO", "Este parcelamento foi excluído. Confira o contrato antes de enviar a guia.");
  if (!(Number(guide.valor) > 0) || !guide.vencimento || !Number.isFinite(new Date(guide.vencimento).getTime())) return recusa(
    "PARCELA_DOCUMENTO_INCOMPLETO", "Confira o valor e o vencimento do documento desta parcela antes de enviar ao cliente.");
  return null;
}

export const SELECT_PARCELA_ENVIO = {
  parcelamentoId: true, extracted: true,
  parcelamento: { select: { formaPagamento: true, status: true } },
  baixada: true, parcela: { select: { pagamentoStatus: true, origemBaixa: true, baixadaEm: true } },
};

export async function conferirParcelasParaEnvio(guias, { client = prisma, atualizar = true } = {}) {
  for (const original of guias || []) {
    if (!original?.parcelamentoId && original?.extracted?.conferenciaDocumentoPendente !== true) continue;
    const guide = atualizar ? await client.guide.findFirst({
      where: { id: original.id, portalClientId: original.portalClientId },
      select: { id: true, valor: true, vencimento: true, paymentStatus: true, ...SELECT_PARCELA_ENVIO },
    }) : original;
    if (!guide) throw Object.assign(new Error("A guia não está mais disponível. Atualize a lista."), { code: "PARCELA_GUIA_INDISPONIVEL", status: 409 });
    const bloqueio = bloqueioEnvioParcela(guide);
    if (bloqueio) throw Object.assign(new Error(bloqueio.message), bloqueio);
  }
}

import { documentoNaoArrecadatorio, STATUS_DOCUMENTO } from './classificacaoDocumento.js';

// A conferência é comum à liberação no portal e a todos os transportes de cobrança.
export function bloqueioEnvioParcela(guide) {
  const recusa = (code, message) => ({ code, message, status: 409, guideId: guide?.id });
  if (documentoNaoArrecadatorio(guide)) return recusa(STATUS_DOCUMENTO, 'Documento reclassificado. Consulte Documentos da empresa.');
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

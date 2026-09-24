export function conferirEnvioParcelaMock(guia) {
  const recusar = (code, message) => { throw Object.assign(new Error(message), { code, status: 409, guideId: guia?.id || guia?.guideId }); };
  if (guia?.extracted?.conferenciaDocumentoPendente) recusar("PARCELA_DOCUMENTO_PENDENTE", "Confira o documento desta parcela na aba Parcelamento antes de liberar ou enviar ao cliente.");
  if (!guia?.parcelamentoId) return;
  if (guia.paymentStatus === "PAID" || guia.baixada || guia.paga || guia.parcela?.pagamentoStatus === "CONFIRMADO" || guia.parcela?.origemBaixa || guia.parcela?.baixadaEm) recusar("PARCELA_PAGA", "Esta parcela tem pagamento confirmado e não pode ser enviada como cobrança.");
  if (guia.parcelamento?.formaPagamento === "DEBITO_AUTOMATICO") recusar("PARCELA_DEBITO_AUTOMATICO", "Este parcelamento está em débito automático. Consulte o pagamento da parcela antes de enviar uma cobrança.");
  if (guia.parcelamento?.status === "EXCLUIDO") recusar("PARCELAMENTO_EXCLUIDO", "Este parcelamento foi excluído. Confira o contrato antes de enviar a guia.");
  if (!(Number(guia.valor) > 0) || !guia.vencimento || !Number.isFinite(new Date(guia.vencimento).getTime())) recusar("PARCELA_DOCUMENTO_INCOMPLETO", "Confira o valor e o vencimento do documento desta parcela antes de enviar ao cliente.");
}

export function valorDaCorrecaoEmCentavos(valor) {
  if (typeof valor !== "number" && typeof valor !== "string") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(String(valor))) return null;

  const centavos = Math.round(Number(valor) * 100);
  return Number.isSafeInteger(centavos) && centavos > 0 ? centavos : null;
}

export function motivoImpedimentoDaGuia(guia) {
  if (
    guia.tipo !== "OUTRA" ||
    guia.parcelamentoId ||
    guia.tributosParcela.length ||
    guia.status !== "PROCESSED" ||
    !guia.competencia
  ) {
    return {
      code: "correcao_exige_revisao",
      message: "Esta guia exige revisão da composição antes de alterar o valor.",
    };
  }

  if (
    guia.baixada ||
    guia.paymentStatus === "PAID" ||
    guia.paymentConfirmedAt ||
    guia.clienteConfirmouEm ||
    guia.comprovantePdfFileId
  ) {
    return {
      code: "guia_com_pagamento",
      message: "A guia tem registro de pagamento e exige revisão contábil.",
    };
  }
  return null;
}

export function evidenciaConfirmaValor(leitura) {
  return Boolean(leitura.linhaDigitavel) && !leitura.linhaDigitavelMotivo;
}

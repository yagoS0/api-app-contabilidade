// Projeção de fatos fiscais existentes; não autoriza envio, pagamento ou escrita.
export function documentosPgdas(circular, guide) {
  const declaracao = Boolean(circular?.pgdasNumeroDeclaracao);
  const extrato = declaracao && Boolean(circular?.pgdasDeclaracaoFileId && circular?.pgdasReciboFileId);
  const total = circular?.dasTotal;
  const valorInformado = total != null && typeof total !== 'boolean' && String(total).trim() !== '' && Number.isFinite(Number(total));
  const semDas = extrato && valorInformado && Number(total) === 0 && !circular.dasNumeroDocumento;
  return { declaracao, extrato, das: Boolean(guide?.pdfBytes?.length) || semDas };
}

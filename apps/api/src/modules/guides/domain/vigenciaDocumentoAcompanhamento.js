export const recusarVigencia = (guide, reason) => ({ vigente: false, reason, guideId: guide?.id });

export function documentoLiberadoParaAcompanhamento(guide) {
  return Boolean(guide?.id && guide.portalClientId && guide.competencia
    && guide.status === 'PROCESSED' && guide.liberadaCliente === true && guide.hash);
}

export function vinculoDaParcelaPreservado(guide, parcela) {
  return Boolean(parcela && parcela.portalClientId === guide.portalClientId
    && parcela.parcelamentoId === guide.parcelamentoId && parcela.guiaId === guide.id
    && parcela.id === guide.parcela?.id);
}

// As capacidades recebidas calculam composição e revisão sem IO.
// A ordem importa: composição pendente precede ambiguidade, que precede revisão.
export function avaliarDocumentoUnico(guide, rows, current, { resolverTributos, revisao }) {
  const candidates = [];
  for (const row of rows) {
    if (row.portalClientId !== guide.portalClientId || row.competencia !== guide.competencia || row.status !== 'PROCESSED' || row.parcelamentoId) continue;
    const taxes = resolverTributos(row);
    if (taxes.status !== 'IDENTIFIED') return recusarVigencia(guide, 'COMPOSICAO_A_CONFERIR');
    if (taxes.tributos.some(t => current.tributos.includes(t))) candidates.push(row);
  }
  if (candidates.length !== 1 || candidates[0].id !== guide.id) return recusarVigencia(guide, 'DOCUMENTO_AMBIGUO');
  if (revisao(candidates[0]) !== revisao(guide)) return recusarVigencia(guide, 'DOCUMENTO_ALTERADO');
  return { vigente: true, source: 'OBRIGACAO_DOCUMENTO_UNICO', guideId: guide.id,
    tributos: [...current.tributos].sort(), revisao: revisao(guide) };
}

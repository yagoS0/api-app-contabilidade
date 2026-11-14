import {
  documentoLiberadoParaAcompanhamento, vinculoDaParcelaPreservado,
  avaliarDocumentoUnico, recusarVigencia,
} from '../domain/vigenciaDocumentoAcompanhamento.js';

export async function conferirVigenciaDocumentoAcompanhamento(guide, { lerParcela, listarGuias, resolverTributos, revisao }) {
  if (!documentoLiberadoParaAcompanhamento(guide)) return recusarVigencia(guide, 'DOCUMENTO_NAO_LIBERADO');
  const current = resolverTributos(guide);
  if (current.status !== 'IDENTIFIED') return recusarVigencia(guide, 'COMPOSICAO_A_CONFERIR');
  if (guide.parcelamentoId) {
    const p = await lerParcela(guide);
    if (!vinculoDaParcelaPreservado(guide, p)) return recusarVigencia(guide, 'DOCUMENTO_SUBSTITUIDO');
    return { vigente: true, source: 'PARCELA_VINCULADA', guideId: guide.id, parcelaId: p.id,
      parcelamentoId: p.parcelamentoId, revisao: revisao(guide) };
  }
  const rows = await listarGuias(guide);
  return avaliarDocumentoUnico(guide, rows, current, { resolverTributos, revisao });
}

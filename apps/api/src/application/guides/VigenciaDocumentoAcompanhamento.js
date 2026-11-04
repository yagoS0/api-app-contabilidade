import { resolverTributosDaGuia } from './tributosDaGuia.js';
import { versaoPagamentoGuia } from './ConfirmacaoPagamentoClienteService.js';
// Same conservative ambiguity rule as CicloEnvioGuias, refined by real composition.
// No newest-date winner and no silent deletion/merging of independent documents.
export async function conferirVigenciaDocumentoAcompanhamento(db, guide) {
  const refuse = reason => ({ vigente: false, reason, guideId: guide?.id });
  if (!guide?.id || !guide.portalClientId || !guide.competencia || guide.status !== 'PROCESSED'
    || guide.liberadaCliente !== true || !guide.hash) return refuse('DOCUMENTO_NAO_LIBERADO');
  const current = resolverTributosDaGuia(guide);
  if (current.status !== 'IDENTIFIED') return refuse('COMPOSICAO_A_CONFERIR');
  if (guide.parcelamentoId) {
    const p = await db.parcela.findFirst({ where: { id: guide.parcela?.id || '', portalClientId: guide.portalClientId, parcelamentoId: guide.parcelamentoId } });
    if (!p || p.portalClientId !== guide.portalClientId || p.parcelamentoId !== guide.parcelamentoId || p.guiaId !== guide.id || p.id !== guide.parcela?.id) return refuse('DOCUMENTO_SUBSTITUIDO');
    return { vigente: true, source: 'PARCELA_VINCULADA', guideId: guide.id, parcelaId: p.id,
      parcelamentoId: p.parcelamentoId, revisao: versaoPagamentoGuia(guide) };
  }
  const rows = await db.guide.findMany({ where: { portalClientId: guide.portalClientId, competencia: guide.competencia, status: 'PROCESSED', parcelamentoId: null }, orderBy: { id: 'asc' } });
  const candidates = [];
  for (const row of rows) {
    if (row.portalClientId !== guide.portalClientId || row.competencia !== guide.competencia || row.status !== 'PROCESSED' || row.parcelamentoId) continue;
    const taxes = resolverTributosDaGuia(row);
    if (taxes.status !== 'IDENTIFIED') return refuse('COMPOSICAO_A_CONFERIR');
    if (taxes.tributos.some(t => current.tributos.includes(t))) candidates.push(row);
  }
  if (candidates.length !== 1 || candidates[0].id !== guide.id) return refuse('DOCUMENTO_AMBIGUO');
  if (versaoPagamentoGuia(candidates[0]) !== versaoPagamentoGuia(guide)) return refuse('DOCUMENTO_ALTERADO');
  return { vigente: true, source: 'OBRIGACAO_DOCUMENTO_UNICO', guideId: guide.id,
    tributos: [...current.tributos].sort(), revisao: versaoPagamentoGuia(guide) };
}

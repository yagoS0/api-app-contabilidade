export function lerParcelaDaGuia(db, guide) {
  return db.parcela.findFirst({ where: { id: guide.parcela?.id || '', portalClientId: guide.portalClientId, parcelamentoId: guide.parcelamentoId } });
}
export function listarGuiasDaCompetencia(db, guide) {
  return db.guide.findMany({ where: { portalClientId: guide.portalClientId, competencia: guide.competencia, status: 'PROCESSED', parcelamentoId: null }, orderBy: { id: 'asc' } });
}

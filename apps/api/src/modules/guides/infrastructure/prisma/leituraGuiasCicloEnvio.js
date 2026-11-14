export function listarGuiasCicloEnvio(db, portalClientId, competencia, selecaoParcela) {
  return db.guide.findMany({ where: { portalClientId, competencia },
    include: { parcelamento: selecaoParcela.parcelamento, parcela: selecaoParcela.parcela }, orderBy: { id: 'asc' } });
}

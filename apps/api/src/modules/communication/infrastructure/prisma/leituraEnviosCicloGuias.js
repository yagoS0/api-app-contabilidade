// Preserva a ordem retornada pelo ledger: a projeção legada usa o primeiro recibo.
export function listarEnviosCicloGuias(db, guideIds) {
  return db.envioGuia.findMany({ where: { guideId: { in: guideIds } } });
}

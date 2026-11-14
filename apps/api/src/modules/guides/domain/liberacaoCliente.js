export function validarLiberacaoCliente({ portalClientId, competencia }) {
  const cid = String(portalClientId || "").trim();
  const comp = String(competencia || "").trim();
  if (!cid || !/^\d{4}-\d{2}$/.test(comp)) {
    const err = new Error("portalClientId/competencia inválidos");
    err.code = "INVALID_INPUT";
    throw err;
  }
  return { cid, comp };
}

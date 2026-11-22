// Usa a transação fornecida pelo chamador, sem conexão ou transação paralela.
export function lerCnpjDestinoAdn(tx, portalClientId) {
  return tx.portalClient.findUnique({ where: { id: portalClientId }, select: { cnpj: true } });
}

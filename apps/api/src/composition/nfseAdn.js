import { lerCnpjDestinoAdn } from '../modules/nfse/infrastructure/prisma/adnDestino.js';
import { validarVinculoDocumentoAdn } from '../modules/nfse/public.js';

// Ponte específica para o ponto de entrada legado; nenhuma chamada externa.
export async function validarDestinoPersistidoAdn(tx, portalClientId, cnpjEmpresa) {
  const destino = await lerCnpjDestinoAdn(tx, portalClientId);
  if (!destino || !validarVinculoDocumentoAdn(destino.cnpj, { cnpjPrestador: cnpjEmpresa }).pertence) {
    const err = new Error('adn_destino_documental_divergente');
    err.code = 'ADN_DESTINO_DOCUMENTAL_DIVERGENTE';
    throw err;
  }
}

import { normalizarDocumento } from '@contabilidade/shared/documentos-fiscais';
import { avaliarVinculoDocumentoAdn } from '../domain/vinculoDocumentoAdn.js';

export function validarVinculoDocumentoAdn(cnpj, metadata = {}) {
  return avaliarVinculoDocumentoAdn({
    empresa: normalizarDocumento(cnpj),
    prestador: normalizarDocumento(metadata.cnpjPrestador),
    tomador: normalizarDocumento(metadata.cnpjTomador),
  });
}

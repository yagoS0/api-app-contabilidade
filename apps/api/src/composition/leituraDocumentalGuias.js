import { resolverTributosDaGuia } from '../application/guides/tributosDaGuia.js';
import { versaoPagamentoGuia } from '../application/guides/ConfirmacaoPagamentoClienteService.js';
import { conferirVigenciaDocumentoAcompanhamento as conferir } from '../modules/guides/application/conferirVigenciaDocumentoAcompanhamento.js';
import { lerParcelaDaGuia, listarGuiasDaCompetencia } from '../modules/guides/infrastructure/prisma/leituraVigenciaDocumentoAcompanhamento.js';

export function conferirVigenciaDocumentoAcompanhamento(db, guide) {
  return conferir(guide, {
    lerParcela: g => lerParcelaDaGuia(db, g),
    listarGuias: g => listarGuiasDaCompetencia(db, g),
    resolverTributos: resolverTributosDaGuia,
    revisao: versaoPagamentoGuia,
  });
}

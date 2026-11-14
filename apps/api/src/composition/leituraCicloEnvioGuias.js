import { criarLeituraCicloEnvioGuias } from '../modules/operations/public.js';
import { criarLeiturasOperacionaisCiclo } from '../modules/operations/infrastructure/prisma/leituraCicloEnvioGuias.js';
import { listarGuiasCicloEnvio } from '../modules/guides/infrastructure/prisma/leituraGuiasCicloEnvio.js';
import { listarEnviosCicloGuias } from '../modules/communication/infrastructure/prisma/leituraEnviosCicloGuias.js';
import { lerInssManual } from '../application/operacoes/OperationsManualInss.js';
import { lerAutomacaoEmpresa } from '../application/fiscal/serpro/CompanyAutomationService.js';
import { calendarioEnvioGuias, decidirEnvioGuias } from '../application/guides/calendarioEnvioGuias.js';
import { mesOperacionalDaCompetencia } from '../application/accounting/parcelamento/pendenciasParcelamento.js';
import { bloqueioEnvioParcela, conferirParcelasParaEnvio, SELECT_PARCELA_ENVIO } from '../application/guides/GuiaParcelaEnvioGuard.js';
import { documentoValido } from '../application/guides/EntregaExternaGuiaService.js';

export function comporLeituraCicloEnvioGuias({ db, now, compliance, contatos, canal, revisaoDocumentoEnvio }) {
  return criarLeituraCicloEnvioGuias({
    ...criarLeiturasOperacionaisCiclo(db),
    lerAutomacao: portalClientId => lerAutomacaoEmpresa(db, portalClientId),
    lerInssManual: (portalClientId, competencia) => lerInssManual(db, portalClientId, competencia),
    listarGuias: (portalClientId, competencia) => listarGuiasCicloEnvio(db, portalClientId, competencia, SELECT_PARCELA_ENVIO),
    listarEnvios: guideIds => listarEnviosCicloGuias(db, guideIds),
    conferirParcelas: guides => conferirParcelasParaEnvio(guides, { client: db }),
    documentoValido, bloqueioEnvioParcela, calendarioEnvioGuias, decidirEnvioGuias, mesOperacionalDaCompetencia,
    now, compliance, contatos, canal, revisaoDocumentoEnvio,
  });
}

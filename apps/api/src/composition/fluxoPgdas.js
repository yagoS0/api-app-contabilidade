import { SerproProcurationService } from '../application/fiscal/serpro/SerproProcurationService.js';
import { procuracaoPermitePgdas } from '../application/fiscal/serpro/pgdasDocumentos.js';
import { recuperarDocumentosPgdas, consultarDocumentosPgdas } from '../modules/fiscal/publicPgdas.js';
import { lerEstadoDocumentalPgdas, registrarIndiceDocumentalPgdas } from '../modules/fiscal/infrastructure/prisma/estadoDocumentalPgdas.js';
import { autorizarLeituraConciliacaoDas445 } from '../infrastructure/security/autorizarLeituraConciliacaoDas445.js';
import { SerproPgdasdService } from '../application/fiscal/serpro/SerproPgdasdService.js';
import { getResolvedSerproCredentials } from '../application/fiscal/serpro/SerproRuntimeSettings.js';
import { syncPgdasByCompetencia } from '../application/fiscal/serpro/SerproPgdasDeclaracaoService.js';
import { capturePgdasGuideForCompany } from '../application/fiscal/serpro/CaptureSerproGuidesService.js';

function portas(entrada, auth) {
  const autorizar = () => autorizarLeituraConciliacaoDas445(entrada.portalClientId, auth);
  const validacaoDocumental = numeroDeclaracao => ({ numeroDeclaracao, autorizar });
  return { autorizar, ler: lerEstadoDocumentalPgdas,
    registrarConsulta: async dados => { await autorizar(); return registrarIndiceDocumentalPgdas({ ...dados, atorId: auth?.user?.id }); },
    consultarIndice: async ({ contribuinteCnpj, competencia }) => {
      await autorizar();
      const runtime = await getResolvedSerproCredentials();
      const procuracao = await new SerproProcurationService().checkCompanyProcuration({ portalClientId: entrada.portalClientId, contratanteCnpj: runtime.certificate.document, reutilizar: true });
      if (!procuracaoPermitePgdas(procuracao)) throw Object.assign(new Error('Procuração sem autorização vigente para PGDAS-D.'), { code: 'SERPRO_PGDAS_PROCURACAO_INSUFICIENTE' });
      await autorizar();
      return new SerproPgdasdService().consultarDeclaracaoIndice({ contratanteCnpj: runtime.certificate.document, contribuinteCnpj, periodoApuracao: competencia });
    },
    recuperarExtrato: ({ numeroDeclaracao, ...parametros }) => syncPgdasByCompetencia({ ...parametros, somenteDocumentos: true, validacaoDocumental: validacaoDocumental(numeroDeclaracao) }),
    recuperarGuia: ({ numeroDeclaracao, ...parametros }) => capturePgdasGuideForCompany({ ...parametros, somenteDocumentos: true, validacaoDocumental: validacaoDocumental(numeroDeclaracao) }),
  };
}
export const consultarDocumentosDaApuracao = (entrada, { auth } = {}) => consultarDocumentosPgdas(entrada, portas(entrada, auth));
export const recuperarDocumentosDaApuracao = (entrada, { auth } = {}) => recuperarDocumentosPgdas(entrada, portas(entrada, auth));

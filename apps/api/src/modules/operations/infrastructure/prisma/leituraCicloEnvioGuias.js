import { keyOf } from '../../domain/registroCicloEnvioGuias.js';

export function criarLeiturasOperacionaisCiclo(db) {
  return {
    lerEmpresa: portalClientId => db.portalClient.findUnique({ where: { id: portalClientId } }),
    lerCadastro: companyId => db.company.findUnique({ where: { id: companyId } }),
    lerConfiguracao: portalClientId => db.appSetting.findUnique({ where: { key: `envio_guias_config:${portalClientId}` } }),
    lerAgenda: () => db.appSetting.findUnique({ where: { key: 'serpro_runtime_settings' } }),
    lerHistoricoRegime: companyId => db.regimeHistorico.findMany({ where: { companyId } }),
    listarFeriados: () => db.feriado.findMany(),
    lerRegistroInss: (portalClientId, competencia) => db.appSetting.findUnique({ where: { key: `operations_manual_inss:v1:${portalClientId}:${competencia}` } }),
    lerRegistroCiclo: (portalClientId, competencia) => db.appSetting.findUnique({ where: { key: keyOf(portalClientId, competencia) } }),
  };
}

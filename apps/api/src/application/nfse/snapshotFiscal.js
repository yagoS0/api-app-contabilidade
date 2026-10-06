import { CONTRATO_NACIONAL } from './contratoNacional.js';
import { CAMPOS } from './perfilEmissao/campos.js';

// Lista explícita: certificados, senhas e configuração de rede não pertencem à auditoria fiscal.
export function snapshotFiscal({ company, perfil, regime, codigoServico, ibscbsLigado }) {
  return {
    contrato: CONTRATO_NACIONAL.id,
    ibscbsLigado: Boolean(ibscbsLigado),
    codigoServico,
    perfilId: perfil?.id || null,
    perfil: Object.fromEntries(CAMPOS.map(({ id }) => [id, perfil?.[id] == null ? null : String(perfil[id])])),
    cadastro: Object.fromEntries(['codigoMunicipioIbge', 'codigoServicoNacional', 'codigoServicoMunicipal', 'rpsSerie', 'pTotTribFed', 'pTotTribEst', 'pTotTribMun'].map(id => [id, company?.[id] == null ? null : String(company[id])])),
    regime: regime || null,
  };
}

import { CONTRATO_NACIONAL } from './contratoNacional.js';
import { CAMPOS } from './perfilEmissao/campos.js';

// Lista explícita: certificados, senhas e configuração de rede não pertencem à auditoria fiscal.
export function snapshotFiscal({ company, perfil, regime, codigoServico, ibscbsLigado, contextoFiscal, regimeVigente }) {
  return {
    contrato: CONTRATO_NACIONAL.id,
    ...(regimeVigente?.ok ? { regimeVigente: { ...regimeVigente } } : {}),
    ibscbsLigado: Boolean(ibscbsLigado),
    codigoServico,
    perfilId: perfil?.id || null,
    categoriaObrigacaoIbscbs: perfil?.categoriaObrigacaoIbscbs || null,
    ...(contextoFiscal?.ok ? { obrigacaoIbscbs: { ...contextoFiscal.obrigacao }, localPrestacao: { ...contextoFiscal.local }, incidenciaMunicipal: { ...contextoFiscal.incidencia } } : {}),
    perfil: Object.fromEntries(CAMPOS.map(({ id }) => [id, perfil?.[id] == null ? null : String(perfil[id])])),
    cadastro: Object.fromEntries(['codigoMunicipioIbge', 'codigoServicoNacional', 'codigoServicoMunicipal', 'rpsSerie', 'pTotTribFed', 'pTotTribEst', 'pTotTribMun'].map(id => [id, company?.[id] == null ? null : String(company[id])])),
    regime: regime || null,
  };
}

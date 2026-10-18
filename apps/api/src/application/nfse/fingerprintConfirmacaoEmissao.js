import { createHash } from 'node:crypto';

// Somente parâmetros materiais do emissor. O contador de DPS e timestamps não
// invalidam a confirmação; identidade, regime, cadastro fiscal e perfil invalidam.
export const CAMPOS_EMPRESA_CONFIRMACAO = [
  'id', 'cnpj', 'cpf', 'codigoMunicipioIbge', 'inscricaoMunicipal',
  'rpsSerie', 'codigoServicoNacional', 'codigosServicoNacional', 'codigoServicoMunicipal',
  'regimeEspecialTributacao', 'beneficioMunicipalNumero', 'pTotTribFed', 'pTotTribEst', 'pTotTribMun',
  'regimeHistorico',
];
const canonico = value => {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toJSON === 'function') return canonico(value.toJSON());
  if (Array.isArray(value)) return value.map(canonico);
  if (typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonico(value[k])]));
  return value;
};

export function fingerprintConfirmacaoEmissao({ company, perfil, regime, ambiente, perfisHabilitados, ibscbsLigado }) {
  const cadastro = Object.fromEntries(CAMPOS_EMPRESA_CONFIRMACAO.map(k => [k, company?.[k] ?? null]));
  const perfilMaterial = perfil ? Object.fromEntries(Object.entries(perfil).filter(([k]) => !['createdAt', 'updatedAt'].includes(k))) : null;
  return createHash('sha256').update(JSON.stringify(canonico({ versao: 1, cadastro, perfil: perfilMaterial,
    regime, ambiente, perfisHabilitados: Boolean(perfisHabilitados), ibscbsLigado: Boolean(ibscbsLigado) }))).digest('hex');
}

export function exigirFingerprintConfirmado(confirmado, atual) {
  if (!confirmado || confirmado !== atual) throw Object.assign(new Error('A configuração de emissão mudou ou o resumo é antigo. Prepare e confirme um novo resumo antes de emitir.'), {
    code: 'NFSE_RESUMO_ALTERADO', antesDoPost: true,
  });
}

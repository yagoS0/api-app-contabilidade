export const ETAPAS = [
  ['LEAD', 'Qualificação'], ['ANALISE', 'Análise'], ['PROPOSTA', 'Proposta'],
  ['CONTRATADO', 'Contratação'], ['ONBOARDING', 'Onboarding'], ['CONCLUIDO', 'Concluído'], ['DESISTIU', 'Perdido'],
];
export function etapaDaOportunidade(item) {
  if (item.status === 'DESISTIU') return 'DESISTIU';
  if (['CONVERTIDO', 'CONCLUIDO_AVULSO'].includes(item.status)) return 'CONCLUIDO';
  if (item.faseComercial === 'CONTRATADO' && item.status === 'EM_TRILHA') return 'ONBOARDING';
  return ETAPAS.some(([id]) => id === item.faseComercial) ? item.faseComercial : 'LEAD';
}
export const nomeDaOportunidade = item => item.razaoSocial || item.responsavelNome || 'Novo contato';
export const servicoDaOportunidade = item => ({ ABERTURA: 'Abertura de empresa', TRANSFERENCIA: 'Troca de contador', INATIVA: 'Regularização' }[item.origem] || item.origem || 'A definir');

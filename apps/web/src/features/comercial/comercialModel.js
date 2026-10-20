export const ETAPAS = [
  ['LEAD', 'Qualificação'], ['ANALISE', 'Análise'], ['PROPOSTA', 'Proposta'],
  ['CONTRATADO', 'Contratação'], ['GANHA', 'Ganha'], ['CONCLUSAO', 'Execução do serviço'], ['CONCLUIDO', 'Encerrado'], ['DESISTIU', 'Perdido'], ['INDISPONIVEL', 'Jornada indisponível'],
];
export function etapaDaOportunidade(item) {
  if (item.status === 'DESISTIU') return 'DESISTIU';
  if (['CONVERTIDO', 'CONCLUIDO_AVULSO'].includes(item.status)) return 'CONCLUIDO';
  if (item.comercial?.contratacao?.ganha) return 'GANHA';
  return ({ cadastro: 'LEAD', publica: 'ANALISE', autorizacao: 'ANALISE', fiscal: 'ANALISE', diagnostico: 'ANALISE', devolutiva: 'ANALISE', proposta: 'PROPOSTA', contrato: 'CONTRATADO', pagamento: 'CONTRATADO', conclusao: 'CONCLUSAO' })[item.comercial?.atual] || 'INDISPONIVEL';
}
export const oportunidadeAtiva = item => !['CONCLUIDO', 'DESISTIU'].includes(etapaDaOportunidade(item));
export const nomeDaOportunidade = item => item.razaoSocial?.trim() || item.responsavelNome?.trim() || `Atendimento ${String(item.id).slice(-6)}`;
export function resumoRetorno(retorno) {
  if (!retorno) return 'Nenhum retorno agendado';
  const d = retorno.dados || {}, quando = new Date(d.quando || '');
  const responsavel = d.responsavelNome || (d.responsavelId ? `Responsável ${String(d.responsavelId).slice(-6)}` : 'Responsável não informado');
  return `${d.acao || 'Ação não informada'} · ${Number.isFinite(quando.getTime()) ? quando.toLocaleString('pt-BR') : 'Data não informada'} · ${responsavel}`;
}
export const servicoDaOportunidade = item => item.origem === 'PESSOA_FISICA' ? item.dados?.servicoSolicitado || 'Pessoa física' : ({ ABERTURA: 'Abertura de empresa', TRANSFERENCIA: 'Troca de contador', INATIVA: 'Regularização' }[item.origem] || item.origem || 'A definir');

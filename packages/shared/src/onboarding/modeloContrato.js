// Metadados públicos de compatibilidade; nenhum texto contratual é embutido.
export const ORIGENS_CONTRATO = ['ABERTURA', 'TRANSFERENCIA', 'INATIVA'];
export const IDENTIFICACOES_CONTRATO = ['CADASTRO', 'PESSOA_FISICA', 'PESSOA_JURIDICA'];

export function configuracaoModeloContratoValida(dados = {}) {
  return typeof dados.recorrente === 'boolean'
    && (dados.permitePreCnpj == null || typeof dados.permitePreCnpj === 'boolean')
    && (dados.identificacaoContratante == null || IDENTIFICACOES_CONTRATO.includes(dados.identificacaoContratante))
    && (dados.origens == null || Array.isArray(dados.origens) && dados.origens.length > 0 && dados.origens.every(o => ORIGENS_CONTRATO.includes(o)))
    && !(dados.identificacaoContratante === 'PESSOA_JURIDICA' && dados.permitePreCnpj === true)
    && !(dados.identificacaoContratante === 'PESSOA_FISICA' && (!dados.origens || dados.origens.some(o => o !== 'ABERTURA')));
}

export function motivoIncompatibilidadeContrato({ modelo, onboarding = {}, opcao } = {}) {
  if (modelo?.tipo !== 'CONTRATO' || !configuracaoModeloContratoValida(modelo.dados)) return 'Confira a configuração de modalidade e identificação do modelo.';
  const d = modelo.dados;
  if (!opcao || d.recorrente !== opcao.recorrente) return 'O modelo precisa corresponder à opção aceita: serviço avulso ou contabilidade mensal.';
  if (d.origens && !d.origens.includes(onboarding.origem)) return 'Este modelo não atende ao motivo desta solicitação.';
  if (!onboarding.cnpj && (d.permitePreCnpj !== true || onboarding.origem && onboarding.origem !== 'ABERTURA')) return 'A abertura sem CNPJ precisa de um modelo próprio para contratar com a pessoa responsável.';
  if (onboarding.cnpj && d.identificacaoContratante === 'PESSOA_FISICA') return 'A empresa já tem CNPJ. Use um modelo que identifique a pessoa jurídica.';
  return null;
}

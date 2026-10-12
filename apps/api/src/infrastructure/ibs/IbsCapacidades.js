// Capacidade documentada não é disponibilidade/habilitação remota.
const fonte = 'https://cgibs.gov.br/upload/arquivos/202609/23171119-moc-api-apuracao-assistida-ibs-v1-10-23092026.pdf';
const bloqueada = (motivo, paginas) => Object.freeze({ disponivel: false, estado: 'BLOQUEADA_CONTRATO', motivo, paginas });
const capacidades = Object.freeze({
  habilitar: bloqueada('BASE_API_NAO_PUBLICADA', '18–19'),
  receberDiferencial: bloqueada('WEBHOOK_LEIAUTE_DIVERGENTE_SEM_HOMOLOGACAO', '19–20'),
  baixarArquivos: bloqueada('ROTA_DOWNLOAD_NAO_PUBLICADA', '20;26–44'),
  solicitarPeriodo: bloqueada('ROTA_PROPOSTA_GET_COM_BODY_ETAPA_FUTURA', '22–23'),
  consultarSaldo: bloqueada('ESPECIFICACAO_FUTURA', '24'),
  emitirGuia: bloqueada('ESPECIFICACAO_FUTURA', '25'),
  consultarGuia: bloqueada('ESPECIFICACAO_FUTURA', '25'),
  baixarGuia: bloqueada('ESPECIFICACAO_FUTURA', '25'),
  confirmarPagamento: bloqueada('CONTRATO_NAO_PUBLICADO', '17;24–25'),
});
export function obterCapacidadesIbs({ ambiente = 'HOMOLOGACAO' } = {}) {
  if (!['HOMOLOGACAO','PRODUCAO'].includes(ambiente)) throw Object.assign(new Error('Ambiente IBS inválido.'), { code: 'IBS_AMBIENTE_INVALIDO' });
  return Object.freeze({ tributo: 'IBS', ambiente, versaoContrato: 'MOC1.10', verificadoEm: '2026-10-12', fonte, runtimeHabilitado: false, capacidades });
}
// Não aceita transportes ou credenciais: não há endpoint remoto implementado.
export function criarClienteIbsBloqueado(opcoes) {
  const contrato = obterCapacidadesIbs(opcoes);
  return Object.freeze({ ...contrato, executar: async acao => {
    if (!Object.hasOwn(capacidades, acao)) throw Object.assign(new Error('Operação IBS desconhecida.'), { code: 'IBS_OPERACAO_INVALIDA' });
    throw Object.assign(new Error('Integração IBS bloqueada até confirmação do contrato e homologação.'), { code: 'IBS_CONTRATO_INCOMPLETO', motivo: capacidades[acao].motivo });
  } });
}

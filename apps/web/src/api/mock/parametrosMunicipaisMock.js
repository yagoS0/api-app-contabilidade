// Respostas deliberadamente sintéticas, sem afirmar convênio/alíquota de cidade real.
export function parametrosMunicipaisMock() {
  const registros = new Map();
  return {
    async getParametrosMunicipais(companyId) {
      return { habilitado: true, ambiente: 'homolog', demonstracao: true, municipio: '3304557', servicos: ['171901'],
        codigoServicoNacional: '171901', codigoServicoMunicipal: '001',
        consultas: [...(registros.get(companyId) || [])], validacaoMunicipalCompleta: false };
    },
    async consultarParametrosMunicipais(companyId, entrada) {
      const lista = registros.get(companyId) || [];
      const anterior = lista.find(r => r.requestKey === entrada.requestKey);
      if (anterior) return anterior;
      const registro = { id: `mock-${entrada.requestKey}`, ...entrada, ambiente: 'homolog',
        codigoServico: entrada.recurso === 'servico' ? entrada.codigoServico + entrada.codigoServicoMunicipal : null,
        status: 'RECEBIDO_PARA_CONFERENCIA', createdAt: new Date().toISOString(), concluidaEm: new Date().toISOString(),
        origem: 'Demonstração local', resposta: { demonstracao: true, aviso: 'Exemplo de retorno para conferência; não representa parâmetros oficiais.' } };
      registros.set(companyId, [registro, ...lista]);
      return registro;
    },
  };
}

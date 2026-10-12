export function criarApuracaoConsumoMock() {
  const indisponivel = async () => { throw new Error('A preparação de IBS/CBS está indisponível na demonstração. Nenhum registro foi salvo.'); };
  return {
    async getBaseApuracaoConsumo(id, contexto) {
      return { ok: true, demonstracao: true, ...contexto, contribuinte: null, configuracao: null, revisao: null,
        desatualizada: false, podeEditar: false,
        capacidades: { coletar: false, conferir: false, confirmarOficial: false, emitirGuia: false, consultarPagamento: false } };
    },
    vincularEstabelecimentosConsumo: indisponivel,
    salvarConfiguracaoConsumo: indisponivel,
    prepararRevisaoConsumo: indisponivel,
    async getColetasCbs(id, { ambiente }) {
      return { ok: true, ambiente, demonstracao: true, capacidades: { abrir: false, consultar: false, baixar: false },
        bloqueios: [{ codigo: 'DEMONSTRACAO', mensagem: 'A demonstração não consulta a Receita nem armazena arquivos oficiais.' }],
        coletas: [], limite: 100, truncada: false };
    },
    async getMensalConsumo(id, contexto) {
      return { ok: true, ...contexto, demonstracao: true, versao: 0, estado: 'EM_CONFERENCIA', desatualizada: false,
        estabelecimentos: [], pendenciasCalculadas: [], podeConferir: false, valoresOficiais: null,
        capacidades: { editar: false, conferirLocal: false, emitirGuia: false, confirmarOficial: false, consultarPagamento: false },
        dados: { valoresDeclarados: null, cobertura: null, pendencias: [], guias: [], pagamentos: [], alocacoes: [] } };
    },
    async getHistoricoMensalConsumo(id, contexto) { return { ok: true, ...contexto, historico: [], truncado: false }; },
    registrarAcaoMensalConsumo: indisponivel,
    reprocessarArquivoColetaCbs: indisponivel,
    abrirColetaCbs: indisponivel,
    consultarColetaCbs: indisponivel,
    baixarArquivoColetaCbs: indisponivel,
  };
}

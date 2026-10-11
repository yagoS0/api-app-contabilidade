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
  };
}

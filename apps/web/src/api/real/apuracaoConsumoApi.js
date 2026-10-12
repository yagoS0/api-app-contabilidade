export function apuracaoConsumoApi(request) {
  const base = id => `/firm/companies/${encodeURIComponent(id)}/apuracao-consumo`;
  const gravar = (id, sufixo, dados) => request(`${base(id)}/${sufixo}`, { method: 'POST', body: JSON.stringify(dados) });
  return {
    getBaseApuracaoConsumo: (id, contexto) => request(`${base(id)}?${new URLSearchParams(contexto)}`),
    vincularEstabelecimentosConsumo: (id, dados) => gravar(id, 'estabelecimentos', dados),
    salvarConfiguracaoConsumo: (id, dados) => gravar(id, 'configuracoes', dados),
    prepararRevisaoConsumo: (id, dados) => gravar(id, 'revisoes', dados),
    getMensalConsumo: (id, { tributo, ambiente, competencia }) => request(`${base(id)}/mensal?${new URLSearchParams({ tributo, ambiente, competencia })}`),
    getHistoricoMensalConsumo: (id, { tributo, ambiente, competencia }) => request(`${base(id)}/mensal/historico?${new URLSearchParams({ tributo, ambiente, competencia })}`),
    registrarAcaoMensalConsumo: (id, { id: intencao, versao, tributo, ambiente, competencia, acao, dados, contextoHash }) => gravar(id, 'mensal/acoes', { id: intencao, versao, tributo, ambiente, competencia, acao, dados, ...(contextoHash !== undefined ? { contextoHash } : {}) }),
    reprocessarArquivoColetaCbs: (id, coletaId, { ambiente }) => gravar(id, `cbs/coletas/${encodeURIComponent(coletaId)}/reprocessar`, { ambiente }),
    getColetasCbs: (id, { ambiente }) => request(`${base(id)}/cbs/coletas?${new URLSearchParams({ ambiente })}`),
    abrirColetaCbs: (id, { id: intencao, ambiente, recurso }) => gravar(id, 'cbs/coletas', { id: intencao, ambiente, recurso }),
    consultarColetaCbs: (id, coletaId, { id: intencao, ambiente }) => gravar(id, `cbs/coletas/${encodeURIComponent(coletaId)}/consultar`, { id: intencao, ambiente }),
    baixarArquivoColetaCbs: (id, coletaId, { id: intencao, ambiente }) => gravar(id, `cbs/coletas/${encodeURIComponent(coletaId)}/baixar`, { id: intencao, ambiente }),
  };
}

export function apuracaoConsumoApi(request) {
  const base = id => `/firm/companies/${encodeURIComponent(id)}/apuracao-consumo`;
  const gravar = (id, sufixo, dados) => request(`${base(id)}/${sufixo}`, { method: 'POST', body: JSON.stringify(dados) });
  return {
    getBaseApuracaoConsumo: (id, contexto) => request(`${base(id)}?${new URLSearchParams(contexto)}`),
    vincularEstabelecimentosConsumo: (id, dados) => gravar(id, 'estabelecimentos', dados),
    salvarConfiguracaoConsumo: (id, dados) => gravar(id, 'configuracoes', dados),
    prepararRevisaoConsumo: (id, dados) => gravar(id, 'revisoes', dados),
  };
}

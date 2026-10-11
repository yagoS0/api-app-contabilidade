export function reformaFiscalApi(request) {
  const base = id => `/firm/companies/${encodeURIComponent(id)}/reforma`;
  return {
    getCadastroReforma: id => request(base(id)),
    salvarCadastroReforma: (id, dados) => request(base(id), { method: 'POST', body: JSON.stringify(dados) }),
    getCarteiraReforma: competencia => request(`/firm/reforma/carteira?competencia=${encodeURIComponent(competencia)}`),
    getVerificacaoNfse: (id, competencia) => request(`${base(id)}/nfse?competencia=${encodeURIComponent(competencia)}`),
    verificarNfseReforma: (id, competencia) => request(`${base(id)}/nfse`, { method: 'POST', body: JSON.stringify({ competencia }) }),
  };
}

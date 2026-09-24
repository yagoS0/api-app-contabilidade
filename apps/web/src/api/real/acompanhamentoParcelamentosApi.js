export function acompanhamentoParcelamentosApi(request) {
  const base = (companyId) => `/firm/companies/${encodeURIComponent(companyId)}/parcelamentos/acompanhamento`;
  const post = (url, body = {}) => request(url, { method: "POST", body: JSON.stringify(body) });
  return {
    getAcompanhamentoParcelamentos: (id) => request(base(id)),
    vincularGuiaParcelamento: (id, guideId, body) => post(`${base(id)}/guias/${encodeURIComponent(guideId)}/vincular`, body),
    reprocessarIndiciosParcelamento: (id) => post(`${base(id)}/reprocessar`),
    localizarParcelamentos: (id, body) => post(`${base(id)}/localizar`, body),
    criarAcompanhamentoParcelamento: (id, body) => post(`${base(id)}/contratos`, body),
    editarAcompanhamentoParcelamento: (id, contratoId, body) => request(`${base(id)}/contratos/${encodeURIComponent(contratoId)}`, { method: "PATCH", body: JSON.stringify(body) }),
    resolverIndicacaoParcelamento: (id, indicacaoId, body) => post(`${base(id)}/indicacoes/${encodeURIComponent(indicacaoId)}/resolver`, body),
    capturarContratoParcelamento: (id, contratoId) => post(`${base(id)}/contratos/${encodeURIComponent(contratoId)}/capturar`),
    consultarPagamentoParcela: (id, parcelaId) => post(`${base(id)}/parcelas/${encodeURIComponent(parcelaId)}/consultar-pagamento`),
    getDocumentoParcela: (id, parcelaId) => request(`${base(id)}/parcelas/${encodeURIComponent(parcelaId)}/documento`),
    conferirDocumentoParcela: (id, parcelaId, body) => post(`${base(id)}/parcelas/${encodeURIComponent(parcelaId)}/conferir-documento`, body),
  };
}

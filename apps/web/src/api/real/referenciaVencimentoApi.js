export function criarReferenciaVencimentoApi(request) {
  const base = companyId => `/firm/companies/${encodeURIComponent(companyId)}/automacao/referencia-vencimento`;
  return {
    getDueDateReference: (companyId, identity) => request(`${base(companyId)}?${new URLSearchParams({tributo:identity.tributo,tipoPeriodo:identity.tipoPeriodo,competencia:identity.competencia})}`),
    saveDueDateReference: (companyId, command) => request(base(companyId), {method:'PUT',body:JSON.stringify(command)}),
  };
}

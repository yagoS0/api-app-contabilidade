// Fechamento contábil não encerra o acompanhamento fiscal das parcelas.
export function temPendenciaParcelamento(company) {
  const compliance = company?.guideCompliance;
  return Boolean(compliance?.hasPendenciasParcelamento || compliance?.parcDas?.pendenciaOperacional
    || Number(compliance?.parcDas?.pendencias) > 0 || compliance?.parcDas?.atrasada);
}

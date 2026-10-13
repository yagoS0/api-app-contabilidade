// Fechamento contábil não encerra o acompanhamento fiscal das parcelas.
export function temPendenciaParcelamento(company) {
  const compliance = company?.guideCompliance;
  if (Array.isArray(compliance?.guiasParcelamentoMes)) return compliance.guiasParcelamentoMes.length > 0;
  return Boolean(compliance?.hasPendenciasParcelamento || compliance?.parcDas?.pendenciaOperacional
    || Number(compliance?.parcDas?.pendencias) > 0 || compliance?.parcDas?.atrasada);
}

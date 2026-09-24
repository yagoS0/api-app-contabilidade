// Usa evidências já salvas; uma indicação sem referência não inventa vencimentos.
export function parcelasFaltantesDoRelatorio(report, companyId) {
  const rows = [...(report?.simples || []), ...(report?.presumidos || []), ...(report?.outros || [])]
    .filter(r => r.portalClientId === companyId);
  const itens = [...rows.flatMap(r => r.faltantes || []),
    ...(report?.conferirVencimento || []).filter(p => p.portalClientId === companyId && p.indicacaoId),
    ...(report?.pendenciasAnteriores || []).filter(p => p.portalClientId === companyId && !p.guideId)];
  const unicos = new Map();
  for (const p of itens) {
    if (p.guideId || p.pagamentoConfirmado || p.formaPagamento === "DEBITO_AUTOMATICO") continue;
    const key = (p.parcelaId || p.id || p.indicacaoId || `${p.parcelamentoId || p.acordo}:${p.numeroParcela || p.referencia || p.vencimento || "mes"}`) + (p.somenteAnteriores ? ":anteriores" : "");
    if (!unicos.has(key)) unicos.set(key, { ...p, key });
  }
  return [...unicos.values()];
}

export function parcelasFaltantesDaVisao(itens, { visao, mes, competencia }) {
  return itens.filter(p => {
    if (p.somenteAnteriores) return visao === "anteriores" || visao === "todas";
    const ref = String(p.vencimento || p.referencia || "").slice(0, 7);
    if (visao === "todas") return true;
    if (!ref) return visao === "vencimento" || (visao === "anteriores" && p.atrasada);
    if (visao === "anteriores") return ref < mes;
    if (visao === "competencia") return p.referencia === competencia;
    return visao === "vencimento" && ref === mes;
  });
}

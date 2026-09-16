// A cobertura é parte do resultado: uma parcela ausente não vira vantagem competitiva.
export function coberturaDoRegime(resultado, entradas) {
  if (!resultado || resultado.indisponivel || resultado.elegivel === false) return { estado: "indisponivel", pendencias: [] };
  const p = [...(resultado.pendenciasMistas || [])];
  const simples = resultado.regime === "Simples Nacional";
  const mercadorias = ["comercio", "combustiveis"].includes(entradas.atividadePresumido);
  const cppFora = !simples || entradas.anexoSimples === "IV";
  if (cppFora && entradas.folhaAnual == null && entradas.folhaRemuneracoesAnual == null) p.push("Informe a base de remunerações para estimar a CPP.");
  if (cppFora && entradas.folhaAnual > 0 && entradas.folhaRemuneracoesAnual == null) p.push("Separe a base de remunerações da folha com encargos usada no Fator R.");
  if (cppFora && (entradas.folhaAnual > 0 || entradas.folhaRemuneracoesAnual > 0) && entradas.encargosAdicionaisAnuais == null) p.push("Informe os encargos patronais adicionais (RAT/FAP e terceiros), inclusive zero quando não houver.");
  if (!simples && mercadorias) p.push("ICMS/ST e tratamentos por produto não estão estimados nesta comparação.");
  if (!simples && /transporte/.test(entradas.atividadePresumido || "")) p.push("A incidência municipal ou estadual do transporte precisa de análise específica.");
  if ((!simples && !mercadorias || simples && resultado.faixa === 6 && !["I", "II"].includes(entradas.anexoSimples)) && entradas.aliquotaIss == null) p.push("Informe o ISS que será recolhido por fora.");
  if (simples && resultado.faixa === 6 && ["I", "II"].includes(entradas.anexoSimples)) p.push("ICMS fora do DAS não estimado.");
  if (resultado.servicosAte120k?.cabe && resultado.servicosAte120k.confirmado == null) p.push("Confirme o enquadramento da presunção reduzida de serviços.");
  if (resultado.basesDetalhadas?.valores?.outrasReceitas > 0) p.push("Confira PIS/Cofins e tratamentos específicos sobre as outras receitas contábeis.");
  return { estado: p.length ? "parcial" : "estimado", pendencias: p };
}

const REGIMES = { SIMPLES_NACIONAL: "Simples Nacional", LUCRO_PRESUMIDO: "Lucro Presumido", LUCRO_REAL: "Lucro Real" };
export function avaliarComparacao(regimes, entradas) {
  const resultados = regimes.map(r => ({ ...r, cobertura: coberturaDoRegime(r, entradas) }));
  const calculados = resultados.filter(r => !r.indisponivel && r.elegivel !== false && Number.isFinite(r.total)).sort((a, b) => a.total - b.total);
  const faltantes = resultados.filter(r => r.elegivel !== false && (r.indisponivel || r.cobertura.estado === "parcial"));
  const completa = calculados.length >= 2 && !faltantes.length;
  const menorEstimativa = calculados[0] || null;
  const atual = calculados.find(r => r.regime === (REGIMES[entradas.regimeAtual] || entradas.regimeAtual));
  return {
    regimes: resultados, menorEstimativa, comparacaoCompleta: completa,
    vencedor: completa ? menorEstimativa : null,
    economiaAnual: completa ? calculados[1].total - menorEstimativa.total : null,
    economiaVsAtual: completa && atual ? atual.total - menorEstimativa.total : null,
    regimeAtual: atual?.regime || null,
    motivoComparacao: completa ? "Estimativa entre os regimes calculados, nas condições informadas."
      : "Comparação parcial: faltam dados ou tributos para indicar o regime de menor custo. Os valores abaixo permitem conferir o que já foi estimado.",
  };
}

const numero = v => v == null || v === "" || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v);
export function basesLucroReal(receitaAnual, valores) {
  if (!valores?.ativo) return null;
  const campos = ["custos", "despesas", "outrasReceitas", "adicoesIrpj", "exclusoesIrpj", "adicoesCsll", "exclusoesCsll"];
  const faltantes = campos.filter(k => numero(valores[k]) == null);
  if (faltantes.length) return { indisponivel: true, faltantes };
  const v = Object.fromEntries(campos.map(k => [k, numero(valores[k])]));
  const lucroContabil = receitaAnual + v.outrasReceitas - v.custos - v.despesas;
  return { lucroContabil, baseIrpj: Math.max(0, lucroContabil + v.adicoesIrpj - v.exclusoesIrpj),
    baseCsll: Math.max(0, lucroContabil + v.adicoesCsll - v.exclusoesCsll), valores: v };
}

function celula(valor) {
  let texto = String(valor ?? "");
  // Conteúdo de cadastro nunca deve virar fórmula ao abrir o CSV.
  if (/^[\s]*[=+@-]/.test(texto) || /^[\t\r\n]/.test(texto)) texto = "'" + texto;
  return '"' + texto.replaceAll('"', '""') + '"';
}

export function relatorioMonitoramentoCsv(alertas, competencia) {
  const linhas = [["Competência", "Empresa", "CNPJ", "Categoria", "Pendência", "Orientação", "Declaração confirmada", "Estado interno"]];
  for (const a of alertas) linhas.push([
    competencia, a.empresa, a.cnpj ? "'" + a.cnpj : "", a.categoria, a.titulo, a.detalhe,
    a.numeroDeclaracao || "", a.estado || "",
  ]);
  return "\uFEFF" + linhas.map(l => l.map(celula).join(";")).join("\r\n");
}

export function baixarRelatorioMonitoramento(alertas, competencia) {
  const url = URL.createObjectURL(new Blob([relatorioMonitoramentoCsv(alertas, competencia)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = `pendencias-fiscais-${String(competencia).replace(/[^0-9-]/g, "")}.csv`;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

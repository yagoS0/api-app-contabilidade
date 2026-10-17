
const moeda = (valor) => {
  if (valor == null || valor === "" || !Number.isFinite(Number(valor))) return null;
  return Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

export function informacaoRecalculo(entry) {
  const registro = entry?.recalculoGuia;
  const instante = registro?.recalculadoEm || entry?.recalculatedAt;
  if (!instante) return null;
  const antes = registro ? registro.valorAnterior : entry?.recalculatedFromValor;
  const depois = registro ? registro.valorAtual : entry?.recalculatedToValor;
  if (antes != null && depois != null && antes !== "" && depois !== ""
      && Number.isFinite(Number(antes)) && Number.isFinite(Number(depois))
      && Math.round(Number(antes) * 100) === Math.round(Number(depois) * 100)) return null;
  const data = new Date(instante);
  const quando = Number.isNaN(data.getTime()) ? "Data não informada" : data.toLocaleString("pt-BR");
  const anterior = moeda(registro ? registro.valorAnterior : entry?.recalculatedFromValor);
  const atual = moeda(registro ? registro.valorAtual : entry?.recalculatedToValor);
  return {
    quando,
    anterior,
    atual,
    totalGuia: registro?.escopoValor === "TOTAL_GUIA",
    titulo: `Guia recalculada · ${quando}${atual ? ` · ${atual}` : ""}`,
  };
}
export { moeda };


const moeda = (valor) => {
  if (valor == null || valor === "" || !Number.isFinite(Number(valor))) return null;
  return Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

export function informacaoRecalculo(entry) {
  const registro = entry?.recalculoGuia;
  const instante = registro?.recalculadoEm || entry?.recalculatedAt;
  if (!instante) return null;
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

export function DetalheRecalculoGuia({ entry }) {
  const info = informacaoRecalculo(entry);
  if (!info) return null;
  return <div style={{ fontSize: "0.75rem", lineHeight: 1.5, color: "var(--text-muted)", whiteSpace: "normal" }}>
    <div>Recálculo em {info.quando}</div>
    {info.anterior && <div>{info.totalGuia ? "Total anterior da guia" : "Valor anterior"}: {info.anterior}</div>}
    {info.atual && <div>{info.totalGuia ? "Total da guia recalculada" : "Valor atualizado"}: {info.atual}</div>}
    {info.totalGuia && <div>O total da guia pode reunir mais de um tributo.</div>}
    <div>O recálculo da guia não confirma pagamento nem altera, por si só, os valores contábeis.</div>
  </div>;
}

export function RecalculoGuiaAviso({ entry }) {
  if (!informacaoRecalculo(entry)) return null;
  return <details style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
    <summary style={{ cursor: "pointer", fontWeight: 600 }}>Guia recalculada</summary>
    <DetalheRecalculoGuia entry={entry} />
  </details>;
}

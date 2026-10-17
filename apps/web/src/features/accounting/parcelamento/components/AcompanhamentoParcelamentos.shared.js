
export function filtrarAcompanhamento(itens, filtro, mes) {
  return (itens || []).filter((i) => filtro === "todos" || (filtro === "anteriores" ? i.anterior : filtro === "mes" ? (i.vencimento?.slice(0, 7) || i.referencia) === mes || (!i.referencia && !i.vencimento) : i.estado !== "RESOLVIDA"));
}

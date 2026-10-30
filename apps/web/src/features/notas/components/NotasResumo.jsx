import { fmtMoney } from "./notasStyles.shared.js";

// Counts come from the full server population, never from the current page.
export function NotasResumo({ summary, resumoRecebidas, loading, error, papel, onSelectPapel, auditoria, captura }) {
  const emitidas = summary?.lista?.EMIT;
  const recebidas = resumoRecebidas?.lista?.DEST;
  return <section className="notas-resumo" aria-label="Indicadores das notas">
    {[['EMIT', 'Emitidas', emitidas], ['DEST', 'Recebidas', recebidas]].map(([key, label, data]) =>
      <button type="button" className="notas-indicador" key={key} aria-pressed={papel === key}
        onClick={() => onSelectPapel?.(key)}>
        <span>{label}</span>
        <strong>{loading ? '…' : error || !data || data.valorCompleto === false ? '—' : fmtMoney(data.valor)}</strong>
        <small>{loading ? 'Carregando…' : error || !data ? 'Contagem indisponível' : data.count + ' notas no filtro'}</small>
        {!loading && !error && data?.valorCompleto === false && <small>Valor a verificar</small>}
        {key === 'EMIT' && captura && <small className="notas-captura-resumo">{captura.texto}</small>}
      </button>)}
    {auditoria}
  </section>;
}

const moeda = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (v) => v ? String(v).slice(0, 10).split("-").reverse().join("/") : "Não informado";
const key = (r) => `${r.portalClientId}::${r.competencia}`;
const tipo = (d) => d.parcelamentoId ? `Parcelamento ${d.acordo || ""} · parcela ${d.numeroParcela ?? "não informada"}` : d.tipo === "SIMPLES" ? "DAS" : d.tipo;

export function GuiasPorVencimento({ title, rows, selectedKeys, onToggle, onToggleAll, onlyPending }) {
  const visible = rows.filter((r) => !onlyPending || r.pendingGuideIds.length || r.faltantes.length);
  const keys = visible.filter((r) => r.pendingGuideIds.length).map(key);
  return <section style={{ marginBottom: 24 }}>
    <h3>{title} ({visible.length})</h3>
    {keys.length > 0 && <label><input type="checkbox" aria-label={`Selecionar ${title}`} checked={keys.every((k) => selectedKeys.has(k))}
      onChange={() => onToggleAll(keys, !keys.every((k) => selectedKeys.has(k)))} /> Selecionar empresas com documentos disponíveis</label>}
    {!visible.length && <p>Nenhuma pendência neste grupo.</p>}
    {visible.map((r) => <article key={key(r)} style={{ border: "1px solid var(--border, #44475a)", borderRadius: 10, marginTop: 12, padding: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input type="checkbox" aria-label={`Selecionar ${r.razao}`} checked={selectedKeys.has(key(r))}
          disabled={!r.pendingGuideIds.length} onChange={() => onToggle(key(r))} />
        <strong>{r.razao}</strong><span>{r.cnpj}</span>
        <a href={`/companies/${r.portalClientId}/guides`} style={{ marginLeft: "auto" }}>Abrir guias</a>
      </div>
      <p>{r.pendingGuideIds.length} documento(s) disponível(is) para envio{r.faltantes.length ? ` · Lote incompleto: ${r.faltantes.length} parcela(s) para conferir` : ""}</p>
      {r.documentos.length > 0 && <div style={{ overflowX: "auto" }}><table style={{ width: "100%", textAlign: "left", borderSpacing: "0 8px" }}>
        <thead><tr><th>Documento</th><th>Competência / referência</th><th>Vencimento</th><th>Valor</th><th>Situação</th></tr></thead>
        <tbody>{r.documentos.map((d) => <tr key={d.guideId}>
          <td>{tipo(d)}</td><td>{d.competencia || "Não informada"}</td><td>{data(d.vencimento)}</td><td>{moeda(d.valor)}</td>
          <td>{d.paga ? "Paga — fora do envio" : d.enviada || d.emailStatus === "SENT" ? "Já enviada" : d.emailStatus === "SENDING" ? "Envio em andamento" : d.falhou ? `Falhou: ${d.erro || "confira e tente novamente"}` : "Será enviada ao selecionar"}</td>
        </tr>)}</tbody>
      </table></div>}
      {r.faltantes.map((p) => <p key={p.parcelaId} role="status" style={{ color: "var(--warning, #ffb347)" }}>
        {p.motivo} · acordo {p.acordo || "não informado"} · parcela {p.numeroParcela ?? "não informada"} · vence {data(p.vencimento)}.
      </p>)}
      {r.faltantes.length > 0 && <p>Enviar os documentos disponíveis mantém esta empresa pendente de conferência.</p>}
    </article>)}
  </section>;
}

export function PendenciasForaDoLote({ report }) {
  return [{ title: "Pendências anteriores", items: report?.pendenciasAnteriores }, { title: "Conferir vencimento", items: report?.conferirVencimento }].map(({ title, items }) => items?.length ?
    <details key={title} style={{ marginBottom: 16 }}><summary>{title} ({items.length}) — não incluídas neste envio</summary>
      <ul>{items.map((d) => <li key={d.guideId}><a href={`/companies/${d.portalClientId}/guides`}>{d.razao}</a> · {tipo(d)} · competência {d.competencia || "não informada"} · vencimento {data(d.vencimento)} · {moeda(d.valor)}{d.enviada ? " · já enviada, pagamento não confirmado" : ""}</li>)}</ul>
    </details> : null);
}

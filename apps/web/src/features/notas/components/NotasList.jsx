// Q12.C.1: tabela de notas (NF-e + NFS-e) com filtros e resumo.

import { useState } from "react";
import { PANEL, fmtMoney, fmtDate } from "./notasStyles";

const TYPE_LABEL = { NFE: "NF-e", NFSE: "NFS-e" };
const PAPEL_BADGE = {
  EMIT: { bg: "rgba(105,255,71,0.15)", color: "#69FF47", label: "Emitida" },
  DEST: { bg: "rgba(139,233,253,0.15)", color: "#8BE9FD", label: "Recebida" },
};

function StatusBadge({ status }) {
  const s = String(status || "autorizada").toLowerCase();
  const color = s === "cancelada" ? "#FF4757" : s === "rejeitada" ? "#FFB347" : "#69FF47";
  return <span style={{ color, fontSize: "0.7rem", fontWeight: 600 }}>{s}</span>;
}

function SummaryStrip({ summary, ano }) {
  if (!summary) return null;
  const t = summary.totals || {};
  const f = summary.filtersApplied || {};
  // Detecta se há algum filtro ativo pra mudar o label
  const hasFilter = Boolean(f.papel || f.type || f.competencia || f.search);
  const scopeLabel = hasFilter ? "filtradas" : `do ano ${ano}`;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12, marginBottom: 12 }}>
      <Box label={`Notas ${scopeLabel}`} value={t.totalNotas || 0} accent={PANEL.text}
        sub={(t.countNfe || t.countNfse) ? `NF-e ${t.countNfe || 0} · NFS-e ${t.countNfse || 0}` : null} />
      <Box label="Emitidas (Receita bruta)" value={fmtMoney(t.totalEmitido)} accent="#69FF47" />
      <Box label="Recebidas (Compras)" value={fmtMoney(t.totalRecebido)} accent="#8BE9FD" />
      {t.countCanceladas > 0 && (
        <Box label="Canceladas" value={t.countCanceladas} accent="#FF4757" />
      )}
    </div>
  );
}
function Box({ label, value, accent, sub }) {
  return (
    <div style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: "0.7rem", color: PANEL.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: "1.15rem", fontWeight: 600, color: accent }}>{value}</div>
      {sub && (
        <div style={{ fontSize: "0.7rem", color: PANEL.muted, marginTop: 2 }}>{sub}</div>
      )}
    </div>
  );
}

function FilterBar({ filters, onChange, onApply, loading, total }) {
  const [local, setLocal] = useState(filters);
  function patch(k, v) { setLocal((p) => ({ ...p, [k]: v, offset: 0 })); }
  function apply() { onChange(local); onApply(local); }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
      <select value={local.papel} onChange={(e) => patch("papel", e.target.value)}
        style={inputStyle}>
        <option value="">Todos os papéis</option>
        <option value="EMIT">Emitidas</option>
        <option value="DEST">Recebidas</option>
      </select>
      <select value={local.type} onChange={(e) => patch("type", e.target.value)} style={inputStyle}>
        <option value="">Todos os tipos</option>
        <option value="NFE">NF-e</option>
        <option value="NFSE">NFS-e</option>
      </select>
      <input type="month" value={local.competencia || ""} onChange={(e) => patch("competencia", e.target.value)}
        placeholder="competência" style={inputStyle} />
      <input type="text" value={local.search || ""} onChange={(e) => patch("search", e.target.value)}
        placeholder="Buscar (CNPJ, nome, número, chave)" style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
      <button onClick={apply} disabled={loading}
        style={{ padding: "8px 14px", background: PANEL.accent, color: "#000", border: "none", borderRadius: 6, fontWeight: 600, cursor: "pointer" }}>
        {loading ? "..." : "Filtrar"}
      </button>
      <span style={{ marginLeft: "auto", color: PANEL.muted, fontSize: "0.8rem" }}>
        {total} nota(s)
      </span>
    </div>
  );
}
const inputStyle = {
  background: PANEL.field, border: `1px solid ${PANEL.border}`,
  borderRadius: 6, color: PANEL.text, padding: "8px 10px", fontSize: "0.85rem",
};

export function NotasList({ notas, total, summary, ano, filters, onFiltersChange, onApply, loading }) {
  return (
    <section style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <h3 style={{ margin: 0, marginBottom: 12, fontSize: "0.95rem", color: PANEL.text }}>📄 Notas Fiscais</h3>
      <SummaryStrip summary={summary} ano={ano} />
      <FilterBar filters={filters} onChange={onFiltersChange} onApply={onApply} loading={loading} total={total} />

      {notas.length === 0 && !loading && (
        <div style={{ padding: 24, textAlign: "center", color: PANEL.muted, fontSize: "0.85rem" }}>
          Nenhuma nota encontrada com os filtros atuais.
          <div style={{ marginTop: 4, fontSize: "0.75rem" }}>
            Use os botões "Buscar NF-e" e "Buscar NFS-e" acima pra capturar do SEFAZ/ADN.
          </div>
        </div>
      )}

      {notas.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ background: PANEL.field, color: PANEL.muted, textAlign: "left" }}>
                <th style={th}>Data</th>
                <th style={th}>Tipo</th>
                <th style={th}>Papel</th>
                <th style={th}>Nº/Série</th>
                <th style={th}>Emitente</th>
                <th style={th}>Tomador</th>
                <th style={{ ...th, textAlign: "right" }}>Valor</th>
                <th style={th}>Status</th>
                <th style={th}>Chave</th>
              </tr>
            </thead>
            <tbody>
              {notas.map((n) => {
                const pap = PAPEL_BADGE[n.papel] || { bg: "transparent", color: PANEL.muted, label: "—" };
                return (
                  <tr key={n.id} style={{ borderTop: `1px solid ${PANEL.border}`, color: PANEL.text }}>
                    <td style={td}>{fmtDate(n.issueDate)}</td>
                    <td style={td}>{TYPE_LABEL[n.type] || n.type}</td>
                    <td style={td}>
                      <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: "0.7rem", fontWeight: 600,
                                     background: pap.bg, color: pap.color, border: `1px solid ${pap.color}` }}>
                        {pap.label}
                      </span>
                    </td>
                    <td style={td}>{n.numero || "—"}{n.serie ? `/${n.serie}` : ""}</td>
                    <td style={{ ...td, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title={n.emitenteNome}>
                      {n.emitenteNome || "—"}
                      <div style={{ fontSize: "0.7rem", color: PANEL.muted, fontFamily: "monospace" }}>
                        {n.emitenteDoc || ""}
                      </div>
                    </td>
                    <td style={{ ...td, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title={n.tomadorNome}>
                      {n.tomadorNome || "—"}
                    </td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "monospace" }}>{fmtMoney(n.total)}</td>
                    <td style={td}><StatusBadge status={n.statusEfetivo || n.status} /></td>
                    <td style={{ ...td, fontSize: "0.7rem", fontFamily: "monospace", color: PANEL.muted, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}
                        title={n.chaveAcesso}>
                      {n.chaveAcesso ? `…${n.chaveAcesso.slice(-12)}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
const th = { padding: 6 };
const td = { padding: 6 };

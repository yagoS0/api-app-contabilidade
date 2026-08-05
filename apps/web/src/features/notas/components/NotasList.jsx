// Q12.C.1: tabela de notas da janela ativa (NF-e OU NFS-e) — enxuta, sem resumo/stats.

import { useState } from "react";
import { PANEL, fmtMoney, fmtDate } from "./notasStyles";

const PAPEL_BADGE = {
  EMIT: { bg: "rgba(105,255,71,0.15)", color: "#69FF47", label: "Emitida" },
  DEST: { bg: "rgba(139,233,253,0.15)", color: "#8BE9FD", label: "Recebida" },
};

function StatusBadge({ status }) {
  const s = String(status || "autorizada").toLowerCase();
  const color = s === "cancelada" ? "#FF4757" : s === "rejeitada" ? "#FFB347" : "#69FF47";
  return <span style={{ color, fontSize: "0.7rem", fontWeight: 600 }}>{s}</span>;
}

function FilterBar({ filters, onChange, onApply, loading, total }) {
  // `local` é o RASCUNHO dos campos que só valem depois de "Filtrar" (hoje, a busca textual).
  // ⚠ Ele é uma cópia feita no MOUNT e nunca ressincroniza. Isso é de propósito para o rascunho —
  // digitar não pode ser desfeito por um render —, mas é veneno para campo que muda de FORA: a
  // competência agora vem do header, e `local` guardava a de quando a aba montou. Duas
  // consequências, as duas silenciosas: o rótulo mostrava o mês velho, e clicar em "Filtrar"
  // reenviava esse mês velho, desfazendo a escolha feita no topo da página.
  //
  // Por isso a competência é lida SEMPRE de `filters` (a fonte de verdade) e injetada no apply.
  const [local, setLocal] = useState(filters);
  function patch(k, v) { setLocal((p) => ({ ...p, [k]: v, offset: 0 })); }
  function apply() {
    const efetivo = { ...local, competencia: filters.competencia };
    onChange(efetivo);
    onApply(efetivo);
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
      {/* ⚠ Sem `input type="month"`: a competência é da EMPRESA e vem do seletor do header.
          Aqui ela ainda por cima ficava atrás de um botão "Filtrar" — o campo mostrava um mês e a
          tabela mostrava outro até alguém clicar, então os dois controles chegavam a discordar
          dentro da MESMA tela. O valor continua à vista, como rótulo, porque filtro ativo sem
          rastro visível é o "filtro fantasma" que a listagem já teve de resolver. */}
      <span style={{ fontSize: "0.8rem", color: PANEL.muted, whiteSpace: "nowrap" }}>
        Competência: <strong style={{ color: PANEL.text }}>{filters.competencia || "todas"}</strong>
      </span>
      <input type="text" value={local.search || ""} onChange={(e) => patch("search", e.target.value)}
        placeholder="Buscar (CNPJ, nome, número, chave)" style={{ ...inputStyle, flex: 1, minWidth: 180 }} />
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

export function NotasList({ notas, total, filters, onFiltersChange, onApply, loading, onMarcarStatus }) {
  return (
    <section style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <FilterBar filters={filters} onChange={onFiltersChange} onApply={onApply} loading={loading} total={total ?? notas.length} />

      {notas.length === 0 && !loading && (
        <div style={{ padding: 24, textAlign: "center", color: PANEL.muted, fontSize: "0.85rem" }}>
          Nenhuma nota encontrada.
        </div>
      )}

      {notas.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ background: PANEL.field, color: PANEL.muted, textAlign: "left" }}>
                <th style={th}>Data</th>
                <th style={th}>Papel</th>
                <th style={th}>Nº/Série</th>
                <th style={th}>Emitente</th>
                <th style={th}>Tomador</th>
                <th style={{ ...th, textAlign: "right" }}>Valor</th>
                <th style={th}>Status</th>
                <th style={th}>Chave</th>
                {onMarcarStatus && <th style={th}></th>}
              </tr>
            </thead>
            <tbody>
              {notas.map((n) => {
                const pap = PAPEL_BADGE[n.papel] || { bg: "transparent", color: PANEL.muted, label: "—" };
                return (
                  <tr key={n.id} style={{ borderTop: `1px solid ${PANEL.border}`, color: PANEL.text }}>
                    <td style={td}>{fmtDate(n.issueDate)}</td>
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
                    {onMarcarStatus && (
                      <td style={td}>
                        {String(n.statusEfetivo || "").toLowerCase() === "cancelada" ? (
                          <button onClick={() => onMarcarStatus(n.id, "autorizada")} title="Reativar (volta a contar no faturamento)"
                            style={{ background: "transparent", border: `1px solid ${PANEL.border}`, color: "#69FF47", borderRadius: 6, padding: "3px 8px", fontSize: "0.7rem", cursor: "pointer", whiteSpace: "nowrap" }}>
                            Reativar
                          </button>
                        ) : (
                          <button onClick={() => { if (window.confirm("Marcar esta nota como CANCELADA? Ela sai do faturamento/apuração.")) onMarcarStatus(n.id, "cancelada"); }} title="Marcar como cancelada (sai do faturamento/apuração)"
                            style={{ background: "transparent", border: `1px solid ${PANEL.border}`, color: "#FF4757", borderRadius: 6, padding: "3px 8px", fontSize: "0.7rem", cursor: "pointer", whiteSpace: "nowrap" }}>
                            Cancelar
                          </button>
                        )}
                      </td>
                    )}
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

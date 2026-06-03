import { PANEL, fmtDate } from "./notasStyles";

export function PendenciasList({ pendencias, saving, onReabrir, onResolver }) {
  const open = (pendencias || []).filter((p) => !p.resolvida);
  if (open.length === 0) return null;

  return (
    <section style={{ background: "rgba(255,71,87,0.08)", border: "1px solid #FF4757", borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <h3 style={{ margin: 0, marginBottom: 12, fontSize: "0.95rem", color: "#FF4757" }}>
        ⚠ Pendências pós-fechamento ({open.length})
      </h3>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
        <thead>
          <tr style={{ background: PANEL.field, color: PANEL.muted, textAlign: "left" }}>
            <th style={{ padding: 6 }}>Competência</th>
            <th style={{ padding: 6 }}>Motivo</th>
            <th style={{ padding: 6 }}>Detectada em</th>
            <th style={{ padding: 6 }}></th>
          </tr>
        </thead>
        <tbody>
          {open.map((p) => (
            <tr key={p.id} style={{ borderTop: `1px solid ${PANEL.border}`, color: PANEL.text }}>
              <td style={{ padding: 6, fontFamily: "monospace" }}>{p.competencia}</td>
              <td style={{ padding: 6 }}>
                {p.motivo}
                {p.observacoes && <span style={{ color: PANEL.muted, display: "block", fontSize: "0.75rem" }}>{p.observacoes}</span>}
              </td>
              <td style={{ padding: 6, color: PANEL.muted }}>{fmtDate(p.createdAt)}</td>
              <td style={{ padding: 6, textAlign: "right" }}>
                <button onClick={() => onReabrir(p.competencia)} disabled={saving}
                  style={{ padding: "4px 8px", borderRadius: 4, border: "none", background: "#FFB347", color: "#000", cursor: "pointer", fontSize: "0.75rem", marginRight: 4, fontWeight: 600 }}>
                  Reabrir competência
                </button>
                <button onClick={() => onResolver(p.id)} disabled={saving}
                  style={{ padding: "4px 8px", borderRadius: 4, border: `1px solid ${PANEL.border}`, background: "transparent", color: PANEL.muted, cursor: "pointer", fontSize: "0.75rem" }}>
                  Ignorar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

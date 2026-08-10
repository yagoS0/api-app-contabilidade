import { Button } from "../../../components/ui/Button";
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
              {/* O âmbar da caixa (a pendência CONSTATADA) fica — ali a cor é informação. O botão
                  não: "Reabrir competência" é ação, e ação primária é o accent. */}
              <td style={{ padding: 6, textAlign: "right" }}>
                <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                  <Button size="sm" onClick={() => onReabrir(p.competencia)} disabled={saving}>
                    Reabrir competência
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => onResolver(p.id)} disabled={saving}>
                    Ignorar
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

import { PANEL, StateBadge, fmtMoney } from "./notasStyles";

const MES_LABELS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

function CompActions({ comp, onFechar, onReabrir, onDetalhar, saving }) {
  const estado = comp.estado;
  return (
    <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
      <button onClick={() => onDetalhar(comp)} disabled={saving}
        style={{ padding: "4px 8px", borderRadius: 4, border: `1px solid ${PANEL.border}`, background: "transparent", color: PANEL.text, cursor: "pointer", fontSize: "0.75rem" }}>
        Detalhar
      </button>
      {(estado === "aberto" || estado === "em_conferencia") && (
        <button onClick={() => onFechar(comp.competencia)} disabled={saving}
          style={{ padding: "4px 8px", borderRadius: 4, border: "none", background: "#8BE9FD", color: "#000", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 }}>
          Fechar
        </button>
      )}
      {["fechado","calculado","revisado","transmitido","confirmado","erro"].includes(estado) && (
        <button onClick={() => onReabrir(comp.competencia)} disabled={saving}
          style={{ padding: "4px 8px", borderRadius: 4, border: "none", background: "#FFB347", color: "#000", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 }}>
          Reabrir
        </button>
      )}
    </div>
  );
}

export function CompetenciasTable({ ano, setAno, competencias, saving, onFechar, onReabrir, onDetalhar }) {
  const anos = [];
  const atual = new Date().getUTCFullYear();
  for (let y = atual; y >= atual - 4; y--) anos.push(y);

  return (
    <section style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: "0.95rem", color: PANEL.text }}>📅 Competências</h3>
        <select value={ano} onChange={(e) => setAno(Number(e.target.value))}
          style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "4px 8px" }}>
          {anos.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
        <thead>
          <tr style={{ background: PANEL.field, color: PANEL.muted, textAlign: "left" }}>
            <th style={{ padding: 6 }}>Competência</th>
            <th style={{ padding: 6 }}>Estado</th>
            <th style={{ padding: 6, textAlign: "right" }}>Notas</th>
            <th style={{ padding: 6, textAlign: "right" }}>RB12</th>
            <th style={{ padding: 6, textAlign: "right" }}>Pendências</th>
            <th style={{ padding: 6, textAlign: "right" }}></th>
          </tr>
        </thead>
        <tbody>
          {competencias.map((comp) => {
            const mes = Number(comp.competencia.slice(5, 7));
            return (
              <tr key={comp.competencia} style={{ borderTop: `1px solid ${PANEL.border}`, color: PANEL.text }}>
                <td style={{ padding: 6 }}>
                  {MES_LABELS[mes - 1]} / {comp.competencia.slice(0, 4)}
                  <span style={{ marginLeft: 8, color: PANEL.muted, fontSize: "0.75rem" }}>({comp.competencia})</span>
                </td>
                <td style={{ padding: 6 }}><StateBadge estado={comp.estado} /></td>
                <td style={{ padding: 6, textAlign: "right" }}>{comp.notasCount || 0}</td>
                <td style={{ padding: 6, textAlign: "right" }}>{fmtMoney(comp.rb12)}</td>
                <td style={{ padding: 6, textAlign: "right", color: comp.pendenciasAbertas > 0 ? "#FF4757" : PANEL.muted }}>
                  {comp.pendenciasAbertas > 0 ? `⚠ ${comp.pendenciasAbertas}` : "—"}
                </td>
                <td style={{ padding: 6 }}>
                  <CompActions comp={comp} saving={saving}
                    onFechar={onFechar} onReabrir={onReabrir} onDetalhar={onDetalhar} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

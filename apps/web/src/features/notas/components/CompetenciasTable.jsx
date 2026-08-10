import { Button } from "../../../components/ui/Button";
import { PANEL, StateBadge, fmtMoney } from "./notasStyles";

const MES_LABELS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

// ⚠ `Fechar` era ciano e `Reabrir` era âmbar — token de ESTADO em botão de AÇÃO. O ciano é a
// categoria (competência FECHADA) e o âmbar é PENDÊNCIA; pintar o botão com a cor do estado que ele
// produz faz o comando parecer o estado, e o `StateBadge` da mesma linha — que é onde a cor
// realmente significa alguma coisa — perde a exclusividade. Ambos são a ação da linha: accent.
function CompActions({ comp, onFechar, onReabrir, onDetalhar, saving }) {
  const estado = comp.estado;
  return (
    <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
      <Button size="sm" variant="secondary" onClick={() => onDetalhar(comp)} disabled={saving}>
        Detalhar
      </Button>
      {(estado === "aberto" || estado === "em_conferencia") && (
        <Button size="sm" onClick={() => onFechar(comp.competencia)} disabled={saving}>
          Fechar
        </Button>
      )}
      {["fechado","calculado","revisado","transmitido","confirmado","erro"].includes(estado) && (
        <Button size="sm" onClick={() => onReabrir(comp.competencia)} disabled={saving}>
          Reabrir
        </Button>
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

import { PANEL, StateBadge, fmtMoney, fmtDate } from "./notasStyles";

function Field({ label, value, mono }) {
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <span style={{ fontSize: "0.7rem", color: PANEL.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontSize: "0.9rem", color: PANEL.text, fontFamily: mono ? "monospace" : undefined }}>{value}</span>
    </div>
  );
}

export function CompetenciaDetailPanel({ comp, saving, onFechar, onReabrir, onClose }) {
  if (!comp) return null;
  return (
    <section style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: "0.95rem", color: PANEL.text }}>
          Competência {comp.competencia} <StateBadge estado={comp.estado} />
        </h3>
        <button onClick={onClose}
          style={{ background: "none", border: "none", color: PANEL.muted, cursor: "pointer", fontSize: "1.2rem" }}>×</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 16 }}>
        <Field label="Notas capturadas" value={comp.notasCount ?? 0} />
        <Field label="RB12 (móvel)" value={fmtMoney(comp.rb12)} />
        <Field label="FS12" value={fmtMoney(comp.fs12Manual)} />
        <Field label="FS12 origem" value={comp.fs12Origem || "—"} />
        <Field label="Fator R" value={comp.fatorR != null ? `${(Number(comp.fatorR) * 100).toFixed(2)}%` : "—"} />
        <Field label="Pendências" value={comp.pendenciasAbertas ?? 0} />
        <Field label="Fechada em" value={fmtDate(comp.lockedAt)} />
        <Field label="Reaberta em" value={fmtDate(comp.reopenedAt)} />
      </div>

      {comp.reopenedReason && (
        <div style={{ padding: 10, background: "rgba(255,179,71,0.10)", border: "1px solid #FFB347", borderRadius: 6, marginBottom: 12, fontSize: "0.85rem", color: "#FFB347" }}>
          <strong>Motivo da última reabertura:</strong> {comp.reopenedReason}
        </div>
      )}

      <div style={{ padding: 12, background: PANEL.field, borderRadius: 6, marginBottom: 12, fontSize: "0.85rem", color: PANEL.muted }}>
        📄 <strong style={{ color: PANEL.text }}>Notas ({comp.notasCount ?? 0})</strong> —
        a listagem detalhada das notas captadas entra na Q12.B (worker DFe + ADN).
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {(comp.estado === "aberto" || comp.estado === "em_conferencia") && (
          <button onClick={() => onFechar(comp.competencia)} disabled={saving}
            style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "#8BE9FD", color: "#000", cursor: "pointer", fontWeight: 600 }}>
            🔒 Fechar competência
          </button>
        )}
        {["fechado","calculado","revisado","transmitido","confirmado","erro"].includes(comp.estado) && (
          <button onClick={() => onReabrir(comp.competencia)} disabled={saving}
            style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "#FFB347", color: "#000", cursor: "pointer", fontWeight: 600 }}>
            🔓 Reabrir competência
          </button>
        )}
      </div>
    </section>
  );
}

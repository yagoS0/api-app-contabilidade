import { useState } from "react";
import { Button } from "../../../components/ui/Button";
import { PANEL } from "./notasStyles";

export function ReabrirCompetenciaModal({ competencia, saving, onConfirm, onClose }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState(null);

  async function handle() {
    setErr(null);
    if (!reason.trim()) { setErr("Motivo é obrigatório."); return; }
    try {
      await onConfirm(reason.trim());
      onClose?.();
    } catch (e) { setErr(e?.message || "Erro."); }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 1700,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{ background: PANEL.surface, border: "1px solid #FFB347", borderRadius: 10, padding: 24, width: "100%", maxWidth: 480 }}>
        <h3 style={{ margin: 0, marginBottom: 12, color: "#FFB347" }}>Reabrir competência {competencia}</h3>
        <p style={{ fontSize: "0.85rem", color: PANEL.muted, marginBottom: 16 }}>
          A reabertura traz a competência de volta para conferência. O motivo fica registrado no audit log
          (FiscalExecutionLog).
        </p>
        <label style={{ display: "grid", gap: 4, marginBottom: 12, fontSize: "0.8rem", color: PANEL.muted }}>
          Motivo (obrigatório)
          <textarea rows={3} autoFocus value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Ex: nota retroativa de prestador X chegou em DD/MM/YYYY"
            style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "8px 12px", resize: "vertical" }} />
        </label>
        {err && <div style={{ color: "var(--danger)", fontSize: "0.8rem", marginBottom: 12 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          {/* Âmbar aqui era a cor da pendência que a reabertura CRIA, não do comando. */}
          <Button onClick={handle} disabled={saving || !reason.trim()}
            title={!reason.trim() ? "Informe o motivo para reabrir" : ""}>
            {saving ? "Reabrindo…" : "Reabrir"}
          </Button>
        </div>
      </div>
    </div>
  );
}

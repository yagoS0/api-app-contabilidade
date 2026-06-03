import { useState } from "react";
import { PANEL } from "./notasStyles";

const SERVICOS = [
  { value: "NFSE", label: "NFS-e (ADN / Emissor Nacional)" },
  { value: "DFE", label: "DFe / SEFAZ (NF-e)" },
  { value: "ESOCIAL", label: "eSocial" },
  { value: "SN", label: "Simples Nacional / PGDAS-D" },
];

export function ProcuracaoCreateModal({ saving, onCreate, onClose }) {
  const [servico, setServico] = useState("NFSE");
  const [validade, setValidade] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [err, setErr] = useState(null);

  async function handle() {
    setErr(null);
    try {
      await onCreate({ servico, validade: validade || null, observacoes: observacoes || null });
      onClose?.();
    } catch (e) { setErr(e?.message || "Erro."); }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 1700,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10, padding: 24, width: "100%", maxWidth: 480 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: PANEL.text, fontSize: "1rem" }}>Nova procuração e-CAC</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: PANEL.muted, cursor: "pointer", fontSize: "1.4rem" }}>×</button>
        </div>

        <label style={{ display: "grid", gap: 4, marginBottom: 12, fontSize: "0.8rem", color: PANEL.muted }}>
          Serviço
          <select value={servico} onChange={(e) => setServico(e.target.value)}
            style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "8px 12px" }}>
            {SERVICOS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>

        <label style={{ display: "grid", gap: 4, marginBottom: 12, fontSize: "0.8rem", color: PANEL.muted }}>
          Validade (opcional)
          <input type="date" value={validade} onChange={(e) => setValidade(e.target.value)}
            style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "8px 12px" }} />
        </label>

        <label style={{ display: "grid", gap: 4, marginBottom: 12, fontSize: "0.8rem", color: PANEL.muted }}>
          Observações
          <textarea rows={3} value={observacoes} onChange={(e) => setObservacoes(e.target.value)}
            style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "8px 12px", resize: "vertical" }} />
        </label>

        {err && <div style={{ color: "#FF4757", fontSize: "0.8rem", marginBottom: 12 }}>{err}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} disabled={saving}
            style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${PANEL.border}`, background: "transparent", color: PANEL.text, cursor: "pointer" }}>
            Cancelar
          </button>
          <button onClick={handle} disabled={saving}
            style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "#69FF47", color: "#000", cursor: "pointer", fontWeight: 600 }}>
            {saving ? "Salvando…" : "Cadastrar"}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { PANEL } from "./notasStyles";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";

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
    <Modal titulo="Nova procuração e-CAC" tamanho="sm" aoFechar={onClose} ocupado={saving} fecharAoClicarFundo={false}
      rodape={<><Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button><Button onClick={handle} disabled={saving}>{saving ? "Salvando…" : "Cadastrar"}</Button></>}>
        <label style={{ display: "grid", gap: 4, marginBottom: 12, fontSize: "0.875rem", color: PANEL.muted }}>
          Serviço
          <select disabled={saving} value={servico} onChange={(e) => setServico(e.target.value)}
            style={{ minWidth: 0, width: "100%", boxSizing: "border-box", background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "8px 12px" }}>
            {SERVICOS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>

        <label style={{ display: "grid", gap: 4, marginBottom: 12, fontSize: "0.875rem", color: PANEL.muted }}>
          Validade (opcional)
          <input disabled={saving} type="date" value={validade} onChange={(e) => setValidade(e.target.value)}
            style={{ minWidth: 0, width: "100%", boxSizing: "border-box", background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "8px 12px" }} />
        </label>

        <label style={{ display: "grid", gap: 4, marginBottom: 12, fontSize: "0.875rem", color: PANEL.muted }}>
          Observações
          <textarea disabled={saving} rows={3} value={observacoes} onChange={(e) => setObservacoes(e.target.value)}
            style={{ minWidth: 0, width: "100%", boxSizing: "border-box", background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "8px 12px", resize: "vertical" }} />
        </label>

        {err && <div role="alert" style={{ color: "var(--danger)", fontSize: "0.875rem", marginBottom: 12 }}>{err}</div>}

    </Modal>
  );
}

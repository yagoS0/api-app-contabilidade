// Q12.B+++.1: modal de upload do A1 da empresa.

import { useState } from "react";
import { Button } from "../../../../components/ui/Button";

const PANEL = { surface: "#21222C", field: "#282A36", border: "#44475A", text: "#F8F8F2", muted: "#aeb6d3" };

export function CompanyCertificateUploadModal({ saving, onUpload, onClose }) {
  const [file, setFile] = useState(null);
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);

  async function handle() {
    setErr(null);
    if (!file) return setErr("Selecione o arquivo .pfx ou .p12");
    if (!password) return setErr("Digite a senha do certificado");
    if (file.size > 10 * 1024 * 1024) return setErr("Arquivo muito grande (max 10 MB)");
    try {
      await onUpload({ file, password });
      onClose?.();
    } catch (e) {
      setErr(e?.message || "Falha ao enviar o certificado.");
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 1800,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10, padding: 24, width: "100%", maxWidth: 480 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, color: PANEL.text, fontSize: "1rem" }}>Upload de Certificado A1</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: PANEL.muted, cursor: "pointer", fontSize: "1.4rem" }}>×</button>
        </div>

        <p style={{ fontSize: "0.8rem", color: PANEL.muted, marginBottom: 16 }}>
          O cert deve ser <strong>A1 ICP-Brasil</strong> emitido para o CNPJ desta empresa.
          Usado para consultar NFS-e via ADN Nacional (gov.br/nfse) e outros serviços que
          exigem cert próprio.
        </p>

        <label style={{ display: "grid", gap: 4, marginBottom: 12, fontSize: "0.8rem", color: PANEL.muted }}>
          Arquivo .pfx / .p12
          <input type="file" accept=".pfx,.p12,application/x-pkcs12"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "8px 12px" }} />
          {file && (
            <span style={{ fontSize: "0.75rem", color: "#69FF47" }}>
              ✓ {file.name} ({(file.size / 1024).toFixed(1)} KB)
            </span>
          )}
        </label>

        <label style={{ display: "grid", gap: 4, marginBottom: 16, fontSize: "0.8rem", color: PANEL.muted }}>
          Senha do certificado
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "8px 12px" }} />
        </label>

        {err && (
          <div style={{ color: "#FF4757", fontSize: "0.8rem", marginBottom: 12, padding: 8, background: "rgba(255,71,87,0.10)", border: "1px solid #FF4757", borderRadius: 4 }}>
            {err}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handle} disabled={saving || !file || !password}>
            {saving ? "Enviando…" : "Enviar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

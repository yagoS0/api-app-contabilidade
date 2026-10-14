// Q12.B+++.1: modal de upload do A1 da empresa.

import { useRef, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { Modal } from "../../../../components/ui/Modal";

const PANEL = { surface: "var(--bg-surface)", field: "var(--bg-subtle)", border: "var(--border)", text: "var(--text)", muted: "var(--text-muted)" };

export function CompanyCertificateUploadModal({ saving, onUpload, onClose }) {
  const [file, setFile] = useState(null);
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);

  const [enviando, setEnviando] = useState(false);
  const trava = useRef(false);
  const ocupado = Boolean(saving || enviando);
  const fechar = () => { if (!saving && !trava.current) onClose?.(); };

  async function handle() {
    if (saving || trava.current) return;
    setErr(null);
    if (!file) return setErr("Selecione o arquivo .pfx ou .p12");
    if (!password) return setErr("Digite a senha do certificado");
    if (file.size > 10 * 1024 * 1024) return setErr("Arquivo muito grande (max 10 MB)");
    trava.current = true; setEnviando(true);
    try {
      await onUpload({ file, password });
      onClose?.();
    } catch (e) {
      setErr(e?.message || "Falha ao enviar o certificado.");
    } finally { trava.current = false; setEnviando(false); }
  }

  return (
    <Modal titulo="Upload de Certificado A1" tamanho="sm" ocupado={ocupado} aoFechar={fechar} fecharAoClicarFundo={false} rodape={<div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={fechar} disabled={ocupado}>Cancelar</Button>
          <Button onClick={handle} disabled={ocupado || !file || !password}>
            {ocupado ? "Enviando…" : "Enviar"}
          </Button>
        </div>}>
      <fieldset disabled={ocupado} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <p style={{ fontSize: "0.875rem", color: PANEL.muted, marginBottom: 16 }}>
          O cert deve ser <strong>A1 ICP-Brasil</strong> emitido para o CNPJ desta empresa.
          Usado para consultar NFS-e via ADN Nacional (gov.br/nfse) e outros serviços que
          exigem cert próprio.
        </p>

        <label style={{ display: "grid", gap: 4, marginBottom: 12, fontSize: "0.875rem", color: PANEL.muted }}>
          Arquivo .pfx / .p12
          <input type="file" accept=".pfx,.p12,application/x-pkcs12"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            style={{ minWidth: 0, width: "100%", boxSizing: "border-box", background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "8px 12px" }} />
          {file && (
            <span style={{ fontSize: "0.75rem", color: "var(--success)" }}>
              ✓ {file.name} ({(file.size / 1024).toFixed(1)} KB)
            </span>
          )}
        </label>

        <label style={{ display: "grid", gap: 4, marginBottom: 16, fontSize: "0.875rem", color: PANEL.muted }}>
          Senha do certificado
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            style={{ minWidth: 0, width: "100%", boxSizing: "border-box", background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "8px 12px" }} />
        </label>

        {err && (
          <div role="alert" style={{ color: "var(--danger)", fontSize: "0.875rem", marginBottom: 12, padding: 8, background: "rgba(255,71,87,0.10)", border: "1px solid var(--danger)", borderRadius: 4 }}>
            {err}
          </div>
        )}

      </fieldset>
    </Modal>
  );
}

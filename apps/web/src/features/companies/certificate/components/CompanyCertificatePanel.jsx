// Q12.B+++.1: painel de status + ações do cert A1 da empresa.
// Mountado na aba "Editar Cadastro" embaixo do CompanyForm.

import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { CompanyCertificateUploadModal } from "./CompanyCertificateUploadModal";

const PANEL = { surface: "#21222C", field: "#282A36", border: "#44475A", text: "#F8F8F2", muted: "#aeb6d3", accent: "#8BE9FD" };

function fmtDate(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("pt-BR"); } catch { return String(iso); }
}

function daysUntil(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.floor(ms / (24 * 3600 * 1000));
}

export function CompanyCertificatePanel({ api, companyId, feedback }) {
  const [cert, setCert] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    if (!companyId || !api?.getCompanyCert) return;
    setLoading(true);
    try {
      const out = await api.getCompanyCert(companyId);
      setCert(out);
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Falha ao carregar cert");
    } finally { setLoading(false); }
  }, [api, companyId, feedback]);

  useEffect(() => { load(); }, [load]);

  async function handleUpload({ file, password }) {
    setSaving(true);
    try {
      const out = await api.uploadCompanyCert(companyId, file, password);
      if (!out?.ok) throw new Error(out?.error || "Falha ao enviar");
      feedback?.notifySuccess?.("Certificado enviado com sucesso.");
      await load();
    } finally { setSaving(false); }
  }

  async function handleDelete() {
    setSaving(true);
    try {
      await api.deleteCompanyCert(companyId);
      feedback?.notifySuccess?.("Certificado removido.");
      setConfirmDelete(false);
      await load();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Falha ao remover");
    } finally { setSaving(false); }
  }

  const hasCert = Boolean(cert?.hasCertificate);
  const days = daysUntil(cert?.expiresAt);
  const expSoon = days != null && days <= 30 && days >= 0;
  const expired = days != null && days < 0;

  return (
    <section style={{
      background: PANEL.surface, border: `1px solid ${PANEL.border}`,
      borderRadius: 8, padding: 16, marginTop: 16,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: "0.95rem", color: PANEL.text }}>
          🔐 Certificado A1 da empresa
        </h3>
        <div style={{ display: "flex", gap: 8 }}>
          {hasCert && (
            <button onClick={() => setConfirmDelete(true)} disabled={saving}
              style={{ padding: "6px 12px", borderRadius: 6, border: `1px solid var(--danger)`, background: "transparent", color: "var(--danger)", cursor: "pointer", fontSize: "0.8rem" }}>
              Remover
            </button>
          )}
          <button onClick={() => setShowUpload(true)} disabled={saving}
            style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: PANEL.accent, color: "#000", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600 }}>
            {hasCert ? "Substituir" : "+ Cadastrar"}
          </button>
        </div>
      </div>

      {loading && <div style={{ color: PANEL.muted, fontSize: "0.85rem" }}>Carregando…</div>}

      {!loading && !hasCert && (
        <div style={{ padding: 12, background: PANEL.field, borderRadius: 6, fontSize: "0.85rem", color: PANEL.muted }}>
          Nenhum certificado cadastrado. Necessário para consultar NFS-e via ADN Nacional
          (gov.br/nfse). Use o botão <strong>"+ Cadastrar"</strong> para enviar o arquivo
          <code style={{ marginLeft: 4 }}>.pfx</code> e a senha.
        </div>
      )}

      {!loading && hasCert && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))", gap: 12, fontSize: "0.85rem" }}>
          <Field label="Status" value={
            expired ? <span style={{ color: "var(--danger)", fontWeight: 600 }}>⚠ EXPIRADO</span> :
            expSoon ? <span style={{ color: "#FFB347", fontWeight: 600 }}>⚠ Expira em {days} dias</span> :
            <span style={{ color: "var(--success)", fontWeight: 600 }}>✓ Ativo</span>
          } />
          <Field label="Enviado em" value={fmtDate(cert.uploadedAt)} />
          <Field label="Validade" value={fmtDate(cert.expiresAt)} />
          {days != null && !expired && (
            <Field label="Dias restantes" value={`${days} dia${days === 1 ? "" : "s"}`} />
          )}
        </div>
      )}

      {confirmDelete && (
        <div style={{ marginTop: 12, padding: 12, background: "rgba(255,71,87,0.10)", border: "1px solid var(--danger)", borderRadius: 6 }}>
          <p style={{ margin: 0, color: PANEL.text, fontSize: "0.85rem" }}>
            Tem certeza? Captura de NFS-e via ADN deixará de funcionar até cadastrar novo cert.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <Button size="sm" variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancelar
            </Button>
            {/* Este É o passo de confirmação (a caixa em volta pergunta "tem certeza?"), então a
                conversão para `.btn-danger` é pura: o vermelho continua no mesmo lugar, saindo do
                token em vez de um `var(--danger)` sólido inventado aqui. */}
            <Button size="sm" variant="danger" onClick={handleDelete} disabled={saving}>
              Remover certificado
            </Button>
          </div>
        </div>
      )}

      {showUpload && (
        <CompanyCertificateUploadModal
          saving={saving}
          onUpload={handleUpload}
          onClose={() => setShowUpload(false)}
        />
      )}
    </section>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: "0.7rem", color: PANEL.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ color: PANEL.text }}>{value}</div>
    </div>
  );
}

import { useState } from "react";
import { PANEL, fmtDate } from "./notasStyles";
import { ProcuracaoCreateModal } from "./ProcuracaoCreateModal";

const SERVICO_LABELS = { NFSE: "NFS-e", DFE: "DFe / SEFAZ", ESOCIAL: "eSocial", SN: "PGDAS-D / SN" };

function StatusBadge({ proc }) {
  if (proc.status === "REVOGADA") return <span style={{ color: PANEL.muted }}>↻ REVOGADA</span>;
  if (proc.validade && new Date(proc.validade) < new Date()) {
    return <span style={{ color: "var(--danger)" }}>⚠ EXPIRADA em {fmtDate(proc.validade)}</span>;
  }
  return <span style={{ color: "var(--success)" }}>✓ ATIVA {proc.validade ? `(até ${fmtDate(proc.validade)})` : ""}</span>;
}

export function ProcuracoesPanel({ procuracoes, saving, onCreate, onRevogar }) {
  const [openModal, setOpenModal] = useState(false);
  const ativas = (procuracoes || []).filter((p) => p.status !== "REVOGADA");

  return (
    <section style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: "0.95rem", color: PANEL.text }}>⚙ Procurações e-CAC</h3>
        <button onClick={() => setOpenModal(true)}
          style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: PANEL.accent, color: "#000", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600 }}>
          + Nova procuração
        </button>
      </div>

      {ativas.length === 0 && (
        <div style={{ color: PANEL.muted, fontSize: "0.85rem", padding: 8 }}>
          Nenhuma procuração cadastrada. Cadastre as procurações que o escritório tem no e-CAC dessa empresa
          para que os workers (DFe, NFS-e, eSocial, PGDAS-D) possam atuar.
        </div>
      )}

      {ativas.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead>
            <tr style={{ background: PANEL.field, color: PANEL.muted, textAlign: "left" }}>
              <th style={{ padding: 6 }}>Serviço</th>
              <th style={{ padding: 6 }}>Status</th>
              <th style={{ padding: 6 }}>Cert real</th>
              <th style={{ padding: 6 }}>Observações</th>
              <th style={{ padding: 6 }}></th>
            </tr>
          </thead>
          <tbody>
            {ativas.map((p) => (
              <tr key={p.id} style={{ borderTop: `1px solid ${PANEL.border}`, color: PANEL.text }}>
                <td style={{ padding: 6 }}>{SERVICO_LABELS[p.servico] || p.servico}</td>
                <td style={{ padding: 6 }}><StatusBadge proc={p} /></td>
                <td style={{ padding: 6, color: p.certCheck?.ok ? "var(--success)" : "var(--danger)" }}>
                  {p.certCheck?.ok ? `✓ ${p.certCheck.source}` : `✗ ${p.certCheck?.code || "—"}`}
                </td>
                <td style={{ padding: 6, color: PANEL.muted }}>{p.observacoes || "—"}</td>
                <td style={{ padding: 6, textAlign: "right" }}>
                  <button onClick={() => onRevogar(p.id)} disabled={saving}
                    style={{ padding: "4px 8px", borderRadius: 4, border: `1px solid ${PANEL.border}`, background: "transparent", color: "var(--danger)", cursor: "pointer", fontSize: "0.75rem" }}>
                    Revogar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {openModal && (
        <ProcuracaoCreateModal saving={saving} onCreate={onCreate} onClose={() => setOpenModal(false)} />
      )}
    </section>
  );
}

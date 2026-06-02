// Q11.1: modal de confirmação de exclusão da empresa.
// Exige contador digitar o CNPJ exato pra liberar o botão "Excluir definitivamente".
// Operação é IRREVERSÍVEL — apaga via cascade Prisma: Guides, AccountingEntries,
// Parcelamentos, Circular, ChartOfAccounts, Funções, etc.

import { useState } from "react";
import { Button } from "../../../../components/ui/Button";

const PANEL = {
  surface: "#21222C",
  field: "#282A36",
  border: "#44475A",
  text: "#F8F8F2",
  muted: "#aeb6d3",
};

function formatCnpj(cnpj) {
  const d = String(cnpj || "").replace(/\D+/g, "");
  if (d.length !== 14) return cnpj;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}

export function DeleteCompanyModal({ company, saving, onConfirm, onClose }) {
  const [confirmInput, setConfirmInput] = useState("");
  const [err, setErr] = useState(null);

  const onlyDigits = (s) => String(s || "").replace(/\D+/g, "");
  const isMatch = onlyDigits(confirmInput) === onlyDigits(company?.cnpj);
  const canDelete = isMatch && !saving;

  async function handleDelete() {
    setErr(null);
    if (!isMatch) return setErr("CNPJ digitado não confere.");
    try {
      await onConfirm({ confirmCnpj: confirmInput });
    } catch (e) {
      setErr(e?.message || "Falha ao excluir.");
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 1800,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{
        background: PANEL.surface, border: "1px solid #FF4757", borderRadius: 10,
        padding: 24, width: "100%", maxWidth: 520,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, color: "#FF4757", fontSize: "1rem" }}>
            ⚠ Excluir empresa
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: PANEL.muted, cursor: "pointer", fontSize: "1.4rem" }}>×</button>
        </div>

        <div style={{
          padding: 12, background: "rgba(255, 71, 87, 0.10)", border: "1px solid #FF4757",
          borderRadius: 6, marginBottom: 16, color: PANEL.text, fontSize: "0.85rem",
        }}>
          <strong>Esta ação é irreversível.</strong> Serão apagados:
          <ul style={{ margin: "6px 0 0 18px", padding: 0, color: PANEL.muted, fontSize: "0.8rem" }}>
            <li>Todos os lançamentos contábeis (provisões, baixas, receitas)</li>
            <li>Todas as guias (DAS, INSS, DARFs) e PDFs armazenados</li>
            <li>Todos os parcelamentos e funções de lançamento</li>
            <li>Circulares mensais, plano de contas da empresa</li>
            <li>Acessos de usuários, certificado digital</li>
          </ul>
        </div>

        <div style={{ marginBottom: 16, fontSize: "0.85rem", color: PANEL.text }}>
          Empresa: <strong>{company?.razao || "—"}</strong><br />
          CNPJ: <strong style={{ fontFamily: "monospace" }}>{formatCnpj(company?.cnpj)}</strong>
        </div>

        <label style={{ display: "grid", gap: 4, fontSize: "0.8rem", color: PANEL.muted, marginBottom: 12 }}>
          Digite o CNPJ exato para confirmar:
          <input
            type="text"
            value={confirmInput}
            onChange={(e) => { setConfirmInput(e.target.value); setErr(null); }}
            placeholder="00.000.000/0000-00"
            autoFocus
            style={{
              background: PANEL.field, border: `1px solid ${isMatch ? "#69FF47" : PANEL.border}`,
              borderRadius: 6, color: PANEL.text, padding: "8px 12px",
              fontSize: "0.95rem", fontFamily: "monospace",
            }}
          />
          {isMatch && (
            <span style={{ color: "#69FF47", fontSize: "0.75rem" }}>✓ CNPJ confere</span>
          )}
        </label>

        {err && (
          <div style={{
            color: "#FF4757", fontSize: "0.8rem", padding: "8px 10px",
            background: "rgba(255, 71, 87, 0.12)", border: "1px solid #FF4757",
            borderRadius: 6, marginBottom: 12,
          }}>
            {err}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button
            variant="danger"
            onClick={handleDelete}
            disabled={!canDelete}
            style={canDelete ? { background: "#FF4757", color: "white" } : { background: "#44475A", color: "#888", cursor: "not-allowed" }}
          >
            {saving ? "Excluindo…" : "Excluir definitivamente"}
          </Button>
        </div>
      </div>
    </div>
  );
}

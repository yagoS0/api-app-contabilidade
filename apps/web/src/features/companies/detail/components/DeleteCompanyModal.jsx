import { normalizarDocumento } from "@contabilidade/shared/documentos-fiscais";
// Q11.1: modal de confirmação de exclusão da empresa.
// Exige contador digitar o CNPJ exato pra liberar o botão "Excluir definitivamente".
// Operação é IRREVERSÍVEL — apaga via cascade Prisma: Guides, AccountingEntries,
// Parcelamentos, Circular, ChartOfAccounts, Funções, etc.

import { useRef, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { Modal } from "../../../../components/ui/Modal";

const PANEL = {
  surface: "var(--bg-surface)",
  field: "var(--bg-subtle)",
  border: "var(--border)",
  text: "var(--text)",
  muted: "var(--text-muted)",
};

function formatCnpj(cnpj) {
  const d = normalizarDocumento(cnpj);
  if (d.length !== 14) return cnpj;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}

export function DeleteCompanyModal({ company, saving, onConfirm, onClose }) {
  const [confirmInput, setConfirmInput] = useState("");
  const [err, setErr] = useState(null);

  const onlyDigits = (s) => String(s || "").replace(/\D+/g, "");
  const isMatch = normalizarDocumento(confirmInput) === normalizarDocumento(company?.cnpj);
  const [excluindo, setExcluindo] = useState(false);
  const trava = useRef(false);
  const ocupado = Boolean(saving || excluindo);
  const canDelete = isMatch && !ocupado;
  const fechar = () => { if (!saving && !trava.current) onClose?.(); };

  async function handleDelete() {
    if (saving || trava.current) return;
    setErr(null);
    if (!isMatch) return setErr("CNPJ digitado não confere.");
    trava.current = true; setExcluindo(true);
    try {
      await onConfirm({ confirmCnpj: confirmInput });
    } catch (e) {
      setErr(e?.message || "Falha ao excluir.");
    } finally { trava.current = false; setExcluindo(false); }
  }

  return (
    <Modal titulo="Excluir empresa" tamanho="md" ocupado={ocupado} aoFechar={fechar} fecharAoClicarFundo={false} rodape={<div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={fechar} disabled={ocupado}>Cancelar</Button>
          <Button
            variant="danger"
            onClick={handleDelete}
            disabled={!canDelete}
          >
            {ocupado ? "Excluindo…" : "Excluir definitivamente"}
          </Button>
        </div>}>
      <fieldset tabIndex={-1} data-modal-autofocus disabled={ocupado} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div style={{
          padding: 12, background: "rgba(255, 71, 87, 0.10)", border: "1px solid var(--danger)",
          borderRadius: 6, marginBottom: 16, color: PANEL.text, fontSize: "0.85rem",
        }}>
          <strong>Esta ação é irreversível.</strong> Serão apagados:
          <ul style={{ margin: "6px 0 0 18px", padding: 0, color: PANEL.muted, fontSize: "0.875rem" }}>
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

        <label style={{ display: "grid", gap: 4, fontSize: "0.875rem", color: PANEL.muted, marginBottom: 12 }}>
          Digite o CNPJ exato para confirmar:
          <input
            type="text"
            value={confirmInput}
            onChange={(e) => { setConfirmInput(e.target.value); setErr(null); }}
            placeholder="00.000.000/0000-00"
            data-modal-autofocus
            style={{
              background: PANEL.field, border: `1px solid ${isMatch ? "var(--success)" : PANEL.border}`,
              borderRadius: 6, color: PANEL.text, padding: "8px 12px",
              fontSize: "0.95rem", fontFamily: "monospace",
            }}
          />
          {isMatch && (
            <span style={{ color: "var(--success)", fontSize: "0.75rem" }}>✓ CNPJ confere</span>
          )}
        </label>

        {err && (
          <div role="alert" style={{
            color: "var(--danger)", fontSize: "0.875rem", padding: "8px 10px",
            background: "rgba(255, 71, 87, 0.12)", border: "1px solid var(--danger)",
            borderRadius: 6, marginBottom: 12,
          }}>
            {err}
          </div>
        )}

      </fieldset>
    </Modal>
  );
}

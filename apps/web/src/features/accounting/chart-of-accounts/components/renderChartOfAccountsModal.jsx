import { useState, useRef } from "react";

const TIPO_OPTIONS = ["ATIVO", "PASSIVO", "RECEITA", "DESPESA", "PATRIMONIO"];
const NATUREZA_OPTIONS = ["DEVEDORA", "CREDORA"];

const EMPTY_FORM = { codigo: "", nome: "", tipo: "DESPESA", natureza: "DEVEDORA" };

const PANEL = {
  page: "#1A1B26",
  surface: "#24253A",
  field: "#1A1B26",
  border: "#44475A",
  text: "#F8F8F2",
  muted: "#6272A4",
  accent: "#BD93F9",
  success: "#69FF47",
  danger: "#FF4757",
  warning: "#FFB347",
};

const FIELD = {
  minHeight: 41,
  border: `1px solid ${PANEL.field}`,
  borderRadius: 8,
  padding: "0 12px",
  font: "inherit",
  fontSize: "0.9375rem",
  color: PANEL.text,
  background: PANEL.field,
  boxSizing: "border-box",
  outline: "none",
};

const LABEL = {
  fontSize: "0.875rem",
  fontWeight: 600,
  color: PANEL.muted,
  display: "grid",
  gap: 6,
};

const ACTION = {
  minHeight: 33,
  padding: "8px 14px",
  borderRadius: 16,
  border: `1px solid ${PANEL.border}`,
  background: PANEL.surface,
  color: PANEL.text,
  font: "inherit",
  fontSize: "0.875rem",
  fontWeight: 600,
  lineHeight: 1,
  cursor: "pointer",
};

const CELL = {
  padding: "14px 12px",
  borderBottom: `1px solid ${PANEL.border}`,
  verticalAlign: "middle",
};

const CODE = {
  display: "inline-flex",
  alignItems: "center",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: "0.9375rem",
  fontWeight: 700,
  color: PANEL.text,
  background: PANEL.surface,
  padding: "4px 8px",
  borderRadius: 8,
  border: `1px solid ${PANEL.border}`,
};

function PendingBadge() {
  return (
    <span
      title="Conta ainda não criada no ERP"
      style={{
        display: "inline-block",
        background: PANEL.warning,
        color: PANEL.page,
        border: "none",
        borderRadius: 999,
        fontSize: "0.75rem",
        fontWeight: 700,
        padding: "4px 10px",
        marginLeft: 6,
        verticalAlign: "middle",
      }}
    >
      Pendente ERP
    </span>
  );
}

function AccountRow({ account, onConfirm, onDelete, saving }) {
  const isPending = account.status === "PENDENTE_ERP";
  return (
    <tr style={isPending ? { background: PANEL.field, outline: "2px solid #8BE9FD", outlineOffset: "-2px" } : { background: PANEL.field }}>
      <td style={{ ...CELL, width: "7rem" }}>
        <span style={CODE}>{account.codigo}</span>
        {isPending && <PendingBadge />}
      </td>
      <td style={CELL}>{account.nome}</td>
      <td style={{ ...CELL, width: "8rem", fontSize: "0.875rem", color: PANEL.muted }}>{account.tipo}</td>
      <td style={{ ...CELL, width: "8rem", fontSize: "0.875rem", color: PANEL.muted }}>{account.natureza}</td>
      <td style={{ ...CELL, width: "12rem", whiteSpace: "nowrap", textAlign: "right" }}>
        <div className="row-actions" style={{ justifyContent: "flex-end", alignItems: "center", minHeight: 28 }}>
          {isPending && (
            <button
              type="button"
              onClick={() => onConfirm(account.codigo)}
              disabled={saving}
              title="Marcar como criada no ERP"
              style={ACTION}
            >
              Confirmar ERP
            </button>
          )}
          <button
            type="button"
            onClick={() => onDelete(account.codigo)}
            disabled={saving}
            style={{ ...ACTION, background: PANEL.danger, borderColor: PANEL.danger }}
          >
            Excluir
          </button>
        </div>
      </td>
    </tr>
  );
}

export function ChartOfAccountsModal({
  accounts,
  onCreateAccount,
  onUpdateAccount,
  onDeleteAccount,
  onImportFile,
  onClose,
}) {
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [importLoading, setImportLoading] = useState(false);
  const fileRef = useRef(null);

  function handleField(k, v) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.codigo || !form.nome) { setError("Código e nome são obrigatórios."); return; }
    setError("");
    setSaving(true);
    try {
      await onCreateAccount(form);
      setForm({ ...EMPTY_FORM });
      setMessage("Conta adicionada. Confirme a criação no ERP para remover o aviso.");
    } catch (err) {
      setError(err?.message === "codigo_ja_existe" ? "Já existe uma conta com este código." : err?.message || "Erro ao criar conta.");
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirm(codigo) {
    setSaving(true);
    setError("");
    try {
      await onUpdateAccount(codigo, { status: "CONFIRMADA" });
      setMessage(`Conta ${codigo} confirmada no ERP.`);
    } catch (err) {
      setError(err?.message || "Erro ao confirmar conta.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(codigo) {
    if (!window.confirm(`Excluir a conta ${codigo}? Lançamentos existentes não serão afetados.`)) return;
    setSaving(true);
    setError("");
    try {
      await onDeleteAccount(codigo);
      setMessage(`Conta ${codigo} excluída.`);
    } catch (err) {
      setError(err?.message || "Erro ao excluir conta.");
    } finally {
      setSaving(false);
    }
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportLoading(true);
    setError("");
    try {
      const result = await onImportFile(file);
      setMessage(`Importação concluída: ${result?.created || 0} conta(s) criada(s).`);
    } catch (err) {
      const code = err?.message || "";
      if (code === "pdf_no_accounts_found") {
        setError("Nenhuma conta reconhecida no PDF. Verifique se é o Relatório de Plano de Contas do ERP, ou use um CSV (código;nome;tipo;natureza).");
      } else if (code === "pdf_import_failed") {
        setError("Falha ao processar o PDF. Tente exportar o plano de contas como CSV no ERP.");
      } else {
        setError(code || "Falha ao importar plano de contas.");
      }
    } finally {
      setImportLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const pendingCount = accounts.filter((a) => a.status === "PENDENTE_ERP").length;
  const grouped = TIPO_OPTIONS.map((tipo) => ({
    tipo,
    items: accounts.filter((a) => a.tipo === tipo).sort((a, b) => Number(a.codigo) - Number(b.codigo) || a.codigo.localeCompare(b.codigo)),
  })).filter((g) => g.items.length > 0);

  return (
      <div style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-4)",
      }}>
      <div style={{
        background: PANEL.surface, borderRadius: 16, border: `1px solid ${PANEL.border}`,
        color: PANEL.text,
        boxShadow: "0 8px 32px rgba(0,0,0,0.28)", width: "100%", maxWidth: "920px",
        maxHeight: "90vh", overflow: "auto", padding: "var(--space-5)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, color: PANEL.text }}>Plano de Contas</h2>
            {pendingCount > 0 && (
              <p style={{ margin: "4px 0 0", fontSize: "0.9375rem", color: PANEL.warning }}>
                {pendingCount} conta{pendingCount !== 1 ? "s" : ""} pendente{pendingCount !== 1 ? "s" : ""} de confirmação no ERP.
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} style={ACTION}>Fechar</button>
        </div>

        {message && <p style={{ marginBottom: "var(--space-3)", color: PANEL.success, fontSize: "0.9375rem" }}>{message}</p>}
        {error && <p style={{ marginBottom: "var(--space-3)", color: PANEL.danger, fontSize: "0.9375rem" }}>{error}</p>}

        {/* Importar CSV/PDF */}
        <div style={{ marginBottom: "var(--space-4)", display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap", padding: 14, background: PANEL.field, borderRadius: 12 }}>
          <span style={{ fontSize: "0.9375rem", color: PANEL.muted }}>Importar plano de contas:</span>
          <label style={{ ...ACTION, cursor: "pointer" }}>
            {importLoading ? "Importando..." : "CSV / PDF"}
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.pdf"
              style={{ display: "none" }}
              onChange={handleImportFile}
              disabled={importLoading}
            />
          </label>
          <span style={{ fontSize: "0.875rem", color: PANEL.muted }}>
            CSV: código;nome;tipo;natureza — ou envie o PDF do plano de contas do ERP.
          </span>
        </div>

        {/* Adicionar conta */}
        <form onSubmit={handleCreate} style={{ marginBottom: "var(--space-4)", padding: 16, background: PANEL.field, borderRadius: 12 }}>
          <h3 style={{ margin: "0 0 var(--space-2)", fontSize: "1rem", fontWeight: 700, color: PANEL.text }}>
            Adicionar conta
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "7rem 1fr 8rem 8rem auto", gap: "var(--space-2)", alignItems: "end" }}>
            <label style={LABEL}>
              Código
              <input
                type="text"
                value={form.codigo}
                onChange={(e) => handleField("codigo", e.target.value)}
                placeholder="ex: 464"
                style={FIELD}
              />
            </label>
            <label style={LABEL}>
              Nome
              <input
                type="text"
                value={form.nome}
                onChange={(e) => handleField("nome", e.target.value)}
                placeholder="Nome da conta"
                style={FIELD}
              />
            </label>
            <label style={LABEL}>
              Tipo
              <select
                value={form.tipo}
                onChange={(e) => handleField("tipo", e.target.value)}
                style={{ ...FIELD, colorScheme: "dark" }}
              >
                {TIPO_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label style={LABEL}>
              Natureza
              <select
                value={form.natureza}
                onChange={(e) => handleField("natureza", e.target.value)}
                style={{ ...FIELD, colorScheme: "dark" }}
              >
                {NATUREZA_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button type="submit" disabled={saving || !form.codigo || !form.nome} style={{ ...ACTION, alignSelf: "end", background: PANEL.success, borderColor: PANEL.success, color: PANEL.page }}>
              {saving ? "..." : "Adicionar"}
            </button>
          </div>
          <p style={{ marginTop: "var(--space-2)", color: PANEL.muted, fontSize: "0.875rem" }}>
            Contas adicionadas aqui ficam marcadas como <strong>Pendente ERP</strong> até serem criadas no ERP e confirmadas.
          </p>
        </form>

        {/* Tabela de contas agrupada por tipo */}
        {accounts.length === 0 ? (
          <p style={{ color: PANEL.muted, fontSize: "0.9375rem" }}>Nenhuma conta cadastrada ainda. Importe um CSV ou adicione manualmente.</p>
        ) : (
          grouped.map(({ tipo, items }) => (
            <div key={tipo} style={{ marginBottom: "var(--space-3)" }}>
              <h4 style={{ margin: "0 0 var(--space-2)", fontSize: "0.875rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: PANEL.muted }}>
                {tipo}
              </h4>
              <div style={{ overflowX: "auto", background: PANEL.field, borderRadius: 16, padding: 14 }}>
                <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed", color: PANEL.text }}>
                  <colgroup>
                    <col style={{ width: "7rem" }} />
                    <col />
                    <col style={{ width: "8rem" }} />
                    <col style={{ width: "8rem" }} />
                    <col style={{ width: "12rem" }} />
                  </colgroup>
                  <thead>
                    <tr style={{ background: PANEL.surface }}>
                      <th style={{ width: "7rem", textAlign: "left", padding: "14px 12px", fontSize: "0.9375rem" }}>Código</th>
                      <th style={{ textAlign: "left", padding: "14px 12px", fontSize: "0.9375rem" }}>Nome</th>
                      <th style={{ width: "8rem", textAlign: "left", padding: "14px 12px", fontSize: "0.9375rem" }}>Tipo</th>
                      <th style={{ width: "8rem", textAlign: "left", padding: "14px 12px", fontSize: "0.9375rem" }}>Natureza</th>
                      <th style={{ width: "12rem", textAlign: "right", padding: "14px 12px", fontSize: "0.9375rem" }}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((account) => (
                      <AccountRow
                        key={account.id || account.codigo}
                        account={account}
                        onConfirm={handleConfirm}
                        onDelete={handleDelete}
                        saving={saving}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

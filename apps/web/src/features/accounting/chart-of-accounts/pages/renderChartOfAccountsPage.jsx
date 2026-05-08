import { useMemo, useRef, useState } from "react";

const TIPO_OPTIONS = ["ATIVO", "PASSIVO", "RECEITA", "DESPESA", "PATRIMONIO"];
const NATUREZA_OPTIONS = ["DEVEDORA", "CREDORA"];
const STATUS_OPTIONS = ["CONFIRMADA", "PENDENTE_ERP"];

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
  padding: "12px",
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

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

export function ChartOfAccountsPage({
  accounts = [],
  onCreateAccount,
  onUpdateAccount,
  onDeleteAccount,
  onImportFile,
  onBack,
  scope = "COMPANY",  // "COMPANY" | "GLOBAL"
}) {
  const isGlobal = scope === "GLOBAL";
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [importLoading, setImportLoading] = useState(false);
  const fileRef = useRef(null);

  const [filterText, setFilterText] = useState("");
  const [filterTipo, setFilterTipo] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const [filterScope, setFilterScope] = useState("all"); // "all" | "GLOBAL" | "COMPANY"

  const filteredAccounts = useMemo(() => {
    const q = normalize(filterText);
    return accounts
      .filter((a) => {
        if (filterTipo !== "all" && a.tipo !== filterTipo) return false;
        if (filterStatus !== "all" && a.status !== filterStatus) return false;
        if (!isGlobal && filterScope !== "all" && a.scope !== filterScope) return false;
        if (!q) return true;
        return normalize(a.codigo).includes(q) || normalize(a.nome).includes(q);
      })
      .sort((a, b) => Number(a.codigo) - Number(b.codigo) || String(a.codigo).localeCompare(String(b.codigo)));
  }, [accounts, filterText, filterTipo, filterStatus, filterScope, isGlobal]);

  // Em scope COMPANY, contas globais são read-only — não entram na seleção.
  const selectableIds = useMemo(
    () => filteredAccounts.filter((a) => isGlobal || a.scope !== "GLOBAL").map((a) => a.codigo),
    [filteredAccounts, isGlobal]
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
  const someSelected = selectableIds.some((id) => selectedIds.has(id));
  const selectedCount = selectableIds.filter((id) => selectedIds.has(id)).length;
  const visibleIds = selectableIds; // alias para o resto do código existente

  const pendingCount = accounts.filter((a) => a.status === "PENDENTE_ERP").length;

  const selectedPendingCount = useMemo(() => {
    const map = new Map(accounts.map((a) => [a.codigo, a.status]));
    return [...selectedIds].filter((id) => map.get(id) === "PENDENTE_ERP" && visibleIds.includes(id)).length;
  }, [selectedIds, accounts, visibleIds]);

  function toggleAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }
  function toggleOne(codigo) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(codigo)) next.delete(codigo);
      else next.add(codigo);
      return next;
    });
  }
  function clearSelection() { setSelectedIds(new Set()); }

  function handleField(k, v) { setForm((prev) => ({ ...prev, [k]: v })); }

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
      const msg = err?.message;
      if (msg === "codigo_ja_existe") {
        setError(isGlobal
          ? "Já existe uma conta global com este código."
          : "Você já tem uma conta com este código nesta empresa.");
      } else {
        setError(msg || "Erro ao criar conta.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirm(codigo) {
    setSaving(true); setError("");
    try {
      await onUpdateAccount(codigo, { status: "CONFIRMADA" });
      setMessage(`Conta ${codigo} confirmada no ERP.`);
    } catch (err) { setError(err?.message || "Erro ao confirmar conta."); } finally { setSaving(false); }
  }

  async function handleDelete(codigo) {
    if (!window.confirm(`Excluir a conta ${codigo}? Lançamentos existentes não serão afetados.`)) return;
    setSaving(true); setError("");
    try {
      await onDeleteAccount(codigo);
      setMessage(`Conta ${codigo} excluída.`);
    } catch (err) { setError(err?.message || "Erro ao excluir conta."); } finally { setSaving(false); }
  }

  async function handleBulkDelete() {
    const ids = visibleIds.filter((id) => selectedIds.has(id));
    if (ids.length === 0) return;
    if (!window.confirm(`Excluir ${ids.length} conta${ids.length !== 1 ? "s" : ""}? Lançamentos existentes não serão afetados.`)) return;
    setBulkBusy(true); setError(""); setMessage("");
    let ok = 0, fail = 0;
    for (const id of ids) {
      try { await onDeleteAccount(id); ok++; }
      catch { fail++; }
    }
    setBulkBusy(false);
    clearSelection();
    if (fail === 0) setMessage(`${ok} conta${ok !== 1 ? "s" : ""} excluída${ok !== 1 ? "s" : ""}.`);
    else setError(`${ok} excluída${ok !== 1 ? "s" : ""}, ${fail} falharam.`);
  }

  async function handleBulkConfirm() {
    const ids = visibleIds.filter((id) => selectedIds.has(id));
    const accountsMap = new Map(accounts.map((a) => [a.codigo, a]));
    const targets = ids.filter((id) => accountsMap.get(id)?.status === "PENDENTE_ERP");
    if (targets.length === 0) {
      setError("Nenhuma das contas selecionadas está pendente de ERP.");
      return;
    }
    if (!window.confirm(`Confirmar ${targets.length} conta${targets.length !== 1 ? "s" : ""} como criadas no ERP?`)) return;
    setBulkBusy(true); setError(""); setMessage("");
    let ok = 0, fail = 0;
    for (const id of targets) {
      try { await onUpdateAccount(id, { status: "CONFIRMADA" }); ok++; }
      catch { fail++; }
    }
    setBulkBusy(false);
    clearSelection();
    if (fail === 0) setMessage(`${ok} conta${ok !== 1 ? "s" : ""} confirmada${ok !== 1 ? "s" : ""} no ERP.`);
    else setError(`${ok} confirmada${ok !== 1 ? "s" : ""}, ${fail} falharam.`);
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportLoading(true); setError(""); setMessage("");
    try {
      const result = await onImportFile(file);
      const created = Number(result?.created || 0);
      const skipped = Number(result?.skipped || 0);
      const errs = Array.isArray(result?.errors) ? result.errors : [];

      if (created === 0 && (errs.length > 0 || skipped > 0)) {
        const firstErr = errs[0]?.reason ? ` Primeiro erro: ${errs[0].reason}` : "";
        setError(`Nenhuma conta criada. ${errs.length} erro(s), ${skipped} ignorada(s).${firstErr}`);
      } else if (errs.length > 0) {
        setMessage(`Importação concluída: ${created} criada(s), ${skipped} ignorada(s), ${errs.length} com erro.`);
      } else {
        setMessage(`Importação concluída: ${created} conta(s) criada(s)${skipped > 0 ? `, ${skipped} ignorada(s)` : ""}.`);
      }
    } catch (err) {
      const code = err?.message || "";
      if (code === "pdf_no_accounts_found") setError("Nenhuma conta reconhecida no PDF. Verifique se é o Relatório de Plano de Contas do ERP, ou use um CSV (código;nome;tipo;natureza).");
      else if (code === "pdf_import_failed") setError("Falha ao processar o PDF. Tente exportar o plano de contas como CSV no ERP.");
      else setError(code || "Falha ao importar plano de contas.");
    } finally {
      setImportLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const containerStyle = {
    width: "100%",
    background: PANEL.page,
    padding: "var(--space-3) var(--space-4)",
    color: PANEL.text,
    minHeight: "100%",
  };

  const sectionStyle = {
    background: PANEL.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 14,
  };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={{ ...sectionStyle, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>
            {isGlobal ? "Plano de Contas Global" : "Plano de Contas"}
          </h2>
          <p style={{ margin: "4px 0 0", color: PANEL.muted, fontSize: "0.875rem" }}>
            {isGlobal
              ? `${accounts.length} conta${accounts.length !== 1 ? "s" : ""} global${accounts.length !== 1 ? "is" : ""} — usadas por todas as empresas.`
              : <>
                  {accounts.length} conta{accounts.length !== 1 ? "s" : ""} dispon{accounts.length !== 1 ? "íveis" : "ível"}
                  {pendingCount > 0 && <> · <span style={{ color: PANEL.warning }}>{pendingCount} pendente{pendingCount !== 1 ? "s" : ""} de ERP</span></>}
                </>}
          </p>
        </div>
        {onBack && <button type="button" onClick={onBack} style={ACTION}>Voltar</button>}
      </div>

      {message && <p style={{ margin: "0 0 12px", padding: "10px 14px", background: "rgba(105,255,71,0.12)", color: PANEL.success, borderRadius: 8, fontSize: "0.9rem" }}>{message}</p>}
      {error && <p style={{ margin: "0 0 12px", padding: "10px 14px", background: "rgba(255,87,87,0.12)", color: PANEL.danger, borderRadius: 8, fontSize: "0.9rem" }}>{error}</p>}

      {/* Importar CSV/PDF */}
      {onImportFile && (
        <div style={sectionStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.9375rem", color: PANEL.muted }}>Importar plano de contas:</span>
            <label style={{ ...ACTION, cursor: "pointer" }}>
              {importLoading ? "Importando..." : "CSV / PDF"}
              <input ref={fileRef} type="file" accept=".csv,.pdf" style={{ display: "none" }} onChange={handleImportFile} disabled={importLoading} />
            </label>
            <span style={{ fontSize: "0.875rem", color: PANEL.muted }}>
              CSV: <code>código;nome;tipo;natureza</code> — ou envie o PDF do plano de contas do ERP.
            </span>
          </div>
        </div>
      )}

      {/* Adicionar conta */}
      <form onSubmit={handleCreate} style={sectionStyle}>
        <h3 style={{ margin: "0 0 12px", fontSize: "1rem", fontWeight: 700 }}>Adicionar conta</h3>
        <div style={{ display: "grid", gridTemplateColumns: "7rem 1fr 8rem 8rem auto", gap: 10, alignItems: "end" }}>
          <label style={LABEL}>
            Código
            <input type="text" value={form.codigo} onChange={(e) => handleField("codigo", e.target.value)} placeholder="ex: 464" style={FIELD} />
          </label>
          <label style={LABEL}>
            Nome
            <input type="text" value={form.nome} onChange={(e) => handleField("nome", e.target.value)} placeholder="Nome da conta" style={FIELD} />
          </label>
          <label style={LABEL}>
            Tipo
            <select value={form.tipo} onChange={(e) => handleField("tipo", e.target.value)} style={{ ...FIELD, colorScheme: "dark" }}>
              {TIPO_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label style={LABEL}>
            Natureza
            <select value={form.natureza} onChange={(e) => handleField("natureza", e.target.value)} style={{ ...FIELD, colorScheme: "dark" }}>
              {NATUREZA_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button type="submit" disabled={saving || !form.codigo || !form.nome} style={{ ...ACTION, alignSelf: "end", background: PANEL.success, borderColor: PANEL.success, color: PANEL.page }}>
            {saving ? "..." : "Adicionar"}
          </button>
        </div>
      </form>

      {/* Filtros */}
      <div style={sectionStyle}>
        <div style={{ display: "grid", gridTemplateColumns: isGlobal ? "1fr 12rem 12rem" : "1fr 12rem 12rem 12rem", gap: 12 }}>
          <label style={LABEL}>
            Buscar (código ou nome)
            <input type="search" value={filterText} onChange={(e) => setFilterText(e.target.value)} placeholder="Digite para filtrar..." style={FIELD} />
          </label>
          <label style={LABEL}>
            Tipo
            <select value={filterTipo} onChange={(e) => setFilterTipo(e.target.value)} style={{ ...FIELD, colorScheme: "dark" }}>
              <option value="all">Todos</option>
              {TIPO_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label style={LABEL}>
            Status ERP
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ ...FIELD, colorScheme: "dark" }}>
              <option value="all">Todos</option>
              <option value="CONFIRMADA">Confirmadas</option>
              <option value="PENDENTE_ERP">Pendentes</option>
            </select>
          </label>
          {!isGlobal && (
            <label style={LABEL}>
              Origem
              <select value={filterScope} onChange={(e) => setFilterScope(e.target.value)} style={{ ...FIELD, colorScheme: "dark" }}>
                <option value="all">Todas</option>
                <option value="GLOBAL">Globais</option>
                <option value="COMPANY">Da empresa</option>
              </select>
            </label>
          )}
        </div>
      </div>

      {/* Toolbar de seleção */}
      {selectedCount > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
          background: "#2D2F45", border: `1px solid ${PANEL.border}`, borderRadius: 8,
          marginBottom: 14, fontSize: "0.875rem",
        }}>
          <span style={{ color: PANEL.accent, fontWeight: 700 }}>
            {selectedCount} selecionada{selectedCount !== 1 ? "s" : ""}
          </span>
          <button
            type="button"
            onClick={handleBulkConfirm}
            disabled={bulkBusy || selectedPendingCount === 0}
            title={selectedPendingCount === 0 ? "Selecione contas pendentes de ERP" : `Confirmar ${selectedPendingCount} pendente${selectedPendingCount !== 1 ? "s" : ""}`}
            style={{ ...ACTION, background: "#8BE9FD", borderColor: "#8BE9FD", color: PANEL.page, opacity: selectedPendingCount === 0 ? 0.5 : 1 }}
          >
            {bulkBusy ? "..." : `Confirmar ERP${selectedPendingCount > 0 ? ` (${selectedPendingCount})` : ""}`}
          </button>
          <button
            type="button"
            onClick={handleBulkDelete}
            disabled={bulkBusy}
            style={{ ...ACTION, background: PANEL.danger, borderColor: PANEL.danger, color: "#fff" }}
          >
            {bulkBusy ? "..." : "Excluir selecionadas"}
          </button>
          <button
            type="button"
            onClick={clearSelection}
            style={{ background: "none", border: "none", color: PANEL.muted, fontSize: "0.8125rem", textDecoration: "underline", cursor: "pointer" }}
          >
            Limpar seleção
          </button>
        </div>
      )}

      {/* Tabela */}
      <div style={sectionStyle}>
        {accounts.length === 0 ? (
          <p style={{ color: PANEL.muted, fontSize: "0.9375rem" }}>
            Nenhuma conta cadastrada ainda. Importe um CSV/PDF ou adicione manualmente acima.
          </p>
        ) : filteredAccounts.length === 0 ? (
          <p style={{ color: PANEL.muted, fontSize: "0.9375rem" }}>
            Nenhuma conta corresponde aos filtros.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
              <colgroup>
                <col style={{ width: "44px" }} />
                <col style={{ width: "8rem" }} />
                <col />
                <col style={{ width: "7rem" }} />
                <col style={{ width: "7rem" }} />
                <col style={{ width: "9rem" }} />
                <col style={{ width: "11rem" }} />
              </colgroup>
              <thead>
                <tr style={{ background: PANEL.field }}>
                  <th style={{ padding: "12px", textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                      onChange={toggleAll}
                      style={{ width: 16, height: 16, cursor: "pointer", accentColor: PANEL.accent }}
                      aria-label="Selecionar todas"
                    />
                  </th>
                  <th style={{ padding: "12px", textAlign: "left", fontSize: "0.875rem" }}>Código</th>
                  <th style={{ padding: "12px", textAlign: "left", fontSize: "0.875rem" }}>Nome</th>
                  <th style={{ padding: "12px", textAlign: "left", fontSize: "0.875rem" }}>Tipo</th>
                  <th style={{ padding: "12px", textAlign: "left", fontSize: "0.875rem" }}>Natureza</th>
                  <th style={{ padding: "12px", textAlign: "left", fontSize: "0.875rem" }}>Status ERP</th>
                  <th style={{ padding: "12px", textAlign: "right", fontSize: "0.875rem" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredAccounts.map((account) => {
                  const isPending = account.status === "PENDENTE_ERP";
                  const isAccountGlobal = account.scope === "GLOBAL";
                  const isReadOnly = !isGlobal && isAccountGlobal; // global em scope COMPANY = read-only
                  const isSelected = selectedIds.has(account.codigo);
                  return (
                    <tr key={`${account.scope || "COMPANY"}-${account.codigo}`} style={{
                      background: isSelected ? "#2a2b3d" : PANEL.field,
                      outline: isSelected ? `1px solid ${PANEL.accent}` : (isPending ? "1px solid #8BE9FD" : "none"),
                      outlineOffset: "-1px",
                      opacity: isReadOnly ? 0.92 : 1,
                    }}>
                      <td style={{ ...CELL, textAlign: "center" }}>
                        {!isReadOnly && (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleOne(account.codigo)}
                            style={{ width: 16, height: 16, cursor: "pointer", accentColor: PANEL.accent }}
                            aria-label={`Selecionar ${account.codigo}`}
                          />
                        )}
                      </td>
                      <td style={CELL}>
                        <span style={CODE}>{account.codigo}</span>
                        {isAccountGlobal && (
                          <span style={{ marginLeft: 6, fontSize: "0.65rem", fontWeight: 700, color: PANEL.page, background: "#8BE9FD", padding: "2px 6px", borderRadius: 999 }}>
                            GLOBAL
                          </span>
                        )}
                      </td>
                      <td style={CELL}>{account.nome}</td>
                      <td style={{ ...CELL, fontSize: "0.875rem", color: PANEL.muted }}>{account.tipo}</td>
                      <td style={{ ...CELL, fontSize: "0.875rem", color: PANEL.muted }}>{account.natureza}</td>
                      <td style={CELL}>
                        {isPending
                          ? <span style={{ display: "inline-block", background: PANEL.warning, color: PANEL.page, borderRadius: 999, fontSize: "0.7rem", fontWeight: 700, padding: "3px 8px" }}>Pendente ERP</span>
                          : <span style={{ display: "inline-block", background: "rgba(105,255,71,0.18)", color: PANEL.success, borderRadius: 999, fontSize: "0.7rem", fontWeight: 700, padding: "3px 8px" }}>Confirmada</span>}
                      </td>
                      <td style={{ ...CELL, textAlign: "right", whiteSpace: "nowrap" }}>
                        {isReadOnly ? (
                          <span style={{ fontSize: "0.75rem", color: PANEL.muted, fontStyle: "italic" }}>
                            Editar no plano global
                          </span>
                        ) : (
                          <>
                            {isPending && (
                              <button type="button" onClick={() => handleConfirm(account.codigo)} disabled={saving} style={{ ...ACTION, marginRight: 6 }}>
                                Confirmar ERP
                              </button>
                            )}
                            <button type="button" onClick={() => handleDelete(account.codigo)} disabled={saving} style={{ ...ACTION, background: PANEL.danger, borderColor: PANEL.danger, color: "#fff" }}>
                              Excluir
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

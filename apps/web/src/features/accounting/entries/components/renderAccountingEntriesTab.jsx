import { useMemo, useState } from "react";
import { ChartOfAccountsModal } from "../../chart-of-accounts/components/renderChartOfAccountsModal";
import { HistoricosModal } from "../../historicos/components/renderHistoricosModal";
import { ImportOFXModal } from "../../ofx-import/components/renderImportOfxModal";
import { AccountRow, NewEntryForm } from "./renderAccountingEntriesParts";
import { ACCOUNTING_PANEL, COLS, ORIGEM_LABELS, STATUS_LABELS, TIPO_LABELS, fmtMoney } from "../lib/accountingEntriesShared";

export function AccountingEntriesTab({
  companyId,
  entries,
  total,
  loading,
  filters,
  onFilterChange,
  onLoad,
  onCreateEntry,
  onUpdateEntry,
  onDeleteEntry,
  onImportOFX,
  onPreviewOFX,
  accounts,
  onLoadAccounts,
  onCreateAccount,
  onUpdateAccount,
  onDeleteAccount,
  onImportAccountsFile,
  savingEntry,
  onExportCsv,
  message,
  error,
  onCreateBaixa,
  savingBaixa,
  onSearchHistoricos,
  onGetHistoricosByCode,
  onLoadAllHistoricos,
  onUpdateHistorico,
  onDeleteHistorico,
}) {
  const [showOFX, setShowOFX] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);
  const [showHistoricos, setShowHistoricos] = useState(false);

  const now = new Date();
  const defaultComp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const activeComp = filters.competencia || defaultComp;

  const totals = useMemo(() => {
    const summary = {};
    entries.forEach((entry) => {
      summary[entry.tipo] = (summary[entry.tipo] || 0) + Number(entry.totalD || entry.valor || 0);
    });
    return summary;
  }, [entries]);

  const listedTotals = useMemo(() => entries.reduce((acc, entry) => {
    const lines = Array.isArray(entry.lines) ? entry.lines : [];
    const totalD = entry.totalD ?? lines.filter((line) => line.tipo === "D").reduce((sum, line) => sum + Number(line.valor || 0), 0);
    const totalC = entry.totalC ?? lines.filter((line) => line.tipo === "C").reduce((sum, line) => sum + Number(line.valor || 0), 0);
    const hasDebitColumn = lines.some((line) => line.tipo === "D" && String(line.conta || "").trim());
    const hasCreditColumn = lines.some((line) => line.tipo === "C" && String(line.conta || "").trim());
    if (hasDebitColumn) acc.debito += Number(totalD || 0);
    if (hasCreditColumn) acc.credito += Number(totalC || 0);
    return acc;
  }, { debito: 0, credito: 0 }), [entries]);

  const actionButtonStyle = {
    minHeight: 33,
    padding: "8px 14px",
    borderRadius: 16,
    border: `1px solid ${ACCOUNTING_PANEL.border}`,
    background: ACCOUNTING_PANEL.surface,
    color: ACCOUNTING_PANEL.text,
    font: "inherit",
    fontSize: "0.875rem",
    fontWeight: 600,
    lineHeight: 1,
    cursor: "pointer",
  };

  const filterLabelStyle = {
    display: "grid",
    gap: 4,
    minWidth: 0,
    fontSize: "0.75rem",
    fontWeight: 500,
    color: ACCOUNTING_PANEL.muted,
  };

  const filterControlStyle = {
    width: "100%",
    height: 41,
    border: `1px solid ${ACCOUNTING_PANEL.field}`,
    borderRadius: 8,
    padding: "0 12px",
    font: "inherit",
    fontSize: "0.875rem",
    color: ACCOUNTING_PANEL.text,
    background: ACCOUNTING_PANEL.field,
    boxSizing: "border-box",
    outline: "none",
  };

  return (
    <div style={{ width: "100%", background: ACCOUNTING_PANEL.page, padding: "var(--space-3) var(--space-4)" }}>
      <div style={{ display: "grid", gap: 12, marginBottom: 10, padding: 16, borderRadius: 12, background: ACCOUNTING_PANEL.surface }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => setShowHistoricos(true)} style={actionButtonStyle}>Histórico</button>
          <button type="button" onClick={() => { setShowAccounts(true); onLoadAccounts(); }} style={actionButtonStyle}>Plano de contas</button>
          <button type="button" onClick={() => setShowOFX(true)} style={actionButtonStyle}>Importar OFX</button>
          {onExportCsv && <button type="button" onClick={onExportCsv} style={actionButtonStyle}>Exportar CSV</button>}
          <button type="button" onClick={onLoad} style={actionButtonStyle}>Atualizar</button>
        </div>

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <label style={filterLabelStyle}>
            Competência
            <input type="month" value={activeComp} onChange={(e) => onFilterChange("competencia", e.target.value)} style={{ ...filterControlStyle, colorScheme: "dark" }} />
          </label>
          <label style={filterLabelStyle}>
            Tipo
            <select value={filters.tipo || ""} onChange={(e) => onFilterChange("tipo", e.target.value)} style={filterControlStyle}>
              <option value="">Selecionar tipo</option>
              {Object.entries(TIPO_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label style={filterLabelStyle}>
            Origem
            <select value={filters.origem || ""} onChange={(e) => onFilterChange("origem", e.target.value)} style={filterControlStyle}>
              <option value="">Selecionar origem</option>
              {Object.entries(ORIGEM_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label style={filterLabelStyle}>
            Status
            <select value={filters.status || ""} onChange={(e) => onFilterChange("status", e.target.value)} style={filterControlStyle}>
              <option value="">Selecionar status</option>
              {Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
        </div>

        {entries.length > 0 && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            {Object.entries(totals).map(([tipo, value]) => (
              <span key={tipo} style={{ fontSize: "0.75rem", color: ACCOUNTING_PANEL.muted }}>
                <strong style={{ color: ACCOUNTING_PANEL.text }}>{TIPO_LABELS[tipo] || tipo}:</strong> R$ {fmtMoney(value)}
              </span>
            ))}
          </div>
        )}
      </div>

      {message && message !== "Lançamento adicionado." && <p style={{ color: "var(--success)", margin: "0 0 8px", fontSize: "0.875rem" }}>{message}</p>}
      {error && <p style={{ color: "var(--danger)", margin: "0 0 8px", fontSize: "0.875rem" }}>{error}</p>}

      <NewEntryForm
        accounts={accounts}
        onSave={onCreateEntry}
        saving={savingEntry}
        activeComp={activeComp}
        onSearchHistoricos={onSearchHistoricos}
        onGetHistoricosByCode={onGetHistoricosByCode}
        listedTotalD={listedTotals.debito}
        listedTotalC={listedTotals.credito}
      />

      <div style={{ overflowX: "auto", borderRadius: 16, marginTop: 4, background: ACCOUNTING_PANEL.surface, padding: 20 }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed", fontSize: "0.9375rem", borderRadius: 16, overflow: "hidden" }}>
          <colgroup>
            {COLS.map((col, index) => <col key={index} style={{ width: col.width }} />)}
          </colgroup>
          <thead>
            <tr style={{ background: ACCOUNTING_PANEL.field, userSelect: "none" }}>
              {COLS.map(({ label, align }, index) => (
                <th key={index} style={{ padding: "14px 14px", textAlign: align, fontSize: "1rem", fontWeight: 700, color: ACCOUNTING_PANEL.text, borderBottom: `1px solid ${ACCOUNTING_PANEL.border}`, position: "sticky", top: 0, background: ACCOUNTING_PANEL.field, zIndex: 10, whiteSpace: "nowrap" }}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} style={{ padding: 16, textAlign: "center", color: ACCOUNTING_PANEL.muted }}>Carregando...</td></tr>}
            {!loading && entries.length === 0 && <tr><td colSpan={8} style={{ padding: 24, textAlign: "center", color: ACCOUNTING_PANEL.muted }}>Nenhum lançamento para esta competência.</td></tr>}
            {entries.map((entry) => (
              <AccountRow
                key={entry.id}
                entry={entry}
                accounts={accounts}
                onUpdate={onUpdateEntry}
                onDelete={onDeleteEntry}
                saving={savingEntry}
                onCreateBaixa={onCreateBaixa}
                savingBaixa={savingBaixa}
                onSearchHistoricos={onSearchHistoricos}
              />
            ))}
          </tbody>
          {total > 0 && <tfoot><tr style={{ background: ACCOUNTING_PANEL.field }}><td colSpan={8} style={{ padding: "5px 8px", fontSize: "0.875rem", color: ACCOUNTING_PANEL.muted, borderTop: `1px solid ${ACCOUNTING_PANEL.border}` }}>{total} lançamento{total !== 1 ? "s" : ""} no total</td></tr></tfoot>}
        </table>
      </div>

      {showOFX && <ImportOFXModal companyId={companyId} accounts={accounts} onPreview={onPreviewOFX} onImport={onImportOFX} onClose={() => setShowOFX(false)} />}
      {showAccounts && <ChartOfAccountsModal companyId={companyId} accounts={accounts} onCreateAccount={onCreateAccount} onUpdateAccount={onUpdateAccount} onDeleteAccount={onDeleteAccount} onImportFile={onImportAccountsFile} onClose={() => setShowAccounts(false)} />}
      {showHistoricos && <HistoricosModal onClose={() => setShowHistoricos(false)} onLoadAll={onLoadAllHistoricos} onUpdate={(id, input) => onUpdateHistorico(id, input)} onDelete={(id) => onDeleteHistorico(id)} />}
    </div>
  );
}

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { HistoricosModal } from "../../historicos/components/renderHistoricosModal";
import { ImportOFXModal } from "../../ofx-import/components/renderImportOfxModal";
import { ImportExcelModal } from "../../excel-import/components/renderImportExcelModal";
import { AccountRow, NewEntryForm } from "./renderAccountingEntriesParts";
import { ACCOUNTING_PANEL, COLS, ORIGEM_LABELS, STATUS_LABELS, TIPO_LABELS, TIPO_GROUP_ORDER, TIPO_GROUP_LABELS, TIPO_GROUP_ACCENT, fmtMoney } from "../lib/accountingEntriesShared";
import { PayrollEntryModal, CsvExportModal } from "./renderAccountingEntriesParts";

function ActionMenu({ label, items, accent }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    function onEsc(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const triggerStyle = {
    minHeight: 33,
    padding: "8px 14px",
    borderRadius: 16,
    border: `1px solid ${accent ? accent : ACCOUNTING_PANEL.border}`,
    background: accent ? accent : ACCOUNTING_PANEL.surface,
    color: accent ? "#1A1B26" : ACCOUNTING_PANEL.text,
    font: "inherit",
    fontSize: "0.875rem",
    fontWeight: 600,
    lineHeight: 1,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 6,
  };
  const menuStyle = {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    minWidth: 200,
    background: "#1A1B26",
    border: "1px solid #44475A",
    borderRadius: 10,
    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    padding: 6,
    zIndex: 50,
  };
  const itemStyle = {
    display: "block",
    width: "100%",
    textAlign: "left",
    background: "transparent",
    border: "none",
    color: ACCOUNTING_PANEL.text,
    padding: "8px 12px",
    borderRadius: 6,
    cursor: "pointer",
    font: "inherit",
    fontSize: "0.8125rem",
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={triggerStyle} aria-haspopup="menu" aria-expanded={open}>
        {label}
        <span style={{ fontSize: "0.7rem", opacity: 0.7 }}>▾</span>
      </button>
      {open && (
        <div role="menu" style={menuStyle}>
          {items.filter(Boolean).map((it, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); it.onClick?.(); }}
              disabled={it.disabled}
              style={{
                ...itemStyle,
                opacity: it.disabled ? 0.5 : 1,
                cursor: it.disabled ? "not-allowed" : "pointer",
              }}
              onMouseEnter={(e) => { if (!it.disabled) e.currentTarget.style.background = ACCOUNTING_PANEL.surface; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              {it.label}
              {it.hint && <div style={{ fontSize: "0.7rem", color: ACCOUNTING_PANEL.muted, marginTop: 2 }}>{it.hint}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
  onLoadBaixaTemplate,
  onSearchHistoricos,
  onGetHistoricosByCode,
  onLoadAllHistoricos,
  onUpdateHistorico,
  onDeleteHistorico,
  onLoadPayrollTemplate,
  onBulkDeleteEntries,
  onOpenChartOfAccountsTab,
  onOpenAccountingRulesTab,
  onPreviewExcel,
  onImportExcel,
}) {
  const [showOFX, setShowOFX] = useState(false);
  const [showHistoricos, setShowHistoricos] = useState(false);
  const [showPayroll, setShowPayroll] = useState(false);
  const [showCsvExport, setShowCsvExport] = useState(false);
  const [showExcel, setShowExcel] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const visibleIds = useMemo(() => entries.map((e) => e.id).filter(Boolean), [entries]);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someSelected = visibleIds.some((id) => selectedIds.has(id));
  const selectedCount = visibleIds.filter((id) => selectedIds.has(id)).length;

  function toggleAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }
  function toggleOne(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() { setSelectedIds(new Set()); }

  async function handleBulkDelete() {
    if (!onBulkDeleteEntries || selectedCount === 0) return;
    const ids = visibleIds.filter((id) => selectedIds.has(id));
    setBulkDeleting(true);
    const result = await onBulkDeleteEntries(ids);
    setBulkDeleting(false);
    if (result?.ok || result?.succeeded > 0) clearSelection();
  }

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

  // Agrupa lançamentos por tipo seguindo TIPO_GROUP_ORDER; tipos desconhecidos caem em "OUTRO".
  const groupedEntries = useMemo(() => {
    const groups = {};
    for (const tipo of TIPO_GROUP_ORDER) groups[tipo] = [];
    for (const entry of entries) {
      const tipo = String(entry.tipo || "OUTRO").toUpperCase();
      const bucket = groups[tipo] ? tipo : "OUTRO";
      groups[bucket].push(entry);
    }
    return groups;
  }, [entries]);

  const groupTotals = useMemo(() => {
    const totals = {};
    for (const tipo of TIPO_GROUP_ORDER) {
      const sum = groupedEntries[tipo].reduce((s, e) => s + Number(e.totalD || e.valor || 0), 0);
      totals[tipo] = sum;
    }
    return totals;
  }, [groupedEntries]);

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
          <ActionMenu
            label="Configurações"
            items={[
              { label: "Histórico de lançamentos", hint: "Templates de histórico reutilizáveis", onClick: () => setShowHistoricos(true) },
              { label: "Plano de contas", hint: "Visualizar e editar contas", onClick: () => { onLoadAccounts(); if (onOpenChartOfAccountsTab) onOpenChartOfAccountsTab(); }, disabled: !onOpenChartOfAccountsTab },
              { label: "Lançamentos padrão", hint: "Regras de receita, provisão e baixa", onClick: () => onOpenAccountingRulesTab?.(), disabled: !onOpenAccountingRulesTab },
            ]}
          />
          <ActionMenu
            label="Import / Export"
            items={[
              { label: "Importar OFX", hint: "Extrato bancário", onClick: () => setShowOFX(true) },
              { label: "Importar Excel", hint: "Planilha (data; descrição; valor)", onClick: () => setShowExcel(true), disabled: !onPreviewExcel || !onImportExcel },
              { label: "Exportar CSV", hint: "Lançamentos por competência", onClick: () => setShowCsvExport(true), disabled: !onExportCsv },
            ]}
          />
          <ActionMenu
            label="Funções"
            accent="#BD93F9"
            items={[
              { label: "+ Folha / Pró-labore", hint: "Lançamento composto pré-preenchido", onClick: () => setShowPayroll(true), disabled: !onLoadPayrollTemplate },
            ]}
          />
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

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" onClick={onLoad} style={actionButtonStyle}>Atualizar</button>
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

      {selectedCount > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          background: "#2D2F45", border: "1px solid #44475A", borderRadius: 8,
          padding: "8px 14px", marginTop: 8, fontSize: "0.875rem", color: ACCOUNTING_PANEL.text,
        }}>
          <span style={{ fontWeight: 700, color: "#BD93F9" }}>
            {selectedCount} selecionado{selectedCount !== 1 ? "s" : ""}
          </span>
          {onBulkDeleteEntries && (
            <button
              type="button"
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              style={{
                background: "#FF5757", border: "none", color: "#fff",
                padding: "6px 14px", borderRadius: 6, fontSize: "0.875rem",
                fontWeight: 600, cursor: bulkDeleting ? "not-allowed" : "pointer",
              }}
            >
              {bulkDeleting ? "Excluindo..." : `Excluir selecionado${selectedCount !== 1 ? "s" : ""}`}
            </button>
          )}
          <button
            type="button"
            onClick={clearSelection}
            style={{
              background: "none", border: "none", color: ACCOUNTING_PANEL.muted,
              fontSize: "0.8125rem", textDecoration: "underline", cursor: "pointer",
            }}
          >
            Limpar seleção
          </button>
        </div>
      )}

      <div style={{ overflowX: "auto", borderRadius: 16, marginTop: 4, background: ACCOUNTING_PANEL.surface, padding: 20 }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed", fontSize: "0.9375rem", borderRadius: 16, overflow: "hidden" }}>
          <colgroup>
            {COLS.map((col, index) => <col key={index} style={{ width: col.width }} />)}
          </colgroup>
          <thead>
            <tr style={{ background: ACCOUNTING_PANEL.field, userSelect: "none" }}>
              <th style={{ padding: "14px 8px", textAlign: "center", borderBottom: `1px solid ${ACCOUNTING_PANEL.border}`, position: "sticky", top: 0, background: ACCOUNTING_PANEL.field, zIndex: 10 }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                  onChange={toggleAll}
                  style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#BD93F9" }}
                  aria-label="Selecionar todos"
                />
              </th>
              {COLS.slice(1).map(({ label, align }, index) => (
                <th key={index} style={{ padding: "14px 14px", textAlign: align, fontSize: "1rem", fontWeight: 700, color: ACCOUNTING_PANEL.text, borderBottom: `1px solid ${ACCOUNTING_PANEL.border}`, position: "sticky", top: 0, background: ACCOUNTING_PANEL.field, zIndex: 10, whiteSpace: "nowrap" }}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{ padding: 16, textAlign: "center", color: ACCOUNTING_PANEL.muted }}>Carregando...</td></tr>}
            {!loading && entries.length === 0 && <tr><td colSpan={9} style={{ padding: 24, textAlign: "center", color: ACCOUNTING_PANEL.muted }}>Nenhum lançamento para esta competência.</td></tr>}
            {!loading && entries.length > 0 && TIPO_GROUP_ORDER.map((tipo) => {
              const items = groupedEntries[tipo];
              if (!items || items.length === 0) return null;
              const accent = TIPO_GROUP_ACCENT[tipo] || ACCOUNTING_PANEL.muted;
              return (
                <Fragment key={tipo}>
                  <tr style={{ background: ACCOUNTING_PANEL.field }}>
                    <td
                      colSpan={9}
                      style={{
                        padding: "10px 14px",
                        borderTop: `2px solid ${accent}`,
                        borderBottom: `1px solid ${ACCOUNTING_PANEL.border}`,
                        fontWeight: 700,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        fontSize: "0.8125rem",
                        color: accent,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        <span style={{ display: "inline-block", width: 6, height: 18, background: accent, borderRadius: 3 }} />
                        <span>{TIPO_GROUP_LABELS[tipo] || tipo}</span>
                        <span style={{ color: ACCOUNTING_PANEL.muted, fontWeight: 500, fontSize: "0.75rem", textTransform: "none", letterSpacing: 0 }}>
                          {items.length} lançamento{items.length !== 1 ? "s" : ""}
                          {groupTotals[tipo] > 0 && <> · R$ {fmtMoney(groupTotals[tipo])}</>}
                        </span>
                      </div>
                    </td>
                  </tr>
                  {items.map((entry) => (
                    <AccountRow
                      key={entry.id}
                      entry={entry}
                      accounts={accounts}
                      onUpdate={onUpdateEntry}
                      onDelete={onDeleteEntry}
                      saving={savingEntry}
                      onCreateBaixa={onCreateBaixa}
                      savingBaixa={savingBaixa}
                      onLoadBaixaTemplate={onLoadBaixaTemplate}
                      onSearchHistoricos={onSearchHistoricos}
                      isSelected={selectedIds.has(entry.id)}
                      onToggleSelect={() => toggleOne(entry.id)}
                    />
                  ))}
                </Fragment>
              );
            })}
          </tbody>
          {total > 0 && <tfoot><tr style={{ background: ACCOUNTING_PANEL.field }}><td colSpan={9} style={{ padding: "5px 8px", fontSize: "0.875rem", color: ACCOUNTING_PANEL.muted, borderTop: `1px solid ${ACCOUNTING_PANEL.border}` }}>{total} lançamento{total !== 1 ? "s" : ""} no total</td></tr></tfoot>}
        </table>
      </div>

      {showOFX && (
        <ImportOFXModal
          companyId={companyId}
          accounts={accounts}
          onPreview={onPreviewOFX}
          onImport={onImportOFX}
          onSearchHistoricos={onSearchHistoricos}
          onGetHistoricosByCode={onGetHistoricosByCode}
          onClose={() => setShowOFX(false)}
        />
      )}
      {showHistoricos && <HistoricosModal onClose={() => setShowHistoricos(false)} onLoadAll={onLoadAllHistoricos} onUpdate={(id, input) => onUpdateHistorico(id, input)} onDelete={(id) => onDeleteHistorico(id)} />}
      {showPayroll && (
        <PayrollEntryModal
          accounts={accounts}
          defaultCompetencia={activeComp}
          onLoadTemplate={onLoadPayrollTemplate}
          onSave={async ({ entry, baixa }) => {
            const result = await onCreateEntry(entry);
            const createdId = result?.entry?.id;
            if (baixa && createdId && onCreateBaixa) {
              try { await onCreateBaixa(createdId, baixa); } catch { /* erro já é exibido */ }
            }
            setShowPayroll(false);
          }}
          saving={savingEntry}
          onClose={() => setShowPayroll(false)}
        />
      )}
      {showCsvExport && (
        <CsvExportModal
          defaultCompetencia={activeComp}
          onExport={(rangeOptions) => onExportCsv(rangeOptions)}
          onClose={() => setShowCsvExport(false)}
        />
      )}
      {showExcel && (
        <ImportExcelModal
          accounts={accounts}
          onPreview={onPreviewExcel}
          onCommit={onImportExcel}
          onClose={() => setShowExcel(false)}
        />
      )}
    </div>
  );
}

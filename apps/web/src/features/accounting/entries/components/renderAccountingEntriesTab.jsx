import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createApiClient } from "../../../../api/client";
import { HistoricosModal } from "../../historicos/components/renderHistoricosModal";
import { ImportOFXModal } from "../../ofx-import/components/renderImportOfxModal";
import { ImportExcelModal } from "../../excel-import/components/renderImportExcelModal";
import { ParcelamentoModal } from "../../parcelamento/components/renderParcelamentoModal";
import { AccountRow, DraftEntryRow } from "./renderAccountingEntriesParts";
import { ACCOUNTING_PANEL, COLS, ORIGEM_LABELS, STATUS_LABELS, TIPO_LABELS, TIPO_GROUP_ORDER, TIPO_GROUP_LABELS, TIPO_GROUP_ACCENT, fmtMoney, formatCompetenciaTitulo } from "../lib/accountingEntriesShared";
import { PayrollEntryModal, CsvExportModal } from "./renderAccountingEntriesParts";
import { FunctionListModal, FunctionEditModal, FunctionApplyModal } from "../../functions/components/AccountingFunctionModals";
import { ParcelamentoCreateModal } from "../../parcelamento/components/ParcelamentoModals";

const fechamentoApi = createApiClient();

// Q18: fechamento contábil compacto — um CADEADO que abre/fecha a empresa no mês.
// 🔒 fechada (clica → reabre) · 🔓 aberta (clica → fecha; bloqueado se houver pendência).
// Checklist de conferência do mês: cada item é uma confirmação MANUAL do contador (o sistema não
// tem como saber se "todas as despesas do mês entraram"). Todos precisam estar marcados pra fechar.
// A ordem aqui é a ordem exibida. As chaves batem com o CHECKLIST_FECHAMENTO do backend.
const CHECKLIST_ITENS = [
  { chave: "folhaProlabore", label: "Folha/Pró-labore", title: "Confirme que a folha e o pró-labore do mês foram lançados." },
  { chave: "despesas",       label: "Despesas",         title: "Confirme que as despesas do mês foram lançadas." },
  { chave: "receitas",       label: "Receitas",         title: "Confirme que as receitas do mês foram lançadas." },
  { chave: "provisoes",      label: "Provisões",        title: "Confirme que as provisões do mês foram lançadas." },
  { chave: "pagamentos",     label: "Pagamentos",       title: "Confirme que os pagamentos do mês foram lançados." },
];

function FechamentoCadeado({ companyId, competencia, entries, onState }) {
  const [fechado, setFechado] = useState(false);
  const [busy, setBusy] = useState(false);
  // Checklist (Q47 + Lote C): { folhaProlabore, despesas, receitas, provisoes, pagamentos }
  const [checklist, setChecklist] = useState({});
  const [checkBusy, setCheckBusy] = useState(null); // chave em gravação

  const problemas = useMemo(() => {
    const out = [];
    // Q24/Q52: lançamentos individuais (1 perna) de parcelamento e de folha/pró-labore
    // balanceiam em GRUPO (parcelamentoId / loteImportacao "FOLHA-"/"PROLABORE-"), não por lançamento.
    const grupos = new Map();
    for (const e of entries || []) {
      if (String(e.tipo || "").toUpperCase() === "PARCELA") continue;
      const lines = e.lines || [];
      if (lines.length === 0) { out.push({ id: e.id, historico: e.historico, motivo: "em branco" }); continue; }
      if (lines.some((l) => !String(l.conta || "").trim())) { out.push({ id: e.id, historico: e.historico, motivo: "conta em branco" }); continue; }
      const folhaLote = String(e.tipo || "").toUpperCase() === "FOLHA" && /^(FOLHA|PROLABORE)-/.test(String(e.loteImportacao || ""));
      const groupKey = e.parcelamentoId || (folhaLote ? e.loteImportacao : null);
      const d = lines.filter((l) => String(l.tipo).toUpperCase() === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
      const c = lines.filter((l) => String(l.tipo).toUpperCase() === "C").reduce((s, l) => s + Number(l.valor || 0), 0);
      if (groupKey) {
        const g = grupos.get(groupKey) || { d: 0, c: 0, historico: e.historico };
        g.d += d; g.c += c;
        grupos.set(groupKey, g);
        continue;
      }
      if (Math.abs(d - c) > 0.01) out.push({ id: e.id, historico: e.historico, motivo: "D≠C" });
    }
    for (const [key, g] of grupos) {
      if (Math.abs(g.d - g.c) > 0.01) out.push({ id: key, historico: g.historico, motivo: "grupo D≠C" });
    }
    return out;
  }, [entries]);

  useEffect(() => {
    let alive = true;
    if (!companyId || !competencia) return undefined;
    fechamentoApi.getFechamentoContabil(companyId, competencia)
      .then((r) => {
        if (!alive) return;
        setFechado(Boolean(r?.fechado));
        // `checklist` é o formato novo; o fallback cobre um backend ainda sem ele (só a folha).
        setChecklist(r?.checklist || { folhaProlabore: r?.folhaProlaboreOk === true });
        onState?.(Boolean(r?.fechado));
      })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, competencia]);

  async function toggle() {
    if (busy) return;
    if (fechado) {
      setBusy(true);
      try { await fechamentoApi.reabrirFechamentoContabil(companyId, competencia); setFechado(false); onState?.(false); }
      catch (e) { window.alert(e?.message || "Falha ao reabrir."); }
      finally { setBusy(false); }
      return;
    }
    if (problemas.length > 0) {
      // eslint-disable-next-line no-alert
      window.alert(
        `Não é possível fechar: ${problemas.length} lançamento(s) com problema.\n\n`
        + problemas.slice(0, 10).map((p) => `• ${p.historico || p.id}: ${p.motivo}`).join("\n")
      );
      return;
    }
    if (pendentes.length > 0) {
      // eslint-disable-next-line no-alert
      window.alert(`Confirme antes de fechar:\n\n${pendentes.map((p) => `• ${p.label}`).join("\n")}`);
      return;
    }
    setBusy(true);
    try { await fechamentoApi.fecharFechamentoContabil(companyId, competencia); setFechado(true); onState?.(true); }
    catch (e) { window.alert(e?.message || "Falha ao fechar."); }
    finally { setBusy(false); }
  }

  async function toggleItem(chave) {
    if (checkBusy || fechado) return;
    const next = !checklist[chave];
    setCheckBusy(chave);
    try {
      await fechamentoApi.setChecklistFechamento(companyId, competencia, chave, next);
      setChecklist((prev) => ({ ...prev, [chave]: next }));
    } catch (e) { window.alert(e?.message || "Falha ao salvar a conferência."); }
    finally { setCheckBusy(null); }
  }

  const pendentes = CHECKLIST_ITENS.filter((i) => checklist[i.chave] !== true);
  const bloqueadoPorChecklist = !fechado && pendentes.length > 0;
  const color = fechado ? "#2DD4BF" : (problemas.length > 0 || bloqueadoPorChecklist) ? "#FF5757" : "#69FF47";
  const title = fechado
    ? `Empresa fechada (${competencia}). Clique para reabrir.`
    : problemas.length > 0
      ? `${problemas.length} lançamento(s) com problema — corrija antes de fechar.`
      : bloqueadoPorChecklist
        ? `Falta confirmar: ${pendentes.map((p) => p.label).join(", ")}.`
        : `Pronta para fechar (${competencia}). Clique no cadeado para fechar.`;
  const btnDisabled = busy || bloqueadoPorChecklist;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {/* Checklist de conferência — some quando o mês já está fechado. */}
      {!fechado && CHECKLIST_ITENS.map((item) => {
        const marcado = checklist[item.chave] === true;
        const gravando = checkBusy === item.chave;
        return (
          <label
            key={item.chave}
            title={item.title}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5, fontSize: "0.78rem", fontWeight: 600,
              color: marcado ? "#69FF47" : "#aeb6d3", cursor: gravando ? "default" : "pointer", userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={marcado}
              disabled={Boolean(checkBusy)}
              onChange={() => toggleItem(item.chave)}
              style={{ cursor: gravando ? "default" : "pointer" }}
            />
            {item.label}
          </label>
        );
      })}
      <button
        type="button"
        onClick={toggle}
        disabled={btnDisabled}
        title={title}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px",
          borderRadius: 8, cursor: btnDisabled ? "not-allowed" : "pointer", fontSize: "0.8rem", fontWeight: 700,
          background: "transparent", color, border: `1px solid ${color}`, opacity: btnDisabled ? 0.6 : 1,
        }}
      >
        <span style={{ fontSize: "1rem" }}>{fechado ? "🔒" : "🔓"}</span>
        {fechado ? "Fechada" : "Fechar mês"}
      </button>
    </div>
  );
}

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
  onCreateFolha,   // Q52: folha/pró-labore em lançamentos individuais (1 chamada por competência)
  onBulkDeleteEntries,
  onOpenChartOfAccountsTab,
  onPreviewExcel,
  onImportExcel,
  // F3: Parcelamento Simples Nacional
  onCreateParcelamento,
  companyRegime,  // regime tributário — controla visibilidade do botão "Novo Parcelamento"
  // Q6: Funções de Lançamento
  accountingFunctions,  // { functions, loading, saving, create, update, remove, apply } do hook useAccountingFunctions
  // Q9: Parcelamentos
  parcelamentos,        // { parcelamentos, loading, saving, create, linkGuide, payParcela, rescindir } do hook useParcelamentos
}) {
  const [showOFX, setShowOFX] = useState(false);
  const [showHistoricos, setShowHistoricos] = useState(false);
  const [showPayroll, setShowPayroll] = useState(false);
  const [showCsvExport, setShowCsvExport] = useState(false);
  const [showFilters, setShowFilters] = useState(false);   // filtros saíram da caixa → modal
  const [showExcel, setShowExcel] = useState(false);
  const [showParcelamento, setShowParcelamento] = useState(false);
  const [savingParcelamento, setSavingParcelamento] = useState(false);
  // Q6: Funções de Lançamento — modais
  const [showFunctionsList, setShowFunctionsList] = useState(false);
  const [editingFunction, setEditingFunction] = useState(null);    // null=fechado, {}=nova, {id,...}=editando existente
  const [applyingFunction, setApplyingFunction] = useState(null);  // function que vai ser aplicada
  // Q9: state pro modal de criar parcelamento (stand-alone, sem guia de origem)
  const [showCreateParcelamento, setShowCreateParcelamento] = useState(false);

  // Parcelamento Simples Nacional só faz sentido para empresas regime SIMPLES.
  const isSimples = String(companyRegime || "").trim().toUpperCase() === "SIMPLES";
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [adding, setAdding] = useState(false); // Q18: linha de novo lançamento inline
  const [monthClosed, setMonthClosed] = useState(false); // Q18: mês fechado bloqueia adicionar

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
  // Q32.1: select-all por grupo (cabeçalho de cada tipo).
  function toggleGroup(ids) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const all = ids.length > 0 && ids.every((id) => next.has(id));
      if (all) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }

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

  // Navegação rápida de competência (setas ◀ ▶ no título): ±1 mês.
  function shiftCompetencia(n) {
    const m = String(activeComp).match(/^(\d{4})-(\d{2})$/);
    if (!m) return;
    let total = Number(m[1]) * 12 + (Number(m[2]) - 1) + n;
    const y = Math.floor(total / 12);
    const mo = (total % 12) + 1;
    onFilterChange("competencia", `${y}-${String(mo).padStart(2, "0")}`);
  }

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
    // Q32: dentro de cada tipo, ordena por DATA desc (mais nova em cima; dia 1 embaixo).
    // Desempate por createdAt desc.
    const ts = (v) => { const t = v ? new Date(v).getTime() : 0; return Number.isFinite(t) ? t : 0; };
    for (const tipo of TIPO_GROUP_ORDER) {
      groups[tipo].sort((a, b) => (ts(b.data) - ts(a.data)) || (ts(b.createdAt) - ts(a.createdAt)));
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

  // Q18: filtros compactos (como no dashboard).
  const filterLabelStyle = {
    display: "grid",
    gap: 3,
    minWidth: 0,
    fontSize: "0.68rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    color: ACCOUNTING_PANEL.muted,
  };

  const filterControlStyle = {
    width: "100%",
    height: 34,
    border: `1px solid ${ACCOUNTING_PANEL.border}`,
    borderRadius: 6,
    padding: "0 8px",
    font: "inherit",
    fontSize: "0.8rem",
    color: ACCOUNTING_PANEL.text,
    background: ACCOUNTING_PANEL.field,
    boxSizing: "border-box",
    outline: "none",
  };

  // Nº de filtros ativos (competência sempre tem valor, então não conta pro selo do botão).
  const activeFilterCount = ["tipo", "origem", "status"].filter((k) => filters?.[k]).length;

  return (
    <div style={{ width: "100%", background: ACCOUNTING_PANEL.page, padding: "var(--space-3) var(--space-4)" }}>
      {/* Caixa superior no mesmo padrão das pílulas: fundo sólido + borda roxa + cantos macios. */}
      <div style={{ display: "grid", gap: 12, marginBottom: 10, padding: 16, borderRadius: 16, border: "1px solid rgba(189,147,249,0.28)", background: ACCOUNTING_PANEL.surface, maxWidth: 1600, marginLeft: "auto", marginRight: "auto" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ActionMenu
            label="Configurações"
            items={[
              { label: "Histórico de lançamentos", hint: "Templates de histórico reutilizáveis", onClick: () => setShowHistoricos(true) },
              { label: "Plano de contas", hint: "Visualizar e editar contas", onClick: () => { onLoadAccounts(); if (onOpenChartOfAccountsTab) onOpenChartOfAccountsTab(); }, disabled: !onOpenChartOfAccountsTab },
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
              // Parcelamento Simples Nacional só aparece para empresas regime SIMPLES.
              ...(isSimples ? [{
                label: "+ Parcelamento Simples",
                hint: "Cria N parcelas (provisão recorrente)",
                onClick: () => setShowParcelamento(true),
                disabled: !onCreateParcelamento,
              }] : []),
              // Q6: Funções customizadas (templates reutilizáveis)
              ...(accountingFunctions ? [{
                label: "Aplicar função…",
                hint: "Use um template reutilizável da empresa ou global",
                onClick: () => setShowFunctionsList(true),
              }] : []),
              // Q9: Parcelamentos (Simples, INSS, DARF, OUTRO)
              ...(parcelamentos ? [{
                label: "+ Novo parcelamento…",
                hint: "Cria parcelamento com abertura + N parcelas (Simples, INSS, etc)",
                onClick: () => setShowCreateParcelamento(true),
              }] : []),
            ]}
          />
          {/* Filtros saíram da caixa: abrem num modal, deixando a caixa superior enxuta. */}
          <button
            type="button"
            onClick={() => setShowFilters(true)}
            style={activeFilterCount ? { ...actionButtonStyle, borderColor: ACCOUNTING_PANEL.accent, color: ACCOUNTING_PANEL.accent } : actionButtonStyle}
            title="Filtrar lançamentos"
          >
            ⚲ Filtro{activeFilterCount ? ` (${activeFilterCount})` : ""}
          </button>
        </div>

        {entries.length > 0 && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            {Object.entries(totals).map(([tipo, value]) => (
              <span key={tipo} style={{ fontSize: "0.75rem", color: ACCOUNTING_PANEL.text }}>
                <strong style={{ color: ACCOUNTING_PANEL.text }}>{TIPO_LABELS[tipo] || tipo}:</strong> R$ {fmtMoney(value)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Modal de filtros (saíram da caixa superior pra deixá-la enxuta). */}
      {showFilters && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={(e) => e.target === e.currentTarget && setShowFilters(false)}
        >
          <div style={{ background: ACCOUNTING_PANEL.surface, border: "1px solid rgba(189,147,249,0.28)", borderRadius: 16, padding: 22, width: 420, maxWidth: "100%", color: ACCOUNTING_PANEL.text, boxSizing: "border-box" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: "1.05rem" }}>Filtros</h3>
              <button type="button" onClick={() => setShowFilters(false)} style={{ background: "none", border: "none", color: ACCOUNTING_PANEL.muted, fontSize: 20, cursor: "pointer", lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ display: "grid", gap: 14 }}>
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
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 20 }}>
              <button
                type="button"
                onClick={() => { onFilterChange("tipo", ""); onFilterChange("origem", ""); onFilterChange("status", ""); }}
                style={actionButtonStyle}
              >
                Limpar
              </button>
              <button
                type="button"
                onClick={() => { if (onLoad) onLoad(); setShowFilters(false); }}
                style={{ ...actionButtonStyle, background: ACCOUNTING_PANEL.accent, color: "#1A1B26", border: "none" }}
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}

      {message && message !== "Lançamento adicionado." && <p style={{ color: "var(--success)", margin: "0 0 8px", fontSize: "0.875rem" }}>{message}</p>}
      {error && <p style={{ color: "var(--danger)", margin: "0 0 8px", fontSize: "0.875rem" }}>{error}</p>}

      {/* Q18: toolbar junto da tabela (mesma largura/centralização) — Adicionar + cadeado */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4, marginBottom: 8, flexWrap: "wrap", maxWidth: 1600, marginLeft: "auto", marginRight: "auto" }}>
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={adding || monthClosed}
          title={monthClosed ? "Mês fechado — reabra a empresa para lançar." : undefined}
          style={{ minHeight: 34, padding: "7px 16px", border: "none", borderRadius: 8, background: (adding || monthClosed) ? "#44475A" : "#69FF47", color: (adding || monthClosed) ? "#888" : "#1A1B26", font: "inherit", fontSize: "0.875rem", fontWeight: 700, cursor: (adding || monthClosed) ? "default" : "pointer" }}
        >
          + Adicionar lançamento
        </button>
        <div style={{ marginLeft: "auto" }}>
          <FechamentoCadeado
            companyId={companyId}
            competencia={activeComp}
            entries={entries}
            onState={(closed) => { setMonthClosed(closed); if (closed) setAdding(false); }}
          />
        </div>
      </div>

      {selectedCount > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          background: "#2D2F45", border: "1px solid #44475A", borderRadius: 8,
          padding: "8px 14px", marginTop: 8, fontSize: "0.875rem", color: ACCOUNTING_PANEL.text,
          maxWidth: 1600, marginLeft: "auto", marginRight: "auto", boxSizing: "border-box",
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

      {/* Q18: tabela centralizada e mais estreita (Histórico fica perto do Valor). */}
      <div style={{ overflowX: "auto", borderRadius: 16, border: `1px solid ${ACCOUNTING_PANEL.border}`, marginTop: 4, background: ACCOUNTING_PANEL.surface, padding: 20, maxWidth: 1600, marginLeft: "auto", marginRight: "auto" }}>
        {/* Q32: título da competência acima do cabeçalho (ex.: MAIO/2026). Q39: setas ◀ ▶ pra navegar. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginBottom: 14 }}>
          <button
            type="button"
            onClick={() => shiftCompetencia(-1)}
            aria-label="Competência anterior"
            title="Competência anterior"
            style={{ background: ACCOUNTING_PANEL.field, border: `1px solid ${ACCOUNTING_PANEL.border}`, color: ACCOUNTING_PANEL.text, borderRadius: 8, width: 34, height: 34, fontSize: "1.1rem", cursor: "pointer", lineHeight: 1 }}
          >
            ◀
          </button>
          <div style={{ minWidth: 200, textAlign: "center", fontSize: "1.4rem", fontWeight: 800, letterSpacing: "0.04em", color: ACCOUNTING_PANEL.text }}>
            {formatCompetenciaTitulo(activeComp)}
          </div>
          <button
            type="button"
            onClick={() => shiftCompetencia(1)}
            aria-label="Próxima competência"
            title="Próxima competência"
            style={{ background: ACCOUNTING_PANEL.field, border: `1px solid ${ACCOUNTING_PANEL.border}`, color: ACCOUNTING_PANEL.text, borderRadius: 8, width: 34, height: 34, fontSize: "1.1rem", cursor: "pointer", lineHeight: 1 }}
          >
            ▶
          </button>
        </div>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed", fontSize: "0.9375rem", borderRadius: 16, overflow: "hidden" }}>
          <colgroup>
            {COLS.map((col, index) => <col key={index} style={{ width: col.width }} />)}
          </colgroup>
          {/* Q32.1: cabeçalho de colunas não fica mais global — é repetido embaixo do título de cada tipo. */}
          <tbody>
            {adding && (
              <DraftEntryRow
                accounts={accounts}
                onSave={onCreateEntry}
                saving={savingEntry}
                activeComp={activeComp}
                onSearchHistoricos={onSearchHistoricos}
                onGetHistoricosByCode={onGetHistoricosByCode}
                onClose={() => setAdding(false)}
              />
            )}
            {loading && <tr><td colSpan={7} style={{ padding: 16, textAlign: "center", color: ACCOUNTING_PANEL.text }}>Carregando...</td></tr>}
            {!loading && entries.length === 0 && <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: ACCOUNTING_PANEL.text }}>Nenhum lançamento para esta competência.</td></tr>}
            {!loading && entries.length > 0 && TIPO_GROUP_ORDER.map((tipo) => {
              const items = groupedEntries[tipo];
              if (!items || items.length === 0) return null;
              const groupIds = items.map((e) => e.id);
              const groupAll = groupIds.every((id) => selectedIds.has(id));
              const groupSome = groupIds.some((id) => selectedIds.has(id));
              return (
                <Fragment key={tipo}>
                  <tr style={{ background: ACCOUNTING_PANEL.field }}>
                    <td
                      colSpan={7}
                      style={{
                        padding: "12px 16px",
                        borderTop: `3px solid ${ACCOUNTING_PANEL.border}`,
                        borderBottom: `2px solid ${ACCOUNTING_PANEL.border}`,
                        fontWeight: 800,
                        letterSpacing: "0.03em",
                        fontSize: "0.95rem",
                        textTransform: "uppercase",
                        color: ACCOUNTING_PANEL.text,
                        textAlign: "center",
                      }}
                    >
                      {/* Q32: separador de tipo mais destacado (maior, caixa-alta, borda superior grossa). */}
                      <span>{TIPO_GROUP_LABELS[tipo] || tipo}</span>
                      <span style={{ color: ACCOUNTING_PANEL.muted, fontWeight: 500, fontSize: "0.78rem", marginLeft: 12, textTransform: "none" }}>
                        {items.length} lançamento{items.length !== 1 ? "s" : ""}
                        {groupTotals[tipo] > 0 && <> · R$ {fmtMoney(groupTotals[tipo])}</>}
                      </span>
                    </td>
                  </tr>
                  {/* Q32.1: cabeçalho de colunas embaixo do título do tipo. */}
                  <tr style={{ background: ACCOUNTING_PANEL.field, userSelect: "none" }}>
                    <th style={{ padding: "8px 8px", textAlign: "center", borderBottom: `1px solid ${ACCOUNTING_PANEL.border}`, borderRight: `1px solid ${ACCOUNTING_PANEL.border}` }}>
                      <input
                        type="checkbox"
                        checked={groupAll}
                        ref={(el) => { if (el) el.indeterminate = groupSome && !groupAll; }}
                        onChange={() => toggleGroup(groupIds)}
                        style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#BD93F9" }}
                        aria-label={`Selecionar todos de ${TIPO_GROUP_LABELS[tipo] || tipo}`}
                      />
                    </th>
                    {COLS.slice(1).map(({ label, align }, index, arr) => (
                      <th key={index} style={{ padding: "8px 12px", textAlign: align, fontSize: "0.82rem", fontWeight: 700, color: ACCOUNTING_PANEL.muted, textTransform: "uppercase", letterSpacing: "0.02em", borderBottom: `1px solid ${ACCOUNTING_PANEL.border}`, borderRight: index < arr.length - 1 ? `1px solid ${ACCOUNTING_PANEL.border}` : "none", whiteSpace: "nowrap" }}>{label}</th>
                    ))}
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
                      onGetHistoricosByCode={onGetHistoricosByCode}
                      isSelected={selectedIds.has(entry.id)}
                      onToggleSelect={() => toggleOne(entry.id)}
                    />
                  ))}
                </Fragment>
              );
            })}
          </tbody>
          {total > 0 && (() => {
            // Q33: contagem + balanço Débito × Crédito — discreto, na mesma linha.
            const dTot = Number(listedTotals.debito) || 0;
            const cTot = Number(listedTotals.credito) || 0;
            const diff = Math.abs(dTot - cTot);
            const balanced = diff <= 0.01;
            return (
              <tfoot>
                <tr style={{ background: ACCOUNTING_PANEL.field }}>
                  <td colSpan={7} style={{ padding: "6px 12px", fontSize: "0.8rem", color: ACCOUNTING_PANEL.muted, borderTop: `1px solid ${ACCOUNTING_PANEL.border}` }}>
                    {total} lançamento{total !== 1 ? "s" : ""} no total
                    <span style={{ margin: "0 8px", color: ACCOUNTING_PANEL.border }}>·</span>
                    D R$ {fmtMoney(dTot) || "0,00"}
                    <span style={{ margin: "0 6px", color: ACCOUNTING_PANEL.border }}>·</span>
                    C R$ {fmtMoney(cTot) || "0,00"}
                    <span style={{ marginLeft: 8, color: balanced ? "#69FF47" : "#FFB347", fontWeight: 600 }}>
                      {balanced ? "✓ ok" : `⚠ dif. R$ ${fmtMoney(diff) || "0,00"}`}
                    </span>
                  </td>
                </tr>
              </tfoot>
            );
          })()}
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
          onSave={async ({ competencia, subtipo, provisoes, baixas, repeatMonths }) => {
            // Q52: cada linha do modal vira UM lançamento individual — o backend cria todos
            // os da competência numa transaction (POST /entries/folha, 1 lote por mês).
            // F2: Repetição N meses — repete provisões + baixas para cada competência seguinte.
            const repeatN = Math.max(0, Math.min(12, Number(repeatMonths) || 0));
            function addMonthsToCompetencia(comp, n) {
              const m = String(comp || "").match(/^(\d{4})-(\d{2})$/);
              if (!m) return comp;
              const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + n, 1));
              return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
            }
            function compToMmYyyy(comp) {
              const m = String(comp || "").match(/^(\d{4})-(\d{2})$/);
              return m ? `${m[2]}/${m[1]}` : "";
            }
            function shiftDate(dateStr, monthsToAdd) {
              if (!dateStr) return dateStr;
              const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
              if (!m) return dateStr;
              // Mantém o dia se possível; se transbordar (ex: 31/02), usa último dia do mês.
              const targetYear = Number(m[1]);
              const targetMonth = Number(m[2]) - 1 + monthsToAdd;
              const day = Number(m[3]);
              const lastDayOfTarget = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
              const realDay = Math.min(day, lastDayOfTarget);
              const dt = new Date(Date.UTC(targetYear, targetMonth, realDay));
              return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
            }
            const baseComp = competencia || activeComp;
            const baseMmYyyy = compToMmYyyy(baseComp);
            const escapeRegex = (s) => String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const subsHistorico = (texto, novaMmYyyy) => {
              if (!texto || !baseMmYyyy) return texto;
              // Substitui apenas o MM/YYYY exato do mês base (evita falso positivo com outros números).
              return String(texto).replace(new RegExp(escapeRegex(baseMmYyyy), "g"), novaMmYyyy);
            };

            try {
              for (let n = 0; n <= repeatN; n++) {
                const compN = addMonthsToCompetencia(baseComp, n);
                const mmYyyyN = compToMmYyyy(compN);
                const provisoesN = (provisoes || []).map((p) => ({
                  ...p,
                  data: shiftDate(p.data, n),
                  historico: subsHistorico(p.historico, mmYyyyN),
                }));
                const baixasN = (baixas || []).map((b) => ({
                  ...b,
                  data: shiftDate(b.data, n),
                  historico: subsHistorico(b.historico, mmYyyyN),
                }));
                if (provisoesN.length === 0 && baixasN.length === 0) continue;
                await onCreateFolha({ competencia: compN, subtipo, provisoes: provisoesN, baixas: baixasN });
              }
              setShowPayroll(false);
            } catch { /* erro já é tratado no onCreateFolha */ }
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
      {showParcelamento && (
        <ParcelamentoModal
          accounts={accounts}
          defaultCompetencia={activeComp}
          saving={savingParcelamento}
          onSave={async (payload) => {
            setSavingParcelamento(true);
            try {
              return await onCreateParcelamento(payload);
            } finally {
              setSavingParcelamento(false);
            }
          }}
          onClose={() => setShowParcelamento(false)}
        />
      )}

      {/* Q6: Funções de Lançamento */}
      {showFunctionsList && accountingFunctions && (
        <FunctionListModal
          functions={accountingFunctions.functions}
          loading={accountingFunctions.loading}
          onApply={(f) => { setShowFunctionsList(false); setApplyingFunction(f); }}
          onEdit={(f) => { setShowFunctionsList(false); setEditingFunction(f); }}
          onDelete={async (f) => {
            // eslint-disable-next-line no-alert
            if (!window.confirm(`Excluir a função "${f.name}"?`)) return;
            try { await accountingFunctions.remove(f.id); } catch {}
          }}
          onCreate={() => { setShowFunctionsList(false); setEditingFunction({}); }}
          onDuplicate={async (f) => {
            // Duplica como nova função da empresa (sem isSystem)
            const dup = {
              name: `${f.name} (cópia)`,
              description: f.description || null,
              entries: (f.entries || []).map((e, idx) => ({
                ordem: idx, historico: e.historico, tipo: e.tipo, subtipo: e.subtipo || null,
                lines: (e.lines || []).map((ln, lidx) => ({ ordem: lidx, conta: ln.conta, tipo: ln.tipo })),
              })),
            };
            try {
              await accountingFunctions.create(dup);
            } catch {}
          }}
          onClose={() => setShowFunctionsList(false)}
        />
      )}
      {editingFunction && accountingFunctions && (
        <FunctionEditModal
          initial={editingFunction.id ? editingFunction : null}
          accounts={accounts}
          saving={accountingFunctions.saving}
          onSave={async (payload) => {
            if (editingFunction.id) {
              await accountingFunctions.update(editingFunction.id, payload);
            } else {
              await accountingFunctions.create(payload);
            }
            setEditingFunction(null);
          }}
          onClose={() => setEditingFunction(null)}
        />
      )}
      {applyingFunction && accountingFunctions && (
        <FunctionApplyModal
          func={applyingFunction}
          defaultCompetencia={activeComp}
          saving={accountingFunctions.saving}
          onApply={async ({ competencia, entryValores }) => {
            await accountingFunctions.apply(applyingFunction.id, { competencia, entryValores });
            setApplyingFunction(null);
            // Recarrega lista de lançamentos para mostrar os criados
            if (onLoad) await onLoad();
          }}
          onClose={() => setApplyingFunction(null)}
        />
      )}

      {/* Q9: criar parcelamento stand-alone (sem guia de origem) */}
      {showCreateParcelamento && parcelamentos && accountingFunctions && (
        <ParcelamentoCreateModal
          accountingFunctions={accountingFunctions}
          saving={parcelamentos.saving}
          onCreate={async (body) => {
            await parcelamentos.create(body);
            setShowCreateParcelamento(false);
            if (onLoad) await onLoad();
          }}
          onClose={() => setShowCreateParcelamento(false)}
        />
      )}
    </div>
  );
}

import { useEffect, useState, useMemo } from "react";
import { BaixaModal } from "../../baixa/components/renderBaixaModal";

const SUBTIPO_ROWS = [
  { key: "DAS",             label: "DAS / Simples Nacional" },
  { key: "INSS",            label: "INSS / CPP" },
  { key: "IRRF",            label: "IRRF" },
  { key: "ISS",             label: "ISS" },
  { key: "PIS_COFINS",      label: "PIS/COFINS" },
  { key: "FGTS",            label: "FGTS" },
  { key: "FERIAS",          label: "Férias" },
  { key: "DECIMO_TERCEIRO", label: "13º Salário" },
  { key: "OUTROS_TRIBUTOS", label: "Outros Tributos" },
];

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function fmtMoney(val) {
  const n = Number(val);
  if (!n) return null;
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function PagamentoCell({ entry, onBaixa }) {
  if (!entry) {
    return (
      <td style={{
        padding: "6px 4px", textAlign: "center", fontSize: "0.75rem",
        color: "#d1d5db", borderRight: "1px solid #e5e7eb",
      }}>
        —
      </td>
    );
  }

  // Placeholder (TEMPLATE sem valor) → célula amarela
  if (entry.placeholder || entry.origem === "TEMPLATE") {
    return (
      <td style={{ background: "#fffbeb", padding: "5px 4px", textAlign: "center", borderRight: "1px solid #e5e7eb", minWidth: 80 }}>
        <span style={{
          display: "inline-block", fontSize: "0.55rem", fontWeight: 800, letterSpacing: "0.04em",
          textTransform: "uppercase", padding: "1px 5px", borderRadius: 999,
          background: "#fef3c7", color: "#92400e", border: "1px solid #fcd34d",
        }}>
          PREENCHER
        </span>
        <div style={{ fontSize: "0.65rem", color: "#92400e", marginTop: 2 }}>sem valor</div>
      </td>
    );
  }

  const isAberto = entry.statusPagamento === "ABERTO";
  const bg          = isAberto ? "#fef2f2" : "#f0fdf4";
  const badgeBg     = isAberto ? "#fee2e2" : "#dcfce7";
  const badgeColor  = isAberto ? "#dc2626" : "#16a34a";
  const badgeBorder = isAberto ? "#fca5a5" : "#86efac";
  const badgeLabel  = isAberto ? "ABERTO" : "PAGO";

  return (
    <td style={{ background: bg, padding: "5px 4px", textAlign: "center", borderRight: "1px solid #e5e7eb", minWidth: 80 }}>
      <span style={{
        display: "inline-block", fontSize: "0.55rem", fontWeight: 800, letterSpacing: "0.04em",
        textTransform: "uppercase", padding: "1px 5px", borderRadius: 999,
        background: badgeBg, color: badgeColor, border: `1px solid ${badgeBorder}`,
      }}>
        {badgeLabel}
      </span>
      <div style={{ fontSize: "0.7rem", fontWeight: 700, marginTop: 2, whiteSpace: "nowrap" }}>
        {fmtMoney(entry.valor || entry.totalD) ? `R$ ${fmtMoney(entry.valor || entry.totalD)}` : "—"}
      </div>
      {isAberto && onBaixa && (
        <button
          onClick={() => onBaixa(entry)}
          style={{
            marginTop: 3, fontSize: "0.6rem", fontWeight: 700, cursor: "pointer",
            background: "#dc2626", color: "white", border: "none",
            borderRadius: 3, padding: "2px 6px", whiteSpace: "nowrap",
          }}
        >
          Dar Baixa
        </button>
      )}
    </td>
  );
}

function FaturamentoCell({ valor }) {
  return (
    <td style={{ padding: "6px 4px", textAlign: "center", fontSize: "0.75rem", borderRight: "1px solid #e5e7eb" }}>
      {valor ? (
        <span style={{ fontWeight: 700, color: "#1d4ed8" }}>R$ {fmtMoney(valor)}</span>
      ) : (
        <span style={{ color: "#d1d5db" }}>—</span>
      )}
    </td>
  );
}

function OperationalBlock({
  competencia,
  runningFiscalAction,
  lastFiscalResult,
  onSearchGuides,
  onCheckPayments,
  onSyncInss,
}) {
  const actionInProgress = Boolean(runningFiscalAction);
  const lastResult = lastFiscalResult?.result || null;

  return (
    <div style={{
      background: "#f3f4f6",
      border: "1px solid #e5e7eb",
      borderRadius: 6,
      padding: "12px 16px",
      marginBottom: 16,
    }}>
      <div style={{ marginBottom: 8, fontSize: "0.8125rem", fontWeight: 600, color: "#374151" }}>
        Operações Fiscais para {competencia}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: lastResult ? 10 : 0 }}>
        <button
          onClick={onSearchGuides}
          disabled={actionInProgress}
          style={{
            fontSize: "0.8125rem",
            fontWeight: 600,
            padding: "6px 12px",
            background: actionInProgress && runningFiscalAction === "search_guides" ? "#3b82f6" : "white",
            color: actionInProgress && runningFiscalAction === "search_guides" ? "white" : "#1f2937",
            border: "1px solid #d1d5db",
            borderRadius: 4,
            cursor: actionInProgress ? "default" : "pointer",
            opacity: actionInProgress && runningFiscalAction !== "search_guides" ? 0.5 : 1,
          }}
        >
          {runningFiscalAction === "search_guides" ? "⏳ Buscando..." : "🔍 Buscar Guias"}
        </button>

        <button
          onClick={onCheckPayments}
          disabled={actionInProgress}
          style={{
            fontSize: "0.8125rem",
            fontWeight: 600,
            padding: "6px 12px",
            background: actionInProgress && runningFiscalAction === "check_payments" ? "#3b82f6" : "white",
            color: actionInProgress && runningFiscalAction === "check_payments" ? "white" : "#1f2937",
            border: "1px solid #d1d5db",
            borderRadius: 4,
            cursor: actionInProgress ? "default" : "pointer",
            opacity: actionInProgress && runningFiscalAction !== "check_payments" ? 0.5 : 1,
          }}
        >
          {runningFiscalAction === "check_payments" ? "⏳ Verificando..." : "✓ Verificar Pagtos"}
        </button>

        <button
          onClick={onSyncInss}
          disabled={actionInProgress}
          style={{
            fontSize: "0.8125rem",
            fontWeight: 600,
            padding: "6px 12px",
            background: actionInProgress && runningFiscalAction === "sync_inss" ? "#3b82f6" : "white",
            color: actionInProgress && runningFiscalAction === "sync_inss" ? "white" : "#1f2937",
            border: "1px solid #d1d5db",
            borderRadius: 4,
            cursor: actionInProgress ? "default" : "pointer",
            opacity: actionInProgress && runningFiscalAction !== "sync_inss" ? 0.5 : 1,
          }}
        >
          {runningFiscalAction === "sync_inss" ? "⏳ Sincronizando..." : "⚙ Sincronizar INSS"}
        </button>
      </div>

      {lastResult && (
        <div style={{
          fontSize: "0.75rem",
          background: lastResult.status === "completed" ? "#ecfdf5" : "#fef2f2",
          border: `1px solid ${lastResult.status === "completed" ? "#a7f3d0" : "#fecaca"}`,
          borderRadius: 3,
          padding: "8px 10px",
          color: lastResult.status === "completed" ? "#065f46" : "#991b1b",
        }}>
          <div style={{ fontWeight: 600, marginBottom: 3 }}>
            {lastResult.action.replace("_", " ").toUpperCase()} — {lastResult.status === "completed" ? "✓ Concluído" : "⚠ Incompleto"}
          </div>
          {lastResult.guidesFound != null && (
            <div>Guias encontradas: {lastResult.guidesFound}</div>
          )}
          {lastResult.guidesChecked != null && (
            <div>Guias verificadas: {lastResult.guidesChecked} (Pagas: {lastResult.guidesPaid}, Vencidas: {lastResult.guidesOverdue}, Abertas: {lastResult.guidesOpen})</div>
          )}
        </div>
      )}
    </div>
  );
}

export function CircularTab({
  circularData,
  loading,
  year,
  competencia,
  onCompetenciaChange,
  onYearChange,
  onLoad,
  onSaveCircular,
  savingCircular,
  onApproveAccountingEntry,
  approvingCircularEntryId,
  accounts,
  onCreateBaixa,
  savingBaixa,
  runningFiscalAction,
  lastFiscalResult,
  onSearchGuides,
  onCheckPayments,
  onSyncInss,
}) {
  const [baixaEntry, setBaixaEntry] = useState(null);
  const [draft, setDraft] = useState({ receitaBruta: "", receitaServicos: "", receitaVendas: "", dasTotal: "", inssTotal: "", inssVencimento: "", inssStatus: "" });
  const currentYear = new Date().getFullYear();

  useEffect(() => {
    const c = circularData?.circular || {};
    setDraft({
      receitaBruta: c.receitaBruta ?? "",
      receitaServicos: c.receitaServicos ?? "",
      receitaVendas: c.receitaVendas ?? "",
      dasTotal: c.dasTotal ?? "",
      inssTotal: c.inssTotal ?? "",
      inssVencimento: c.inssVencimento ? String(c.inssVencimento).slice(0, 10) : "",
      inssStatus: c.inssStatus ?? "",
    });
  }, [circularData?.circular]);

  const matrix = useMemo(() => {
    if (!circularData?.provisoes) return {};
    const map = {};
    for (const p of circularData.provisoes) {
      if (!p.subtipo) continue;
      const k = `${p.subtipo}__${p.competencia}`;
      const existing = map[k];
      // Preferência: ABERTO real > PAGO > TEMPLATE (placeholder)
      if (!existing) { map[k] = p; continue; }
      const isTemplate = (e) => e.placeholder || e.origem === "TEMPLATE";
      if (isTemplate(existing) && !isTemplate(p)) { map[k] = p; continue; }
      if (!isTemplate(existing) && p.statusPagamento === "ABERTO" && !isTemplate(p)) { map[k] = p; }
    }
    return map;
  }, [circularData]);

  const visibleRows = useMemo(() => {
    if (!circularData?.provisoes) return SUBTIPO_ROWS;
    const usedSubtipos = new Set(circularData.provisoes.map((p) => p.subtipo).filter(Boolean));
    return SUBTIPO_ROWS.filter((r) => usedSubtipos.has(r.key));
  }, [circularData]);

  // Totais por mês para linha de saldo em aberto
  const abertoByMonth = useMemo(() => {
    if (!circularData?.provisoes) return {};
    const totals = {};
    for (const p of circularData.provisoes) {
      if (p.statusPagamento === "ABERTO" && !p.placeholder && p.origem !== "TEMPLATE") {
        totals[p.competencia] = (totals[p.competencia] || 0) + (Number(p.totalD) || 0);
      }
    }
    return totals;
  }, [circularData]);

  const monthKeys = MONTH_LABELS.map((_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const reviewEntries = Array.isArray(circularData?.reviewEntries)
    ? circularData.reviewEntries
    : Array.isArray(circularData?.entries)
      ? circularData.entries
      : [];
  const circular = circularData?.circular || null;

  function updateDraft(key, value) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function saveCircular() {
    if (!onSaveCircular) return;
    const payload = {};
    if (draft.receitaBruta !== "") payload.receitaBruta = draft.receitaBruta;
    if (draft.receitaServicos !== "") payload.receitaServicos = draft.receitaServicos;
    if (draft.receitaVendas !== "") payload.receitaVendas = draft.receitaVendas;
    if (draft.dasTotal !== "") payload.dasTotal = draft.dasTotal;
    if (draft.inssTotal !== "") payload.inssTotal = draft.inssTotal;
    if (draft.inssVencimento !== "") payload.inssVencimento = draft.inssVencimento;
    if (draft.inssStatus !== "") payload.inssStatus = draft.inssStatus;
    await onSaveCircular(payload);
  }

  return (
    <div style={{ padding: "var(--space-3) var(--space-4)", width: "100%", background: "var(--bg-surface)" }}>
      {/* Cabeçalho */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>Circular — Provisões e Pagamentos</h2>

        {/* Seletor de ano */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          <button
            onClick={() => onYearChange(year - 1)}
            style={{
              background: "white", border: "1px solid var(--border)", borderRadius: 4,
              width: 28, height: 28, cursor: "pointer", fontSize: "0.875rem",
            }}
          >
            ←
          </button>
          <span style={{ fontWeight: 700, fontSize: "1rem", minWidth: 48, textAlign: "center" }}>{year}</span>
          <button
            onClick={() => onYearChange(year + 1)}
            disabled={year >= currentYear + 1}
            style={{
              background: "white", border: "1px solid var(--border)", borderRadius: 4,
              width: 28, height: 28, cursor: year >= currentYear + 1 ? "default" : "pointer",
              fontSize: "0.875rem", opacity: year >= currentYear + 1 ? 0.4 : 1,
            }}
          >
            →
          </button>
          <button
            onClick={() => onLoad(year)}
            style={{
              background: "white", border: "1px solid var(--border)", borderRadius: 4,
              height: 28, padding: "0 10px", cursor: "pointer", fontSize: "0.8125rem",
            }}
          >
            Atualizar
          </button>
        </div>
      </div>

      {/* Operational Block */}
      {onSearchGuides && onCheckPayments && onSyncInss && (
        <OperationalBlock
          competencia={competencia}
          runningFiscalAction={runningFiscalAction}
          lastFiscalResult={lastFiscalResult}
          onSearchGuides={onSearchGuides}
          onCheckPayments={onCheckPayments}
          onSyncInss={onSyncInss}
        />
      )}

      {/* Legenda */}
      <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: "0.75rem", color: "var(--text-muted)", flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#fee2e2", border: "1px solid #fca5a5", display: "inline-block" }} />
          Em aberto
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#dcfce7", border: "1px solid #86efac", display: "inline-block" }} />
          Pago
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#fffbeb", border: "1px solid #fcd34d", display: "inline-block" }} />
          Aguardando valor
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#eff6ff", border: "1px solid #bfdbfe", display: "inline-block" }} />
          Faturamento
        </span>
      </div>

      {loading && (
        <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 32 }}>Carregando...</p>
      )}

      {!loading && !circularData && (
        <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 32 }}>
          Nenhum dado disponível. Clique em Atualizar.
        </p>
      )}

      {!loading && circularData && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "grid", gap: 12, padding: 16, border: "1px solid #e5e7eb", borderRadius: 8, background: "white" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "0.95rem" }}>Revisão fiscal mensal</h3>
                <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: "0.8rem" }}>Edite os valores vindos do SERPRO e regenere os lançamentos da Circular.</p>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  Competência
                  <input type="month" value={competencia || ""} onChange={(e) => onCompetenciaChange?.(e.target.value)} style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db" }} />
                </label>
                <button onClick={() => onLoad(year, competencia)} style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db", background: "white", cursor: "pointer" }}>Atualizar</button>
              </div>
            </div>

            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                Receita bruta
                <input value={draft.receitaBruta} onChange={(e) => updateDraft("receitaBruta", e.target.value)} placeholder="0,00" style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db" }} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                Receita serviços
                <input value={draft.receitaServicos} onChange={(e) => updateDraft("receitaServicos", e.target.value)} placeholder="0,00" style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db" }} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                Receita vendas
                <input value={draft.receitaVendas} onChange={(e) => updateDraft("receitaVendas", e.target.value)} placeholder="0,00" style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db" }} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                DAS total
                <input value={draft.dasTotal} onChange={(e) => updateDraft("dasTotal", e.target.value)} placeholder="0,00" style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db" }} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                INSS total
                <input value={draft.inssTotal} onChange={(e) => updateDraft("inssTotal", e.target.value)} placeholder="0,00" style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db" }} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                INSS vencimento
                <input type="date" value={draft.inssVencimento} onChange={(e) => updateDraft("inssVencimento", e.target.value)} style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db" }} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                INSS status
                <input value={draft.inssStatus} onChange={(e) => updateDraft("inssStatus", e.target.value)} placeholder="EMITTED" style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db" }} />
              </label>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={saveCircular} disabled={savingCircular} style={{ padding: "9px 14px", borderRadius: 6, border: "none", background: "#2563eb", color: "white", cursor: savingCircular ? "default" : "pointer", opacity: savingCircular ? 0.7 : 1 }}>
                {savingCircular ? "Salvando..." : "Salvar e regenerar"}
              </button>
              {circular?.hasAccountingDivergence && (
                <span style={{ color: "#b45309", fontSize: "0.8rem" }}>{circular.accountingDivergenceMessage || "Divergência registrada."}</span>
              )}
            </div>
          </div>

          <div style={{ display: "grid", gap: 10, padding: 16, border: "1px solid #e5e7eb", borderRadius: 8, background: "white" }}>
            <h3 style={{ margin: 0, fontSize: "0.95rem" }}>Lançamentos gerados</h3>
            {reviewEntries.length === 0 ? (
              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.85rem" }}>Nenhum lançamento gerado para esta competência.</p>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {reviewEntries.map((entry) => (
                  <div key={entry.id} style={{ display: "grid", gap: 6, padding: 12, border: "1px solid #e5e7eb", borderRadius: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <strong>{entry.eventType || entry.tipo}</strong>
                      <span>{entry.status || "RASCUNHO"}</span>
                    </div>
                    <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>{entry.historico}</div>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: "0.85rem" }}>
                      <span>D: {entry.lines?.[0]?.conta || "—"}</span>
                      <span>C: {entry.lines?.[1]?.conta || "—"}</span>
                      <span>Valor: {fmtMoney(entry.valor || entry.totalD) ? `R$ ${fmtMoney(entry.valor || entry.totalD)}` : "—"}</span>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        onClick={() => onApproveAccountingEntry?.(entry.id)}
                        disabled={approvingCircularEntryId === entry.id}
                        style={{ padding: "7px 12px", borderRadius: 6, border: "none", background: "#16a34a", color: "white", cursor: approvingCircularEntryId === entry.id ? "default" : "pointer", opacity: approvingCircularEntryId === entry.id ? 0.7 : 1 }}
                      >
                        {approvingCircularEntryId === entry.id ? "Aprovando..." : "Aprovar"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 6 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem", tableLayout: "auto" }}>
            <thead>
              <tr style={{ background: "#f3f4f6" }}>
                <th style={{
                  padding: "6px 10px", textAlign: "left", fontSize: "0.7rem", fontWeight: 700,
                  color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em",
                  borderRight: "2px solid #d1d5db", borderBottom: "2px solid #d1d5db",
                  position: "sticky", left: 0, background: "#f3f4f6", zIndex: 10,
                  minWidth: 160,
                }}>
                  Obrigação
                </th>
                {MONTH_LABELS.map((m, i) => (
                  <th key={i} style={{
                    padding: "6px 4px", textAlign: "center", fontSize: "0.7rem", fontWeight: 700,
                    color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em",
                    borderRight: "1px solid #e5e7eb", borderBottom: "2px solid #d1d5db",
                    minWidth: 80,
                  }}>
                    {m}/{String(year).slice(2)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={13} style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontStyle: "italic" }}>
                    Nenhuma provisão registrada para {year}. Crie lançamentos do tipo Provisão na aba Lançamentos.
                  </td>
                </tr>
              )}
              {visibleRows.map((row) => (
                <tr key={row.key}>
                  <td style={{
                    padding: "6px 10px", fontWeight: 600, fontSize: "0.8125rem",
                    borderRight: "2px solid #d1d5db", borderBottom: "1px solid #e5e7eb",
                    position: "sticky", left: 0, background: "white", zIndex: 5,
                    whiteSpace: "nowrap",
                  }}>
                    {row.label}
                  </td>
                  {monthKeys.map((comp) => (
                    <PagamentoCell
                      key={comp}
                      entry={matrix[`${row.key}__${comp}`]}
                      onBaixa={(entry) => setBaixaEntry(entry)}
                    />
                  ))}
                </tr>
              ))}

              {/* Linha de Total em Aberto */}
              <tr style={{ borderTop: "2px solid #d1d5db", background: "#fef2f2" }}>
                <td style={{
                  padding: "6px 10px", fontWeight: 700, fontSize: "0.8125rem",
                  borderRight: "2px solid #d1d5db",
                  position: "sticky", left: 0, background: "#fef2f2", zIndex: 5,
                  whiteSpace: "nowrap", color: "#dc2626",
                }}>
                  Total em Aberto
                </td>
                {monthKeys.map((comp) => {
                  const total = abertoByMonth[comp];
                  return (
                    <td key={comp} style={{ padding: "6px 4px", textAlign: "center", borderRight: "1px solid #e5e7eb" }}>
                      {total ? (
                        <span style={{ fontWeight: 700, fontSize: "0.75rem", color: "#dc2626" }}>
                          R$ {fmtMoney(total)}
                        </span>
                      ) : (
                        <span style={{ color: "#d1d5db", fontSize: "0.75rem" }}>—</span>
                      )}
                    </td>
                  );
                })}
              </tr>

              {/* Linha de Faturamento */}
              <tr style={{ borderTop: "1px solid #e5e7eb" }}>
                <td style={{
                  padding: "6px 10px", fontWeight: 600, fontSize: "0.8125rem",
                  borderRight: "2px solid #d1d5db",
                  position: "sticky", left: 0, background: "#eff6ff", zIndex: 5,
                  whiteSpace: "nowrap",
                }}>
                  Faturamento
                </td>
                {monthKeys.map((comp) => (
                  <FaturamentoCell key={comp} valor={circularData.receitas?.[comp]} />
                ))}
              </tr>
            </tbody>
          </table>
          </div>
        </div>
      )}

      {baixaEntry && (
        <BaixaModal
          entry={baixaEntry}
          accounts={accounts}
          saving={savingBaixa}
          onSave={async (input) => {
            await onCreateBaixa(baixaEntry.id, input);
            setBaixaEntry(null);
          }}
          onClose={() => setBaixaEntry(null)}
        />
      )}
    </div>
  );
}

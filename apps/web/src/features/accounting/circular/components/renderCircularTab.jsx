import { useEffect, useState, useMemo } from "react";
import { BaixaModal } from "../../baixa/components/renderBaixaModal";
import { SmartHistoricoInput, LineEditor, hasDuplicateAccountAcrossSides } from "../../entries/components/renderAccountingEntriesParts";
import { ACCOUNTING_PANEL, PANEL_FIELD_STYLE, SUBTIPO_OPTIONS } from "../../entries/lib/accountingEntriesShared";

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

const TIPO_LABELS = { DESPESA: "Despesa", RECEITA: "Receita", FOLHA: "Folha", PROVISAO: "Provisão", BAIXA: "Baixa", OUTRO: "Outro" };

function fmtMoney(val) {
  const n = Number(val);
  if (!n) return null;
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(value) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

// ─── Entry Edit Modal ────────────────────────────────────────────────────────

function CircularEntryEditModal({ entry, accounts, saving, onSave, onClose, onSearchHistoricos }) {
  const [form, setForm] = useState({
    data: entry.data ? String(entry.data).slice(0, 10) : "",
    historico: entry.historico || "",
    tipo: entry.tipo || "PROVISAO",
    subtipo: entry.subtipo || "",
    lines: (entry.lines || []).map((l) => ({
      tipo: l.tipo,
      conta: l.conta || "",
      valor: String(Number(l.valor || 0).toFixed(2)),
    })),
  });

  const isDuplicate = hasDuplicateAccountAcrossSides(form.lines);
  const subtipoLabel = SUBTIPO_ROWS.find((r) => r.key === entry.subtipo)?.label || entry.subtipo || "Lançamento";

  async function handleSave() {
    if (isDuplicate) return;
    await onSave(form);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: ACCOUNTING_PANEL.surface, border: `1px solid ${ACCOUNTING_PANEL.border}`, borderRadius: 10, padding: 20, width: "100%", maxWidth: 540, maxHeight: "90vh", overflowY: "auto" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontWeight: 700, color: ACCOUNTING_PANEL.text, fontSize: "0.9375rem" }}>
            Editar: {subtipoLabel}
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: ACCOUNTING_PANEL.muted, cursor: "pointer", fontSize: "1.4rem", lineHeight: 1, padding: "0 4px" }}>×</button>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          {/* Data */}
          <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: ACCOUNTING_PANEL.muted }}>
            Data
            <input
              type="date"
              value={form.data}
              onChange={(e) => setForm((p) => ({ ...p, data: e.target.value }))}
              style={{ ...PANEL_FIELD_STYLE, colorScheme: "dark", height: 34, padding: "0 10px" }}
            />
          </label>

          {/* Histórico */}
          <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: ACCOUNTING_PANEL.muted }}>
            Histórico
            <SmartHistoricoInput
              value={form.historico}
              onChange={(v) => setForm((p) => ({ ...p, historico: v }))}
              onFillFromHistory={(h, ls) =>
                setForm((p) => ({
                  ...p,
                  historico: h,
                  lines: ls?.length
                    ? ls.map((l) => ({ tipo: l.tipo, conta: l.conta || "", valor: l.valor ? String(l.valor) : "" }))
                    : p.lines,
                }))
              }
              onSearchHistoricos={onSearchHistoricos}
              accounts={accounts}
            />
          </label>

          {/* Tipo + Subtipo */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: ACCOUNTING_PANEL.muted }}>
              Tipo
              <select
                value={form.tipo}
                onChange={(e) =>
                  setForm((p) => ({ ...p, tipo: e.target.value, subtipo: e.target.value !== "PROVISAO" ? "" : p.subtipo }))
                }
                style={{ ...PANEL_FIELD_STYLE, height: 34, padding: "0 8px", colorScheme: "dark" }}
              >
                {Object.entries(TIPO_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
            {form.tipo === "PROVISAO" && (
              <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: ACCOUNTING_PANEL.muted }}>
                Subtipo
                <select
                  value={form.subtipo || ""}
                  onChange={(e) => setForm((p) => ({ ...p, subtipo: e.target.value }))}
                  style={{ ...PANEL_FIELD_STYLE, height: 34, padding: "0 8px", colorScheme: "dark" }}
                >
                  <option value="">—</option>
                  {SUBTIPO_OPTIONS.map(({ key, label }) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {/* Linhas */}
          <div>
            <div style={{ fontSize: "0.75rem", color: ACCOUNTING_PANEL.muted, marginBottom: 4 }}>Linhas (D/C)</div>
            <LineEditor
              lines={form.lines}
              onChange={(ls) => setForm((p) => ({ ...p, lines: ls }))}
              accounts={accounts}
            />
          </div>

          {isDuplicate && (
            <div style={{ color: "#FF4757", fontSize: "0.8125rem", fontWeight: 600 }}>
              Débito e crédito não podem usar a mesma conta.
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              onClick={onClose}
              style={{ ...PANEL_FIELD_STYLE, height: 34, padding: "0 16px", cursor: "pointer", borderRadius: 4 }}
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving || isDuplicate}
              style={{
                height: 34, padding: "0 20px",
                background: "#69FF47", color: "#1A1B26",
                border: "none", borderRadius: 4,
                fontWeight: 700, fontSize: "0.875rem",
                cursor: saving || isDuplicate ? "default" : "pointer",
                opacity: saving || isDuplicate ? 0.6 : 1,
              }}
            >
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── PagamentoCell ───────────────────────────────────────────────────────────

function PagamentoCell({ entry, onBaixa, onEdit, onCancelBaixa, cancellingBaixaId }) {
  const [confirmCancel, setConfirmCancel] = useState(false);

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

  // Placeholder (TEMPLATE sem valor)
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
        {onEdit && (
          <button
            onClick={() => onEdit(entry)}
            style={{
              marginTop: 3, fontSize: "0.6rem", fontWeight: 700, cursor: "pointer",
              background: "#92400e", color: "white", border: "none",
              borderRadius: 3, padding: "2px 6px",
            }}
          >
            ✎ Editar
          </button>
        )}
      </td>
    );
  }

  const isAberto = entry.statusPagamento === "ABERTO";
  const bg          = isAberto ? "#fef2f2" : "#f0fdf4";
  const badgeBg     = isAberto ? "#fee2e2" : "#dcfce7";
  const badgeColor  = isAberto ? "#dc2626" : "#16a34a";
  const badgeBorder = isAberto ? "#fca5a5" : "#86efac";
  const badgeLabel  = isAberto ? "ABERTO" : "PAGO";
  const baixaId     = !isAberto ? (entry.baixas?.[0]?.id ?? null) : null;
  const isCancelling = cancellingBaixaId === baixaId;
  const isSynthetic = entry.synthetic === true;

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
      {entry.recalculatedAt && entry.recalculatedToValor != null && (
        <div
          style={{ fontSize: "0.6rem", fontWeight: 700, color: "#92400e", whiteSpace: "nowrap", marginTop: 1 }}
          title={`Guia recalculada em ${fmtDate(entry.recalculatedAt)}. Valor original do lançamento: R$ ${fmtMoney(entry.recalculatedFromValor)}. Valor atualizado: R$ ${fmtMoney(entry.recalculatedToValor)}.`}
        >
          ↻ R$ {fmtMoney(entry.recalculatedToValor)}
        </div>
      )}
      {isSynthetic && (
        <div style={{ fontSize: "0.55rem", color: "#6b7280", marginTop: 3, fontStyle: "italic" }}>
          via guia SERPRO
        </div>
      )}
      <div style={{ display: "flex", gap: 2, justifyContent: "center", flexWrap: "wrap", marginTop: 3 }}>
        {onEdit && !isSynthetic && (
          <button
            onClick={() => onEdit(entry)}
            style={{
              fontSize: "0.6rem", fontWeight: 700, cursor: "pointer",
              background: "#6272A4", color: "white", border: "none",
              borderRadius: 3, padding: "2px 5px",
            }}
          >
            ✎
          </button>
        )}
        {isAberto && onBaixa && !isSynthetic && (
          <button
            onClick={() => onBaixa(entry)}
            style={{
              fontSize: "0.6rem", fontWeight: 700, cursor: "pointer",
              background: "#dc2626", color: "white", border: "none",
              borderRadius: 3, padding: "2px 5px", whiteSpace: "nowrap",
            }}
          >
            Baixar
          </button>
        )}
        {!isAberto && baixaId && onCancelBaixa && !isSynthetic && (
          confirmCancel ? (
            <div style={{ display: "flex", gap: 2, flexWrap: "wrap", justifyContent: "center" }}>
              <button
                onClick={() => { setConfirmCancel(false); onCancelBaixa(baixaId); }}
                disabled={isCancelling}
                style={{ fontSize: "0.55rem", fontWeight: 800, cursor: "pointer", background: "#dc2626", color: "white", border: "none", borderRadius: 3, padding: "2px 5px" }}
              >
                {isCancelling ? "..." : "Sim"}
              </button>
              <button
                onClick={() => setConfirmCancel(false)}
                style={{ fontSize: "0.55rem", fontWeight: 700, cursor: "pointer", background: "#44475A", color: "white", border: "none", borderRadius: 3, padding: "2px 5px" }}
              >
                Não
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmCancel(true)}
              style={{
                fontSize: "0.55rem", fontWeight: 700, cursor: "pointer",
                background: "#44475A", color: "#d1d5db", border: "none",
                borderRadius: 3, padding: "2px 5px", whiteSpace: "nowrap",
              }}
            >
              Cancelar
            </button>
          )
        )}
      </div>
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

// ─── Operational Block ───────────────────────────────────────────────────────

const ACTION_LABELS = {
  search_guides: "Buscar Guias",
  check_payments: "Verificar Pagtos",
  sync_inss: "Sincronizar INSS",
};

const STATUS_STYLES = {
  completed: { bg: "#ecfdf5", border: "#a7f3d0", color: "#065f46", badge: "#dcfce7", badgeBorder: "#86efac", label: "Concluído" },
  skipped:   { bg: "#fffbeb", border: "#fcd34d", color: "#92400e", badge: "#fef3c7", badgeBorder: "#fcd34d", label: "Ignorado" },
  failed:    { bg: "#fef2f2", border: "#fecaca", color: "#991b1b", badge: "#fee2e2", badgeBorder: "#fca5a5", label: "Falhou" },
  running:   { bg: "#eff6ff", border: "#bfdbfe", color: "#1d4ed8", badge: "#dbeafe", badgeBorder: "#93c5fd", label: "Em execução" },
};

function fmtDatetime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function buildExecutionSummary(entry) {
  if (entry.action === "search_guides") {
    const parts = [];
    if (entry.guidesFound != null) parts.push(`${entry.guidesFound} encontradas`);
    if (entry.guidesCaptured != null) parts.push(`${entry.guidesCaptured} capturadas`);
    if (entry.entriesGenerated != null && entry.entriesGenerated > 0) parts.push(`${entry.entriesGenerated} lançamentos`);
    return parts.join(" · ") || null;
  }
  if (entry.action === "check_payments") {
    if (entry.guidesChecked == null) return null;
    return `${entry.guidesChecked} verificadas · ${entry.guidesPaid ?? 0} pagas · ${entry.guidesOverdue ?? 0} vencidas · ${entry.guidesOpen ?? 0} abertas`;
  }
  if (entry.action === "sync_inss") {
    const parts = [];
    if (entry.guidesFound != null) parts.push(`${entry.guidesFound} encontradas`);
    if (entry.guidesCaptured != null) parts.push(`${entry.guidesCaptured} capturadas`);
    return parts.join(" · ") || null;
  }
  return null;
}

// Notificações temporárias: somem após 30s e mostram no máximo 5
const TOAST_TTL_MS = 30_000;
const TOAST_MAX = 5;

function ExecutionHistoryPanel({ executions, loadingExecutions }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Mostra apenas execuções dos últimos 30s, máximo 5 (mais recentes primeiro)
  const visible = useMemo(() => {
    if (!Array.isArray(executions)) return [];
    const cutoff = now - TOAST_TTL_MS;
    return executions
      .filter((e) => {
        const t = e?.startedAt ? new Date(e.startedAt).getTime() : 0;
        return Number.isFinite(t) && t >= cutoff;
      })
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, TOAST_MAX);
  }, [executions, now]);

  if (loadingExecutions) return null;
  if (visible.length === 0) return null;

  return (
    <div style={{ border: "1px solid #44475A", borderRadius: 6, background: "#1A1B26", marginBottom: 0, overflow: "hidden" }}>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid #44475A", background: "#1A1B26", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#F8F8F2" }}>Execuções recentes</span>
        <span style={{ fontSize: "0.7rem", color: "#6272A4" }}>somem após 30s · máx. 5</span>
      </div>
      <div style={{ display: "grid" }}>
        {visible.map((entry) => {
          const st = STATUS_STYLES[entry.status] || STATUS_STYLES.failed;
          const summary = buildExecutionSummary(entry);
          return (
            <div key={entry.id} style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr auto",
              gap: "6px 12px",
              alignItems: "start",
              padding: "10px 16px",
              borderBottom: "1px solid #2d2f4a",
              background: "#1A1B26",
            }}>
              <div style={{ paddingTop: 1 }}>
                <span style={{
                  display: "inline-block", fontSize: "0.6rem", fontWeight: 800,
                  letterSpacing: "0.04em", textTransform: "uppercase",
                  padding: "2px 6px", borderRadius: 999,
                  background: st.badge, color: st.color, border: `1px solid ${st.badgeBorder}`,
                  whiteSpace: "nowrap",
                }}>
                  {st.label}
                </span>
              </div>
              <div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#F8F8F2" }}>
                    {ACTION_LABELS[entry.action] || entry.action}
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "#6272A4" }}>{entry.competencia}</span>
                </div>
                {summary && (
                  <div style={{ fontSize: "0.75rem", color: "#6272A4", marginTop: 2 }}>{summary}</div>
                )}
                {entry.skipReason && (
                  <div style={{ fontSize: "0.75rem", color: "#92400e", marginTop: 2 }}>
                    Motivo: {entry.skipReason.replace(/_/g, " ")}
                  </div>
                )}
                {entry.errorMessage && (
                  <div style={{ fontSize: "0.75rem", color: "#991b1b", marginTop: 2 }}>
                    Erro: {entry.errorCode ? `[${entry.errorCode}] ` : ""}{entry.errorMessage}
                  </div>
                )}
              </div>
              <div style={{ fontSize: "0.7rem", color: "#6272A4", whiteSpace: "nowrap", textAlign: "right" }}>
                {fmtDatetime(entry.startedAt)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OperationalBlock({
  competencia,
  onCompetenciaChange,
  runningFiscalAction,
  lastFiscalResult,
  onSearchGuides,
  onCheckPayments,
  onSyncInss,
  executions,
  loadingExecutions,
}) {
  const actionInProgress = Boolean(runningFiscalAction);
  const rawLastResult = lastFiscalResult?.result || null;

  // Auto-esconder o card de "última ação" após 30s, mesma lógica do painel de execuções
  const [resultExpired, setResultExpired] = useState(false);
  useEffect(() => {
    if (!rawLastResult) { setResultExpired(false); return undefined; }
    setResultExpired(false);
    const id = setTimeout(() => setResultExpired(true), TOAST_TTL_MS);
    return () => clearTimeout(id);
  }, [rawLastResult]);
  const lastResult = resultExpired ? null : rawLastResult;

  const lastByAction = {};
  if (Array.isArray(executions)) {
    for (const e of executions) {
      if (!lastByAction[e.action]) lastByAction[e.action] = e;
    }
  }

  function actionButtonStyle(key) {
    const isActive = runningFiscalAction === key;
    const last = lastByAction[key];
    let borderColor = "#44475A";
    if (!actionInProgress && last) {
      borderColor = last.status === "completed" ? "#86efac"
        : last.status === "failed" ? "#fca5a5"
        : last.status === "skipped" ? "#fcd34d"
        : "#44475A";
    }
    return {
      fontSize: "0.8125rem",
      fontWeight: 600,
      padding: "6px 12px",
      background: isActive ? "#3b82f6" : "#1A1B26",
      color: isActive ? "white" : "#F8F8F2",
      border: `1px solid ${isActive ? "#3b82f6" : borderColor}`,
      borderRadius: 4,
      cursor: actionInProgress ? "default" : "pointer",
      opacity: actionInProgress && !isActive ? 0.5 : 1,
    };
  }

  return (
    <div style={{ background: "#24253A", border: "1px solid #44475A", borderRadius: 8, padding: "12px 16px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#F8F8F2" }}>
          Operações Fiscais
        </div>
        {onCompetenciaChange && (
          <input
            type="month"
            value={competencia || ""}
            onChange={(e) => onCompetenciaChange(e.target.value)}
            style={{ ...PANEL_FIELD_STYLE, height: 30, padding: "0 8px", width: "auto", colorScheme: "dark" }}
          />
        )}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <button onClick={() => onSearchGuides()} disabled={actionInProgress} style={actionButtonStyle("search_guides")}>
          {runningFiscalAction === "search_guides" ? "⏳ Buscando..." : "🔍 Buscar Guias"}
        </button>
        <button onClick={() => onCheckPayments()} disabled={actionInProgress} style={actionButtonStyle("check_payments")}>
          {runningFiscalAction === "check_payments" ? "⏳ Verificando..." : "✓ Verificar Pagtos"}
        </button>
        <button onClick={() => onSyncInss()} disabled={actionInProgress} style={actionButtonStyle("sync_inss")}>
          {runningFiscalAction === "sync_inss" ? "⏳ Sincronizando..." : "⚙ Sincronizar INSS"}
        </button>
      </div>
      <div style={{ fontSize: "0.7rem", color: "#6272A4", marginBottom: lastResult ? 10 : 0, fontStyle: "italic" }}>
        Use estes botões apenas como fallback manual quando o cron job do SERPRO não trouxer a guia automaticamente.
      </div>

      {lastResult && (
        <div style={{
          fontSize: "0.75rem",
          background: lastResult.status === "completed" ? "#ecfdf5" : lastResult.status === "skipped" ? "#fffbeb" : "#fef2f2",
          border: `1px solid ${lastResult.status === "completed" ? "#a7f3d0" : lastResult.status === "skipped" ? "#fcd34d" : "#fecaca"}`,
          borderRadius: 3,
          padding: "8px 10px",
          color: lastResult.status === "completed" ? "#065f46" : lastResult.status === "skipped" ? "#92400e" : "#991b1b",
          marginBottom: 10,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 3 }}>
            {ACTION_LABELS[lastResult.action] || lastResult.action} —{" "}
            {lastResult.status === "completed" ? "✓ Concluído" : lastResult.status === "skipped" ? "⚠ Ignorado" : "✗ Falhou"}
          </div>
          {lastResult.guidesFound != null && <div>Guias encontradas: {lastResult.guidesFound}</div>}
          {lastResult.guidesCaptured != null && <div>Capturadas: {lastResult.guidesCaptured}</div>}
          {lastResult.guidesChecked != null && (
            <div>Verificadas: {lastResult.guidesChecked} (Pagas: {lastResult.guidesPaid}, Vencidas: {lastResult.guidesOverdue}, Abertas: {lastResult.guidesOpen})</div>
          )}
          {lastResult.reason && <div>Motivo: {lastResult.reason.replace(/_/g, " ")}</div>}
        </div>
      )}

      <ExecutionHistoryPanel executions={executions} loadingExecutions={loadingExecutions} />
    </div>
  );
}

// ─── CircularTab ─────────────────────────────────────────────────────────────

export function CircularTab({
  circularData,
  loading,
  year,
  competencia,
  onCompetenciaChange,
  onYearChange,
  onLoad,
  accounts,
  onCreateBaixa,
  savingBaixa,
  onLoadBaixaTemplate,
  runningFiscalAction,
  lastFiscalResult,
  onSearchGuides,
  onCheckPayments,
  onSyncInss,
  executions,
  loadingExecutions,
  error,
  message,
  onUpdateEntry,
  onSearchHistoricos,
  onCancelBaixa,
}) {
  const [baixaEntry, setBaixaEntry] = useState(null);
  const [editEntry, setEditEntry] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [cancellingBaixaId, setCancellingBaixaId] = useState(null);
  const currentYear = new Date().getFullYear();

  const matrix = useMemo(() => {
    if (!circularData?.provisoes) return {};
    const map = {};
    for (const p of circularData.provisoes) {
      if (!p.subtipo) continue;
      const k = `${p.subtipo}__${p.competencia}`;
      const existing = map[k];
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

  async function handleEditSave(form) {
    if (!editEntry || !onUpdateEntry) return;
    setSavingEdit(true);
    try {
      await onUpdateEntry(editEntry.id, form);
      await onLoad(year, competencia);
      setEditEntry(null);
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleCancelBaixa(baixaId) {
    if (!onCancelBaixa) return;
    setCancellingBaixaId(baixaId);
    try {
      await onCancelBaixa(baixaId);
      await onLoad(year, competencia);
    } finally {
      setCancellingBaixaId(null);
    }
  }

  return (
    <div style={{ padding: "var(--space-3) var(--space-4)", width: "100%", background: "#1A1B26", minHeight: "100%" }}>
      {/* Cabeçalho */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "#F8F8F2" }}>Circular — Provisões e Pagamentos</h2>

        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          <button
            onClick={() => onYearChange(year - 1)}
            style={{
              background: "#24253A", border: "1px solid #44475A", borderRadius: 4, color: "#F8F8F2",
              width: 28, height: 28, cursor: "pointer", fontSize: "0.875rem",
            }}
          >
            ←
          </button>
          <span style={{ fontWeight: 700, fontSize: "1rem", minWidth: 48, textAlign: "center", color: "#F8F8F2" }}>{year}</span>
          <button
            onClick={() => onYearChange(year + 1)}
            disabled={year >= currentYear + 1}
            style={{
              background: "#24253A", border: "1px solid #44475A", borderRadius: 4, color: "#F8F8F2",
              width: 28, height: 28, cursor: year >= currentYear + 1 ? "default" : "pointer",
              fontSize: "0.875rem", opacity: year >= currentYear + 1 ? 0.4 : 1,
            }}
          >
            →
          </button>
          <button
            onClick={() => onLoad(year)}
            style={{
              background: "#24253A", border: "1px solid #44475A", borderRadius: 4, color: "#F8F8F2",
              height: 28, padding: "0 10px", cursor: "pointer", fontSize: "0.8125rem",
            }}
          >
            Atualizar
          </button>
        </div>
      </div>

      {/* Feedback */}
      {(error || message) && (
        <div style={{ marginBottom: 12, display: "grid", gap: 6 }}>
          {error && (
            <div style={{ padding: "10px 14px", borderRadius: 6, background: "#3d1515", border: "1px solid #7f1d1d", color: "#fca5a5", fontSize: "0.8125rem" }}>
              {error}
            </div>
          )}
          {message && (
            <div style={{ padding: "10px 14px", borderRadius: 6, background: "#0d2d1e", border: "1px solid #166534", color: "#86efac", fontSize: "0.8125rem" }}>
              {message}
            </div>
          )}
        </div>
      )}

      {/* Operational Block */}
      {onSearchGuides && onCheckPayments && onSyncInss && (
        <OperationalBlock
          competencia={competencia}
          onCompetenciaChange={onCompetenciaChange}
          runningFiscalAction={runningFiscalAction}
          lastFiscalResult={lastFiscalResult}
          onSearchGuides={onSearchGuides}
          onCheckPayments={onCheckPayments}
          onSyncInss={onSyncInss}
          executions={executions}
          loadingExecutions={loadingExecutions}
        />
      )}

      {/* Legenda */}
      <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: "0.75rem", color: "#6272A4", flexWrap: "wrap" }}>
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
        <p style={{ color: "#6272A4", textAlign: "center", padding: 32 }}>Carregando...</p>
      )}

      {!loading && !circularData && (
        <p style={{ color: "#6272A4", textAlign: "center", padding: 32 }}>
          Nenhum dado disponível. Clique em Atualizar.
        </p>
      )}

      {!loading && circularData && (
        <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 6, background: "white" }}>
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
                      onEdit={onUpdateEntry ? (entry) => setEditEntry(entry) : null}
                      onCancelBaixa={onCancelBaixa ? handleCancelBaixa : null}
                      cancellingBaixaId={cancellingBaixaId}
                    />
                  ))}
                </tr>
              ))}

              {/* Total em Aberto */}
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

              {/* Faturamento */}
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
      )}

      {/* Baixa Modal */}
      {baixaEntry && (
        <BaixaModal
          entry={baixaEntry}
          accounts={accounts}
          saving={savingBaixa}
          onSave={async (input) => {
            await onCreateBaixa(baixaEntry.id, input);
            await onLoad(year, competencia);
            setBaixaEntry(null);
          }}
          onClose={() => setBaixaEntry(null)}
          onLoadBaixaTemplate={onLoadBaixaTemplate}
        />
      )}

      {/* Entry Edit Modal */}
      {editEntry && (
        <CircularEntryEditModal
          entry={editEntry}
          accounts={accounts || []}
          saving={savingEdit}
          onSave={handleEditSave}
          onClose={() => setEditEntry(null)}
          onSearchHistoricos={onSearchHistoricos}
        />
      )}
    </div>
  );
}

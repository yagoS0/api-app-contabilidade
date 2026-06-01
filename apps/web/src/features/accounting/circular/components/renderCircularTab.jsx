import { useEffect, useState, useMemo } from "react";
import { BaixaModal } from "../../baixa/components/renderBaixaModal";
import { SmartHistoricoInput, LineEditor, hasDuplicateAccountAcrossSides } from "../../entries/components/renderAccountingEntriesParts";
import { ParcelamentosList, ParcelaPaymentModal } from "../../parcelamento/components/ParcelamentoModals";
import { ACCOUNTING_PANEL, PANEL_FIELD_STYLE, SUBTIPO_OPTIONS } from "../../entries/lib/accountingEntriesShared";

// Subtipos universais + flag de regimes que os exibem.
// "all" = qualquer regime; array = só esses regimes.
// Simples NÃO tem IRPJ/CSLL/PIS_COFINS/ISS (esses são exclusivos de Presumido/Real).
// Presumido/Real NÃO tem DAS (esse é exclusivo de Simples).
const SUBTIPO_ROWS_ALL = [
  { key: "DAS",             label: "DAS / Simples Nacional",        regimes: ["SIMPLES"] },
  // PARC_DAS — parcelamento Simples Nacional. Aparece logo abaixo de DAS por proximidade temática.
  // Só faz sentido para empresas regime SIMPLES (que pagam DAS via Simples Nacional).
  { key: "PARC_DAS",        label: "Parc. Simples Nacional",        regimes: ["SIMPLES"] },
  { key: "IRPJ",            label: "IRPJ",                          regimes: ["LUCRO_PRESUMIDO", "LUCRO_REAL"] },
  { key: "CSLL",            label: "CSLL",                          regimes: ["LUCRO_PRESUMIDO", "LUCRO_REAL"] },
  { key: "PIS_COFINS",      label: "PIS/COFINS",                    regimes: ["LUCRO_PRESUMIDO", "LUCRO_REAL"] },
  { key: "ISS",             label: "ISS",                           regimes: ["LUCRO_PRESUMIDO", "LUCRO_REAL"] },
  { key: "INSS",            label: "INSS / CPP",                    regimes: "all" },
  { key: "IRRF",            label: "IRRF",                          regimes: "all" },
  { key: "FGTS",            label: "FGTS",                          regimes: "all" },
  { key: "FERIAS",          label: "Férias",                        regimes: "all" },
  { key: "DECIMO_TERCEIRO", label: "13º Salário",                   regimes: "all" },
  { key: "OUTROS_TRIBUTOS", label: "Outros Tributos",               regimes: "all" },
];

function getSubtipoRowsForRegime(regime) {
  const r = String(regime || "").trim().toUpperCase();
  if (!r) return SUBTIPO_ROWS_ALL;  // sem regime conhecido → mostra tudo (fallback)
  return SUBTIPO_ROWS_ALL.filter(
    (row) => row.regimes === "all" || row.regimes.includes(r),
  );
}

// Mantido como fallback para código legado que ainda importava esta constante.
const SUBTIPO_ROWS = SUBTIPO_ROWS_ALL;

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
  const [saveError, setSaveError] = useState(null);

  const isDuplicate = hasDuplicateAccountAcrossSides(form.lines);
  const subtipoLabel = SUBTIPO_ROWS.find((r) => r.key === entry.subtipo)?.label || entry.subtipo || "Lançamento";

  // Detecta linhas com conta vazia — ajuda o contador a entender por que o save vai falhar.
  const linesWithEmptyConta = form.lines.filter((l) => !String(l.conta || "").trim()).length;
  const linesWithoutValor = form.lines.filter((l) => {
    const v = parseFloat(String(l.valor || "0").replace(",", "."));
    return !Number.isFinite(v) || v <= 0;
  }).length;

  async function handleSave() {
    if (isDuplicate) return;
    setSaveError(null);
    if (linesWithEmptyConta > 0) {
      setSaveError(`Há ${linesWithEmptyConta} linha(s) sem código de conta. Preencha as contas antes de salvar.`);
      return;
    }
    if (linesWithoutValor > 0) {
      setSaveError(`Há ${linesWithoutValor} linha(s) sem valor (ou com valor ≤ 0).`);
      return;
    }
    try {
      // passa também o eventType (pra backend memorizar D/C no AccountingHistorico)
      await onSave({ ...form, eventType: entry.eventType || null });
    } catch (err) {
      setSaveError(err?.message || "Falha ao salvar lançamento.");
    }
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
          {saveError && (
            <div style={{
              color: "#FF4757", fontSize: "0.8125rem", fontWeight: 600,
              padding: "8px 10px", borderRadius: 6,
              background: "rgba(255, 71, 87, 0.12)", border: "1px solid #FF4757",
            }}>
              {saveError}
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
        color: "#44475A", borderRight: "1px solid #44475A",
      }}>
        —
      </td>
    );
  }

  // Placeholder (TEMPLATE sem valor)
  if (entry.placeholder || entry.origem === "TEMPLATE") {
    return (
      <td style={{ background: "rgba(255, 179, 71, 0.10)", padding: "5px 4px", textAlign: "center", borderRight: "1px solid #44475A", minWidth: 80 }}>
        <span style={{
          display: "inline-block", fontSize: "0.55rem", fontWeight: 800, letterSpacing: "0.04em",
          textTransform: "uppercase", padding: "1px 5px", borderRadius: 999,
          background: "rgba(255, 179, 71, 0.20)", color: "#FFB347", border: "1px solid #FFB347",
        }}>
          PREENCHER
        </span>
        <div style={{ fontSize: "0.65rem", color: "#FFB347", marginTop: 2 }}>sem valor</div>
        {onEdit && (
          <button
            onClick={() => onEdit(entry)}
            style={{
              marginTop: 3, fontSize: "0.6rem", fontWeight: 700, cursor: "pointer",
              background: "#FFB347", color: "#1A1B26", border: "none",
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
  const bg          = isAberto ? "rgba(255, 71, 87, 0.10)" : "rgba(105, 255, 71, 0.08)";
  const badgeBg     = isAberto ? "rgba(255, 71, 87, 0.20)" : "rgba(105, 255, 71, 0.20)";
  const badgeColor  = isAberto ? "#FF4757" : "#69FF47";
  const badgeBorder = isAberto ? "#FF4757" : "#69FF47";
  const badgeLabel  = isAberto ? "ABERTO" : "PAGO";
  const baixaId     = !isAberto ? (entry.baixas?.[0]?.id ?? null) : null;
  const isCancelling = cancellingBaixaId === baixaId;
  const isSynthetic = entry.synthetic === true;

  return (
    <td style={{ background: bg, padding: "5px 4px", textAlign: "center", borderRight: "1px solid #44475A", minWidth: 80, color: "#F8F8F2" }}>
      <span style={{
        display: "inline-block", fontSize: "0.55rem", fontWeight: 800, letterSpacing: "0.04em",
        textTransform: "uppercase", padding: "1px 5px", borderRadius: 999,
        background: badgeBg, color: badgeColor, border: `1px solid ${badgeBorder}`,
      }}>
        {badgeLabel}
      </span>
      <div style={{ fontSize: "0.7rem", fontWeight: 700, marginTop: 2, whiteSpace: "nowrap", color: "#F8F8F2" }}>
        {fmtMoney(entry.valor || entry.totalD) ? `R$ ${fmtMoney(entry.valor || entry.totalD)}` : "—"}
      </div>
      {entry.recalculatedAt && entry.recalculatedToValor != null && (
        <div
          style={{ fontSize: "0.6rem", fontWeight: 700, color: "#FFB347", whiteSpace: "nowrap", marginTop: 1 }}
          title={`Guia recalculada em ${fmtDate(entry.recalculatedAt)}. Valor original do lançamento: R$ ${fmtMoney(entry.recalculatedFromValor)}. Valor atualizado: R$ ${fmtMoney(entry.recalculatedToValor)}.`}
        >
          ↻ R$ {fmtMoney(entry.recalculatedToValor)}
        </div>
      )}
      {isSynthetic && (
        <div style={{ fontSize: "0.55rem", color: "#aeb6d3", marginTop: 3, fontStyle: "italic" }}>
          via guia SERPRO
        </div>
      )}
      <div style={{ display: "flex", gap: 2, justifyContent: "center", flexWrap: "wrap", marginTop: 3 }}>
        {onEdit && !isSynthetic && (
          <button
            onClick={() => onEdit(entry)}
            style={{
              fontSize: "0.6rem", fontWeight: 700, cursor: "pointer",
              background: "#BD93F9", color: "#1A1B26", border: "none",
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
              background: "#FF4757", color: "white", border: "none",
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
                style={{ fontSize: "0.55rem", fontWeight: 800, cursor: "pointer", background: "#FF4757", color: "white", border: "none", borderRadius: 3, padding: "2px 5px" }}
              >
                {isCancelling ? "..." : "Sim"}
              </button>
              <button
                onClick={() => setConfirmCancel(false)}
                style={{ fontSize: "0.55rem", fontWeight: 700, cursor: "pointer", background: "#44475A", color: "#F8F8F2", border: "none", borderRadius: 3, padding: "2px 5px" }}
              >
                Não
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmCancel(true)}
              style={{
                fontSize: "0.55rem", fontWeight: 700, cursor: "pointer",
                background: "#44475A", color: "#aeb6d3", border: "none",
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
    <td style={{ padding: "6px 4px", textAlign: "center", fontSize: "0.75rem", borderRight: "1px solid #44475A" }}>
      {valor ? (
        <span style={{ fontWeight: 700, color: "#8BE9FD" }}>R$ {fmtMoney(valor)}</span>
      ) : (
        <span style={{ color: "#44475A" }}>—</span>
      )}
    </td>
  );
}

// Q7.2: painel "Operações Fiscais" foi removido — as ações (Buscar Guias, Verificar Pagtos,
// Sincronizar INSS) ficam nas abas Guias / Configurações. Circular foca só na tabela.

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
  companyRegime,  // regime tributário da empresa: filtra linhas exibidas (DAS só Simples; IRPJ/CSLL/PIS_COFINS/ISS só Presumido)
  onCreateBaixa,
  savingBaixa,
  onLoadBaixaTemplate,
  error,
  message,
  onUpdateEntry,
  onSearchHistoricos,
  onCancelBaixa,
  parcelamentos, // Q9: hook completo (parcelamentos, payParcela, rescindir, etc)
}) {
  const [baixaEntry, setBaixaEntry] = useState(null);
  const [editEntry, setEditEntry] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [cancellingBaixaId, setCancellingBaixaId] = useState(null);
  // Q9: state pro modal de pagamento de parcela
  const [payingParcela, setPayingParcela] = useState(null); // { parcelamento, parcela }
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

  // Linhas da matriz são filtradas em 2 passos:
  // 1) Por regime tributário da empresa (Simples não tem IRPJ/CSLL/etc; Presumido não tem DAS)
  // 2) Apenas linhas que tenham pelo menos 1 entrada com dados (estética — esconde linhas vazias)
  const visibleRows = useMemo(() => {
    const byRegime = getSubtipoRowsForRegime(companyRegime);
    if (!circularData?.provisoes) return byRegime;
    const usedSubtipos = new Set(circularData.provisoes.map((p) => p.subtipo).filter(Boolean));
    return byRegime.filter((r) => usedSubtipos.has(r.key));
  }, [circularData, companyRegime]);

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
      // Propaga exceção para o modal exibir o erro inline.
      // handleUpdateEntry no hook engole erros via try/catch e seta entriesError —
      // por isso aqui validamos o retorno: se vier { ok: false, error } do backend, lança.
      const result = await onUpdateEntry(editEntry.id, form);
      if (result && result.ok === false) {
        throw new Error(result.error || result.message || "Falha ao salvar lançamento.");
      }
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

      {/* Operações Fiscais removidas: ações (Buscar Guias, Verificar Pagtos, Sincronizar INSS)
          ficam nas abas Guias/Configurações; Circular foca só na tabela. */}

      {/* Legenda — paleta dark consistente com o resto do app */}
      <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: "0.75rem", color: "#aeb6d3", flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "rgba(255, 71, 87, 0.20)", border: "1px solid #FF4757", display: "inline-block" }} />
          Em aberto
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "rgba(105, 255, 71, 0.20)", border: "1px solid #69FF47", display: "inline-block" }} />
          Pago
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "rgba(255, 179, 71, 0.20)", border: "1px solid #FFB347", display: "inline-block" }} />
          Aguardando valor
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "rgba(139, 233, 253, 0.20)", border: "1px solid #8BE9FD", display: "inline-block" }} />
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
        <div style={{ overflowX: "auto", border: "1px solid #44475A", borderRadius: 6, background: "#21222C" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem", tableLayout: "auto", color: "#F8F8F2" }}>
            <thead>
              <tr style={{ background: "#282A36" }}>
                <th style={{
                  padding: "6px 10px", textAlign: "left", fontSize: "0.7rem", fontWeight: 700,
                  color: "#aeb6d3", textTransform: "uppercase", letterSpacing: "0.05em",
                  borderRight: "2px solid #44475A", borderBottom: "2px solid #44475A",
                  position: "sticky", left: 0, background: "#282A36", zIndex: 10,
                  minWidth: 160,
                }}>
                  Obrigação
                </th>
                {MONTH_LABELS.map((m, i) => (
                  <th key={i} style={{
                    padding: "6px 4px", textAlign: "center", fontSize: "0.7rem", fontWeight: 700,
                    color: "#aeb6d3", textTransform: "uppercase", letterSpacing: "0.05em",
                    borderRight: "1px solid #44475A", borderBottom: "2px solid #44475A",
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
                  <td colSpan={13} style={{ padding: 24, textAlign: "center", color: "#aeb6d3", fontStyle: "italic" }}>
                    Nenhuma provisão registrada para {year}. Crie lançamentos do tipo Provisão na aba Lançamentos.
                  </td>
                </tr>
              )}
              {visibleRows.map((row) => (
                <tr key={row.key}>
                  <td style={{
                    padding: "6px 10px", fontWeight: 600, fontSize: "0.8125rem",
                    borderRight: "2px solid #44475A", borderBottom: "1px solid #44475A",
                    position: "sticky", left: 0, background: "#21222C", zIndex: 5,
                    whiteSpace: "nowrap", color: "#F8F8F2",
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
              <tr style={{ borderTop: "2px solid #44475A", background: "rgba(255, 71, 87, 0.10)" }}>
                <td style={{
                  padding: "6px 10px", fontWeight: 700, fontSize: "0.8125rem",
                  borderRight: "2px solid #44475A",
                  position: "sticky", left: 0, background: "rgba(255, 71, 87, 0.10)", zIndex: 5,
                  whiteSpace: "nowrap", color: "#FF4757",
                }}>
                  Total em Aberto
                </td>
                {monthKeys.map((comp) => {
                  const total = abertoByMonth[comp];
                  return (
                    <td key={comp} style={{ padding: "6px 4px", textAlign: "center", borderRight: "1px solid #44475A" }}>
                      {total ? (
                        <span style={{ fontWeight: 700, fontSize: "0.75rem", color: "#FF4757" }}>
                          R$ {fmtMoney(total)}
                        </span>
                      ) : (
                        <span style={{ color: "#44475A", fontSize: "0.75rem" }}>—</span>
                      )}
                    </td>
                  );
                })}
              </tr>

              {/* Faturamento */}
              <tr style={{ borderTop: "1px solid #44475A" }}>
                <td style={{
                  padding: "6px 10px", fontWeight: 600, fontSize: "0.8125rem",
                  borderRight: "2px solid #44475A",
                  position: "sticky", left: 0, background: "rgba(139, 233, 253, 0.10)", zIndex: 5,
                  whiteSpace: "nowrap", color: "#8BE9FD",
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

      {/* Q9: lista de parcelamentos (Simples, INSS, etc) — embaixo da matriz */}
      {parcelamentos && (
        <div style={{ marginTop: 20 }}>
          <ParcelamentosList
            parcelamentos={parcelamentos.parcelamentos}
            loading={parcelamentos.loading}
            onPayParcela={(parc, parcela) => setPayingParcela({ parcelamento: parc, parcela })}
            onRescindir={async (parcId) => {
              try { await parcelamentos.rescindir(parcId); } catch {}
            }}
          />
        </div>
      )}

      {/* Q9: modal de pagamento de parcela */}
      {payingParcela && parcelamentos && (
        <ParcelaPaymentModal
          parcelamento={payingParcela.parcelamento}
          parcela={payingParcela.parcela}
          saving={parcelamentos.saving}
          onConfirm={async ({ jurosValor, dataPagamento }) => {
            await parcelamentos.payParcela(
              payingParcela.parcelamento.id,
              payingParcela.parcela.numeroParcela,
              { jurosValor, dataPagamento }
            );
            setPayingParcela(null);
            await onLoad(year, competencia);
          }}
          onClose={() => setPayingParcela(null)}
        />
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

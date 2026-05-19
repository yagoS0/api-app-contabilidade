import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { fmtMoney } from "../../entries/lib/accountingEntriesShared";
import { SmartHistoricoInput, AccountCodeInput } from "../../entries/components/renderAccountingEntriesParts";

const PANEL = {
  surface: "#24253A",
  field: "#1A1B26",
  border: "#44475A",
  text: "#F8F8F2",
  muted: "#6272A4",
  accent: "#BD93F9",
  success: "#69FF47",
  warning: "#FFB347",
  danger: "#FF4757",
};

const overlay = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1100,
  display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
};

const modalBox = {
  background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10,
  padding: 22, width: 1280, maxWidth: "100%", maxHeight: "92vh", overflowY: "auto",
  color: PANEL.text, boxSizing: "border-box",
};

const inputStyle = {
  background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6,
  color: PANEL.text, padding: "6px 8px", fontSize: "0.85rem", width: "100%", boxSizing: "border-box",
};

const headStyle = {
  padding: "8px 6px", textAlign: "left", color: "#aeb6d3", fontSize: "0.75rem",
  fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
  borderBottom: `1px solid ${PANEL.border}`, background: PANEL.field,
};

function fmtDateBR(iso) {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/**
 * Modal de importação OFX — versão otimizada para digitação rápida.
 *
 * Fluxo:
 *  1. Upload: file picker .ofx/.qfx → onPreview(file)
 *  2. Review: tabela com Histórico/D/C editáveis por linha
 *     - Auto-propagação: editar uma linha propaga para todas as outras com
 *       mesma `descricaoOfx` que estavam vazias OU iguais ao valor antigo
 *     - SmartHistoricoInput: autocomplete de histórico + auto-fill de D/C
 *     - AccountCodeInput: dropdown próprio para D e C
 *     - Enter encadeado: Hist → D → C → próxima linha pendente
 *     - Esc fecha modal, Ctrl+Enter dispara import
 *     - Auto-focus na 1ª linha pendente ao entrar no review
 *  3. Commit: onImport(transactions) → cria entries + auto-save de histórico
 */
export function ImportOFXModal({
  accounts = [],
  onPreview,
  onImport,
  onSearchHistoricos,
  onGetHistoricosByCode,
  onClose,
}) {
  const [step, setStep] = useState("upload"); // "upload" | "review" | "done"
  const [file, setFile] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [bulkD, setBulkD] = useState("");
  const [bulkC, setBulkC] = useState("");
  const [bulkH, setBulkH] = useState("");
  const [filterMode, setFilterMode] = useState("all"); // "all" | "pending"

  // Matriz de refs por linha (rowIdx → { hist, d, c })
  const rowRefs = useRef([]);

  async function handlePreview() {
    if (!file) { setError("Selecione um arquivo OFX."); return; }
    setError("");
    setLoading(true);
    try {
      const res = await onPreview(file);
      const list = Array.isArray(res?.transactions) ? res.transactions : [];
      if (list.length === 0) {
        setError("Nenhuma transação encontrada no arquivo.");
        return;
      }
      const hydrated = list.map((t) => ({
        ...t,
        historico: t.match?.historicoSugerido || "",
        contaDebito: t.match?.contaDebito || "",
        contaCredito: t.match?.contaCredito || "",
        skip: false,
      }));
      setTransactions(hydrated);
      rowRefs.current = hydrated.map(() => ({}));
      setStep("review");
    } catch (err) {
      setError(err?.message || "Falha ao ler o arquivo OFX.");
    } finally {
      setLoading(false);
    }
  }

  // F1: auto-propagação por descricaoOfx idêntica.
  // Quando o usuário edita uma linha, propaga para as outras com mesma descrição
  // que ainda estavam vazias OU tinham o mesmo valor antigo (não sobrescreve override).
  function updateRow(idx, patch) {
    setTransactions((prev) => {
      const target = prev[idx];
      if (!target) return prev;
      const next = prev.map((r, i) => (i === idx ? { ...r, ...patch } : r));
      const key = target.descricaoOfx;
      if (!key) return next;
      const FIELDS = ["historico", "contaDebito", "contaCredito"];
      return next.map((r, i) => {
        if (i === idx) return r;
        if (r.descricaoOfx !== key || r.skip) return r;
        const updated = { ...r };
        let touched = false;
        for (const f of FIELDS) {
          if (patch[f] === undefined) continue;
          const wasEmpty = !r[f];
          const wasSameAsOld = r[f] === target[f];
          if (wasEmpty || wasSameAsOld) {
            updated[f] = patch[f];
            touched = true;
          }
        }
        return touched ? updated : r;
      });
    });
  }

  function applyBulkFill() {
    if (!bulkD && !bulkC && !bulkH) return;
    setTransactions((prev) => prev.map((r) => {
      const isComplete = r.contaDebito && r.contaCredito && r.historico;
      if (isComplete || r.skip) return r;
      return {
        ...r,
        contaDebito: r.contaDebito || bulkD,
        contaCredito: r.contaCredito || bulkC,
        historico: r.historico || bulkH,
      };
    }));
  }

  const totalRows = transactions.length;
  const matchedRows = transactions.filter((t) => t.match).length;
  const pendingRows = transactions.filter(
    (t) => !t.skip && (!t.historico || !t.contaDebito || !t.contaCredito),
  ).length;
  const completeRows = transactions.filter(
    (t) => t.contaDebito && t.contaCredito && t.historico && !t.skip,
  ).length;
  const skipRows = transactions.filter((t) => t.skip).length;
  const canCommit = completeRows > 0 && !saving;

  // F7: filtro "só pendentes" — preserva o array original e os índices reais
  const visibleTransactions = useMemo(() => {
    if (filterMode !== "pending") return transactions.map((t, i) => ({ t, originalIdx: i }));
    return transactions
      .map((t, i) => ({ t, originalIdx: i }))
      .filter(({ t }) => !t.skip && (!t.historico || !t.contaDebito || !t.contaCredito));
  }, [transactions, filterMode]);

  async function handleCommit() {
    setError("");
    const toSend = transactions
      .filter((t) => !t.skip && t.contaDebito && t.contaCredito && t.historico)
      .map((t) => ({
        rowIndex: t.rowIndex,
        data: t.data,
        descricaoOfx: t.descricaoOfx,
        historico: t.historico,
        valor: Number(t.valor),
        contaDebito: t.contaDebito,
        contaCredito: t.contaCredito,
        tipo: "DESPESA",
      }));
    if (toSend.length === 0) {
      setError("Nenhum lançamento pronto para importar.");
      return;
    }
    setSaving(true);
    try {
      const res = await onImport(toSend);
      if (res?.ok) {
        setResult(res);
        setStep("done");
      } else {
        setError(res?.message || "Falha ao importar.");
      }
    } catch (err) {
      setError(err?.message || "Falha ao importar.");
    } finally {
      setSaving(false);
    }
  }

  // Atalhos globais: APENAS Ctrl/Cmd+Enter para importar.
  // ESC intencionalmente NÃO fecha — fechamento deve ser explícito (botão ×, Cancelar
  // ou Voltar) para não perder digitação por acidente (autocomplete + ESC é caso comum
  // onde o usuário só quer fechar o dropdown, não o modal inteiro).
  useEffect(() => {
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        if (canCommit) {
          e.preventDefault();
          handleCommit();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCommit]);

  // F6: auto-focus na primeira linha pendente ao entrar no review
  useEffect(() => {
    if (step !== "review") return;
    const idx = transactions.findIndex((r) => !r.skip && !r.historico);
    if (idx >= 0) {
      requestAnimationFrame(() => rowRefs.current[idx]?.hist?.focus?.());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // F4: encadeamento Enter Hist → D → C → próxima linha pendente
  function handleCellKeyDown(e, rowIdx, field) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (field === "hist") rowRefs.current[rowIdx]?.d?.focus?.();
    else if (field === "d") rowRefs.current[rowIdx]?.c?.focus?.();
    else if (field === "c") {
      const next = transactions.findIndex(
        (r, i) => i > rowIdx && !r.skip && (!r.historico || !r.contaDebito || !r.contaCredito),
      );
      if (next >= 0) rowRefs.current[next]?.hist?.focus?.();
    }
  }

  return (
    <div style={overlay}>
      <div style={modalBox}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem" }}>Importar OFX</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: PANEL.muted, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        {step === "upload" && (
          <div>
            <p style={{ fontSize: "0.85rem", color: PANEL.muted, margin: "0 0 12px" }}>
              Selecione um arquivo de extrato bancário <strong>.OFX</strong> ou <strong>.QFX</strong>.
              O sistema casa cada descrição do banco com históricos já cadastrados para preencher
              automaticamente Histórico, Débito e Crédito. Descrições novas ficam pendentes para
              você declarar — e a partir dali ficam memorizadas para os próximos imports.
            </p>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="file"
                accept=".ofx,.qfx"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                style={{ ...inputStyle, padding: "8px 10px", flex: "1 1 320px" }}
              />
              <Button variant="primary" onClick={handlePreview} disabled={!file || loading}>
                {loading ? "Lendo..." : "Pré-visualizar"}
              </Button>
            </div>
            {error && (
              <div style={{ marginTop: 12, padding: 8, background: "rgba(255,87,87,0.15)", border: "1px solid #FF5757", borderRadius: 6, color: "#FF5757", fontSize: "0.8125rem" }}>
                {error}
              </div>
            )}
          </div>
        )}

        {step === "review" && (
          <div>
            <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: "0.85rem", flexWrap: "wrap", alignItems: "center" }}>
              <span><strong style={{ color: PANEL.success }}>{matchedRows}</strong> casadas</span>
              <span><strong style={{ color: PANEL.warning }}>{pendingRows}</strong> pendentes</span>
              <span><strong style={{ color: PANEL.accent }}>{completeRows}</strong> prontas</span>
              {skipRows > 0 && <span><strong style={{ color: PANEL.muted }}>{skipRows}</strong> ignoradas</span>}
              <span style={{ color: PANEL.muted }}>{totalRows} no total</span>

              {/* F7: filtro só-pendentes */}
              <div style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center", padding: 2, background: PANEL.field, borderRadius: 6 }}>
                <button
                  onClick={() => setFilterMode("all")}
                  style={{
                    padding: "4px 10px", border: "none", borderRadius: 4, cursor: "pointer",
                    fontSize: "0.75rem", fontWeight: 600,
                    background: filterMode === "all" ? PANEL.accent : "transparent",
                    color: filterMode === "all" ? "#1A1B26" : PANEL.muted,
                  }}
                >
                  Todas ({totalRows})
                </button>
                <button
                  onClick={() => setFilterMode("pending")}
                  style={{
                    padding: "4px 10px", border: "none", borderRadius: 4, cursor: "pointer",
                    fontSize: "0.75rem", fontWeight: 600,
                    background: filterMode === "pending" ? PANEL.warning : "transparent",
                    color: filterMode === "pending" ? "#1A1B26" : PANEL.muted,
                  }}
                  disabled={pendingRows === 0}
                >
                  Pendentes ({pendingRows})
                </button>
              </div>
            </div>

            {/* Hint de atalhos */}
            <div style={{ fontSize: "0.7rem", color: PANEL.muted, marginBottom: 8, fontStyle: "italic" }}>
              💡 <strong>Atalhos:</strong> ↑↓+Enter no Histórico para escolher sugestão (preserva o texto digitado, só preenche D/C) · Enter pula para próximo campo / próxima pendente · <kbd>Ctrl+Enter</kbd> importa
            </div>

            {/* overflow visible vertical para deixar dropdowns aparecerem; X scroll fica no modalBox */}
            <div style={{ borderRadius: 8, border: `1px solid ${PANEL.border}`, marginBottom: 12, overflow: "visible" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr>
                    <th style={{ ...headStyle, width: 90 }}>Data</th>
                    <th style={{ ...headStyle, width: 220 }}>Descrição (banco)</th>
                    <th style={{ ...headStyle, minWidth: 240 }}>Histórico (lançamento)</th>
                    <th style={{ ...headStyle, width: 110, textAlign: "right" }}>Valor (R$)</th>
                    <th style={{ ...headStyle, width: 105, textAlign: "center" }}>D</th>
                    <th style={{ ...headStyle, width: 105, textAlign: "center" }}>C</th>
                    <th style={{ ...headStyle, width: 110 }}>Status</th>
                    <th style={{ ...headStyle, width: 50, textAlign: "center" }}>Pular</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTransactions.map(({ t, originalIdx }) => {
                    const idx = originalIdx;
                    const ready = t.contaDebito && t.contaCredito && t.historico;
                    const matched = Boolean(t.match);
                    const bg = t.skip
                      ? "transparent"
                      : matched && ready
                        ? "rgba(105,255,71,0.05)"
                        : !matched && !ready
                          ? "rgba(255,179,71,0.05)"
                          : "transparent";
                    const sinalLabel = t.sinal === "DEBITO" ? "↓ Saída" : "↑ Entrada";
                    const sinalColor = t.sinal === "DEBITO" ? PANEL.danger : PANEL.success;
                    return (
                      <tr key={idx} style={{ background: bg, borderBottom: `1px solid ${PANEL.border}`, opacity: t.skip ? 0.4 : 1 }}>
                        <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>{fmtDateBR(t.data)}</td>
                        <td
                          style={{ padding: "5px 8px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          title={t.descricaoOfx}
                        >
                          {t.descricaoOfx || "—"}
                        </td>
                        {/* F2: SmartHistoricoInput por linha */}
                        <td style={{ padding: "5px 8px", verticalAlign: "top" }}>
                          {t.skip ? (
                            <input type="text" value={t.historico || ""} disabled style={{ ...inputStyle, color: PANEL.muted }} />
                          ) : (
                            <div onKeyDown={(e) => handleCellKeyDown(e, idx, "hist")}>
                              <SmartHistoricoInput
                                preserveTypedText
                                value={t.historico || ""}
                                onChange={(v) => updateRow(idx, { historico: v })}
                                onFillFromHistory={(text, lines) => {
                                  // Com `preserveTypedText`, `text` === o que o usuário digitou
                                  // (o componente não sobrescreve). Só aplicamos D/C.
                                  const d = lines?.find((l) => l.tipo === "D")?.conta;
                                  const c = lines?.find((l) => l.tipo === "C")?.conta;
                                  updateRow(idx, {
                                    historico: text,
                                    ...(d ? { contaDebito: d } : {}),
                                    ...(c ? { contaCredito: c } : {}),
                                  });
                                }}
                                onSearchHistoricos={onSearchHistoricos}
                                accounts={accounts}
                                inputRef={(el) => { rowRefs.current[idx] = { ...rowRefs.current[idx], hist: el }; }}
                                inputStyle={{ fontSize: "0.85rem", minHeight: 32, padding: "4px 8px", fontWeight: 400 }}
                              />
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "5px 8px", textAlign: "right", whiteSpace: "nowrap", verticalAlign: "top" }}>
                          {fmtMoney(t.valor)}
                          <div style={{ fontSize: "0.65rem", color: sinalColor, marginTop: 2 }}>{sinalLabel}</div>
                        </td>
                        {/* F3: AccountCodeInput em D e C */}
                        <td style={{ padding: "5px 8px", verticalAlign: "top" }}>
                          {t.skip ? (
                            <input type="text" value={t.contaDebito || ""} disabled style={{ ...inputStyle, textAlign: "center" }} />
                          ) : (
                            <AccountCodeInput
                              id={`ofx-d-${idx}`}
                              value={t.contaDebito || ""}
                              onChange={(v) => updateRow(idx, { contaDebito: v })}
                              onKeyDown={(e) => handleCellKeyDown(e, idx, "d")}
                              accounts={accounts}
                              onGetHistoricosByCode={onGetHistoricosByCode}
                              onSelectHistorico={(text, d, c) => updateRow(idx, {
                                historico: text || t.historico,
                                contaDebito: d || t.contaDebito,
                                contaCredito: c || t.contaCredito,
                              })}
                              placeholder="—"
                              inputRef={(el) => { rowRefs.current[idx] = { ...rowRefs.current[idx], d: el }; }}
                            />
                          )}
                        </td>
                        <td style={{ padding: "5px 8px", verticalAlign: "top" }}>
                          {t.skip ? (
                            <input type="text" value={t.contaCredito || ""} disabled style={{ ...inputStyle, textAlign: "center" }} />
                          ) : (
                            <AccountCodeInput
                              id={`ofx-c-${idx}`}
                              value={t.contaCredito || ""}
                              onChange={(v) => updateRow(idx, { contaCredito: v })}
                              onKeyDown={(e) => handleCellKeyDown(e, idx, "c")}
                              accounts={accounts}
                              onGetHistoricosByCode={onGetHistoricosByCode}
                              onSelectHistorico={(text, d, c) => updateRow(idx, {
                                historico: text || t.historico,
                                contaDebito: d || t.contaDebito,
                                contaCredito: c || t.contaCredito,
                              })}
                              placeholder="—"
                              inputRef={(el) => { rowRefs.current[idx] = { ...rowRefs.current[idx], c: el }; }}
                            />
                          )}
                        </td>
                        <td style={{ padding: "5px 8px", fontSize: "0.78rem", verticalAlign: "top" }}>
                          {t.skip ? <span style={{ color: PANEL.muted }}>—</span>
                            : matched ? (
                              <span style={{ color: PANEL.success }}>
                                ✓ {t.match.matchType === "exact" ? "Casou" : "Parcial"}
                              </span>
                            ) : ready ? (
                              <span style={{ color: PANEL.accent }}>✓ Pronto</span>
                            ) : (
                              <span style={{ color: PANEL.warning }}>⚠ Pendente</span>
                            )}
                        </td>
                        <td style={{ padding: "5px 8px", textAlign: "center", verticalAlign: "top" }}>
                          <input
                            type="checkbox"
                            checked={Boolean(t.skip)}
                            onChange={(e) => updateRow(idx, { skip: e.target.checked })}
                            style={{ width: 16, height: 16, cursor: "pointer", accentColor: PANEL.accent }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                  {visibleTransactions.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ padding: 24, textAlign: "center", color: PANEL.muted, fontSize: "0.85rem" }}>
                        Nenhuma linha pendente — todas estão completas ou ignoradas.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {pendingRows > 0 && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", padding: 10, background: PANEL.field, borderRadius: 6, marginBottom: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.78rem", color: PANEL.muted }}>Aplicar a todas pendentes:</span>
                <input
                  type="text"
                  value={bulkH}
                  onChange={(e) => setBulkH(e.target.value)}
                  placeholder="Histórico"
                  style={{ ...inputStyle, width: 200, color: bulkH ? PANEL.text : PANEL.muted }}
                />
                <input
                  type="text"
                  list="ofx-bulk-d"
                  value={bulkD}
                  onChange={(e) => setBulkD(e.target.value)}
                  placeholder="Débito"
                  style={{ ...inputStyle, width: 110, fontWeight: 700, color: bulkD ? "#8BE9FD" : PANEL.muted, textAlign: "center" }}
                />
                <input
                  type="text"
                  list="ofx-bulk-c"
                  value={bulkC}
                  onChange={(e) => setBulkC(e.target.value)}
                  placeholder="Crédito"
                  style={{ ...inputStyle, width: 110, fontWeight: 700, color: bulkC ? PANEL.success : PANEL.muted, textAlign: "center" }}
                />
                <datalist id="ofx-bulk-d">
                  {accounts.map((a) => <option key={a.codigo} value={a.codigo}>{a.codigo} — {a.nome}</option>)}
                </datalist>
                <datalist id="ofx-bulk-c">
                  {accounts.map((a) => <option key={a.codigo} value={a.codigo}>{a.codigo} — {a.nome}</option>)}
                </datalist>
                <Button variant="secondary" size="sm" onClick={applyBulkFill} disabled={!bulkD && !bulkC && !bulkH}>
                  Aplicar
                </Button>
              </div>
            )}

            {error && (
              <div style={{ marginBottom: 10, padding: 8, background: "rgba(255,87,87,0.15)", border: "1px solid #FF5757", borderRadius: 6, color: "#FF5757", fontSize: "0.8125rem" }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button variant="secondary" onClick={() => { setStep("upload"); setTransactions([]); rowRefs.current = []; setError(""); }}>Voltar</Button>
              <Button variant="secondary" onClick={onClose}>Cancelar</Button>
              <Button variant="primary" onClick={handleCommit} disabled={!canCommit} title="Ctrl+Enter">
                {saving ? "Importando..." : `Importar ${completeRows} ${completeRows === 1 ? "linha" : "linhas"}`}
              </Button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div style={{ display: "grid", gap: 12 }}>
            <p style={{ color: PANEL.success, fontSize: "0.9375rem", margin: 0 }}>
              ✓ {result?.created || 0} lançamento{result?.created !== 1 ? "s" : ""} importado{result?.created !== 1 ? "s" : ""} com sucesso.
              {result?.failed > 0 && (
                <> {" "}<span style={{ color: PANEL.warning }}>({result.failed} falha{result.failed !== 1 ? "s" : ""})</span></>
              )}
            </p>
            <p style={{ color: PANEL.muted, fontSize: "0.875rem", margin: 0 }}>
              Lote: <span style={{ color: PANEL.text, fontWeight: 700 }}>{result?.loteImportacao}</span>
            </p>
            <p style={{ color: PANEL.muted, fontSize: "0.8125rem", margin: 0 }}>
              Os históricos digitados foram memorizados — descrições iguais nos próximos OFX virão pré-preenchidas.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button variant="primary" onClick={onClose}>Fechar</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { fmtMoney } from "../../entries/lib/accountingEntriesShared";

const PANEL = {
  surface: "#24253A",
  field: "#1A1B26",
  border: "#44475A",
  text: "#F8F8F2",
  muted: "#6272A4",
  accent: "#BD93F9",
};

const overlay = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1100,
  display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
};
const modalBox = {
  background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10,
  padding: 22, width: 1100, maxWidth: "100%", maxHeight: "92vh", overflowY: "auto",
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

export function ImportExcelModal({ accounts = [], onPreview, onCommit, onClose }) {
  const [step, setStep] = useState("upload"); // "upload" | "review"
  const [file, setFile] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [bulkD, setBulkD] = useState("");
  const [bulkC, setBulkC] = useState("");

  async function handlePreview() {
    if (!file) { setError("Selecione um arquivo Excel."); return; }
    setError("");
    setLoading(true);
    try {
      const res = await onPreview(file);
      const list = Array.isArray(res?.transactions) ? res.transactions : [];
      if (list.length === 0) {
        setError("Nenhuma transação encontrada no arquivo.");
        return;
      }
      // Hidrata cada linha com contas a partir do match (se houver)
      const hydrated = list.map((t) => ({
        ...t,
        contaDebito: t.match?.contaDebito || "",
        contaCredito: t.match?.contaCredito || "",
        skip: false,
      }));
      setTransactions(hydrated);
      setStep("review");
    } catch (err) {
      setError(err?.message || "Falha ao processar Excel.");
    } finally {
      setLoading(false);
    }
  }

  function updateRow(idx, patch) {
    setTransactions((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function applyBulkFill() {
    if (!bulkD && !bulkC) return;
    setTransactions((prev) => prev.map((r) => {
      if (r.contaDebito && r.contaCredito) return r; // já preenchidas — não mexe
      return {
        ...r,
        contaDebito: r.contaDebito || bulkD,
        contaCredito: r.contaCredito || bulkC,
      };
    }));
  }

  const totalRows = transactions.length;
  const matchedRows = transactions.filter((t) => t.match).length;
  const pendingRows = transactions.filter((t) => !t.match).length;
  const completeRows = transactions.filter((t) => t.contaDebito && t.contaCredito && !t.skip).length;
  const skipRows = transactions.filter((t) => t.skip).length;
  const canCommit = completeRows > 0 && !saving;

  async function handleCommit() {
    setError("");
    const toSend = transactions
      .filter((t) => !t.skip && t.contaDebito && t.contaCredito)
      .map((t) => ({
        rowIndex: t.rowIndex,
        data: t.data,
        descricao: t.descricao,
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
      const res = await onCommit(toSend);
      if (res?.ok) {
        onClose();
      } else {
        setError(res?.message || "Falha ao importar.");
      }
    } catch (err) {
      setError(err?.message || "Falha ao importar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={modalBox}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem" }}>Importar Excel</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: PANEL.muted, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        {step === "upload" && (
          <div>
            <p style={{ fontSize: "0.85rem", color: PANEL.muted, margin: "0 0 12px" }}>
              Formato esperado: planilha com colunas <strong>Data | Descrição | Valor</strong> (cabeçalho opcional).
              O sistema casa as descrições com históricos já cadastrados para preencher automaticamente as contas. Descrições novas ficam pendentes para você declarar — e a partir dali ficam memorizadas para próximos imports.
            </p>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="file"
                accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
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
            <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: "0.85rem", flexWrap: "wrap" }}>
              <span><strong style={{ color: "#69FF47" }}>{matchedRows}</strong> casadas</span>
              <span><strong style={{ color: "#FFB347" }}>{pendingRows}</strong> pendentes</span>
              <span><strong style={{ color: PANEL.accent }}>{completeRows}</strong> prontas para importar</span>
              {skipRows > 0 && <span><strong style={{ color: PANEL.muted }}>{skipRows}</strong> ignoradas</span>}
              <span style={{ color: PANEL.muted }}>{totalRows} no total</span>
            </div>

            <div style={{ overflowX: "auto", borderRadius: 8, border: `1px solid ${PANEL.border}`, marginBottom: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr>
                    <th style={{ ...headStyle, width: 100 }}>Data</th>
                    <th style={headStyle}>Descrição</th>
                    <th style={{ ...headStyle, width: 110, textAlign: "right" }}>Valor (R$)</th>
                    <th style={{ ...headStyle, width: 110, textAlign: "center" }}>Débito</th>
                    <th style={{ ...headStyle, width: 110, textAlign: "center" }}>Crédito</th>
                    <th style={{ ...headStyle, width: 130 }}>Status</th>
                    <th style={{ ...headStyle, width: 60, textAlign: "center" }}>Pular</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t, idx) => {
                    const ready = t.contaDebito && t.contaCredito;
                    const matched = Boolean(t.match);
                    const bg = t.skip
                      ? "transparent"
                      : matched && ready
                      ? "rgba(105,255,71,0.05)"
                      : !matched
                      ? "rgba(255,179,71,0.05)"
                      : "transparent";
                    return (
                      <tr key={idx} style={{ background: bg, borderBottom: `1px solid ${PANEL.border}`, opacity: t.skip ? 0.4 : 1 }}>
                        <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>{fmtDateBR(t.data)}</td>
                        <td style={{ padding: "5px 8px" }}>{t.descricao}</td>
                        <td style={{ padding: "5px 8px", textAlign: "right", whiteSpace: "nowrap" }}>{fmtMoney(t.valor)}</td>
                        <td style={{ padding: "5px 8px" }}>
                          <input
                            type="text"
                            list={`excel-acc-${idx}`}
                            value={t.contaDebito || ""}
                            onChange={(e) => updateRow(idx, { contaDebito: e.target.value })}
                            placeholder="—"
                            disabled={t.skip}
                            style={{ ...inputStyle, fontWeight: 700, color: t.contaDebito ? "#8BE9FD" : PANEL.muted, textAlign: "center" }}
                          />
                        </td>
                        <td style={{ padding: "5px 8px" }}>
                          <input
                            type="text"
                            list={`excel-acc-${idx}`}
                            value={t.contaCredito || ""}
                            onChange={(e) => updateRow(idx, { contaCredito: e.target.value })}
                            placeholder="—"
                            disabled={t.skip}
                            style={{ ...inputStyle, fontWeight: 700, color: t.contaCredito ? "#69FF47" : PANEL.muted, textAlign: "center" }}
                          />
                          <datalist id={`excel-acc-${idx}`}>
                            {accounts.map((a) => <option key={a.codigo} value={a.codigo}>{a.codigo} — {a.nome}</option>)}
                          </datalist>
                        </td>
                        <td style={{ padding: "5px 8px", fontSize: "0.78rem" }}>
                          {t.skip ? <span style={{ color: PANEL.muted }}>—</span>
                            : matched ? (
                              <span style={{ color: "#69FF47" }}>
                                ✓ {t.match.matchType === "exact" ? "Casou" : "Parcial"}
                              </span>
                            ) : ready ? (
                              <span style={{ color: PANEL.accent }}>✓ Pronto</span>
                            ) : (
                              <span style={{ color: "#FFB347" }}>⚠ Pendente</span>
                            )}
                        </td>
                        <td style={{ padding: "5px 8px", textAlign: "center" }}>
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
                </tbody>
              </table>
            </div>

            {pendingRows > 0 && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", padding: 10, background: PANEL.field, borderRadius: 6, marginBottom: 12 }}>
                <span style={{ fontSize: "0.78rem", color: PANEL.muted }}>Aplicar a todas pendentes:</span>
                <input
                  type="text"
                  list="excel-bulk-d"
                  value={bulkD}
                  onChange={(e) => setBulkD(e.target.value)}
                  placeholder="Débito"
                  style={{ ...inputStyle, width: 110, fontWeight: 700, color: bulkD ? "#8BE9FD" : PANEL.muted, textAlign: "center" }}
                />
                <input
                  type="text"
                  list="excel-bulk-c"
                  value={bulkC}
                  onChange={(e) => setBulkC(e.target.value)}
                  placeholder="Crédito"
                  style={{ ...inputStyle, width: 110, fontWeight: 700, color: bulkC ? "#69FF47" : PANEL.muted, textAlign: "center" }}
                />
                <datalist id="excel-bulk-d">
                  {accounts.map((a) => <option key={a.codigo} value={a.codigo}>{a.codigo} — {a.nome}</option>)}
                </datalist>
                <datalist id="excel-bulk-c">
                  {accounts.map((a) => <option key={a.codigo} value={a.codigo}>{a.codigo} — {a.nome}</option>)}
                </datalist>
                <Button variant="secondary" size="sm" onClick={applyBulkFill} disabled={!bulkD && !bulkC}>
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
              <Button variant="secondary" onClick={() => { setStep("upload"); setTransactions([]); setError(""); }}>Voltar</Button>
              <Button variant="secondary" onClick={onClose}>Cancelar</Button>
              <Button variant="primary" onClick={handleCommit} disabled={!canCommit}>
                {saving ? "Importando..." : `Importar ${completeRows} ${completeRows === 1 ? "linha" : "linhas"}`}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

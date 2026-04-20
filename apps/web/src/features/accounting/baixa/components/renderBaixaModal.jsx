import { useState } from "react";
import { Button } from "../../../../components/ui/Button";

const SUBTIPO_LABELS = {
  DAS: "DAS / Simples Nacional",
  IRRF: "IRRF",
  ISS: "ISS",
  PIS_COFINS: "PIS/COFINS",
  FGTS: "FGTS",
  FERIAS: "Férias",
  DECIMO_TERCEIRO: "13º Salário",
  OUTROS_TRIBUTOS: "Outros Tributos",
};

function fmtMoney(val) {
  const n = Number(val);
  return isNaN(n) ? "—" : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const INPUT = {
  height: 32,
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: "0 var(--space-3)",
  font: "inherit",
  fontSize: "0.8125rem",
  background: "white",
};

function LineEditor({ lines, onChange, accounts }) {
  function updateLine(idx, field, val) {
    onChange(lines.map((l, i) => i === idx ? { ...l, [field]: val } : l));
  }
  function removeLine(idx) {
    onChange(lines.filter((_, i) => i !== idx));
  }
  function addLine(tipo) {
    onChange([...lines, { tipo, conta: "", valor: "" }]);
  }

  const totalD = lines.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
  const totalC = lines.filter((l) => l.tipo === "C").reduce((s, l) => s + Number(l.valor || 0), 0);
  const diff = Math.abs(totalD - totalC);
  const balanced = diff < 0.01;

  return (
    <div style={{ marginTop: 8 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
        <thead>
          <tr style={{ background: "#f3f4f6" }}>
            <th style={{ padding: "4px 6px", width: 52, textAlign: "left", fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 700 }}>D/C</th>
            <th style={{ padding: "4px 6px", textAlign: "left", fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 700 }}>Conta</th>
            <th style={{ padding: "4px 6px", width: 120, textAlign: "right", fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 700 }}>Valor (R$)</th>
            <th style={{ padding: "4px 6px", width: 28 }} />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td style={{ padding: "2px 4px" }}>
                <select value={l.tipo} onChange={(e) => updateLine(i, "tipo", e.target.value)}
                  style={{ ...INPUT, width: 46, fontWeight: 700, color: l.tipo === "D" ? "#1d4ed8" : "#065f46" }}>
                  <option value="D">D</option>
                  <option value="C">C</option>
                </select>
              </td>
              <td style={{ padding: "2px 4px" }}>
                <input
                  type="text"
                  value={l.conta}
                  onChange={(e) => updateLine(i, "conta", e.target.value)}
                  placeholder="Código da conta"
                  list={`baixa-accounts-${i}`}
                  style={{ ...INPUT, width: "100%" }}
                />
                {accounts?.length > 0 && (
                  <datalist id={`baixa-accounts-${i}`}>
                    {accounts.map((a) => (
                      <option key={a.codigo} value={a.codigo}>{a.codigo} — {a.nome}</option>
                    ))}
                  </datalist>
                )}
              </td>
              <td style={{ padding: "2px 4px" }}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={l.valor}
                  onChange={(e) => updateLine(i, "valor", e.target.value)}
                  placeholder="0,00"
                  style={{ ...INPUT, width: "100%", textAlign: "right" }}
                />
              </td>
              <td style={{ padding: "2px 4px", textAlign: "center" }}>
                {lines.length > 2 && (
                  <button onClick={() => removeLine(i)}
                    style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "0.875rem", lineHeight: 1 }}>
                    ×
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2} style={{ padding: "4px 6px", fontSize: "0.75rem" }}>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => addLine("D")}
                  style={{ fontSize: "0.7rem", background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}>
                  + Débito
                </button>
                <button onClick={() => addLine("C")}
                  style={{ fontSize: "0.7rem", background: "#ecfdf5", color: "#047857", border: "1px solid #a7f3d0", borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}>
                  + Crédito
                </button>
              </div>
            </td>
            <td colSpan={2} style={{ padding: "4px 6px", textAlign: "right", fontSize: "0.75rem" }}>
              {balanced ? (
                <span style={{ color: "#047857", fontWeight: 700 }}>Balanceado</span>
              ) : (
                <span style={{ color: "#dc2626", fontWeight: 700 }}>Dif. R$ {fmtMoney(diff)}</span>
              )}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function BaixaModal({ entry, accounts, onSave, onClose, saving }) {
  const subtipoLabel = SUBTIPO_LABELS[entry.subtipo] || entry.subtipo || entry.tipo;
  const title = `Dar Baixa — ${subtipoLabel}`;

  const defaultHistorico = entry.subtipo
    ? `Pagamento ${SUBTIPO_LABELS[entry.subtipo] || entry.subtipo} ref. ${entry.competencia}`
    : `Pagamento ref. ${entry.competencia}`;

  const today = new Date().toISOString().slice(0, 10);

  const [data, setData] = useState(today);
  const [historico, setHistorico] = useState(defaultHistorico);
  const [lines, setLines] = useState(() => {
    const entryLines = entry.lines || [];
    if (entryLines.length === 0) {
      return [{ tipo: "D", conta: "", valor: "" }, { tipo: "C", conta: "", valor: "" }];
    }
    return entryLines.map((l) => ({
      tipo: l.tipo === "D" ? "C" : "D",
      conta: l.conta,
      valor: String(Number(l.valor).toFixed(2)),
    }));
  });
  const [error, setError] = useState("");

  const totalD = lines.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
  const totalC = lines.filter((l) => l.tipo === "C").reduce((s, l) => s + Number(l.valor || 0), 0);
  const balanced = Math.abs(totalD - totalC) < 0.01 && totalD > 0;
  const canSave = data && historico && balanced && !saving;

  async function handleSave() {
    if (!canSave) return;
    setError("");
    try {
      await onSave({
        data,
        historico,
        lines: lines.map((l, i) => ({ conta: l.conta, tipo: l.tipo, valor: Number(l.valor || 0), ordem: i })),
      });
    } catch (err) {
      setError(err?.message || "Falha ao registrar baixa.");
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-4)",
    }}>
      <div style={{
        background: "var(--bg-surface)", borderRadius: "var(--radius)", border: "1px solid var(--border)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.16)", width: "100%", maxWidth: "560px",
        maxHeight: "90vh", overflow: "auto", padding: "var(--space-5)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-3)" }}>
          <h2 style={{ margin: 0, fontSize: "1.0625rem", fontWeight: 700 }}>{title}</h2>
          <Button size="sm" variant="secondary" onClick={onClose}>Fechar</Button>
        </div>

        {/* Info da provisão */}
        <div style={{
          background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 6,
          padding: "8px 12px", marginBottom: 16, fontSize: "0.8125rem",
        }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <span><strong>Competência:</strong> {entry.competencia}</span>
            <span><strong>Histórico:</strong> {entry.historico}</span>
            <span><strong>Valor provisionado:</strong> R$ {fmtMoney(entry.valor || entry.totalD)}</span>
          </div>
        </div>

        {error && <p style={{ color: "var(--danger)", margin: "0 0 12px", fontSize: "0.875rem" }}>{error}</p>}

        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 12, marginBottom: 8 }}>
          <label style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-muted)", display: "grid", gap: 4 }}>
            Data do pagamento
            <input
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              style={{ ...INPUT, width: "100%" }}
            />
          </label>
          <label style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-muted)", display: "grid", gap: 4 }}>
            Histórico
            <input
              type="text"
              value={historico}
              onChange={(e) => setHistorico(e.target.value)}
              style={{ ...INPUT, width: "100%" }}
            />
          </label>
        </div>

        <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
          Partidas (contrapartida da provisão)
        </div>
        <LineEditor lines={lines} onChange={setLines} accounts={accounts} />

        <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="primary" onClick={handleSave} disabled={!canSave}>
            {saving ? "Registrando..." : "Confirmar Baixa"}
          </Button>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        </div>
      </div>
    </div>
  );
}

import { useState, useRef } from "react";
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
  width: "100%",
};

const LABEL = {
  fontSize: "0.875rem",
  fontWeight: 600,
  color: PANEL.muted,
  display: "grid",
  gap: 6,
};

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function formatCurrency(val) {
  const n = Number(val);
  return isNaN(n) ? "—" : n.toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

function AccountSelect({ value, onChange, accounts, placeholder }) {
  return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
      style={{ ...FIELD, colorScheme: "dark" }}
    >
      <option value="">{placeholder || "— selecione —"}</option>
      {accounts.map((a) => (
        <option key={a.codigo} value={a.codigo}>
          {a.codigo} — {a.nome}
          {a.status === "PENDENTE_ERP" ? " *" : ""}
        </option>
      ))}
    </select>
  );
}

export function ImportOFXModal({ accounts, onPreview, onImport, onClose }) {
  const [step, setStep] = useState("upload"); // upload | preview | done
  const [file, setFile] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [contaDebito, setContaDebito] = useState("");
  const [contaCredito, setContaCredito] = useState("");
  const [tipo, setTipo] = useState("DESPESA");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  async function handlePreview() {
    if (!file) { setError("Selecione um arquivo OFX."); return; }
    setError("");
    setLoading(true);
    try {
      const payload = await onPreview(file);
      setTransactions(Array.isArray(payload?.transactions) ? payload.transactions : []);
      setStep("preview");
    } catch (err) {
      setError(err?.message || "Falha ao ler o arquivo OFX.");
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    if (!contaDebito || !contaCredito) { setError("Selecione débito e crédito."); return; }
    setError("");
    setLoading(true);
    try {
      const payload = await onImport({ file, contaDebito, contaCredito, tipo });
      setResult(payload);
      setStep("done");
    } catch (err) {
      setError(err?.message || "Falha ao importar lançamentos.");
    } finally {
      setLoading(false);
    }
  }

  return (
      <div style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-4)",
      }}>
      <div style={{
        background: PANEL.surface, color: PANEL.text, borderRadius: 16, border: `1px solid ${PANEL.border}`,
        boxShadow: "0 8px 32px rgba(0,0,0,0.28)", width: "100%", maxWidth: "760px",
        maxHeight: "90vh", overflow: "auto", padding: "var(--space-5)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
          <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, color: PANEL.text }}>Importar arquivo OFX</h2>
          <button type="button" onClick={onClose} style={ACTION}>Fechar</button>
        </div>

        {error && <p style={{ marginBottom: "var(--space-3)", color: PANEL.danger, fontSize: "0.9375rem" }}>{error}</p>}

        {step === "upload" && (
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            <p style={{ color: PANEL.muted, fontSize: "0.9375rem" }}>
              Selecione um arquivo de extrato bancário no formato <strong>.OFX</strong> ou <strong>.QFX</strong>.
              O sistema identificará automaticamente os débitos.
            </p>
            <label style={LABEL}>
              Arquivo OFX
              <input
                ref={fileRef}
                type="file"
                accept=".ofx,.qfx"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                style={{ font: "inherit", color: PANEL.text }}
              />
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={handlePreview} disabled={loading || !file} style={{ ...ACTION, background: PANEL.success, borderColor: PANEL.success, color: PANEL.page }}>
                {loading ? "Lendo..." : "Pré-visualizar"}
              </button>
              <button type="button" onClick={onClose} style={ACTION}>Cancelar</button>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div style={{ display: "grid", gap: "var(--space-4)" }}>
            <p style={{ color: PANEL.muted, fontSize: "0.9375rem" }}>
              {transactions.length} transação{transactions.length !== 1 ? "ões" : ""} encontrada{transactions.length !== 1 ? "s" : ""}.
              Defina as contas contábeis e confirme a importação.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
              <label style={LABEL}>
                Conta Débito (saída)
                <AccountSelect value={contaDebito} onChange={setContaDebito} accounts={accounts} placeholder="— débito —" />
              </label>
              <label style={LABEL}>
                Conta Crédito (origem)
                <AccountSelect value={contaCredito} onChange={setContaCredito} accounts={accounts} placeholder="— crédito —" />
              </label>
              <label style={LABEL}>
                Tipo de lançamento
                <select
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value)}
                  style={{ ...FIELD, colorScheme: "dark" }}
                >
                  <option value="DESPESA">Despesa</option>
                  <option value="RECEITA">Receita</option>
                  <option value="OUTRO">Outro</option>
                </select>
              </label>
            </div>

            <div style={{ maxHeight: "280px", overflowY: "auto", background: PANEL.field, borderRadius: 16, padding: 14 }}>
              <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, color: PANEL.text }}>
                <thead>
                  <tr style={{ background: PANEL.surface }}>
                    <th style={{ textAlign: "left", padding: "14px 12px", fontSize: "0.9375rem" }}>Data</th>
                    <th style={{ textAlign: "left", padding: "14px 12px", fontSize: "0.9375rem" }}>Histórico</th>
                    <th style={{ textAlign: "right", padding: "14px 12px", fontSize: "0.9375rem" }}>Valor (R$)</th>
                    <th style={{ textAlign: "left", padding: "14px 12px", fontSize: "0.9375rem" }}>Tipo OFX</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t, i) => (
                    <tr key={i} style={{ background: PANEL.field }}>
                      <td style={{ whiteSpace: "nowrap", padding: "10px 12px" }}>{formatDate(t.data)}</td>
                      <td title={t.historico} style={{ padding: "10px 12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.historico || "—"}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", padding: "10px 12px" }}>{formatCurrency(t.valor)}</td>
                      <td>
                        <span style={{ fontSize: "0.875rem", color: t.sinal === "DEBITO" ? PANEL.danger : PANEL.success, padding: "10px 12px", display: "inline-block" }}>
                          {t.trnType || t.sinal}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={handleImport} disabled={loading || !contaDebito || !contaCredito} style={{ ...ACTION, background: PANEL.success, borderColor: PANEL.success, color: PANEL.page }}>
                {loading ? "Importando..." : `Importar ${transactions.length} lançamento${transactions.length !== 1 ? "s" : ""}`}
              </button>
              <button type="button" onClick={() => setStep("upload")} style={ACTION}>Voltar</button>
              <button type="button" onClick={onClose} style={ACTION}>Cancelar</button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            <p style={{ color: PANEL.success, fontSize: "0.9375rem" }}>
              {result?.created || 0} lançamento{result?.created !== 1 ? "s" : ""} importado{result?.created !== 1 ? "s" : ""} com sucesso.
            </p>
            <p style={{ color: PANEL.muted, fontSize: "0.9375rem" }}>
              Lote: <span style={{ color: PANEL.text, fontWeight: 700 }}>{result?.loteImportacao}</span>
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={onClose} style={{ ...ACTION, background: PANEL.success, borderColor: PANEL.success, color: PANEL.page }}>Fechar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { Button } from "../../../../components/ui/Button";

const PANEL = {
  surface: "#24253A",
  field: "#1A1B26",
  border: "#44475A",
  text: "#F8F8F2",
  muted: "#6272A4",
  accent: "#BD93F9",
  warning: "#FFB347",
  success: "#69FF47",
  danger: "#FF4757",
};

const overlay = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1100,
  display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
};
const modalBox = {
  background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10,
  padding: 22, width: 920, maxWidth: "100%", maxHeight: "92vh", overflowY: "auto",
  color: PANEL.text, boxSizing: "border-box",
};
const inputStyle = {
  background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6,
  color: PANEL.text, padding: "8px 10px", fontSize: "0.9rem", width: "100%", boxSizing: "border-box",
};
const labelStyle = {
  display: "block", fontSize: "0.75rem", color: PANEL.muted, marginBottom: 4,
  fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em",
};

function fmtMoney(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
}

function addMonthsToCompetencia(comp, n) {
  const m = String(comp || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + n, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function buildDateLabel(comp, dia) {
  const m = String(comp || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return "—";
  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  const lastDay = new Date(Date.UTC(yyyy, mm, 0)).getUTCDate();
  const diaReal = Math.min(Math.max(1, Number(dia) || 1), lastDay);
  return `${String(diaReal).padStart(2, "0")}/${String(mm).padStart(2, "0")}/${yyyy}`;
}

/**
 * Modal de criação de Parcelamento Simples Nacional.
 *
 * Gera N entries (1 por mês), cada um com 3 linhas:
 *   D principal (ex: conta 265)
 *   D juros (ex: conta 501) — opcional, se valor > 0
 *   C contrapartida (ex: conta 553) — total = principal + juros
 *
 * Todos com subtipo="PARC_DAS" e statusPagamento="ABERTO". Aparecem na linha
 * "Parc. Simples Nacional" da Circular. Empresas com parcelamento ABERTO na
 * competência atual mostram tag laranja "PARC DAS" no Card da Home.
 */
export function ParcelamentoModal({ accounts = [], defaultCompetencia, onSave, onClose, saving = false }) {
  const [competenciaInicial, setCompetenciaInicial] = useState(defaultCompetencia || "");
  const [diaPagamento, setDiaPagamento] = useState(9);
  const [periodosReferenciados, setPeriodosReferenciados] = useState("");
  const [numParcelas, setNumParcelas] = useState(9);
  const [principalAccount, setPrincipalAccount] = useState("");
  const [principalValue, setPrincipalValue] = useState("");
  const [jurosAccount, setJurosAccount] = useState("");
  const [jurosValue, setJurosValue] = useState("");
  const [contraAccount, setContraAccount] = useState("");
  const [error, setError] = useState("");

  const principalNum = Number(String(principalValue || "").replace(",", "."));
  const jurosNum = Number(String(jurosValue || "").replace(",", "."));
  const totalPorParcela = (Number.isFinite(principalNum) ? principalNum : 0)
    + (Number.isFinite(jurosNum) ? jurosNum : 0);

  // Preview das N parcelas (data + valor) — em tempo real conforme o usuário digita
  const preview = useMemo(() => {
    if (!competenciaInicial || !numParcelas || numParcelas < 1) return [];
    const arr = [];
    for (let i = 0; i < Math.min(60, Math.max(1, Number(numParcelas) || 1)); i++) {
      const compN = addMonthsToCompetencia(competenciaInicial, i);
      arr.push({
        numero: i + 1,
        competencia: compN,
        dataLabel: buildDateLabel(compN, diaPagamento),
        valor: totalPorParcela,
      });
    }
    return arr;
  }, [competenciaInicial, diaPagamento, numParcelas, totalPorParcela]);

  function canSubmit() {
    if (!principalAccount || !contraAccount) return false;
    if (!Number.isFinite(principalNum) || principalNum <= 0) return false;
    if (jurosValue && (!Number.isFinite(jurosNum) || jurosNum < 0)) return false;
    if (jurosNum > 0 && !jurosAccount) return false;
    if (!/^\d{4}-\d{2}$/.test(String(competenciaInicial || ""))) return false;
    if (!numParcelas || numParcelas < 1) return false;
    return true;
  }

  async function handleSubmit(e) {
    e?.preventDefault();
    setError("");
    if (!canSubmit()) {
      setError("Preencha conta principal, contrapartida, valor e competência inicial.");
      return;
    }
    try {
      const result = await onSave({
        principalAccount: String(principalAccount).trim(),
        principalValue: principalNum,
        jurosAccount: jurosAccount ? String(jurosAccount).trim() : "",
        jurosValue: Number.isFinite(jurosNum) && jurosNum > 0 ? jurosNum : 0,
        contraAccount: String(contraAccount).trim(),
        numParcelas: Number(numParcelas),
        competenciaInicial: String(competenciaInicial).trim(),
        diaPagamento: Number(diaPagamento) || 9,
        periodosReferenciados: String(periodosReferenciados || "").trim(),
        label: "PARCELAMENTO SIMPLES NACIONAL",
      });
      if (result?.ok !== false) {
        onClose();
      } else {
        setError(result?.message || "Falha ao criar parcelamento.");
      }
    } catch (err) {
      setError(err?.message || "Falha ao criar parcelamento.");
    }
  }

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={modalBox}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem" }}>Novo Parcelamento Simples Nacional</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: PANEL.muted, fontSize: 22, cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>

        <p style={{ margin: "0 0 14px", fontSize: "0.8125rem", color: PANEL.muted, lineHeight: 1.5 }}>
          Cria N entries (1 por mês), cada um com débito do principal (+ juros se houver) contra a conta de
          contrapartida. Cada parcela vai com status <strong>ABERTO</strong> — você baixa mês a mês na aba Circular.
        </p>

        <form onSubmit={handleSubmit}>
          {/* Período e parcelas */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Competência inicial *</label>
              <input type="month" value={competenciaInicial} onChange={(e) => setCompetenciaInicial(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Dia de pagamento</label>
              <input type="number" min={1} max={31} value={diaPagamento} onChange={(e) => setDiaPagamento(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Nº de parcelas *</label>
              <input type="number" min={1} max={60} value={numParcelas} onChange={(e) => setNumParcelas(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Períodos referenciados (texto livre)</label>
            <input
              type="text"
              value={periodosReferenciados}
              onChange={(e) => setPeriodosReferenciados(e.target.value)}
              placeholder="Ex: SET/OUT/NOV/2024"
              style={inputStyle}
            />
            <p style={{ margin: "4px 0 0", fontSize: "0.7rem", color: PANEL.muted }}>
              Esse texto vai no histórico de cada parcela: "VR REF PARCELAMENTO SIMPLES NACIONAL DE <strong>{periodosReferenciados || "..."}</strong> EM {numParcelas || "N"} PARCELAS N/1"
            </p>
          </div>

          {/* Contas e valores */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 10 }}>
            <div>
              <label style={labelStyle}>Conta Principal (D) *</label>
              <input
                type="text"
                list="parc-acc-principal"
                value={principalAccount}
                onChange={(e) => setPrincipalAccount(e.target.value)}
                placeholder="Ex: 265"
                style={{ ...inputStyle, fontWeight: 700, color: principalAccount ? "#8BE9FD" : PANEL.muted }}
              />
            </div>
            <div>
              <label style={labelStyle}>Valor Principal (R$) *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={principalValue}
                onChange={(e) => setPrincipalValue(e.target.value)}
                placeholder="0,00"
                style={{ ...inputStyle, textAlign: "right" }}
              />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 10 }}>
            <div>
              <label style={labelStyle}>Conta Juros (D)</label>
              <input
                type="text"
                list="parc-acc-juros"
                value={jurosAccount}
                onChange={(e) => setJurosAccount(e.target.value)}
                placeholder="Ex: 501 (opcional)"
                style={{ ...inputStyle, fontWeight: 700, color: jurosAccount ? "#8BE9FD" : PANEL.muted }}
              />
            </div>
            <div>
              <label style={labelStyle}>Valor Juros (R$)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={jurosValue}
                onChange={(e) => setJurosValue(e.target.value)}
                placeholder="0,00"
                style={{ ...inputStyle, textAlign: "right" }}
              />
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Conta Contrapartida (C) *</label>
            <input
              type="text"
              list="parc-acc-contra"
              value={contraAccount}
              onChange={(e) => setContraAccount(e.target.value)}
              placeholder="Ex: 553"
              style={{ ...inputStyle, fontWeight: 700, color: contraAccount ? PANEL.success : PANEL.muted }}
            />
            <p style={{ margin: "4px 0 0", fontSize: "0.78rem", color: PANEL.accent }}>
              Total por parcela: <strong>R$ {fmtMoney(totalPorParcela)}</strong> (Principal + Juros)
            </p>
          </div>

          {/* Datalists das contas (mesmo data set para todas; codigo+nome) */}
          <datalist id="parc-acc-principal">
            {accounts.map((a) => <option key={a.codigo} value={a.codigo}>{a.codigo} — {a.nome}</option>)}
          </datalist>
          <datalist id="parc-acc-juros">
            {accounts.map((a) => <option key={a.codigo} value={a.codigo}>{a.codigo} — {a.nome}</option>)}
          </datalist>
          <datalist id="parc-acc-contra">
            {accounts.map((a) => <option key={a.codigo} value={a.codigo}>{a.codigo} — {a.nome}</option>)}
          </datalist>

          {/* Preview da tabela de parcelas */}
          {preview.length > 0 && (
            <div style={{
              borderRadius: 8, border: `1px solid ${PANEL.border}`, marginBottom: 14, overflow: "auto",
              maxHeight: 220,
            }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ background: PANEL.field, position: "sticky", top: 0 }}>
                    <th style={{ padding: "6px 10px", textAlign: "left", color: "#aeb6d3", fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase" }}>Parcela</th>
                    <th style={{ padding: "6px 10px", textAlign: "left", color: "#aeb6d3", fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase" }}>Data</th>
                    <th style={{ padding: "6px 10px", textAlign: "left", color: "#aeb6d3", fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase" }}>Competência</th>
                    <th style={{ padding: "6px 10px", textAlign: "right", color: "#aeb6d3", fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase" }}>Valor (R$)</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((p) => (
                    <tr key={p.numero} style={{ borderTop: `1px solid ${PANEL.border}` }}>
                      <td style={{ padding: "5px 10px" }}>#{p.numero}</td>
                      <td style={{ padding: "5px 10px" }}>{p.dataLabel}</td>
                      <td style={{ padding: "5px 10px" }}>{p.competencia}</td>
                      <td style={{ padding: "5px 10px", textAlign: "right", fontWeight: 600 }}>{fmtMoney(p.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {error && (
            <div style={{
              marginBottom: 10, padding: 10, background: "rgba(255,87,87,0.15)",
              border: `1px solid ${PANEL.danger}`, borderRadius: 6, color: PANEL.danger, fontSize: "0.85rem",
            }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={saving || !canSubmit()}>
              {saving ? "Criando..." : `Criar ${numParcelas || 0} parcela${Number(numParcelas) === 1 ? "" : "s"}`}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ParcelamentoModal;

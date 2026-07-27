import { useEffect, useState } from "react";
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
  border: "1px solid #44475A",
  borderRadius: "var(--radius-sm)",
  padding: "0 var(--space-3)",
  font: "inherit",
  fontSize: "0.8125rem",
  background: "#1A1B26",
  color: "#F8F8F2",
  colorScheme: "dark",
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
    // minWidth:0 + overflowX próprio: se as colunas não couberem, quem rola é ESTA tabela,
    // não o modal inteiro (o pai agora é overflowX:hidden).
    <div style={{ marginTop: 8, overflowX: "auto", minWidth: 0 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
        <thead>
          <tr style={{ background: "#282A36" }}>
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
                  style={{ ...INPUT, width: 46, fontWeight: 700, color: l.tipo === "D" ? "#8BE9FD" : "#69FF47" }}>
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
                  style={{ fontSize: "0.7rem", background: "rgba(139,233,253,0.12)", color: "#8BE9FD", border: "1px solid #8BE9FD", borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}>
                  + Débito
                </button>
                <button onClick={() => addLine("C")}
                  style={{ fontSize: "0.7rem", background: "rgba(105,255,71,0.10)", color: "#69FF47", border: "1px solid #69FF47", borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}>
                  + Crédito
                </button>
              </div>
            </td>
            <td colSpan={2} style={{ padding: "4px 6px", textAlign: "right", fontSize: "0.75rem" }}>
              {balanced ? (
                <span style={{ color: "#69FF47", fontWeight: 700 }}>Balanceado</span>
              ) : (
                <span style={{ color: "#FF5757", fontWeight: 700 }}>Dif. R$ {fmtMoney(diff)}</span>
              )}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// A data da baixa é o DIA DA CONFIRMAÇÃO (hoje) — pagamento se lança quando acontece.
// Antes o padrão era "dia 5 do mês seguinte à competência", o que jogava o lançamento para um
// mês diferente do atual (às vezes futuro), fora do mês que o contador está fechando.
// O campo segue editável para corrigir um pagamento feito em outro dia.

export function BaixaModal({ entry, accounts, onSave, onClose, saving, onLoadBaixaTemplate }) {
  const subtipoLabel = SUBTIPO_LABELS[entry.subtipo] || entry.subtipo || entry.tipo;
  const title = `Dar Baixa — ${subtipoLabel}`;

  const defaultHistorico = entry.subtipo
    ? `Pagamento ${SUBTIPO_LABELS[entry.subtipo] || entry.subtipo} ref. ${entry.competencia}`
    : `Pagamento ref. ${entry.competencia}`;

  const today = new Date().toISOString().slice(0, 10);
  const valorBase = Number(entry.valor || entry.totalD || 0);

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
  const [templateApplied, setTemplateApplied] = useState(null); // "COMPANY" | "GLOBAL" | null
  const [acrescimo, setAcrescimo] = useState(null); // { juros, multa, total, conta } — guia recalculada (item 2)
  const [saldoInfo, setSaldoInfo] = useState(null); // { principal, abatido, saldo, quotasPagas } — baixa parcial
  const [quotaNumero, setQuotaNumero] = useState(1); // nº da quota desta baixa

  // Carrega template configurado (se houver) para pré-preencher
  useEffect(() => {
    if (!onLoadBaixaTemplate || !entry?.id) return;
    let canceled = false;
    onLoadBaixaTemplate(entry.id)
      .then((res) => {
        if (canceled) return;
        const acr = res?.acrescimo || null;
        setAcrescimo(acr);
        setSaldoInfo(res?.saldoInfo || null);
        setQuotaNumero(res?.quotaNumero || 1);
        const tpl = res?.template;
        if (!tpl) return;
        // Baixa parcial: tpl.valor já vem como o SALDO restante (não o principal cheio).
        const principal = Number(tpl.valor || valorBase) || 0;
        const juros = Number(acr?.juros) || 0;
        const multa = Number(acr?.multa) || 0;
        const acrescimoTotal = Math.round((juros + multa) * 100) / 100;
        // Item 2: guia recalculada → cada acréscimo na sua conta de despesa (juros 501, multa 506);
        // o crédito (caixa) sai pelo TOTAL pago (principal + juros + multa).
        // `papel` marca o que cada linha representa. O backend usa isso pra separar a baixa em
        // lançamentos independentes (principal / juros / multa) — derivar pelo número da conta não
        // serviria, porque o contador pode trocar a conta aqui no modal.
        const newLines = [{ tipo: "D", conta: tpl.debitAccountCode || "", valor: principal.toFixed(2), papel: "PRINCIPAL" }];
        if (juros > 0) newLines.push({ tipo: "D", conta: acr.contaJuros || "501", valor: juros.toFixed(2), papel: "JUROS" });
        if (multa > 0) newLines.push({ tipo: "D", conta: acr.contaMulta || "506", valor: multa.toFixed(2), papel: "MULTA" });
        newLines.push({ tipo: "C", conta: tpl.creditAccountCode || "", valor: (principal + acrescimoTotal).toFixed(2), papel: "CAIXA" });
        setLines(newLines);
        if (tpl.historico) setHistorico(tpl.historico);
        setTemplateApplied(tpl.scope || "GLOBAL");
      })
      .catch(() => { /* silencioso — fallback ao comportamento manual */ });
    return () => { canceled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id]);

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
        // `papel` só existe nas linhas que o template gerou; linha adicionada à mão vai sem ele
        // (o backend trata como principal). Não atrapalha quem ignora o campo.
        lines: lines.map((l, i) => ({ conta: l.conta, tipo: l.tipo, valor: Number(l.valor || 0), ordem: i, papel: l.papel || null })),
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
        // overflow:"auto" valia para os DOIS eixos: a tabela de partidas (colunas fixas) estourava
        // e o modal inteiro rolava lateralmente. Agora só o eixo Y rola no modal; quem rola em X é
        // o wrapper da tabela (abaixo). Mesmo tratamento do CircularEntryEditModal.
        maxHeight: "90vh", overflowY: "auto", overflowX: "hidden",
        padding: "var(--space-5)", boxSizing: "border-box",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-3)" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.0625rem", fontWeight: 700 }}>{title}</h2>
            {templateApplied && (
              <span style={{ fontSize: "0.7rem", color: "#16a34a", display: "inline-block", marginTop: 4 }}>
                ✓ Pré-preenchido com regra {templateApplied === "COMPANY" ? "da empresa" : "global"}
              </span>
            )}
          </div>
          <Button size="sm" variant="secondary" onClick={onClose}>Fechar</Button>
        </div>

        {/* Baixa parcial por quota: mostra saldo restante quando a provisão já teve quotas pagas */}
        {saldoInfo && saldoInfo.abatido > 0.009 && saldoInfo.saldo > 0.009 && (
          <div style={{ background: "rgba(120,170,255,0.12)", border: "1px solid #6EA8FF", borderRadius: 6, padding: "8px 12px", marginBottom: 12, fontSize: "0.8rem" }}>
            💠 Pagamento por quota — <strong>quota {quotaNumero}</strong>. Provisão R$ {saldoInfo.principal.toFixed(2)} ·
            já pago R$ {saldoInfo.abatido.toFixed(2)} · <strong>saldo R$ {saldoInfo.saldo.toFixed(2)}</strong>.
            O valor sugerido é o saldo; reduza o principal se for pagar só uma parte.
          </div>
        )}

        {/* Item 2: aviso de guia recalculada (juros → 501, multa → 506) */}
        {acrescimo && acrescimo.total > 0 && (
          <div style={{ background: "rgba(255,110,110,0.12)", border: "1px solid #FF6E6E", borderRadius: 6, padding: "8px 12px", marginBottom: 12, fontSize: "0.8rem" }}>
            ⚠ Guia recalculada — acréscimo de <strong>R$ {acrescimo.total.toFixed(2)}</strong>:
            {acrescimo.juros > 0 && <> juros R$ {acrescimo.juros.toFixed(2)} → conta <strong>{acrescimo.contaJuros || "501"}</strong></>}
            {acrescimo.juros > 0 && acrescimo.multa > 0 && " · "}
            {acrescimo.multa > 0 && <> multa R$ {acrescimo.multa.toFixed(2)} → conta <strong>{acrescimo.contaMulta || "506"}</strong></>}
            . O crédito (caixa) sai pelo total pago (principal + juros + multa).
          </div>
        )}

        {/* Info da provisão */}
        <div style={{
          background: "rgba(255,179,71,0.12)", border: "1px solid #FFB347", borderRadius: 6,
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

// Q15.7 — Modal de fechamento da apuração.
// Faturamento (read-only, das notas), folha 12m (grade), atividades (editável),
// aviso de disparidade, alíquota/DAS calculado. Botões: Calcular | Salvar | Transmitir.
import { useEffect, useState } from "react";
import { PANEL, fmtMoney } from "../../notas/components/notasStyles";

function pasAnteriores(competencia, n = 12) {
  const [y, m] = String(competencia).split("-").map(Number);
  const out = [];
  for (let i = n; i >= 1; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export function FechamentoModal({ api, feedback, portalClientId, competencia, razao, onClose, onChanged }) {
  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [atividades, setAtividades] = useState([]);
  const [folha, setFolha] = useState({}); // { pa: valor }
  const [resultado, setResultado] = useState(null);
  const [showTransmit, setShowTransmit] = useState(false);
  const [confirmComp, setConfirmComp] = useState("");

  async function load() {
    setLoading(true);
    try {
      const out = await api.getFechamento(portalClientId, competencia);
      const d = out?.dados || out;
      setDados(d);
      setAtividades(Array.isArray(d?.atividades) ? d.atividades.filter((a) => a && a.idAtividade != null) : []);
      // folha: pré-preenche da memória se houver
      const folhaInit = {};
      if (Array.isArray(d?.folhaMensal12)) for (const f of d.folhaMensal12) folhaInit[f.pa] = f.valor;
      setFolha(folhaInit);
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Falha ao carregar fechamento");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [portalClientId, competencia]);

  const temFatorR = atividades.some((a) => a.sujeitoFatorR);
  const folhaSerie = pasAnteriores(competencia).map((pa) => ({ pa, valor: Number(folha[pa] || 0) }));

  function setAtvValor(idx, campo, valor) {
    setAtividades((prev) => prev.map((a, i) => i === idx ? { ...a, [campo]: Number(valor) || 0 } : a));
  }

  async function handleCalcular() {
    setActing(true);
    try {
      const out = await api.calcularFechamento(portalClientId, competencia, {
        atividades, folhaMensal12: folhaSerie, regimeApuracao: dados?.regimeApuracao,
      });
      if (!out?.ok) throw new Error(out?.message || out?.error || "Falha");
      setResultado(out.result);
      feedback?.notifySuccess?.(`DAS calculado: ${fmtMoney(out.result?.dasValor || 0)}`);
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro no cálculo (SERPRO)");
    } finally { setActing(false); }
  }

  async function handleSalvar() {
    setActing(true);
    try {
      const out = await api.salvarFechamento(portalClientId, competencia, {
        atividades, folhaMensal12: folhaSerie, regimeApuracao: dados?.regimeApuracao,
      });
      if (!out?.ok) throw new Error(out?.message || out?.error || "Falha");
      feedback?.notifySuccess?.("Apuração fechada (pronta pra apurar em lote).");
      onChanged?.();
      onClose?.();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro ao salvar");
    } finally { setActing(false); }
  }

  async function handleTransmitir() {
    if (confirmComp !== competencia) { feedback?.notifyError?.("Digite a competência exata."); return; }
    setActing(true);
    try {
      const out = await api.transmitirFechamento(portalClientId, competencia, confirmComp);
      if (!out?.ok) throw new Error(out?.message || out?.error || "Falha");
      const r = out.result || {};
      feedback?.notifySuccess?.(r.jaDeclarado
        ? "PA já declarado — não retransmitido."
        : `Transmitida! Declaração ${r.numeroDeclaracao || "?"}`);
      setShowTransmit(false);
      onChanged?.();
      onClose?.();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro na transmissão");
    } finally { setActing(false); }
  }

  const inputS = { background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 4, color: PANEL.text, padding: "4px 8px", fontSize: "0.8rem" };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10, padding: 22, width: "min(94vw, 820px)", maxHeight: "90vh", overflowY: "auto", color: PANEL.text, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>🔒 Fechamento — {razao} · {competencia}</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: PANEL.muted, cursor: "pointer", fontSize: "1.2rem" }}>✕</button>
        </div>

        {loading && <div style={{ color: PANEL.muted, padding: 20 }}>Carregando…</div>}

        {dados && !loading && (
          <>
            {!dados.cadastroCompleto && (
              <div style={{ padding: 10, background: "rgba(255,71,87,0.10)", border: "1px solid #FF4757", borderRadius: 6, color: "#FF4757", fontSize: "0.85rem" }}>
                ⚠ Cadastro fiscal incompleto. Preencha em Apuração V2 → Cadastro Fiscal antes de transmitir.
              </div>
            )}

            {/* Faturamento (read-only) */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
              <Card label="Faturamento interno" value={fmtMoney(dados.faturamento?.interno)} accent="#69FF47" />
              <Card label="Faturamento externo" value={fmtMoney(dados.faturamento?.externo)} accent="#8BE9FD" />
              <Card label="RBT12" value={fmtMoney(dados.rbt12)} sub={dados.rbt12Origem} />
              <Card label="Regime" value={dados.regimeApuracao} />
            </div>

            {/* Disparidades */}
            {Array.isArray(dados.disparidades) && dados.disparidades.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {dados.disparidades.map((d, i) => (
                  <div key={i} style={{ padding: 8, background: "rgba(255,179,71,0.12)", border: "1px solid #FFB347", borderRadius: 6, color: "#FFB347", fontSize: "0.78rem" }}>
                    ⚠ {d.descricao}
                  </div>
                ))}
              </div>
            )}

            {/* Atividades */}
            <div>
              <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: 6 }}>Atividades (receita por atividade do PGDAS-D)</div>
              {atividades.length === 0 ? (
                <div style={{ color: PANEL.muted, fontSize: "0.8rem", padding: 10, background: PANEL.field, borderRadius: 6 }}>
                  Nenhuma atividade. Classifique as notas (Apuração V2) ou ajuste o cadastro.
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                  <thead><tr style={{ color: PANEL.muted, textAlign: "left" }}>
                    <th style={{ padding: 4 }}>Atividade (id)</th>
                    <th style={{ padding: 4 }}>Anexo</th>
                    <th style={{ padding: 4, textAlign: "right" }}>Interno</th>
                    <th style={{ padding: 4, textAlign: "right" }}>Externo</th>
                  </tr></thead>
                  <tbody>
                    {atividades.map((a, idx) => (
                      <tr key={idx} style={{ borderTop: `1px solid ${PANEL.border}` }}>
                        <td style={{ padding: 4 }}>{a.descricao || `#${a.idAtividade}`} <span style={{ color: PANEL.muted }}>({a.idAtividade})</span></td>
                        <td style={{ padding: 4 }}>{a.anexoImplicito}{a.sujeitoFatorR ? " ★FR" : ""}</td>
                        <td style={{ padding: 4, textAlign: "right" }}>
                          <input type="number" step="0.01" value={a.valorInterno || 0} onChange={(e) => setAtvValor(idx, "valorInterno", e.target.value)} style={{ ...inputS, width: 110, textAlign: "right" }} />
                        </td>
                        <td style={{ padding: 4, textAlign: "right" }}>
                          <input type="number" step="0.01" value={a.valorExterno || 0} onChange={(e) => setAtvValor(idx, "valorExterno", e.target.value)} style={{ ...inputS, width: 110, textAlign: "right" }} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Folha 12m (Fator-R) — só se houver atividade sujeita */}
            {temFatorR && (
              <div>
                <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: 6 }}>
                  ★ Folha de salários (12 meses) — pro Fator-R. A RFB decide Anexo III↔V.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 6 }}>
                  {pasAnteriores(competencia).map((pa) => (
                    <label key={pa} style={{ fontSize: "0.7rem", color: PANEL.muted, display: "flex", flexDirection: "column", gap: 2 }}>
                      {pa}
                      <input type="number" step="0.01" value={folha[pa] || ""} onChange={(e) => setFolha((p) => ({ ...p, [pa]: e.target.value }))} placeholder="0,00" style={inputS} />
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Resultado */}
            {resultado && (
              <div style={{ padding: 12, background: "rgba(105,255,71,0.10)", border: "1px solid #69FF47", borderRadius: 6 }}>
                <div style={{ fontSize: "0.7rem", color: PANEL.muted, textTransform: "uppercase" }}>DAS calculado (oficial SERPRO)</div>
                <div style={{ fontSize: "1.3rem", fontWeight: 700, color: "#69FF47" }}>{fmtMoney(resultado.dasValor)}</div>
                {resultado.rbt12 != null && <div style={{ fontSize: "0.75rem", color: PANEL.muted }}>RBT12 usado: {fmtMoney(resultado.rbt12)}</div>}
              </div>
            )}

            {/* Botões */}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button onClick={handleCalcular} disabled={acting || atividades.length === 0}
                style={btn("#8BE9FD")}>{acting ? "…" : "🧮 Calcular (simulação)"}</button>
              <button onClick={handleSalvar} disabled={acting || !resultado}
                style={btn("#FFB347")} title={!resultado ? "Calcule antes de salvar" : ""}>💾 Salvar (fechar)</button>
              <button onClick={() => setShowTransmit(true)} disabled={acting || !resultado}
                style={btn("#69FF47")} title={!resultado ? "Calcule antes de transmitir" : ""}>📤 Apurar/Transmitir</button>
            </div>

            {/* Confirmação de transmissão individual */}
            {showTransmit && (
              <div style={{ padding: 12, background: "rgba(255,71,87,0.08)", border: "1px solid #FF4757", borderRadius: 6, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ color: "#FF4757", fontSize: "0.85rem", fontWeight: 600 }}>⚠ Transmissão OFICIAL — digite a competência ({competencia}) pra confirmar:</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={confirmComp} onChange={(e) => setConfirmComp(e.target.value)} placeholder={competencia} style={{ ...inputS, fontFamily: "monospace", flex: 1 }} />
                  <button onClick={handleTransmitir} disabled={acting || confirmComp !== competencia} style={btn("#FF4757", "#fff")}>{acting ? "Transmitindo…" : "Confirmar"}</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Card({ label, value, accent, sub }) {
  return (
    <div style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 10 }}>
      <div style={{ fontSize: "0.65rem", color: PANEL.muted, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: "1rem", fontWeight: 600, color: accent || PANEL.text }}>{value}</div>
      {sub && <div style={{ fontSize: "0.65rem", color: PANEL.muted }}>{sub}</div>}
    </div>
  );
}
function btn(bg, color = "#000") {
  return { padding: "8px 14px", borderRadius: 6, border: "none", background: bg, color, cursor: "pointer", fontSize: "0.85rem", fontWeight: 600 };
}

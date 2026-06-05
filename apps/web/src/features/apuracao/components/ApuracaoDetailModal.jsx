// Q12.C.4: modal de revisão da apuração mensal de uma empresa.
//
// Permite:
//   1. Ver estado atual (pendente/calculada/revisada/transmitida)
//   2. Editar FS12 manual + clicar "Calcular"
//   3. Ver RB12, Receita do mês, Fator R, Receita por anexo
//   4. Ver divergências (avisos do CalculoFiscal)
//   5. Marcar como revisada (libera transmissão futura)
//   6. Reclassificar itens (lookup De/Para Anexo)
//   7. (futuro Q12.C.5) Transmitir via SERPRO Integra Contador

import { useCallback, useEffect, useState } from "react";
import { PANEL, fmtMoney, fmtDate } from "../../notas/components/notasStyles";

const ESTADO_BADGES = {
  pendente:    { color: PANEL.muted,  icon: "⚪", label: "pendente" },
  calculada:   { color: "#BD93F9",    icon: "🟣", label: "calculada" },
  revisada:    { color: "#FFB347",    icon: "🟡", label: "revisada" },
  transmitida: { color: "#69FF47",    icon: "🟢", label: "transmitida" },
  confirmada:  { color: "#69FF47",    icon: "✅", label: "confirmada" },
  erro:        { color: "#FF4757",    icon: "🔴", label: "erro" },
};

const ANEXO_COLORS = {
  III: "#8BE9FD",
  IV:  "#FFB347",
  V:   "#FF4757",
  DEFAULT: PANEL.muted,
};

function EstadoBadge({ estado }) {
  const e = ESTADO_BADGES[estado] || ESTADO_BADGES.pendente;
  return (
    <span style={{
      padding: "3px 10px", borderRadius: 12,
      background: `${e.color}22`, color: e.color, border: `1px solid ${e.color}`,
      fontSize: "0.8rem", fontWeight: 600,
    }}>{e.icon} {e.label}</span>
  );
}

function MoneyCard({ label, value, accent, sub }) {
  return (
    <div style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: "0.7rem", color: PANEL.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: "1.1rem", fontWeight: 600, color: accent || PANEL.text }}>{value}</div>
      {sub && <div style={{ fontSize: "0.7rem", color: PANEL.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function AnexoChip({ anexo, valor }) {
  const color = ANEXO_COLORS[anexo] || PANEL.muted;
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "8px 12px", background: `${color}11`, border: `1px solid ${color}`,
      borderRadius: 6, minWidth: 140,
    }}>
      <span style={{ fontWeight: 600, color }}>Anexo {anexo}</span>
      <span style={{ color: PANEL.text, fontFamily: "monospace" }}>{fmtMoney(valor)}</span>
    </div>
  );
}

function DivergenciaItem({ d }) {
  const sevColor = d.severidade === "ERROR" ? "#FF4757" : d.severidade === "WARN" ? "#FFB347" : "#8BE9FD";
  const sevIcon = d.severidade === "ERROR" ? "🔴" : d.severidade === "WARN" ? "⚠" : "ℹ";
  return (
    <div style={{ display: "flex", gap: 8, padding: "6px 10px", background: `${sevColor}11`, borderLeft: `3px solid ${sevColor}`, borderRadius: 4, marginBottom: 4 }}>
      <span style={{ color: sevColor }}>{sevIcon}</span>
      <div style={{ flex: 1, fontSize: "0.8rem" }}>
        <strong style={{ color: sevColor }}>{d.tipo}</strong>{" "}
        <span style={{ color: PANEL.text }}>{d.descricao}</span>
        {(d.esperado || d.obtido) && (
          <div style={{ fontSize: "0.7rem", color: PANEL.muted, marginTop: 2 }}>
            {d.esperado && <>esperado: {d.esperado} </>}
            {d.obtido && <>obtido: {d.obtido}</>}
          </div>
        )}
      </div>
    </div>
  );
}

export function ApuracaoDetailModal({ api, feedback, portalClientId, razao, competencia, onClose, onChanged }) {
  const [apuracao, setApuracao] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fs12Input, setFs12Input] = useState("");
  const [classifying, setClassifying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const a = await api.getApuracao(portalClientId, competencia);
      setApuracao(a);
      if (a?.fs12 != null) setFs12Input(String(a.fs12));
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro");
    } finally { setLoading(false); }
  }, [api, portalClientId, competencia, feedback]);

  useEffect(() => { load(); }, [load]);

  async function handleClassify() {
    setClassifying(true);
    try {
      const out = await api.classificarNotas(portalClientId, { force: true });
      const r = out?.result || {};
      feedback?.notifySuccess?.(`Classificados ${r.classified || 0} itens (${r.defaultUsed || 0} em default III).`);
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro");
    } finally { setClassifying(false); }
  }

  async function handleCalc() {
    setSaving(true);
    try {
      const fs12 = fs12Input ? Number(fs12Input) : undefined;
      const out = await api.calcularApuracao(portalClientId, competencia, { fs12 });
      if (!out?.ok) throw new Error(out?.message || "Falha");
      feedback?.notifySuccess?.(`Apuração calculada — Fator R: ${(out.result.fatorR * 100).toFixed(2)}%`);
      await load();
      onChanged?.();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro");
    } finally { setSaving(false); }
  }

  async function handleRevisar() {
    setSaving(true);
    try {
      const out = await api.revisarApuracao(portalClientId, competencia);
      if (!out?.ok) throw new Error(out?.message || "Falha");
      feedback?.notifySuccess?.("Apuração marcada como revisada.");
      await load();
      onChanged?.();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro");
    } finally { setSaving(false); }
  }

  const r = apuracao;
  const fatorRPct = r?.fatorR != null ? (Number(r.fatorR) * 100).toFixed(2) : null;
  const fatorRClass = fatorRPct != null ? (Number(r.fatorR) >= 0.28 ? "Anexo III" : "Anexo V") : null;
  const receitaPorAnexo = r?.receitaPorAnexo || {};
  const totalAnexos = Object.values(receitaPorAnexo).reduce((s, v) => s + Number(v || 0), 0);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 1800,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16, overflowY: "auto",
    }}>
      <div style={{
        background: PANEL.surface, border: `1px solid ${PANEL.border}`,
        borderRadius: 10, padding: 24, width: "100%", maxWidth: 800, maxHeight: "90vh", overflowY: "auto",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, color: PANEL.text, fontSize: "1rem" }}>📊 Apuração — {competencia}</h3>
            <div style={{ fontSize: "0.85rem", color: PANEL.muted, marginTop: 4 }}>{razao}</div>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {r && <EstadoBadge estado={r.estado} />}
            <button onClick={onClose} style={{ background: "none", border: "none", color: PANEL.muted, cursor: "pointer", fontSize: "1.4rem" }}>×</button>
          </div>
        </div>

        {loading && <div style={{ padding: 24, textAlign: "center", color: PANEL.muted }}>Carregando…</div>}

        {!loading && !r && (
          <div style={{ padding: 16, background: PANEL.field, borderRadius: 6, marginBottom: 16, color: PANEL.muted, fontSize: "0.85rem" }}>
            Apuração ainda não calculada. Preencha o FS12 (se Simples + Fator R) e clique <strong>Calcular</strong>.
          </div>
        )}

        {!loading && (
          <>
            {/* Cards principais */}
            {r && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12, marginBottom: 16 }}>
                <MoneyCard label="Receita do mês" value={fmtMoney(r.receitaMes)} accent="#69FF47" />
                <MoneyCard label="RB12 (12 meses móvel)" value={fmtMoney(r.rb12)} accent={PANEL.text} />
                <MoneyCard label="FS12 (folha 12m)" value={fmtMoney(r.fs12)} accent={PANEL.text} />
                <MoneyCard label="Fator R" value={fatorRPct != null ? `${fatorRPct}%` : "—"}
                  accent={fatorRPct != null && Number(r.fatorR) >= 0.28 ? "#69FF47" : "#FFB347"}
                  sub={fatorRClass ? `→ ${fatorRClass}` : null} />
              </div>
            )}

            {/* Receita por anexo */}
            {r && totalAnexos > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: "0.75rem", color: PANEL.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                  Receita por anexo
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {Object.entries(receitaPorAnexo).filter(([_, v]) => Number(v) > 0).map(([anexo, v]) => (
                    <AnexoChip key={anexo} anexo={anexo} valor={v} />
                  ))}
                </div>
              </div>
            )}

            {/* Divergências */}
            {r?.divergencias && r.divergencias.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: "0.75rem", color: PANEL.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                  Divergências ({r.divergencias.length})
                </div>
                {r.divergencias.map((d) => <DivergenciaItem key={d.id} d={d} />)}
              </div>
            )}

            {/* Form FS12 + ações */}
            <div style={{ padding: 12, background: PANEL.field, borderRadius: 6, marginBottom: 16 }}>
              <label style={{ display: "grid", gap: 4, fontSize: "0.8rem", color: PANEL.muted, marginBottom: 12 }}>
                FS12 — folha de pagamento 12m (opcional, sobrescreve circular)
                <input type="number" step="0.01" min="0" value={fs12Input}
                  onChange={(e) => setFs12Input(e.target.value)}
                  placeholder="0.00"
                  style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "8px 12px", fontFamily: "monospace" }}
                />
              </label>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button onClick={handleClassify} disabled={classifying || saving}
                  style={{ padding: "8px 14px", borderRadius: 6, border: `1px solid ${PANEL.border}`, background: "transparent", color: PANEL.text, cursor: "pointer", fontSize: "0.85rem" }}
                  title="Reclassifica os itens das notas usando o De/Para Anexo (LC116/NCM/CFOP)">
                  {classifying ? "Classificando…" : "🏷 Reclassificar itens"}
                </button>
                <button onClick={handleCalc} disabled={saving || classifying}
                  style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: "#BD93F9", color: "#000", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600 }}>
                  {saving ? "Calculando…" : (r ? "↻ Recalcular" : "🧮 Calcular")}
                </button>
                {r && r.estado === "calculada" && (
                  <button onClick={handleRevisar} disabled={saving}
                    style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: "#FFB347", color: "#000", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600 }}
                    title="Marca como revisada — habilita transmissão SERPRO PGDAS-D (Q12.C.5)">
                    ✓ Marcar revisada
                  </button>
                )}
                {r && r.estado === "revisada" && (
                  <button disabled title="Q12.C.5 — em desenvolvimento"
                    style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: PANEL.border, color: PANEL.muted, cursor: "not-allowed", fontSize: "0.85rem", fontWeight: 600 }}>
                    📤 Transmitir (em breve)
                  </button>
                )}
              </div>
            </div>

            {r?.transmitidoEm && (
              <div style={{ padding: 10, background: "rgba(105,255,71,0.10)", border: "1px solid #69FF47", borderRadius: 6, fontSize: "0.8rem", color: "#69FF47" }}>
                ✓ Transmitido em {fmtDate(r.transmitidoEm)}
                {r.numeroDeclaracao && <> · nº declaração <strong>{r.numeroDeclaracao}</strong></>}
                {r.dasValor && <> · DAS R$ {Number(r.dasValor).toFixed(2)}</>}
              </div>
            )}

            {r?.idempotencyKey && (
              <div style={{ marginTop: 12, fontSize: "0.7rem", color: PANEL.muted, fontFamily: "monospace" }}>
                idempotencyKey: {r.idempotencyKey.slice(0, 16)}…
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Q14.3.c — Painel do motor de apuração local.
// Permite contador escolher competência + apurar + ver DAS calculado por anexo.
import { useState } from "react";
import { PANEL, fmtMoney } from "../../notas/components/notasStyles";

function defaultCompetencia() {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const ANEXO_COLORS = {
  I:   "#FFB347",
  II:  "#FF8E72",
  III: "#8BE9FD",
  IV:  "#BD93F9",
  V:   "#FF4757",
};

export function MotorPanel({ panel }) {
  const [competencia, setCompetencia] = useState(defaultCompetencia);
  const [folha12m, setFolha12m] = useState("");
  const [resultado, setResultado] = useState(null);

  async function handleApurar() {
    try {
      const opts = folha12m ? { folha12m: Number(folha12m) } : {};
      const r = await panel.apurarV2(competencia, opts);
      setResultado(r);
    } catch { /* feedback já notifica */ }
  }

  const blockers = resultado?.blockers || [];
  const anexos = resultado?.aliquotaEfetivaPorAnexo || {};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, color: PANEL.text }}>
      <div>
        <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>🧮 Motor de apuração local (v2)</div>
        <div style={{ fontSize: "0.8rem", color: PANEL.muted }}>
          Calcula DAS direto da tabela versionada AliquotaSimplesNacional. Cross-check com SERPRO virá na Fase 6.
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", color: PANEL.muted }}>
          Competência:
          <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)}
            style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "6px 10px" }} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", color: PANEL.muted }}
          title="Necessário só se houver receita Fator R. Vazio = usa último valor informado pra essa empresa.">
          Folha 12m (R$):
          <input type="number" step="0.01" value={folha12m} onChange={(e) => setFolha12m(e.target.value)}
            placeholder="opcional" style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "6px 10px", width: 140 }} />
        </label>
        <button onClick={handleApurar} disabled={panel.saving}
          style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "#BD93F9", color: "#000", cursor: "pointer", fontSize: "0.9rem", fontWeight: 600 }}>
          {panel.saving ? "Calculando…" : "🧮 Apurar agora"}
        </button>
      </div>

      {/* Resultado: blockers OU snapshot */}
      {resultado && !resultado.ok && blockers.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {blockers.map((b, i) => (
            <div key={i} style={{
              padding: 14, background: "rgba(255,71,87,0.10)", border: "1px solid #FF4757",
              borderRadius: 8, color: "#FF4757",
            }}>
              <strong>[{b.tipo}]</strong> {b.mensagem}
            </div>
          ))}
        </div>
      )}

      {resultado && resultado.ok && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Badge Fator R quando houver */}
          {resultado.fatorR && (
            <div style={{
              padding: 14, background: "rgba(189,147,249,0.10)", border: "1px solid #BD93F9",
              borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
            }}>
              <div>
                <div style={{ fontSize: "0.7rem", color: PANEL.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  ★ Decisão Fator R (mensal)
                </div>
                <div style={{ fontSize: "1rem", color: "#BD93F9", fontWeight: 600 }}>
                  {(resultado.fatorR.fatorR * 100).toFixed(2)}% {resultado.fatorR.fatorR >= resultado.fatorR.threshold ? "≥" : "<"} {(resultado.fatorR.threshold * 100).toFixed(0)}%
                  {" → Receita Fator R aplicada no Anexo "}
                  <strong style={{ color: resultado.fatorR.anexoDecidido === "III" ? "#8BE9FD" : "#FF4757" }}>
                    {resultado.fatorR.anexoDecidido}
                  </strong>
                </div>
                <div style={{ fontSize: "0.7rem", color: PANEL.muted, marginTop: 4 }}>
                  Folha 12m = {fmtMoney(resultado.fatorR.folha12m)} · RBT12 = {fmtMoney(resultado.rbt12)}
                </div>
              </div>
            </div>
          )}

          {/* Resumo */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))", gap: 12 }}>
            <MoneyCard label="DAS Calculado (LOCAL)" value={fmtMoney(resultado.dasCalculadoLocal)} accent="#69FF47" />
            <MoneyCard label="RBT12" value={fmtMoney(resultado.rbt12)} accent={PANEL.text} />
            <MoneyCard label="Receita do mês" value={fmtMoney(resultado.receitaPorTipo ? Object.values(resultado.receitaPorTipo).reduce((s, v) => s + v, 0) : 0)} accent="#8BE9FD" />
          </div>

          {/* Detalhe por anexo */}
          <div style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: 10 }}>Detalhe por anexo:</div>
            {Object.keys(anexos).length === 0 ? (
              <div style={{ color: PANEL.muted, fontSize: "0.85rem" }}>Nenhum anexo com receita.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ color: PANEL.muted, textAlign: "left" }}>
                    <th style={{ padding: 6 }}>Anexo</th>
                    <th style={{ padding: 6 }}>Faixa</th>
                    <th style={{ padding: 6, textAlign: "right" }}>Nominal</th>
                    <th style={{ padding: 6, textAlign: "right" }}>Parcela</th>
                    <th style={{ padding: 6, textAlign: "right" }}>Efetiva</th>
                    <th style={{ padding: 6, textAlign: "right" }}>Receita</th>
                    <th style={{ padding: 6, textAlign: "right" }}>DAS Anexo</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(anexos).map(([anexo, info]) => (
                    <tr key={anexo} style={{ borderTop: `1px solid ${PANEL.border}` }}>
                      <td style={{ padding: 6, fontWeight: 600, color: ANEXO_COLORS[anexo] || PANEL.text }}>{anexo}</td>
                      <td style={{ padding: 6 }}>{info.faixa}ª</td>
                      <td style={{ padding: 6, textAlign: "right", fontFamily: "monospace" }}>{(info.nominal * 100).toFixed(2)}%</td>
                      <td style={{ padding: 6, textAlign: "right", fontFamily: "monospace" }}>{fmtMoney(info.parcelaDeduzir)}</td>
                      <td style={{ padding: 6, textAlign: "right", fontFamily: "monospace", color: "#FFB347" }}>{(info.efetiva * 100).toFixed(4)}%</td>
                      <td style={{ padding: 6, textAlign: "right", fontFamily: "monospace" }}>{fmtMoney(info.receita)}</td>
                      <td style={{ padding: 6, textAlign: "right", fontFamily: "monospace", color: "#69FF47", fontWeight: 600 }}>{fmtMoney(info.dasParcial)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {resultado.snapshot?.vigenciaAliquota && (
              <div style={{ marginTop: 8, fontSize: "0.7rem", color: PANEL.muted, fontFamily: "monospace" }}>
                Vigência da tabela usada: {new Date(resultado.snapshot.vigenciaAliquota).toISOString().slice(0, 10)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MoneyCard({ label, value, accent }) {
  return (
    <div style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: "0.7rem", color: PANEL.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: "1.1rem", fontWeight: 600, color: accent }}>{value}</div>
    </div>
  );
}

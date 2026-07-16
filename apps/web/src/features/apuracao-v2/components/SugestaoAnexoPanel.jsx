// Módulo Fiscal (§1.3) — visão por nota da sugestão de anexo (só leitura, não grava nada).
// Seletor de competência → tabela de notas com anexo sugerido, confiança e justificativa.
// "revisão" = o classificador não decidiu sozinho. Pra virar pendência de fato (e ser resolvida),
// é preciso rodar "Classificar competência" na sub-aba Pendências — a sugestão não cria a fila.

import { useState } from "react";
import { PANEL, fmtMoney } from "../../notas/components/notasStyles";

function competenciaAnterior() {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const CONF = {
  alta: { cor: "#69FF47", label: "alta" },
  media: { cor: "#FFB347", label: "média" },
  revisao: { cor: "#FF6E6E", label: "revisão" },
};

export function SugestaoAnexoPanel({ panel }) {
  const [competencia, setCompetencia] = useState(competenciaAnterior());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(null);

  async function carregar() {
    setLoading(true); setErro(null);
    try {
      const out = await panel.getSugestao(competencia);
      if (!out?.ok) throw new Error(out?.message || "Falha");
      setData(out);
    } catch (e) {
      setErro(e?.message || "Erro");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  const inputStyle = { background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "6px 10px", fontSize: "0.85rem", colorScheme: "dark" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, color: PANEL.text }}>
      <div style={{ fontSize: "1.05rem", fontWeight: 600 }}>Sugestão de anexo por nota</div>

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ display: "grid", gap: 3, fontSize: "0.75rem", color: PANEL.muted }}>
          Competência
          <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} style={inputStyle} />
        </label>
        <button onClick={carregar} disabled={loading}
          style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "#8BE9FD", color: "#000", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600, opacity: loading ? 0.6 : 1 }}>
          {loading ? "Carregando…" : "Sugerir"}
        </button>
      </div>

      {erro && (
        <div style={{ padding: 10, background: "rgba(255,71,87,0.10)", border: "1px solid #FF4757", borderRadius: 8, color: "#FF6E6E", fontSize: "0.85rem" }}>{erro}</div>
      )}

      {data && !data.perfilConfigurado && (
        <div style={{ padding: 10, background: "rgba(255,179,71,0.10)", border: "1px solid #FFB347", borderRadius: 8, color: "#FFB347", fontSize: "0.8rem" }}>
          ⚠ Perfil não configurado (em <strong>Cadastro</strong>). A sugestão roda sem restrição de atividades ativas.
        </div>
      )}

      {data && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: "0.82rem" }}>
            <span>Notas: <strong>{data.totalNotas}</strong></span>
            <span style={{ color: CONF.alta.cor }}>alta {data.resumo?.alta || 0}</span>
            <span style={{ color: CONF.media.cor }}>média {data.resumo?.media || 0}</span>
            <span style={{ color: CONF.revisao.cor }}>revisão {data.resumo?.revisao || 0}</span>
            {data.anexosAtivos?.length ? <span style={{ color: PANEL.muted }}>· perfil ativo: {data.anexosAtivos.join(", ")}</span> : null}
          </div>

          {data.totalNotas === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: PANEL.muted, background: PANEL.field, borderRadius: 8 }}>
              Nenhuma nota EMIT autorizada nesta competência.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem", minWidth: 760 }}>
                <thead>
                  <tr style={{ background: PANEL.field, color: PANEL.muted, textAlign: "left" }}>
                    <th style={{ padding: 8 }}>Nota</th>
                    <th style={{ padding: 8 }}>Tipo</th>
                    <th style={{ padding: 8, textAlign: "right" }}>Valor</th>
                    <th style={{ padding: 8 }}>Anexo sugerido</th>
                    <th style={{ padding: 8 }}>Confiança</th>
                    <th style={{ padding: 8 }}>Justificativa</th>
                  </tr>
                </thead>
                <tbody>
                  {data.notas.map((n) => {
                    const c = CONF[n.confianca] || CONF.media;
                    return (
                      <tr key={n.notaId} style={{ borderTop: `1px solid ${PANEL.border}` }}>
                        <td style={{ padding: 8, fontFamily: "monospace" }}>{n.numero || n.notaId.slice(0, 8)}</td>
                        <td style={{ padding: 8 }}>{n.tipo === "NFSE" ? "NFS-e" : "NF-e"}</td>
                        <td style={{ padding: 8, textAlign: "right" }}>{fmtMoney(n.total)}</td>
                        <td style={{ padding: 8, fontWeight: 700 }}>
                          {n.anexoDominante}
                          {n.anexos.length > 1 && <span style={{ color: PANEL.muted, fontWeight: 400 }}> (+{n.anexos.length - 1})</span>}
                        </td>
                        <td style={{ padding: 8, color: c.cor, fontWeight: 700 }}>{c.label}</td>
                        <td style={{ padding: 8, color: PANEL.muted }}>{n.motivo}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

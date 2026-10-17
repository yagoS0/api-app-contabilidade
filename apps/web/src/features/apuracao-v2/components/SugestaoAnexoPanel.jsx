import "./classificacao-notas.css";
import { Button } from "../../../components/ui/Button";
import { TIPOS_CLASSIFICACAO } from "../lib/tiposClassificacao";

import { PANEL, fmtMoney } from "../../notas/components/notasStyles.shared.js";

const CONF = {
  alta: { cor: "var(--state-ok)", label: "alta" },
  media: { cor: "var(--state-warn)", label: "média" },
  revisao: { cor: "var(--state-warn)", label: "revisão" },
};

export function SugestaoAnexoTabela({ data, selecoes = {}, onSelecionar, disabled = false }) {
  if (!data) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, color: PANEL.text }}>
      {!data.perfilConfigurado && (
        <div style={{ padding: 10, background: "var(--state-warn-surface)", border: "1px solid var(--state-warn)", borderRadius: 8, color: "var(--state-warn)", fontSize: "0.875rem" }}>
          ⚠ Perfil não configurado (na sub-aba <strong>Cadastro</strong>). A sugestão roda sem restrição de atividades ativas.
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: "0.875rem" }}>
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
        <div className="classificacao-notas-scroll" role="region" aria-label="Classificação por nota" tabIndex={0} style={{ overflowX: "auto" }}>
          <table className="classificacao-notas-tabela" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem", minWidth: 720 }}>
            <thead>
              <tr style={{ background: PANEL.field, color: PANEL.muted, textAlign: "left" }}>
                <th style={{ padding: 8 }}>Nota</th>
                <th style={{ padding: 8 }}>Tipo</th>
                <th style={{ padding: 8, textAlign: "right" }}>Valor</th>
                <th style={{ padding: 8 }}>Anexo sugerido</th>
                <th style={{ padding: 8 }}>Confiança</th>
                <th style={{ padding: 8 }}>Justificativa</th>
                {onSelecionar && <th style={{ padding: 8 }}>Classificação escolhida</th>}
              </tr>
            </thead>
            <tbody>
              {data.notas.map((n) => {
                const c = CONF[n.confianca] || CONF.media;
                return (
                  <tr key={n.notaId} style={{ borderTop: `1px solid ${PANEL.border}` }}>
                    <td data-label="Nota" style={{ padding: 8, fontFamily: "monospace" }}>{n.numero || n.notaId.slice(0, 8)}</td>
                    <td data-label="Tipo" style={{ padding: 8 }}>{n.tipo === "NFSE" ? "NFS-e" : "NF-e"}</td>
                    <td data-label="Valor" style={{ padding: 8, textAlign: "right" }}>{fmtMoney(n.total)}</td>
                    <td data-label="Anexo sugerido" style={{ padding: 8, fontWeight: 600 }}>
                      {TIPOS_CLASSIFICACAO.find(([tipo]) => tipo === n.tipoReceitaSugerido)?.[1] || n.anexoDominante}
                      {n.anexos.length > 1 && <span style={{ color: PANEL.muted, fontWeight: 400 }}> (+{n.anexos.length - 1})</span>}
                    </td>
                    <td data-label="Confiança" style={{ padding: 8, color: c.cor, fontWeight: 600 }}>{c.label}</td>
                    <td data-label="Justificativa" style={{ padding: 8, color: PANEL.muted }}>{n.motivo}</td>
                    {onSelecionar && <td data-label="Classificação escolhida" style={{ padding: 8, minWidth: 250 }}>
                      <select aria-label={`Anexo da nota ${n.numero || n.notaId}`} value={selecoes[n.notaId] || ""} disabled={disabled || !n.itens}
                        onChange={e => onSelecionar(n.notaId, e.target.value)}
                        style={{ width: "100%", minHeight: 40, color: PANEL.text, background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, padding: 8 }}>
                        <option value="">Manter classificação atual</option>
                        {TIPOS_CLASSIFICACAO.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                      {TIPOS_CLASSIFICACAO.some(([v]) => v === n.tipoReceitaSugerido) && <Button size="sm" variant="secondary" disabled={disabled} style={{ marginTop: 8 }} onClick={() => onSelecionar(n.notaId, n.tipoReceitaSugerido)}>Selecionar sugestão</Button>}
                    </td>}

                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

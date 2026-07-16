// Módulo Fiscal (§1.3) — tabela da sugestão de anexo por nota (só leitura, não grava nada).
// Componente PRESENTACIONAL: recebe `data` já carregado. A competência, o botão "Sugerir" e o
// state vivem no pai (ApuracaoV2Tab), pra sobreviverem à troca de sub-aba e ficarem lado a lado
// com as pendências.
// "revisão" = o classificador não decidiu sozinho. Pra virar pendência de fato, rode
// "Classificar competência" (mesma sub-aba) — a sugestão não cria a fila.

import { PANEL, fmtMoney } from "../../notas/components/notasStyles";

const CONF = {
  alta: { cor: "#69FF47", label: "alta" },
  media: { cor: "#FFB347", label: "média" },
  revisao: { cor: "#FF6E6E", label: "revisão" },
};

export function SugestaoAnexoTabela({ data }) {
  if (!data) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, color: PANEL.text }}>
      {!data.perfilConfigurado && (
        <div style={{ padding: 10, background: "rgba(255,179,71,0.10)", border: "1px solid #FFB347", borderRadius: 8, color: "#FFB347", fontSize: "0.8rem" }}>
          ⚠ Perfil não configurado (na sub-aba <strong>Cadastro</strong>). A sugestão roda sem restrição de atividades ativas.
        </div>
      )}

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
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem", minWidth: 720 }}>
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
    </div>
  );
}

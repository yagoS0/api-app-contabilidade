// Tabelas do relatório SITFIS — a leitura do dia a dia. O PDF oficial fica ao lado, opcional.
//
// O relatório traz um bloco por assunto ("Pendência - Débito (SIEF)", "Pendência - Processo
// Fiscal (SIEF)"…), cada um com SUAS PRÓPRIAS COLUNAS. Por isso a tela não tem um cabeçalho fixo:
// renderiza as colunas que o bloco declarou.
//
// NADA SOME. Bloco que o parser não conseguiu alinhar aparece com as linhas cruas e o aviso de
// conferir no PDF — esconder passaria a impressão de "nada consta", que é o oposto do que se sabe.

const COR = { texto: "#F8F8F2", suave: "#A7B0C0", borda: "#44475A", ok: "#69FF47", alerta: "#FFB347", erro: "#FF5555" };

// Colunas de dinheiro alinham à direita e vão em fonte monoespaçada — comparar valores em coluna
// desalinhada é onde o olho erra.
const COLUNAS_VALOR = new Set(["Vl. Original", "Sdo. Devedor", "Multa", "Juros", "Sdo. Dev. Cons.", "Valor"]);

function Bloco({ bloco }) {
  const { titulo, descricao = [], colunas = [], registros = [], anotacoes = [], naoInterpretado = [] } = bloco;

  return (
    <div style={{ marginTop: 16 }}>
      {titulo && (
        <div style={{ color: COR.texto, fontSize: "0.86rem", fontWeight: 700, marginBottom: 6 }}>{titulo}</div>
      )}

      {descricao.map((d, i) => (
        <div key={i} style={{ color: COR.alerta, fontSize: "0.84rem", marginBottom: 6 }}>{d}</div>
      ))}

      {colunas.length > 0 && registros.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
            <thead>
              <tr>
                {colunas.map((c) => (
                  <th
                    key={c}
                    style={{
                      padding: "6px 8px", color: COR.suave, fontWeight: 600, whiteSpace: "nowrap",
                      textAlign: COLUNAS_VALOR.has(c) ? "right" : "left",
                      borderBottom: `1px solid ${COR.borda}`,
                    }}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {registros.map((r, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${COR.borda}` }}>
                  {colunas.map((c) => (
                    <td
                      key={c}
                      style={{
                        padding: "6px 8px", whiteSpace: "nowrap",
                        textAlign: COLUNAS_VALOR.has(c) ? "right" : "left",
                        fontFamily: COLUNAS_VALOR.has(c) ? "monospace" : "inherit",
                        color: c === "Situação" && /DEVEDOR/i.test(r[c] || "") ? COR.erro : COR.texto,
                      }}
                    >
                      {r[c] || "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {anotacoes.length > 0 && (
        <div style={{ marginTop: 6, color: COR.suave, fontSize: "0.75rem" }}>
          Notificação de lançamento: {anotacoes.join(" · ")}
        </div>
      )}

      {naoInterpretado.length > 0 && (
        <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 6, background: "rgba(255,85,85,0.10)", border: `1px solid ${COR.erro}` }}>
          <div style={{ color: COR.erro, fontSize: "0.8rem", fontWeight: 700, marginBottom: 4 }}>
            Não foi possível alinhar estas linhas em colunas — confira no PDF oficial:
          </div>
          <div style={{ color: COR.suave, fontSize: "0.78rem", fontFamily: "monospace", lineHeight: 1.6 }}>
            {naoInterpretado.join(" · ")}
          </div>
        </div>
      )}
    </div>
  );
}

export function SitfisRelatorioTabela({ relatorio }) {
  if (!relatorio) return null;
  const { diagnosticos = [], naoInterpretado = [] } = relatorio;

  return (
    <div>
      {diagnosticos.map((d) => (
        <div key={d.chave} style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${COR.borda}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <strong style={{ color: COR.texto, fontSize: "0.9rem" }}>{d.orgao}</strong>
            {d.semPendencia && (
              <span style={{ color: COR.ok, fontSize: "0.8rem", fontWeight: 700 }}>Nada consta</span>
            )}
          </div>

          {!d.semPendencia && (d.blocos?.length
            ? d.blocos.map((b, i) => <Bloco key={i} bloco={b} />)
            : (
              <div style={{ marginTop: 8, color: COR.erro, fontSize: "0.8rem" }}>
                Este órgão apontou algo, mas não foi possível ler as seções — confira no PDF oficial.
              </div>
            ))}
        </div>
      ))}

      {naoInterpretado.length > 0 && (
        <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 6, background: "rgba(255,85,85,0.10)", border: `1px solid ${COR.erro}`, color: COR.erro, fontSize: "0.8rem" }}>
          {naoInterpretado.join(" · ")} — confira no PDF oficial.
        </div>
      )}
    </div>
  );
}

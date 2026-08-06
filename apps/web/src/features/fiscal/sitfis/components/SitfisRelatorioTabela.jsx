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

// ⚠ A COLUNA QUE RESPONDE A PERGUNTA.
// A tabela tem CINCO colunas de dinheiro com valores parecidos (e "Vl. Original" e "Sdo. Devedor"
// são quase sempre idênticas), todas com o mesmo peso visual. A que importa — quanto a empresa
// deve HOJE, já com multa e juros — é o saldo consolidado. Sem destacá-la, achar o número certo
// exigia ler o cabeçalho de cinco colunas a cada linha.
const COLUNA_TOTAL = "Sdo. Dev. Cons.";

/** "15.510,72" → 15510.72. `null` quando não é um número reconhecível — nunca 0. */
export function parseValorBR(v) {
  const t = String(v ?? "").trim();
  if (!t) return null;
  if (!/^-?[\d.]+,\d{2}$/.test(t)) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * A soma do saldo consolidado do bloco — ou `null`.
 *
 * ⚠ UMA LINHA ILEGÍVEL INVALIDA O TOTAL INTEIRO, e essa é a regra que este helper existe para
 * garantir. Os valores são STRINGS lidas de um PDF; um total parcial mostraria uma dívida MENOR
 * que a real, e o contador leria o número achando que está conferido. Mesma disciplina da
 * autoverificação do comprovante de arrecadação: só mostra quando fecha.
 *
 * Com uma linha só não há total — a soma seria o próprio valor, repetido logo abaixo dele.
 */
export function totalDoBloco(colunas, registros, coluna = COLUNA_TOTAL) {
  if (!colunas?.includes(coluna) || !registros || registros.length < 2) return null;
  let soma = 0;
  for (const r of registros) {
    const v = parseValorBR(r[coluna]);
    if (v === null) return null;
    soma += v;
  }
  // Centavos: somar float acumula erro (0,1+0,2). O arredondamento é de APRESENTAÇÃO.
  return Math.round(soma * 100) / 100;
}

const fmtBRL = (n) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function Bloco({ bloco }) {
  const { titulo, descricao = [], colunas = [], registros = [], anotacoes = [], naoInterpretado = [] } = bloco;

  // "Quanto esta empresa deve?" é a pergunta que a tela existe para responder, e com IRPJ + CSLL +
  // PIS + COFINS ela exigia somar quatro valores de cabeça. A regra de quando NÃO somar está em
  // `totalDoBloco`, com teste.
  const totalConsolidado = totalDoBloco(colunas, registros);

  // Coluna cujo valor é o MESMO em todas as linhas não informa nada e ainda ocupa espaço — o caso
  // real é "Situação: DEVEDOR" repetido em cada linha de um bloco de pendências. Vira uma nota
  // única acima da tabela, e a coluna sai.
  const colunasConstantes = colunas.filter((c) => {
    if (registros.length < 2 || COLUNAS_VALOR.has(c)) return false;
    const primeiro = registros[0][c];
    return Boolean(primeiro) && registros.every((r) => r[c] === primeiro);
  });
  const colunasVisiveis = colunas.filter((c) => !colunasConstantes.includes(c));

  return (
    <div style={{ marginTop: 16 }}>
      {titulo && (
        <div style={{ color: COR.texto, fontSize: "0.86rem", fontWeight: 700, marginBottom: 6 }}>{titulo}</div>
      )}

      {descricao.map((d, i) => (
        <div key={i} style={{ color: COR.alerta, fontSize: "0.84rem", marginBottom: 6 }}>{d}</div>
      ))}

      {/* Coluna com valor idêntico em todas as linhas vira UMA nota, não uma coluna repetida. */}
      {colunasConstantes.length > 0 && (
        <div style={{ color: COR.suave, fontSize: "0.76rem", marginBottom: 4 }}>
          {colunasConstantes.map((c) => (
            <span key={c} style={{ marginRight: 12 }}>
              {c}: <strong style={{ color: /DEVEDOR/i.test(registros[0][c]) ? COR.erro : COR.texto }}>{registros[0][c]}</strong>
              <span style={{ color: COR.suave }}> (todas as linhas)</span>
            </span>
          ))}
        </div>
      )}

      {colunasVisiveis.length > 0 && registros.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
            <thead>
              <tr>
                {colunasVisiveis.map((c) => (
                  <th
                    key={c}
                    style={{
                      padding: "6px 8px", fontWeight: c === COLUNA_TOTAL ? 800 : 600, whiteSpace: "nowrap",
                      color: c === COLUNA_TOTAL ? COR.texto : COR.suave,
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
                /* Zebra: com sete colunas numéricas seguidas, o olho perde a linha no meio do
                   caminho e lê o juros de uma no saldo de outra. */
                <tr key={i} style={{ borderTop: `1px solid ${COR.borda}`, background: i % 2 ? "rgba(255,255,255,0.02)" : "transparent" }}>
                  {colunasVisiveis.map((c) => (
                    <td
                      key={c}
                      style={{
                        padding: "6px 8px",
                        // ⚠ A descrição da receita PODE quebrar; o resto não.
                        // No Presumido ela vem com a denominação inteira ("2172-01 COFINS -
                        // FATURAMENTO/PJ EM GERAL"). Com `nowrap` em tudo, uma string dessas
                        // empurrava as colunas de dinheiro para fora da tela.
                        whiteSpace: COLUNAS_VALOR.has(c) || c !== "Receita" ? "nowrap" : "normal",
                        textAlign: COLUNAS_VALOR.has(c) ? "right" : "left",
                        fontFamily: COLUNAS_VALOR.has(c) ? "monospace" : "inherit",
                        fontWeight: c === COLUNA_TOTAL ? 700 : 400,
                        color: c === COLUNA_TOTAL ? COR.erro
                          : c === "Situação" && /DEVEDOR/i.test(r[c] || "") ? COR.erro
                            : COR.texto,
                      }}
                    >
                      {r[c] || "—"}
                    </td>
                  ))}
                </tr>
              ))}

              {totalConsolidado !== null && (
                <tr style={{ borderTop: `2px solid ${COR.borda}` }}>
                  {colunasVisiveis.map((c, idx) => (
                    <td
                      key={c}
                      style={{
                        padding: "7px 8px", whiteSpace: "nowrap",
                        textAlign: c === COLUNA_TOTAL ? "right" : "left",
                        fontFamily: c === COLUNA_TOTAL ? "monospace" : "inherit",
                        fontWeight: 800,
                        color: c === COLUNA_TOTAL ? COR.erro : COR.suave,
                      }}
                    >
                      {/* O rótulo diz que a soma é DA TELA, não um total que a RFB declarou. */}
                      {idx === 0 ? `Total (${registros.length} pendências)` : c === COLUNA_TOTAL ? fmtBRL(totalConsolidado) : ""}
                    </td>
                  ))}
                </tr>
              )}
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

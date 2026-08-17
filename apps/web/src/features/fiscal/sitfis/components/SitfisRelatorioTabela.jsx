// Tabelas do relatório SITFIS — a leitura do dia a dia. O PDF oficial fica ao lado, opcional.
//
// O relatório traz um bloco por assunto ("Pendência - Débito (SIEF)", "Pendência - Processo
// Fiscal (SIEF)"…), cada um com SUAS PRÓPRIAS COLUNAS. Por isso a tela não tem um cabeçalho fixo:
// renderiza as colunas que o bloco declarou.
//
// NADA SOME. Bloco que o parser não conseguiu alinhar aparece com as linhas cruas e o aviso de
// conferir no PDF — esconder passaria a impressão de "nada consta", que é o oposto do que se sabe.
//
// ⚠ A TELA MOSTRA AS COLUNAS QUE O PDF MOSTRA — TODAS ELAS, SEMPRE (pedido do dono, 17/08/2026:
// *"é a tabela de débitos, preciso que essa tabela seja consistente"*).
//
// Até aqui havia a regra oposta, `colunasConstantes`: coluna NÃO-monetária cujo valor se repetisse
// em TODAS as linhas saía da tabela e virava uma nota ("Situação: DEVEDOR (todas as linhas)"). Ela
// nasceu de um caso real e razoável — a coluna "Situação" com "DEVEDOR" linha a linha, ocupando
// espaço sem informar nada (commit f8768d10). **Ela foi REMOVIDA, e o motivo é o pedido acima:**
//
//  1. **Ela se volta contra tabela CURTA.** Numa empresa com DUAS linhas, `PA/Exerc.`, `Dt. Vcto` e
//     `Situação` coincidem por acaso — e as SEIS colunas do relatório viravam TRÊS na tela. Medido
//     nos 22 relatórios reais guardados em produção (17/08/2026): **19 colunas perdidas em 13
//     tabelas, em 12 das 17 empresas com tabela.** O caso da empresa de duas linhas está travado em
//     `__tests__/colunasNuncaSomem.test.jsx`.
//  2. **Um conjunto de colunas que muda com os dados nunca é consistente.** A MESMA empresa podia
//     mostrar 6 colunas num mês e 3 no outro, sem nada na tela explicando a diferença — e a
//     coincidência que dispara o colapso não tem significado fiscal nenhum.
//
// ⚠ E o motivo NÃO era espaço de tela: a tabela já vive num contêiner com `overflow-x: auto`.
// Quando não couber, quem cede é o LAYOUT (rolagem), nunca o dado do relatório fiscal.
// Se um dia alguma coluna se revelar vazia em 100% dos casos, isso é decisão do dono — não é
// motivo para a tela voltar a decidir sozinha o que mostrar.

const COR = { texto: "#F8F8F2", suave: "#A7B0C0", borda: "#44475A", ok: "#69FF47", alerta: "#FFB347", erro: "#FF5555" };

// Colunas de dinheiro alinham à direita e vão em fonte monoespaçada — comparar valores em coluna
// desalinhada é onde o olho erra.
// ⚠ `Vl.Original`/`Sdo.Devedor` (sem espaço) NÃO são erro de digitação: é assim que o bloco
// "Débito com Exigibilidade Suspensa (SIEF)" imprime o cabeçalho, enquanto "Pendência - Débito
// (SIEF)" imprime com espaço. As duas grafias existem no mesmo relatório — ver `COLUNAS_CONHECIDAS`
// em `parseSitfisRelatorio.js`. Sem as duas, a coluna de dinheiro do bloco suspenso ficava alinhada
// à esquerda e em fonte proporcional, que é onde o olho troca um valor pelo outro.
const COLUNAS_VALOR = new Set([
  "Vl. Original", "Sdo. Devedor", "Vl.Original", "Sdo.Devedor",
  "Multa", "Juros", "Sdo. Dev. Cons.", "Valor",
]);

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

  // ⚠ O QUARTO ESTADO — o bloco que não virou tabela e também não caiu em `naoInterpretado`.
  //
  // `montarTabela` (parser) varre o começo do bloco atrás de um rótulo de `COLUNAS_CONHECIDAS`.
  // Enquanto não acha, tudo vai para `descricao` — então, quando NENHUM rótulo bate, o bloco INTEIRO
  // sai em `descricao` e `naoInterpretado` fica VAZIO (o `slice` já não tem sobra para pôr nele).
  // Na tela isso aparecia como linhas soltas, sem uma palavra dizendo que não foram interpretadas:
  // ausência de leitura com cara de conteúdo. O caso real é o bloco do parcelamento (SIEFPAR), que é
  // rótulo/valor intercalado.
  //
  // ⚠ Aqui só se torna a ausência VISÍVEL. Nada é interpretado: as linhas continuam na ordem exata
  // em que o relatório as imprime, sem virar tabela, sem pares rótulo→valor. Tabular o SIEFPAR é
  // decisão de produto, e está pendente do dono.
  const naoVirouTabela = colunas.length === 0 && registros.length === 0 && descricao.length > 0;

  return (
    <div style={{ marginTop: 16 }}>
      {titulo && (
        <div style={{ color: COR.texto, fontSize: "0.86rem", fontWeight: 700, marginBottom: 6 }}>{titulo}</div>
      )}

      {/* Descrição livre que vem ANTES do cabeçalho ("SIMPLES NACIONAL - EM PARCELAMENTO"). Quando
          o bloco tem colunas, ela é exatamente isto: uma linha de contexto, e o bloco foi lido. */}
      {!naoVirouTabela && descricao.map((d, i) => (
        <div key={i} style={{ color: COR.alerta, fontSize: "0.84rem", marginBottom: 6 }}>{d}</div>
      ))}

      {/* ⚠ AUSÊNCIA NUNCA É RESPOSTA: o bloco que não foi interpretado DIZ que não foi, e por quê.
          Âmbar, e não vermelho: aqui o parser não encontrou cabeçalho nenhum (o formato do bloco é
          outro) — diferente de `naoInterpretado`, onde ele achou colunas e as linhas não fecharam,
          que é o caso com risco de dado faltando. */}
      {naoVirouTabela && (
        <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(255,179,71,0.10)", border: `1px solid ${COR.alerta}`, marginBottom: 6 }}>
          <div style={{ color: COR.alerta, fontSize: "0.8rem", fontWeight: 700, marginBottom: 4 }}>
            Este bloco não foi interpretado como tabela: nenhuma das linhas dele é um cabeçalho de
            coluna conhecido do relatório.
          </div>
          <div style={{ color: COR.suave, fontSize: "0.76rem", marginBottom: 6 }}>
            As linhas aparecem abaixo na ordem exata em que o relatório as imprime — nada foi
            reordenado nem emparelhado. Confira no PDF oficial.
          </div>
          <div style={{ color: COR.texto, fontSize: "0.8rem", fontFamily: "monospace", lineHeight: 1.6 }}>
            {descricao.map((d, i) => (
              <div key={i}>{d}</div>
            ))}
          </div>
        </div>
      )}

      {colunas.length > 0 && registros.length > 0 && (
        /* ⚠ A ROLAGEM É QUEM CEDE. Tabela larga rola dentro do contêiner; coluna do relatório
           fiscal não some para caber na tela. */
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
            <thead>
              <tr>
                {colunas.map((c) => (
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
                  {colunas.map((c) => (
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
                  {colunas.map((c, idx) => (
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

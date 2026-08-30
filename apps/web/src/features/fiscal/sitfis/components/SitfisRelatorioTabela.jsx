// ⚠⚠ ESPELHO — ESTE ARQUIVO TEM UMA CÓPIA DELIBERADA NO PORTAL DO CLIENTE.
//
//   `apps/portal-cliente-web/src/features/fiscal/RelatorioSitfis.jsx`
//
// ⚠ A regra veio inteira (cada bloco declara as próprias colunas; a tela mostra as que o PDF
// mostra; uma linha ilegível invalida o total do bloco; nada some). ⚠⚠ DUAS coisas divergem de
// propósito: a paleta (lá é clara) e DUAS frases — **o cliente não tem o PDF**, e `situacao` nula
// **nunca** lê como "em dia".
//
// ⚠ Os dois frontends NÃO compartilham código; a obrigação de sincronizar é de quem edita, e a
// tabela "mudou lá, muda aqui" vive em `apps/portal-cliente-web/CLAUDE.md`. ⚠ Duas leituras da
// mesma regra divergem na primeira correção — e a divergência aparece como as duas telas afirmando
// coisas diferentes sobre a MESMA empresa, que é o defeito mais caro de achar.
//
// ⚠ Este aviso foi acrescentado em 24/08/2026: até então **12 dos 13 originais eram mudos** sobre
// ter cópia, e a tabela do `CLAUDE.md` só é consultada por quem já sabe que ela existe.

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

const COR = { texto: "#F8F8F2", suave: "#A7B0C0", borda: "#44475A", ok: "var(--success)", alerta: "#FFB347", erro: "#FF5555" };

// Colunas de dinheiro alinham à direita e vão em fonte monoespaçada — comparar valores em coluna
// desalinhada é onde o olho erra.
// ⚠ `Vl.Original`/`Sdo.Devedor` (sem espaço) NÃO são erro de digitação: é assim que o bloco
// "Débito com Exigibilidade Suspensa (SIEF)" imprime o cabeçalho, enquanto "Pendência - Débito
// (SIEF)" imprime com espaço. As duas grafias existem no mesmo relatório — ver `COLUNAS_CONHECIDAS`
// em `parseSitfisRelatorio.js`. Sem as duas, a coluna de dinheiro do bloco suspenso ficava alinhada
// à esquerda e em fonte proporcional, que é onde o olho troca um valor pelo outro.
// ⚠ `Valor em Atraso`/`Valor Suspenso` entraram em 17/08/2026, com a tabulação do bloco do
// parcelamento (SIEFPAR): são as duas colunas de dinheiro DELE. Sem elas aqui, o valor do
// parcelamento sairia alinhado à esquerda e em fonte proporcional, que é onde o olho troca um
// valor pelo outro — a mesma falta que `Vl.Original` teve.
const COLUNAS_VALOR = new Set([
  "Vl. Original", "Sdo. Devedor", "Vl.Original", "Sdo.Devedor",
  "Multa", "Juros", "Sdo. Dev. Cons.", "Valor",
  "Valor em Atraso", "Valor Suspenso",
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

/**
 * ⚠ O RÓTULO DA ANOTAÇÃO É O QUE O PDF IMPRIME — E ISSO DEIXOU DE SER SEMPRE O MESMO.
 *
 * Até a leitura POSICIONAL entrar, `anotacoes` só podia vir de uma linha `Notificação de
 * lançamento:` — o parser de texto não reconhece outra —, e por isso a tela cravava esse rótulo.
 * A leitura posicional lê QUALQUER par `Rótulo: valor` do relatório, e o primeiro que ela trouxe
 * foi `Situação:` (`ATIVA A SER COBRADA`, `AJUIZADA`, `NEGOCIADA NO SISPAR`…), dos blocos de
 * dívida ativa (SIDA). Mantido o rótulo fixo, a tela diria "Notificação de lançamento: ATIVA A
 * SER COBRADA" — um rótulo FALSO sobre dado fiscal, exatamente o que não se faz.
 *
 * `anotacoesPorRegistro` traz o rótulo que o PDF imprimiu, amarrado ao registro. Aqui ele é usado
 * SÓ para nomear — a promoção de `Situação` a COLUNA da tabela é decisão de produto e não foi
 * tomada (ela é impressa numa linha própria, fora do grid do cabeçalho).
 *
 * ⚠ Só agrupa quando os rótulos cobrem EXATAMENTE as anotações (mesmo multiconjunto de valores).
 * Qualquer sobra e a função devolve `null`, e a tela volta ao rótulo de hoje — nunca se inventa
 * rótulo nem se esconde anotação.
 *
 * @returns {{rotulo: string, valores: string[]}[] | null}
 */
export function anotacoesComRotulo(anotacoes = [], porRegistro = []) {
  if (!Array.isArray(porRegistro) || !porRegistro.length) return null;
  const pares = [];
  for (const r of porRegistro) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return null;
    for (const [rotulo, valor] of Object.entries(r)) pares.push([rotulo, valor]);
  }
  if (pares.length !== anotacoes.length) return null;

  const restante = new Map();
  for (const v of anotacoes) restante.set(v, (restante.get(v) || 0) + 1);
  for (const [, valor] of pares) {
    const n = restante.get(valor);
    if (!n) return null;
    restante.set(valor, n - 1);
  }

  const grupos = [];
  for (const [rotulo, valor] of pares) {
    const g = grupos.find((x) => x.rotulo === rotulo);
    if (g) g.valores.push(valor);
    else grupos.push({ rotulo, valores: [valor] });
  }
  return grupos;
}

function Bloco({ bloco }) {
  const {
    titulo, descricao = [], colunas = [], registros = [], anotacoes = [], naoInterpretado = [],
    anotacoesPorRegistro = [], aviso = null,
  } = bloco;
  const gruposDeAnotacao = anotacoesComRotulo(anotacoes, anotacoesPorRegistro);

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
  // ausência de leitura com cara de conteúdo.
  //
  // ⚠ O CASO QUE ORIGINOU ESTE ESTADO — o bloco do parcelamento (SIEFPAR) — SAIU DELE em
  // 17/08/2026: o dono decidiu tabular o bloco, e o parser passou a lê-lo por PARES
  // (`montarTabelaDePares`), então ele chega aqui já com `colunas` e `registros`. O que ainda cai
  // neste estado, medido nos 22 relatórios reais, são os blocos
  // "Parcelamento com Exigibilidade Suspensa (PARCSN/PARCMEI)", cuja única linha é uma descrição
  // livre ("SIMPLES NACIONAL - EM PARCELAMENTO"): sem rótulo não há par, e forçar tabela ali seria
  // inventar o layout.
  //
  // ⚠ Aqui só se torna a ausência VISÍVEL. Nada é interpretado: as linhas continuam na ordem exata
  // em que o relatório as imprime, sem virar tabela, sem pares rótulo→valor.
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
        gruposDeAnotacao
          ? gruposDeAnotacao.map((g) => (
            <div key={g.rotulo} style={{ marginTop: 6, color: COR.suave, fontSize: "0.75rem" }}>
              {g.rotulo}: {g.valores.join(" · ")}
            </div>
          ))
          : (
            <div style={{ marginTop: 6, color: COR.suave, fontSize: "0.75rem" }}>
              Notificação de lançamento: {anotacoes.join(" · ")}
            </div>
          )
      )}

      {/*
        ⚠⚠ LÁPIDE — O BLOCO NÃO INTERPRETADO SAIU DA TELA EM 28/08/2026, POR DECISÃO DO DONO.

        Pedido literal, para publicar: *"precisamos fazer é tirar da situação fiscal a parte que não
        pode ser montada"*. Perguntado se ficava uma linha discreta no lugar, ele escolheu
        **"tirar tudo, sem marca nenhuma"**.

        ⚠⚠ ISTO REVERTE UMA REGRA ESCRITA DESTE ARQUIVO, e ela fica registrada porque continua
        verdadeira como argumento: *"A tabela nunca some. Bloco ilegível aparece com as linhas cruas
        e o aviso de conferir no PDF — esconder passaria a impressão de 'nada consta', o oposto do
        que se sabe."*

        ⚠ A CONSEQUÊNCIA FOI MEDIDA E ACEITA POR ELE: sobre os 22 relatórios reais de produção são
        **3 blocos** que caem em `naoInterpretado` — entre eles o `Pendência - Inscrição (SIDA)` de
        40.444.555/0001-64, que é dívida ativa. Eles deixam de aparecer nesta tela. Quem decidiu é o
        contador, que é quem lê o PDF oficial e responde pela conclusão.

        ⚠ O DADO NÃO SUMIU DO SISTEMA: `parseSitfisRelatorio` continua devolvendo `naoInterpretado`,
        e `scripts/diag-sitfis-tabelas.mjs` continua contando. O que saiu é o RENDER.
      */}
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

    </div>
  );
}

// AS TABELAS DO RELATÓRIO SITFIS, na paleta CLARA do cliente.
//
// ⚠ Espelho de `apps/web/src/features/fiscal/sitfis/components/SitfisRelatorioTabela.jsx` — a de lá
// é escura e com cor hardcoded, e os dois apps não compartilham código. As REGRAS vieram inteiras;
// o que mudou foi a paleta (classes daqui) e as duas coisas abaixo, as duas por causa de QUEM LÊ.
//
// ⚠⚠ 1. ONDE O ESCRITÓRIO MANDA "confira no PDF oficial", O CLIENTE NÃO TEM O PDF. Ele é servido por
// uma rota do escritório e não viaja para cá. Repetir a frase mandaria o cliente atrás de um
// documento que ele não consegue abrir — a saída dele é uma só, e é falar com o contador.
//
// ⚠⚠ 2. NADA AQUI CONSULTA NADA. Não existe botão de consultar situação fiscal neste portal: a
// consulta ao SERPRO é PAGA e o limite é por CONTRATANTE — uma consulta à toa de uma empresa
// consome o limite da carteira inteira do escritório.
//
// ⚠ NADA SOME. Bloco que o interpretador não conseguiu alinhar aparece com as linhas CRUAS e o
// aviso. Esconder passaria a impressão de "nada consta", que é o oposto do que se sabe.

import { brl } from "../../lib/format";
import { COLUNAS_VALOR, COLUNA_TOTAL, naoVirouTabela, totalDoBloco } from "./lib/situacaoFiscalNaTela";

const FALE_COM_O_CONTADOR = "Fale com o seu contador sobre estas linhas.";

function Bloco({ bloco }) {
  const { titulo, descricao = [], colunas = [], registros = [], anotacoes = [], naoInterpretado = [] } = bloco;
  const total = totalDoBloco(colunas, registros);
  const cru = naoVirouTabela(bloco);

  return (
    <div className="sitfis-bloco">
      {titulo ? <h4 className="sitfis-bloco-titulo">{titulo}</h4> : null}

      {/* Descrição livre que vem ANTES do cabeçalho ("SIMPLES NACIONAL - EM PARCELAMENTO").
          Com colunas no bloco, ela é exatamente isto: uma linha de contexto. */}
      {!cru && descricao.map((d, i) => <p key={i} className="meta">{d}</p>)}

      {/* ⚠ AUSÊNCIA NUNCA É RESPOSTA: o bloco que não foi interpretado DIZ que não foi.
          Âmbar, e não vermelho: aqui nenhum cabeçalho foi reconhecido (o formato do bloco é outro)
          — diferente de `naoInterpretado`, onde havia colunas e as linhas não fecharam, que é o
          caso com risco de dado faltando. */}
      {cru ? (
        <div className="alerta alerta-aviso">
          <strong>Não conseguimos organizar este trecho em tabela.</strong> As linhas aparecem abaixo
          na ordem exata em que o relatório as imprime. {FALE_COM_O_CONTADOR}
          <div className="sitfis-cru">
            {descricao.map((d, i) => <div key={i}>{d}</div>)}
          </div>
        </div>
      ) : null}

      {colunas.length > 0 && registros.length > 0 ? (
        /* ⚠ A ROLAGEM É QUEM CEDE. Tabela larga rola dentro do contêiner; coluna de relatório
           fiscal não some para caber na tela. */
        <div className="table-wrap">
          <table className="table table--sitfis">
            <thead>
              <tr>
                {colunas.map((c) => (
                  <th
                    key={c}
                    scope="col"
                    className={COLUNAS_VALOR.has(c) ? "num" : undefined}
                    data-coluna-total={c === COLUNA_TOTAL ? "sim" : undefined}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {registros.map((r, i) => (
                <tr key={i}>
                  {colunas.map((c) => (
                    <td
                      key={c}
                      className={COLUNAS_VALOR.has(c) ? "num" : undefined}
                      data-coluna-total={c === COLUNA_TOTAL ? "sim" : undefined}
                      /* ⚠ Só a descrição da receita PODE quebrar de linha: no Presumido ela vem com
                         a denominação inteira ("2172-01 COFINS - FATURAMENTO/PJ EM GERAL"), e com
                         tudo em `nowrap` ela empurra as colunas de dinheiro para fora da tela. */
                      data-quebra={c === "Receita" ? "sim" : undefined}
                    >
                      {r[c] || "—"}
                    </td>
                  ))}
                </tr>
              ))}

              {total !== null ? (
                <tr data-linha-total="sim">
                  {colunas.map((c, idx) => (
                    <td
                      key={c}
                      className={c === COLUNA_TOTAL ? "num" : undefined}
                      data-coluna-total={c === COLUNA_TOTAL ? "sim" : undefined}
                    >
                      {/* O rótulo diz que a soma é DA TELA, não um total que a Receita declarou. */}
                      {idx === 0
                        ? <strong>{`Total (${registros.length} pendências)`}</strong>
                        : c === COLUNA_TOTAL
                          ? <strong>{brl(total)}</strong>
                          : ""}
                    </td>
                  ))}
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {anotacoes.length > 0 ? (
        <p className="meta">Notificação de lançamento: {anotacoes.join(" · ")}</p>
      ) : null}

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

export function RelatorioSitfis({ relatorio }) {
  if (!relatorio) return null;
  const { diagnosticos = [], naoInterpretado = [] } = relatorio;

  return (
    <div>
      {diagnosticos.map((d) => (
        <section key={d.chave} className="sitfis-orgao" aria-label={d.orgao}>
          <div className="sitfis-orgao-cabecalho">
            <h3>{d.orgao}</h3>
            {/* Verde é CONCLUÍDO, nunca ação — e aqui ele diz um fato do relatório, não um estado
                da empresa hoje. A data de quando isso foi apurado fica no topo da página. */}
            {d.semPendencia ? <span className="sitfis-nada-consta">Nada consta</span> : null}
          </div>

          {!d.semPendencia
            ? (d.blocos?.length
              ? d.blocos.map((b, i) => <Bloco key={i} bloco={b} />)
              : (
                <div className="alerta alerta-erro">
                  <strong>Este órgão apontou algo, mas não conseguimos ler as seções do
                  relatório.</strong> {FALE_COM_O_CONTADOR}
                </div>
              ))
            : null}
        </section>
      ))}

    </div>
  );
}

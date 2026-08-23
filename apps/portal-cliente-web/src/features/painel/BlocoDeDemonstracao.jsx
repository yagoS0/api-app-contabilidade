// O BLOCO DE DEMONSTRAÇÃO — fluxo de caixa ⇄ DRE.
//
// ⚠⚠ O SELO É DIRIGIDO PELO DADO, NÃO PELO AMBIENTE, e a leitura é `demonstracao !== false`.
//
// Com `=== true`, uma resposta que simplesmente NÃO trouxesse o campo — backend novo que esqueceu,
// coluna fora de um `select` explícito (a armadilha que já mordeu três vezes neste projeto) —
// apresentaria ficção como fato, em silêncio. Com `!== false`, o modo de falhar vira "selo a mais",
// que é barato. É a mesma regra que o portão de emissão já segue: AUSENTE NÃO É `false`.
//
// ⚠ E não pode depender de `api.mode`: o aviso "Modo demonstração" do login vive dele e **some no
// modo real**. Quem afirma que o número é fictício tem de ser a resposta.
//
// ⚠ FLUXO ⇄ DRE SÃO VISÕES, NÃO ROTAS — `<button>`, jamais `<a href>`. Não há URL para uma visão, e
// inventar `#/dre` daria um hash que o `useRota` recusa e devolve para o padrão: o "filtro
// fantasma" dentro da própria tela.

import { useEffect, useState } from "react";
import { api } from "../../api";
import { AlertaErro, Carregando } from "../../components/ui";
import { useCarregamento } from "../../lib/hooks";
import { brl } from "../../lib/format";
import { PainelDoDia } from "./PainelDoDia";

const VISOES = [
  { chave: "fluxo", rotulo: "Fluxo de caixa" },
  { chave: "dre", rotulo: "DRE" },
];

/** ⚠ `!== false`: só some quando o servidor AFIRMA que o dado é real. Ver o topo do arquivo. */
export function ehDemonstracao(dados) {
  return dados?.demonstracao !== false;
}

function Selo() {
  return (
    <p className="alerta alerta-aviso demonstracao-selo" role="status">
      <strong>Dados de demonstração.</strong> Estes números não são da sua empresa — eles servem
      para mostrar como a tela vai funcionar. Fale com o seu contador sobre os seus números.
    </p>
  );
}

/**
 * `"2026-08-18"` → `18`. Por fatia de string, nunca `new Date`: aqui o dado é data CIVIL.
 */
const numeroDoDia = (dia) => Number(String(dia).slice(8, 10));

/**
 * O dia de HOJE em `"YYYY-MM-DD"`, no relógio de quem lê.
 *
 * ⚠ Sem `toISOString()`: ele converte para UTC, e às 22h de Brasília (UTC-3) devolveria a data de
 * AMANHÃ — a mesma armadilha que `features/emitir/EmitirNotaPage.jsx` já registra.
 */
function diaDeHoje() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function Fluxo({ dados, aoAbrirDia }) {
  const hoje = diaDeHoje();

  return (
    /* ⚠ A ROLAGEM É DESTA TABELA, e o motivo é a página: 31 linhas empurrariam o conteúdo REAL
       abaixo dela (os três cards do mês e "Próximos vencimentos") para ~1.200px fora da dobra. */
    <div className="table-wrap table-wrap--alto">
      <table className="table table--fluxo">
        <thead>
          <tr>
            <th scope="col">Dia</th>
            <th scope="col" className="num">Entradas</th>
            <th scope="col" className="num">Saídas</th>
            <th scope="col" className="num">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {dados.dias.map((d) => {
            const vazio = d.entradas === 0 && d.saidas === 0;
            const numero = numeroDoDia(d.dia);
            return (
              /* ⚠⚠ LINHA CLICÁVEL — a PRIMEIRA deste app, e a decisão escrita contra ela é sobre
                 OUTRA tela. O `CLAUDE.md` diz da lista de NOTAS: *"ela teria um destino só — a tela
                 que pratica ato fiscal — e clique acidental ali é caro"*. Aqui o destino é um painel
                 de LEITURA: o argumento não transfere, e isto fica escrito para o próximo não achar
                 que a regra foi ignorada.

                 ⚠ A linha e o botão chamam o MESMO `aoAbrirDia`, e NÃO há `stopPropagation`: o
                 handler é idempotente de propósito — abrir o dia 18 duas vezes é abrir o dia 18.
                 ⚠ E `role="button"` na `<tr>` seria o caminho errado: tiraria a linha da semântica
                 de tabela para quem usa leitor de tela. Quem carrega o papel de controle é o
                 `<button>` da célula do dia. */
              <tr
                key={d.dia}
                onClick={() => aoAbrirDia(d.dia)}
                data-vazio={vazio ? "sim" : undefined}
                data-hoje={d.dia === hoje ? "sim" : undefined}
              >
                <th scope="row">
                  <button
                    type="button"
                    className="dia-botao"
                    onClick={() => aoAbrirDia(d.dia)}
                    aria-label={`Abrir o dia ${numero}`}
                  >
                    {numero}
                  </button>
                </th>
                <td className="num">{brl(d.entradas)}</td>
                <td className="num">{brl(d.saidas)}</td>
                <td className="num" data-negativo={d.saldo < 0 ? "sim" : undefined}>
                  {brl(d.saldo)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">No mês</th>
            <td className="num">{brl(dados.totais.entradas)}</td>
            <td className="num">{brl(dados.totais.saidas)}</td>
            {/* ⚠ ESTA CÉLULA NÃO É A SOMA DA COLUNA — somar saldo acumulado não significa nada. É o
                saldo no ÚLTIMO dia do mês, e o `title` diz isso para quem alinhar a coluna com o
                olho e esperar um total. */}
            <td
              className="num"
              title="Saldo no fim do mês"
              data-negativo={dados.totais.saldoFinal < 0 ? "sim" : undefined}
            >
              <strong>{brl(dados.totais.saldoFinal)}</strong>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Dre({ dados }) {
  return (
    <div className="table-wrap">
      <table className="table table--dre">
        <tbody>
          {dados.linhas.map((l) => {
            const forte = l.tipo === "subtotal" || l.tipo === "resultado";
            // ⚠ VERMELHO SÓ NO RESULTADO, nunca na dedução. Imposto sobre a receita é negativo por
            // DEFINIÇÃO — pintar toda linha de menos deixaria o DRE inteiro vermelho num mês de
            // lucro, e nesta casa cor forte quer dizer "isto pede ação agora". O que pede ação é
            // fechar o mês no prejuízo; o sinal do abatimento já está no próprio número.
            const alerta = forte && l.valor < 0;
            return (
              <tr key={l.chave} data-linha-dre={l.tipo}>
                <td>{forte ? <strong>{l.rotulo}</strong> : l.rotulo}</td>
                <td className="num" data-negativo={alerta ? "sim" : undefined}>
                  {forte ? <strong>{brl(l.valor)}</strong> : brl(l.valor)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function BlocoDeDemonstracao({ companyId, competencia }) {
  const [visao, setVisao] = useState("fluxo");
  // ⚠ O ÍNDICE, e não a string do dia: o painel anda com ‹ › e precisa saber onde estão as bordas
  // do mês. Guardar a string obrigaria a procurá-la no array a cada passo, e "não achei" viraria
  // um painel vazio em vez de um botão desabilitado.
  const [diaAberto, setDiaAberto] = useState(null);

  const fluxoQuery = useCarregamento(
    () => api.getFluxoCaixa(companyId, { competencia }),
    [companyId, competencia],
    { habilitado: visao === "fluxo" },
  );
  const dreQuery = useCarregamento(
    () => api.getDre(companyId, { competencia }),
    [companyId, competencia],
    { habilitado: visao === "dre" },
  );

  const atual = visao === "fluxo" ? fluxoQuery : dreQuery;
  const dados = atual.dados;
  const diasDoFluxo = fluxoQuery.dados?.dias || [];

  // ⚠ Trocar de empresa, de mês ou de visão FECHA o painel. Sem isto ele continuaria aberto
  // mostrando o dia 18 de agosto enquanto a tabela atrás já é setembro — e é a mesma classe de
  // defeito que a competência única existe para impedir: duas telas afirmando coisas diferentes.
  useEffect(() => {
    setDiaAberto(null);
  }, [companyId, competencia, visao]);

  function abrirDia(dia) {
    const i = diasDoFluxo.findIndex((d) => d.dia === dia);
    if (i >= 0) setDiaAberto(i);
  }

  return (
    <section
      className="card demonstracao"
      aria-label="Fluxo de caixa e DRE"
      /* ⚠ Auditável no DOM, como `data-status` e `data-estado-nota`: quem inspecionar a página
         consegue provar qual bloco é demonstração sem depender de ler o texto do selo. */
      data-demonstracao={ehDemonstracao(dados) ? "sim" : "nao"}
    >
      <div className="card-header">
        <h2>{visao === "fluxo" ? "Fluxo de caixa" : "DRE"}</h2>
        {/* ⚠ `mode="view"`: trocar de visão NÃO navega, então são botões. */}
        <div className="page-actions" role="group" aria-label="Visão do painel">
          {VISOES.map((v) => (
            <button
              key={v.chave}
              type="button"
              className={v.chave === visao ? "btn btn-primary" : "btn"}
              aria-pressed={v.chave === visao}
              onClick={() => setVisao(v.chave)}
            >
              {v.rotulo}
            </button>
          ))}
        </div>
      </div>

      {ehDemonstracao(dados) ? <Selo /> : null}

      {atual.carregando ? <Carregando /> : null}

      <AlertaErro
        erro={atual.erro}
        padrao="Não foi possível montar o painel."
        aoTentarNovamente={atual.recarregar}
      />

      {!atual.carregando && !atual.erro && dados ? (
        visao === "fluxo" ? <Fluxo dados={dados} aoAbrirDia={abrirDia} /> : <Dre dados={dados} />
      ) : null}

      {/* ⚠ Montado condicionalmente no fim, irmão do conteúdo — o mesmo arranjo dos outros dois
          diálogos do app (`SeletorEmpresa`, `ConfirmarCancelamento`). Não há `createPortal` aqui e
          não é a hora de introduzir um. */}
      {diaAberto !== null ? (
        <PainelDoDia
          dias={diasDoFluxo}
          indice={diaAberto}
          aoFechar={() => setDiaAberto(null)}
          aoIr={setDiaAberto}
        />
      ) : null}
    </section>
  );
}

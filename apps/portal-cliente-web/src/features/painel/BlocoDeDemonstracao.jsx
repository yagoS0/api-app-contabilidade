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

import { useState } from "react";
import { api } from "../../api";
import { AlertaErro, Carregando } from "../../components/ui";
import { useCarregamento } from "../../lib/hooks";
import { brl, fmtCompetencia } from "../../lib/format";

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

function Fluxo({ dados }) {
  return (
    <div className="table-wrap">
      <table className="table table--fluxo">
        <thead>
          <tr>
            <th scope="col">Mês</th>
            <th scope="col" className="num">Entradas</th>
            <th scope="col" className="num">Saídas</th>
            <th scope="col" className="num">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {dados.meses.map((m) => (
            <tr key={m.competencia}>
              <td>{fmtCompetencia(m.competencia)}</td>
              <td className="num">{brl(m.entradas)}</td>
              <td className="num">{brl(m.saidas)}</td>
              {/* ⚠ Saldo negativo é o ramo que decide cor e sinal — e a lib garante que ele
                  exista na série, para que este desenho seja conferido antes de produção. */}
              <td className="num" data-negativo={m.saldo < 0 ? "sim" : undefined}>
                {brl(m.saldo)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td><strong>No período</strong></td>
            <td className="num">{brl(dados.totais.entradas)}</td>
            <td className="num">{brl(dados.totais.saidas)}</td>
            <td className="num" data-negativo={dados.totais.saldo < 0 ? "sim" : undefined}>
              <strong>{brl(dados.totais.saldo)}</strong>
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
        visao === "fluxo" ? <Fluxo dados={dados} /> : <Dre dados={dados} />
      ) : null}
    </section>
  );
}

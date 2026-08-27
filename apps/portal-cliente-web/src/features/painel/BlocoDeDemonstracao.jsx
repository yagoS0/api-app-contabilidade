// O BLOCO DO PAINEL — fluxo de caixa ⇄ DRE.
//
// ⚠⚠ O NOME DO ARQUIVO FICOU MEIO FALSO EM 27/08/2026, E ISSO ESTÁ AQUI DE PROPÓSITO: **o fluxo de
// caixa deixou de ser demonstração**. Ele vem do servidor (`GET /client/.../fluxo-de-caixa`, o MESMO
// payload que o contador lê) e responde `demonstracao: false`, então a visão de fluxo **não tem
// selo**. O DRE continua ficção — não existe rota de DRE —, e é ele que mantém o selo aceso.
// ⚠ Renomear o arquivo é decisão à parte: a chave de navegação, os testes e o `data-demonstracao`
// vivem em volta dele, e meia renomeação é o "filtro fantasma" que este app já pagou duas vezes.
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
//
// ⚠⚠ A REGRA DE LEITURA DO FLUXO NÃO MORA AQUI — ela está em `lib/leituraDoFluxo.js`, com teste
// próprio, e é ESPELHO da do portal do contador. Aqui só há LIGAÇÃO.

import { useState } from "react";
import { api } from "../../api";
import { AlertaErro, Carregando } from "../../components/ui";
import { useCarregamento } from "../../lib/hooks";
import { brl } from "../../lib/format";
import {
  DIRECAO,
  FRASE_DA_PREVISAO,
  FRASE_SEM_TOTAL,
  PROCEDENCIA,
  confrontoDaLinha,
  evidenciaDaLinha,
  leituraDaProcedencia,
  mesTemAlgo,
  quandoDaLinha,
  ressalvasDoFluxo,
  rotuloDaFonte,
  rotuloDoMes,
  separarMeses,
  totaisParaTela,
  totalDoBloco,
} from "./lib/leituraDoFluxo";

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
 * ⚠⚠ OS TRÊS COMPARTIMENTOS, SEPARADOS — e NÃO existe uma quarta caixa somando os dois primeiros.
 *
 * A ausência do número único é o contrato inteiro. Quem acrescentar "Saldo do mês" aqui recria
 * exatamente o número que a API se recusa a entregar.
 */
function TotaisDoMes({ totais, titulo }) {
  const t = totaisParaTela(totais);
  const bloco = (procedencia, valores) => {
    const r = leituraDaProcedencia(procedencia);
    return (
      <div className="fluxo-total" data-procedencia={procedencia}>
        <span className="fluxo-total-rotulo">{r.rotulo}</span>
        <span className="fluxo-total-valores">
          entra <strong>{brl(valores.entrada)}</strong> · sai <strong>{brl(valores.saida)}</strong>
        </span>
      </div>
    );
  };
  return (
    <div className="fluxo-totais">
      {titulo ? <span className="fluxo-totais-titulo">{titulo}</span> : null}
      {bloco(PROCEDENCIA.FATO, t.fato)}
      {bloco(PROCEDENCIA.PREVISAO, t.previsao)}
      {t.desconhecido.quantas > 0 ? (
        <div className="fluxo-total" data-procedencia={PROCEDENCIA.DESCONHECIDO}>
          <span className="fluxo-total-rotulo">
            {leituraDaProcedencia(PROCEDENCIA.DESCONHECIDO).rotulo}
          </span>
          {/* ⚠⚠ CONTAGEM, nunca valor: o que não tem mês não vira zero e não vira previsão. */}
          <span className="fluxo-total-valores">
            {t.desconhecido.quantas} linha(s) sem valor somável
          </span>
        </div>
      ) : null}
    </div>
  );
}

function LinhaDoMes({ linha }) {
  const quando = quandoDaLinha(linha);
  const evidencia = evidenciaDaLinha(linha);
  const confronto = confrontoDaLinha(linha);
  const entra = linha?.direcao === DIRECAO.ENTRADA;
  const r = leituraDaProcedencia(linha?.procedencia);
  return (
    <tr>
      <td>
        {quando.texto}
        {/* ⚠⚠ O dia ausente diz POR QUÊ — e a frase vem do SERVIDOR, não desta tela. */}
        {quando.motivo ? <span className="fluxo-motivo">{quando.motivo}</span> : null}
      </td>
      <td>
        <strong>{linha?.rotulo || "—"}</strong>
        {/* ⚠⚠ A PALAVRA "previsto" VAI NO TEXTO, não só na cor. */}
        <span className="chip" data-procedencia={linha?.procedencia}>{r.rotulo}</span>
        <span className="fluxo-origem">{rotuloDaFonte(linha?.fonte)}</span>
        {/* ⚠⚠ A EVIDÊNCIA vai no TEXTO, nunca num `title` — ele não aparece no toque. */}
        {evidencia ? <span className="fluxo-evidencia">{evidencia}</span> : null}
        {confronto ? <span className="fluxo-confronto">{confronto}</span> : null}
      </td>
      <td className="num">{entra ? brl(linha?.valor) : ""}</td>
      <td className="num">{entra ? "" : brl(linha?.valor)}</td>
    </tr>
  );
}

function MesDoFluxo({ mes }) {
  return (
    <section className="fluxo-mes">
      <h3>{rotuloDoMes(mes?.competencia)}</h3>
      <TotaisDoMes totais={mes?.totais} />
      {mesTemAlgo(mes) ? (
        /* ⚠ O `overflow-x` do `.table-wrap` é o que impede a PÁGINA de rolar para o lado em 375px. */
        <div className="table-wrap">
          <table className="table table--fluxo-mes">
            <thead>
              <tr>
                <th scope="col">Quando</th>
                <th scope="col">O quê</th>
                <th scope="col" className="num">Entra</th>
                <th scope="col" className="num">Sai</th>
              </tr>
            </thead>
            <tbody>
              {mes.linhas.map((l, i) => (
                <LinhaDoMes key={`${l?.fonte || "?"}-${l?.referencia?.id || i}`} linha={l} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        // ⚠ Mês vazio DIZ que está vazio. Sumir faria "não há movimento" e "não carregou" ficarem
        // iguais — e o primeiro é uma afirmação sobre o dinheiro da empresa.
        <p className="fluxo-vazio">Nada previsto nem lançado para este mês.</p>
      )}
    </section>
  );
}

/**
 * ⚠⚠ O FLUXO — 12 MESES, e ele NÃO é mais diário.
 *
 * ⚠ A forma diária (dia · entradas · saídas · SALDO, com o painel do dia) morreu junto com a
 * demonstração, e não por gosto: **as projeções não têm dia** (o prazo de recebimento é contado em
 * meses, a recorrência diz o ciclo), e **não existe saldo acumulado** — sem saldo inicial não há o
 * que acumular. Uma tabela com coluna de saldo afirmaria as duas coisas.
 * ⚠ `PainelDoDia.jsx` e `lib/dadosDeDemonstracao.diasDoMes` ficaram SEM CONSUMIDOR por causa disso.
 * Não foram apagados — apagar componente é decisão à parte, e há precedente escrito neste projeto.
 */
function Fluxo({ dados }) {
  // ⚠⚠ OS MESES DISTANTES NASCEM RECOLHIDOS. Aqui isso pesa mais que no portal do contador: esta
  // tela é lida no celular, e doze meses abertos empurrariam tudo o mais para fora da dobra.
  const [distantesAbertos, setDistantesAbertos] = useState(false);
  const { proximos, distantes } = separarMeses(dados?.meses);
  const ressalvas = ressalvasDoFluxo(dados);

  return (
    <div className="fluxo">
      {/* ⚠⚠ AS DUAS FRASES SÃO OBRIGATÓRIAS: uma diz que a previsão não aconteceu, a outra diz por
          que não existe um número único. Sem elas, "previsto" se lê como compromisso e a ausência
          do total se lê como falta. */}
      <p className="meta meta--bloco">{FRASE_DA_PREVISAO}</p>
      <p className="meta meta--bloco">{FRASE_SEM_TOTAL}</p>

      {/* ⚠⚠ AS RESSALVAS VÊM ANTES DOS MESES: a guia vencida é a linha mais urgente do fluxo e não
          mora em mês nenhum — embaixo das tabelas ela ficaria abaixo da dobra. */}
      {ressalvas.map((r, i) => (
        <p
          key={`${r.titulo || ""}-${i}`}
          className={r.tom === "aviso" ? "alerta alerta-aviso" : "alerta alerta-info"}
          role="status"
        >
          <strong>{r.titulo}</strong> {r.texto}
        </p>
      ))}

      {proximos.map((m) => <MesDoFluxo key={m.competencia} mes={m} />)}

      {distantes.length > 0 ? (
        <section className="fluxo-distantes">
          <div className="card-header">
            <h3>Mais {distantes.length} mês(es)</h3>
            <button
              type="button"
              className="btn"
              aria-expanded={distantesAbertos}
              onClick={() => setDistantesAbertos((v) => !v)}
            >
              {distantesAbertos ? "Recolher" : "Mostrar mês a mês"}
            </button>
          </div>
          {/* ⚠⚠ O TOTAL DO BLOCO É POR PROCEDÊNCIA, nunca somado. Sem ele os meses recolhidos
              sumiriam de vista; com uma soma única, virariam o número de doze meses que o contrato
              recusa. */}
          <TotaisDoMes totais={totalDoBloco(distantes)} titulo="No bloco recolhido" />
          <p className="meta meta--bloco">
            Quanto mais distante o mês, menos evidência há por trás da previsão — cada linha mostra
            quantas vezes aquilo já apareceu.
          </p>
          {distantesAbertos ? distantes.map((m) => <MesDoFluxo key={m.competencia} mes={m} />) : null}
        </section>
      ) : null}
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
  const demonstracao = ehDemonstracao(dados);

  return (
    <section
      /* ⚠ A moldura tracejada de `.demonstracao` é do que É demonstração. Com o fluxo real ela sai,
         senão a tela continuaria dizendo "isto é maquete" por desenho depois de o selo sumir. */
      className={demonstracao ? "card demonstracao" : "card"}
      aria-label="Fluxo de caixa e DRE"
      /* ⚠ Auditável no DOM, como `data-status` e `data-estado-nota`: quem inspecionar a página
         consegue provar qual bloco é demonstração sem depender de ler o texto do selo. */
      data-demonstracao={demonstracao ? "sim" : "nao"}
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

      {demonstracao ? <Selo /> : null}

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

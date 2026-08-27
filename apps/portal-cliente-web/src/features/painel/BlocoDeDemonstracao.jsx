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
  confrontoDaLinha,
  evidenciaDaLinha,
  leituraDaProcedencia,
  mesCurto,
  mesTemAlgo,
  quandoDaLinha,
  ressalvasDoFluxo,
  rotuloDaFonte,
  rotuloDoMes,
} from "./lib/leituraDoFluxo";
// ⚠ A agregação da PLANILHA mora fora do espelho: `leituraDoFluxo.js` é cópia da do contador, e esta
// grade só existe no portal do cliente. Ver o cabeçalho de `planilhaDoFluxo.js`.
import { diasDaPlanilha, linhasDaPlanilha } from "./lib/planilhaDoFluxo";

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

// ⚠⚠ AQUI VIVIA `TotaisDoMes`, E A REGRA DELE CONTINUA VALENDO — só mudou de guardião.
// Ele desenhava os três compartimentos (`fato` · `previsão` · `desconhecido`) e carregava, por
// escrito, que **não existe uma quarta caixa somando os dois primeiros**: *"a ausência do número
// único é o contrato inteiro"*. Ele ficou sem consumidor quando a planilha substituiu as doze seções
// de mês (27/08/2026), e um componente local sem chamador é o identificador órfão que este projeto já
// pagou três vezes — por isso saiu, em vez de ficar anotado.
// ⚠ A REGRA NÃO SAIU COM ELE: a grade não tem linha nem coluna de total, e há teste varrendo a tabela
// contra `No mês`, `Total` e `Saldo`. Quem acrescentar um rodapé de soma recria exatamente o número
// que a API se recusa a entregar.

/**
 * ⚠⚠ A EVIDÊNCIA DE UMA LINHA — de onde ela veio, e por que o número é aquele.
 *
 * ⚠ Ela era uma `<tr>` de uma segunda TABELA que abria abaixo da grade; virou item de LISTA em
 * 27/08/2026, quando o dono pediu que a própria planilha mudasse para a visão de dias em vez de abrir
 * outra tabela embaixo. **O conteúdo é o mesmo** — o que caiu foi a segunda grade.
 */
function ItemDaEvidencia({ linha }) {
  const quando = quandoDaLinha(linha);
  const evidencia = evidenciaDaLinha(linha);
  const confronto = confrontoDaLinha(linha);
  const entra = linha?.direcao === DIRECAO.ENTRADA;
  const r = leituraDaProcedencia(linha?.procedencia);
  return (
    <li className="fluxo-evid">
      <span className="fluxo-evid-valor" data-direcao={entra ? "entrada" : "saida"}>
        {entra ? "+" : "−"} {brl(linha?.valor)}
      </span>
      <span className="fluxo-evid-corpo">
        <strong>{linha?.rotulo || "—"}</strong>
        {/* ⚠⚠ A PALAVRA "Previsto" VAI NO TEXTO, não só na cor — a lei escrita deste fluxo. */}
        <span className="chip" data-procedencia={linha?.procedencia}>{r.rotulo}</span>
        <span className="fluxo-origem">{rotuloDaFonte(linha?.fonte)}</span>
        {/* ⚠⚠ A EVIDÊNCIA vai no TEXTO, nunca num `title` — ele não aparece no toque. */}
        {evidencia ? <span className="fluxo-evidencia">{evidencia}</span> : null}
        {confronto ? <span className="fluxo-confronto">{confronto}</span> : null}
        <span className="fluxo-motivo">
          {quando.texto}{quando.motivo ? ` — ${quando.motivo}` : ""}
        </span>
      </span>
    </li>
  );
}

/** O que sustenta os números do mês aberto. ⚠ Lista, não tabela: a segunda grade é que incomodava. */
function EvidenciaDoMes({ mes }) {
  return (
    <section className="fluxo-mes">
      <h3>{rotuloDoMes(mes?.competencia)}</h3>
      {mesTemAlgo(mes) ? (
        <ul className="fluxo-evidencias">
          {mes.linhas.map((l, i) => (
            <ItemDaEvidencia key={`${l?.fonte || "?"}-${l?.referencia?.id || i}`} linha={l} />
          ))}
        </ul>
      ) : (
        // ⚠ Mês vazio DIZ que está vazio. Sumir faria "não há movimento" e "não carregou" ficarem
        // iguais — e o primeiro é uma afirmação sobre o dinheiro da empresa.
        <p className="fluxo-vazio">Nada previsto nem lançado para este mês.</p>
      )}
    </section>
  );
}

/**
 * O dinheiro DA GRADE — o mesmo número de `brl`, sem o `R$` repetido em cada célula.
 *
 * ⚠ A GRAMÁTICA DO NÚMERO NÃO É REESCRITA AQUI: milhar, decimal, sinal e o traço da ausência
 * continuam saindo de `brl` (espelho do `format.ts` do app mobile). O que se tira é o SÍMBOLO, que
 * numa planilha se diz uma vez no canto e não em cada célula.
 */
const naGrade = (v) => brl(v).replace("R$ ", "");

/**
 * ⚠⚠ AS QUATRO COLUNAS — e a grade foi TRANSPOSTA em 27/08/2026 para chegar aqui.
 *
 * > Dono: *"colocando entrada, saída, recorrência, diário, todos no MESMO PESO, e em linha não em
 * > coluna; a diferença deles será a cor de suas COLUNAS: entrada verde, saída vermelha, recorrência
 * > ciano e diário azul"*.
 *
 * O que mudou, e por quê:
 *
 *   · **os meses viraram LINHAS** e as quatro categorias viraram COLUNAS. A forma anterior tinha 12
 *     colunas de mês e exigia 1.132px de largura mínima — ela ROLAVA no celular. Com cinco colunas
 *     ela cabe em 375px sem rolar, e a leitura vira a de qualquer planilha de caixa: o mês desce, a
 *     categoria atravessa.
 *   · **"todos no mesmo peso"** desfez o recuo que fazia `Recorrência` e `Diário` parecerem
 *     decomposição da saída. Elas continuam SENDO derivadas dela (`Diário = (Saída − Recorrência) ÷
 *     dias`), e isso agora é dito no `title` da coluna, não no desenho.
 *   · **a cor mudou de eixo**: ela marcava `fato` × `previsão`; agora marca a CATEGORIA. Quem separa
 *     o que já existe do que é previsão passou a ser o PREENCHIMENTO — sólido × contorno —, que é a
 *     única marca que sobrevive à impressão em preto e branco.
 */
const COLUNAS_DA_PLANILHA = [
  {
    chave: "entrada",
    rotulo: "Entrada",
    ajuda: "O que entra no mês.",
    partes: (t) => [
      { valor: t.entrada.fato, procedencia: "fato" },
      { valor: t.entrada.previsao, procedencia: "previsao" },
    ],
  },
  {
    chave: "saida",
    rotulo: "Saída",
    ajuda: "O que sai no mês — guias de imposto e despesas.",
    partes: (t) => [
      { valor: t.saida.fato, procedencia: "fato" },
      { valor: t.saida.previsao, procedencia: "previsao" },
    ],
  },
  {
    chave: "recorrencia",
    rotulo: "Recorrência",
    ajuda: "A parte da saída que se repete todo mês.",
    partes: (t) => [{ valor: t.recorrente, procedencia: "derivado" }],
  },
  {
    chave: "diario",
    rotulo: "Diário",
    ajuda: "O que sobra da saída depois do que se repete, dividido pelos dias do mês.",
    partes: (t) => [{ valor: t.diario, procedencia: "derivado" }],
  },
];

function CelulasDaLinha({ t, diario }) {
  return COLUNAS_DA_PLANILHA.map((c) => {
    const partes = c.partes({ ...t, diario }).filter((p) => p.valor);
    return (
      <td key={c.chave} className="num" data-coluna={c.chave} data-vazio={partes.length ? undefined : "sim"}>
        {/* ⚠ ZERO SAI COMO TRAÇO. `R$ 0,00` em toda célula vazia é a parede de zeros que esta forma
            existe para desfazer — e "nada aqui" não é "zero reais". */}
        {partes.length === 0 ? "—" : partes.map((pt) => (
          <span key={pt.procedencia} className="planilha-valor" data-procedencia-celula={pt.procedencia}>
            {naGrade(pt.valor)}
          </span>
        ))}
      </td>
    );
  });
}

/**
 * ⚠⚠ A MESMA TABELA MUDA — ela não abre uma segunda embaixo.
 *
 * > Dono, 27/08/2026: *"não quero que ao clicar no mês abra uma tabela embaixo, quero que a própria
 * > tabela mude para visualizar o mês, aparecendo 10 dias, e rolagem para rolar entre os dias; caso
 * > queira voltar a visualizar os 12 meses é só clicar em algum botão que volte"*.
 *
 * ⚠ As COLUNAS não mudam entre as duas visões — são as mesmas quatro, com as mesmas cores. O que
 * troca é o que a LINHA significa: um mês ou um dia. Trocar as colunas junto faria a pessoa reaprender
 * a tabela a cada clique.
 */
function PlanilhaDoFluxo({ meses, mesAberto, aoAbrirMes }) {
  const dodia = mesAberto ? diasDaPlanilha(mesAberto) : null;

  return (
    /* ⚠ `.table-wrap` FICA mesmo cabendo em 375px: ele é o que impede a PÁGINA de rolar para o lado.
       ⚠ E `--planilha-alta` liga a rolagem VERTICAL, que só existe na visão de dias — dez linhas e o
       resto rola, com o cabeçalho grudado. Na visão de meses são doze linhas e elas cabem. */
    <div className={mesAberto ? "table-wrap table-wrap--planilha-alta" : "table-wrap"}>
      <table className="table table--planilha-fluxo">
        <thead>
          <tr>
            <td className="planilha-canto">
              {mesAberto ? (
                /* ⚠ O caminho de volta é um BOTÃO no canto da própria tabela, e não um link acima
                   dela: quem entrou clicando no mês procura a saída onde entrou. */
                <button type="button" className="planilha-voltar" onClick={() => aoAbrirMes(null)}>
                  ← 12 meses
                </button>
              ) : "R$"}
            </td>
            {COLUNAS_DA_PLANILHA.map((c) => (
              <th key={c.chave} scope="col" className="num" data-coluna={c.chave} title={c.ajuda}>
                {c.rotulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!mesAberto && meses.map((mes) => (
            <tr key={mes?.competencia}>
              <th scope="row">
                {/* ⚠⚠ O MÊS É UM `<button>`, não um `<a>`: trocar a visão da tabela não é navegação —
                    não há URL para ela, e inventar uma daria um hash que o `useRota` recusa. */}
                <button
                  type="button"
                  className="planilha-mes"
                  onClick={() => aoAbrirMes(mes?.competencia)}
                  title={`Ver ${rotuloDoMes(mes?.competencia)} dia a dia`}
                >
                  {mesCurto(mes?.competencia)}
                </button>
              </th>
              <CelulasDaLinha t={linhasDaPlanilha(mes)} diario={linhasDaPlanilha(mes).diario} />
            </tr>
          ))}

          {mesAberto && (
            <>
              {/* ⚠⚠ A LINHA "NO MÊS" VEM PRIMEIRO, E ELA É A MAIORIA DO DINHEIRO. As projeções não têm
                  dia (o prazo de recebimento é contado em meses, a recorrência diz o ciclo): medido,
                  6 das 8 linhas do payload chegam sem dia. Espalhá-las pelos dias inventaria precisão
                  que ninguém informou; escondê-las faria o mês parecer menor do que é. */}
              <tr className="planilha-sem-dia">
                <th scope="row">no mês</th>
                <CelulasDaLinha t={dodia.semDia} diario={null} />
              </tr>
              {dodia.dias.map((d) => (
                <tr key={d.dia}>
                  <th scope="row">dia {String(d.dia).padStart(2, "0")}</th>
                  {/* ⚠ O `Diário` repete em todo dia, e é o que ele SIGNIFICA: uma média. Calculá-lo
                      por dia exigiria saber o gasto de cada dia — que é o que não existe. */}
                  <CelulasDaLinha t={d} diario={dodia.diario} />
                </tr>
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * ⚠⚠ AS DUAS RESSALVAS QUE NÃO APARECEM NESTE PORTAL — e só estas duas.
 *
 * Decisão do dono, 27/08/2026, em duas etapas: *"tire esses avisos da página"* e, depois, *"pode
 * excluir isso também"*. São a guia já vencida e a guia sem mês.
 *
 * ⚠⚠ EU ARGUMENTEI CONTRA E ELE DECIDIU — fica escrito porque o critério deste app manda o
 * contrário: *"fica o texto que muda uma decisão de quem lê ou avisa de consequência fiscal"*, e
 * *"2 guias venceram, somando R$ 18.638,39"* é as duas coisas.
 *
 * ⚠ O QUE SEGURA A DECISÃO: **o fato continua chegando por dois caminhos que já existiam** — o card
 * "A vencer" do Painel, na mesma tela, logo acima; e a aba Guias. O `CLAUDE.md` já registrava que os
 * dois números conviviam e podiam divergir; tirar este resolve aquela ambiguidade em vez de criá-la.
 *
 * ⚠⚠ A REGRA NÃO FOI TOCADA. `ressalvasDoFluxo` é ESPELHO da do contador — lá o aviso FICA, porque
 * quem trabalha a guia é ele.
 *
 * ⚠⚠ O CORTE É NOMINAL, E A PRIMEIRA VERSÃO ERRAVA NISSO: ela filtrava por TOM e levava junto
 * *"Repetições não lidas"*, que ele não pediu para tirar. **Quem pegou foi o teste.** Com a lista
 * fechada, um aviso NOVO aparece — que é o comportamento certo.
 * ⚠ `startsWith` porque a segunda tem sufixo dinâmico (`Sem mês — SIMPLES`).
 */
const RESSALVAS_FORA_DESTE_PORTAL = ["Guias já vencidas", "Sem mês"];

function Fluxo({ dados }) {
  const meses = Array.isArray(dados?.meses) ? dados.meses : [];
  // ⚠ Nasce nos 12 MESES. A visão de dias é um mergulho, e mergulho não é estado inicial.
  const [aberta, setAberta] = useState(null);
  const mesAberto = meses.find((m) => m?.competencia === aberta) || null;
  const ressalvas = ressalvasDoFluxo(dados);
  const contexto = ressalvas.filter(
    (r) => !RESSALVAS_FORA_DESTE_PORTAL.some((p) => String(r?.titulo || "").startsWith(p)),
  );

  return (
    <div className="fluxo">
      <PlanilhaDoFluxo meses={meses} mesAberto={mesAberto} aoAbrirMes={setAberta} />

      {/* ⚠⚠ A COR NÃO PODE SER A ÚNICA MARCA. Desde que ela passou a marcar a CATEGORIA (a coluna),
          quem separa o que já existe do que é previsão é o PREENCHIMENTO — sólido × contorno. Essa é
          a metade que sobrevive à impressão em preto e branco e ao daltonismo; a cor, não. */}
      <p className="meta meta--bloco fluxo-legenda-cor">
        <span data-procedencia-celula="fato">preenchido</span> já existe ·{" "}
        <span data-procedencia-celula="previsao">contorno</span> previsto
      </p>

      {/* ⚠⚠ A TABELA DE BAIXO SAIU — pedido do dono. O que ela carregava, porém, NÃO era decoração: é
          a evidência de cada linha (de onde veio, quantas vezes já apareceu, o confronto entre o que
          foi declarado e o que apareceu de fato). É ela que separa "previsto" de "chutado".
          ⚠ Por isso ela virou LISTA, não sumiu: uma segunda tabela era o que incomodava. */}
      {mesAberto ? <EvidenciaDoMes mes={mesAberto} /> : null}

      <details className="fluxo-notas">
        <summary>Como este fluxo é calculado</summary>
        <p className="meta meta--bloco">{FRASE_DA_PREVISAO}</p>
        <p className="meta meta--bloco">{FRASE_SEM_TOTAL}</p>
        {contexto.map((r, i) => (
          <p key={`${r.titulo || ""}-${i}`} className="meta meta--bloco">
            <strong>{r.titulo}</strong> {r.texto}
          </p>
        ))}
      </details>
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

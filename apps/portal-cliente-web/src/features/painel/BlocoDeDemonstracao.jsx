// O BLOCO DO PAINEL — fluxo de caixa ⇄ DRE.
//
// ⚠⚠ O NOME DO ARQUIVO FICOU MEIO FALSO EM 27/08/2026, E ISSO ESTÁ AQUI DE PROPÓSITO: **o fluxo de
// caixa deixou de ser demonstração**. Ele vem do servidor (`GET /client/.../fluxo-de-caixa`) e
// responde `demonstracao: false`, então a visão de fluxo **não tem selo**. O DRE continua ficção —
// não existe rota de DRE —, e é ele que mantém o selo aceso.
// ⚠ Esta linha dizia *"o MESMO payload que o contador lê"* e ficou falsa em 29/08/2026: o dono
// removeu o fluxo de caixa do portal do contador e a rota `/firm/.../fluxo-de-caixa` saiu. O corpo
// compartilhado (`routes/fluxoDeCaixaHttp.js`) continua sendo o único que monta o fluxo — hoje com
// **um consumidor só**.
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
// próprio. Aqui só há LIGAÇÃO.
// ⚠ Ela era ESPELHO da do portal do contador ("mudou lá, muda aqui"); a cópia de lá foi APAGADA em
// 29/08/2026 com o fluxo daquele portal, e não há mais o que sincronizar. **Não recrie o espelho
// por simetria**: espelho sem consumidor não é código morto barato, é obrigação de sincronizar
// para sempre numa cópia que ninguém abre.

import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { AlertaErro, Carregando } from "../../components/ui";
import { useCarregamento } from "../../lib/hooks";
import { brl } from "../../lib/format";
// ⚠ `somarCompetencia` SAIU daqui em 29/08/2026 e foi para a lib: o Painel passou a precisar dela
// para ler o MÊS SEGUINTE nos cards, e duas cópias da mesma aritmética divergiriam na primeira
// correção — a mesma razão pela qual `linhaDoMes` é compartilhada entre o card e a tabela.
import { mesCurto, rotuloDoMes, somarCompetencia } from "./lib/leituraDoFluxo";
// ⚠ A agregação das SEIS COLUNAS mora à parte da leitura: aquele arquivo lê o VOCABULÁRIO do
// servidor e este AGREGA para a tabela desta tela. Ver o cabeçalho de `tabelaDoFluxo.js`.
import {
  COLUNAS, COLUNAS_EM_PERCENTUAL, STATUS, emPercentual, gradeTransposta, linhasDosDias, DIAS_ANTES,
  linhaDoMes,
  navegacaoDoPar, parDeMeses,
} from "./lib/tabelaDoFluxo";
// ⚠ `diasDoMes` é aritmética de STRING, nunca `toISOString()`: às 22h de Brasília o ISO devolveria
// o dia seguinte. Ela é a única coisa que sobrou de `dadosDeDemonstracao` no caminho do fluxo.
import { diasDoMes } from "./lib/dadosDeDemonstracao";
import { PopUpDeGuias } from "./PopUpDeGuias";
import { SuasSaidas } from "./SuasSaidas";
import { GavetaDoDia } from "./GavetaDoDia";
import { GuiasVencidas } from "./GuiasVencidas";

/**
 * ⚠⚠ A FOLGA que a tela pede ao servidor quando a seta chega na BORDA da janela carregada.
 *
 * Pedir a janela começando exatamente no mês alvo faria o passo SEGUINTE, na mesma direção, ir ao
 * servidor de novo — e andar um mês é a navegação mais comum desta tela. Um mês de folga atrás
 * resolve isso sem carregar nada a mais: a janela tem 12 meses de qualquer jeito.
 *
 * ⚠ `DIAS_POR_VEZ` (10) morava aqui e SAIU: o mês inteiro passou a ser desenhado de uma vez. Ver o
 * cabeçalho de `TabelaDeDias`.
 */
const MESES_DE_FOLGA = 1;

/** ⚠ R$ × % — v3 §3.6. Entrada e Resultado seguem em R$ nos dois. */
const UNIDADES = [
  { chave: "rs", rotulo: "R$" },
  { chave: "pct", rotulo: "%" },
];

const VISOES = [
  /**
   * ⚠ O rótulo é **"Fluxo"**, não "Fluxo de caixa" — decisão do dono, 30/08/2026: *"escreva apenas
   * Fluxo no seletor"*. O par com "DRE" já diz do que se trata, e o nome longo fazia o alternador
   * ocupar metade da barra ao lado de uma palavra de três letras.
   * ⚠ A CHAVE continua `"fluxo"`: ela é o vocabulário que o resto do arquivo lê (`visao === "fluxo"`
   * aparece em sete lugares) e mudá-la quebraria tudo em silêncio.
   */
  { chave: "fluxo", rotulo: "Fluxo" },
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
 * ⚠⚠ LÁPIDE — o que morava aqui, e por que saiu (28/08/2026).
 *
 * Havia `ItemDaEvidencia` + `EvidenciaDoMes` (a lista de "por que esta linha está aqui": origem,
 * evidência, confronto entre o declarado e o observado), `RESSALVAS_FORA_DESTE_PORTAL` e um
 * `<details>` "Como este fluxo é calculado".
 *
 * **Saíram por decisão do dono**, `CONSTITUICAO-do-produto.md` §3: *"sem legendas, sem rodapés
 * explicativos, sem textos de apoio nas camadas 1–3 — a hierarquia explica, não o texto"*, e §3.8 do
 * v3: *"Não há rodapé nem texto explicativo no card."* É a reversão nº 3 do §6.
 *
 * ⚠⚠ **EU ARGUMENTEI CONTRA E ELE DECIDIU**, e fica registrado porque o critério escrito deste app
 * manda o contrário: *"fica o texto que muda uma decisão de quem lê ou avisa de consequência
 * fiscal"*. A evidência era o que separava "previsto" de "chutado".
 *
 * ⚠ **O QUE SEGURA A DECISÃO:** a REGRA não foi apagada. `evidenciaDaLinha`, `confrontoDaLinha` e
 * `ressalvasDoFluxo` continuam em `lib/leituraDoFluxo.js`, com teste próprio. E a pergunta *"de onde
 * veio esse número?"* passou a ter lugar próprio: a camada 4 da Constituição, o drill-in de dias.
 *
 * ⚠⚠ **ESTA FRASE DIZIA QUE ELAS "continuam sendo renderizadas NO PORTAL DO CONTADOR" E FICOU FALSA
 * EM 29/08/2026** — o dono removeu o fluxo de caixa daquele portal (*"para o contador não vai
 * existir fluxo de caixa"*) e `apps/web/src/features/fluxo/` foi apagada inteira. **As três funções
 * estão hoje SEM TELA NENHUMA, nos dois apps** — vivas só por teste. Isso não as torna código morto
 * (elas são a leitura do vocabulário do servidor, e a Fase 4 volta a consumi-las na tela de dias),
 * mas quem for decidir sobre elas precisa saber que a metade do argumento acima não existe mais.
 *
 * ⚠ Os componentes locais foram APAGADOS, não deixados sem chamador: componente órfão dentro do
 * arquivo é ruído. O que é de fora (a regra) ficou.
 */

/**
 * ⚠ O dinheiro DA TABELA — o mesmo número de `brl`, sem o `R$` repetido em cada célula.
 *
 * ⚠ A GRAMÁTICA DO NÚMERO NÃO É REESCRITA AQUI: milhar, decimal e sinal continuam saindo de `brl`
 * (espelho do `format.ts` do app mobile). O que se tira é o SÍMBOLO, que numa planilha se diz uma
 * vez no cabeçalho e não em cada célula (v3 §8).
 */
const naGrade = (v) => brl(v).replace("R$ ", "");

const pctFmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * ⚠⚠ UMA CÉLULA — e ela carrega o status em TRÊS canais, nunca só na cor.
 *
 * Constituição §1: *"A distinção nunca é só cor: âmbar vem sempre com itálico, `data-status` no DOM
 * e `aria-label` na célula."* Impressão em preto e branco e daltonismo tiram a cor; o itálico fica,
 * o atributo fica, e o leitor de tela ouve a palavra.
 *
 * ⚠ Célula ausente vira traço INVISÍVEL (v3 §3.2, "sem peso visual") **com texto oculto**: sem ele,
 * "não há lançamento" e "não carregou" ficam iguais para quem não vê a tela.
 */
function Celula({ celula, coluna, unidade, entradaDoPeriodo, aoAbrir, rotuloDoPeriodo }) {
  /**
   * ⚠⚠ A CÉLULA É CLICÁVEL — decisão do dono, 30/08/2026: *"todos os blocos de saída devem e podem
   * ser clicados, isso abre um menu lateral que mostra as saídas naquele dia, com suas descrições"*
   * · *"o de impostos também"*.
   *
   * ⚠ **O `<button>` fica DENTRO do `<td>`**, nunca um `onClick` na célula ou um `role="button"` na
   * linha: `role` na `<tr>` a tiraria da semântica de tabela, e a decisão já está escrita nesta casa
   * a propósito do `PainelDoDia`. Assim a tabela continua tabela e o alvo continua focável pelo
   * teclado.
   * ⚠⚠ **RESULTADO NÃO ABRE.** Ele é uma CONTA (entrada − saídas), não um conjunto de lançamentos:
   * uma gaveta ali teria de inventar o que listar. Quem responde "de onde veio" são as outras
   * quatro colunas.
   */
  const abre = typeof aoAbrir === "function" && coluna !== "resultado";

  if (!celula) {
    /**
     * ⚠⚠ A CÉLULA VAZIA CONTINUA CLICÁVEL NA COLUNA DE SAÍDA, e é o pedido do dono: *"ele deve
     * clicar no campo do dia, abre um menu lateral e aí ele digita a saída"*. Um dia sem nada é
     * justamente onde ele quer acrescentar — e um alvo que só existe quando já há valor tornaria a
     * ação inalcançável no caso mais comum.
     * ⚠ Nas outras colunas o traço continua inerte: abrir uma gaveta vazia de impostos não oferece
     * nada, e um clique que não faz nada se lê como defeito.
     */
    if (!abre || coluna !== "saida") {
      return (
        <td className="num" data-coluna={coluna}>
          <span className="fluxo-v3-vazio" aria-hidden="true">–</span>
          <span className="sr-only">sem lançamento</span>
        </td>
      );
    }
    return (
      <td className="num" data-coluna={coluna}>
        <button
          type="button"
          className="fluxo-v4-celula"
          onClick={() => aoAbrir(coluna)}
          aria-label={`Acrescentar saída em ${rotuloDoPeriodo}`}
        >
          <span className="fluxo-v3-vazio" aria-hidden="true">–</span>
        </button>
      </td>
    );
  }

  const ehPercentual = unidade === "pct" && COLUNAS_EM_PERCENTUAL.includes(coluna);
  const pct = ehPercentual ? emPercentual(celula, entradaDoPeriodo) : null;

  // ⚠⚠ No modo %, entrada ZERO devolve `null` — e a célula vira traço em vez de `0,0%` ou `∞`.
  // Dividir por zero não produz uma proporção; produz uma mentira (v3 §3.6).
  if (ehPercentual && pct == null) {
    return (
      <td className="num" data-coluna={coluna}>
        <span className="fluxo-v3-vazio" aria-hidden="true">–</span>
        <span className="sr-only">sem base para calcular o percentual</span>
      </td>
    );
  }

  const previsto = celula.status === STATUS.PREVISTO;
  const texto = ehPercentual ? `${pctFmt.format(pct)}%` : naGrade(celula.valor);
  /* ⚠ O terceiro canal. "Previsto" é a palavra da Lei 5 — ela cobre compromisso E presunção, que
     por fora são a mesma cor. ⚠ Sendo botão, ele vira o NOME ACESSÍVEL, e por isso diz também o
     que o clique faz e de que período é: "R$ 1.437,15" sozinho não é um rótulo de ação. */
  const rotulo = abre
    ? `${texto}${previsto ? ", previsto" : ""} — ver em ${rotuloDoPeriodo}`
    : (previsto ? `${texto}, previsto` : undefined);

  const valor = (
    <span
      className="fluxo-v3-valor"
      data-coluna={coluna}
      data-status={celula.status}
      data-negativo={coluna === "resultado" && celula.valor < 0 ? "sim" : undefined}
      aria-label={abre ? undefined : rotulo}
    >
      {texto}
    </span>
  );

  return (
    <td className="num" data-coluna={coluna}>
      {abre ? (
        <button type="button" className="fluxo-v4-celula" onClick={() => aoAbrir(coluna)} aria-label={rotulo}>
          {valor}
        </button>
      ) : valor}
    </td>
  );
}

/**
 * As cinco células de uma linha — mês ou dia, o mesmo desenho.
 *
 * ⚠⚠ `entradaDaBase` — A BASE DO PERCENTUAL DE UM DIA É A ENTRADA DO **MÊS** (01/09/2026).
 *
 * > Dono: *"ao clicar em porcentagem os dias saem, mas deveriam se transformar em porcentagem"*.
 *
 * O defeito: cada linha de dia usava a PRÓPRIA entrada como denominador — e quase nenhum dia tem
 * entrada (ela cai no dia 1), então no modo `%` toda célula de imposto/folha dos dias virava traço
 * ("sem base") e a tabela parecia esvaziar. Só o rodapé convertia.
 *
 * ⚠ Com a entrada do MÊS como base, o dia mostra a FATIA dele no mesmo denominador do rodapé — e
 * os dias SOMAM para o total, que é o que uma coluna de percentuais promete. Denominadores
 * diferentes por linha somariam para nada.
 * ⚠ O rodapé não passa a prop: a linha dele É o mês, e a base cai na própria entrada.
 * ⚠ Mês sem entrada continua traço em TODAS as linhas — dividir por zero segue proibido (§3.6).
 */
function CelulasDoPeriodo({ linha, unidade, comFolha, aoAbrir, rotuloDoPeriodo, entradaDaBase }) {
  return COLUNAS
    .filter((c) => comFolha || c.chave !== "folha")
    .map((c) => (
      <Celula
        key={c.chave}
        celula={linha[c.chave]}
        coluna={c.chave}
        unidade={unidade}
        entradaDoPeriodo={entradaDaBase !== undefined ? entradaDaBase : linha.entrada}
        aoAbrir={aoAbrir}
        rotuloDoPeriodo={rotuloDoPeriodo}
      />
    ));
}

/**
 * ⚠⚠ A FORMA v4 — DOIS MESES LADO A LADO, EM DIAS (29/08/2026). Isto INVERTE o v3.
 *
 * > Dono: *"ao invés de mostrar o mês ele vai mostrar os dias mesmo (…) 30 dias à esquerda sendo o
 * > mês corrente e 30 dias à direita sendo o mês seguinte. Setas cabeçalho para andar para frente e
 * > para trás entre os meses, botão para ver o horizonte e aí mudamos a tabela para mês."*
 *
 * No v3 §3.7 os dias eram um MERGULHO a partir da tabela de meses ("os outros meses somem"), e as
 * setas sumiam dentro dele. Agora os dias são o estado inicial, as setas são o controle principal e
 * a tabela de meses virou o **Horizonte**, atrás de um botão.
 *
 * ⚠ O que NÃO mudou, e não pode mudar: as cinco categorias, o `status` por célula nos três canais,
 * o traço para ausência, e a linha **"no mês"** vindo primeiro em cada bloco — as projeções sem dia
 * (recorrência, imposto previsto, folha) continuam ali, e espalhá-las pelos dias inventaria
 * precisão que ninguém informou.
 *
 * ⚠⚠ **A PAGINAÇÃO DE 10 DIAS SAIU.** O v3 mostrava 10 por vez e anexava +10 na rolagem, porque a
 * tabela era única e altíssima. O dono descreveu *"30 dias à esquerda e 30 à direita"*: mostrar 10 e
 * exigir rolagem para ver o dia 12 contraria o pedido. Hoje o mês inteiro é desenhado e quem cede é
 * a ROLAGEM INTERNA do bloco — a mesma regra do `.table-wrap`, que existe para a página não rolar
 * para o lado.
 */
/**
 * ⚠ O rótulo do dia vira BOTÃO, e não a linha inteira: `role="button"` numa `<tr>` a tiraria da
 * semântica de tabela — a decisão já está escrita nesta casa a propósito do `PainelDoDia`.
 */
function BotaoDoPeriodo({ aoAbrir, children }) {
  return (
    <button type="button" className="fluxo-v4-dia" onClick={aoAbrir}>
      {children}
    </button>
  );
}

function TabelaDeDias({ bloco, unidade, comFolha, cabecalho, aoAbrir, diaDeHoje = null }) {
  const caixaDeRolagem = useRef(null);
  const colunas = COLUNAS.filter((c) => comFolha || c.chave !== "folha");

  // ⚠⚠ BLOCO SEM MÊS NÃO É BLOCO VAZIO. Andando até a borda da janela, o mês da direita pode não ter
  // vindo nesta consulta. Desenhar 30 dias em traço afirmaria *"este mês não tem nada"* — e o certo
  // é *"este mês não está nesta consulta"*. São coisas diferentes, e a tela diz qual é.
  if (!bloco.mes) {
    return (
      <div className="fluxo-v4-bloco" data-mes={bloco.competencia} data-ausente="sim">
        {cabecalho}
        <p className="fluxo-v4-ausente">
          {rotuloDoMes(bloco.competencia)} não veio nesta consulta — use as setas para carregá-lo.
          Isto não quer dizer que o mês esteja sem lançamento.
        </p>
      </div>
    );
  }

  const dodia = linhasDosDias(bloco.mes, diasDoMes(bloco.competencia).length);
  /**
   * ⚠⚠ OS 10 DIAS PASSARAM A SER ROLAGEM, NÃO CORTE (30/08/2026) — dono: *"os dias devem ser
   * passados com rolagem, não com seta."*
   *
   * O MÊS INTEIRO é desenhado; quem mostra dez de cada vez é a ALTURA do `.table-wrap--dias`, e
   * quem anda é a rolagem. ⚠ Cortar em JavaScript tiraria os outros dias do DOM: quem rolasse não
   * acharia nada, e quem usa leitor de tela nunca saberia que eles existem — é a mesma decisão que
   * a tabela de guias em atraso já carrega.
   * ⚠ `janelaDeDias` (o corte) fica na lib, SEM CHAMADOR e com teste: ela é a regra de "onde a
   * janela começa", e é dela que sai a rolagem inicial abaixo.
   */
  const dias = dodia.dias;
  /* ⚠ O total do MÊS INTEIRO, pela MESMA agregação da tabela — nunca uma soma nova. */
  const totalDoMes = linhaDoMes(bloco.mes);

  /**
   * ⚠⚠ A TELA ABRE MOSTRANDO HOJE, e é o motivo de a janela existir: *"para que sempre seja visto o
   * dia em que estamos"*. Sem esta rolagem inicial, o mês abriria no dia 1 e o dia de hoje ficaria
   * a vinte linhas de distância — que é exatamente o defeito que o pedido desfaz.
   *
   * ⚠ Ela usa `scrollTop` direto, e não `scrollIntoView`: este último rola TAMBÉM a página, e a
   * tela saltaria para o meio do fluxo ao abrir.
   * ⚠ `5` linhas acima é o mesmo "5 para trás" que ele pediu — a linha de hoje nasce com contexto
   * atrás, não colada no topo.
   * ⚠ Só o mês de HOJE rola: nos outros não há dia para onde ir, e rolar ali esconderia o dia 1 sem
   * motivo.
   */
  useEffect(() => {
    const caixa = caixaDeRolagem.current;
    if (!caixa || !Number.isInteger(diaDeHoje)) return;
    const linha = caixa.querySelector('tbody tr[data-hoje="sim"]');
    if (!linha) return;
    caixa.scrollTop = Math.max(0, linha.offsetTop - linha.offsetHeight * DIAS_ANTES);
  }, [diaDeHoje, bloco.competencia]);

  return (
    <div className="fluxo-v4-bloco" data-mes={bloco.competencia}>
      {cabecalho}
      <div className="table-wrap table-wrap--dias" ref={caixaDeRolagem}>
        <table className="table table--fluxo-v3">
          <thead>
            <tr>
              <th scope="col" className="col-periodo">Dia</th>
              {colunas.map((c) => (
                <th key={c.chave} scope="col" data-coluna={c.chave}>{c.rotulo}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/*
              ⚠⚠ A LINHA "no mês" SAIU DO CORPO EM 30/08/2026 — dono: *"esse no mês tem que sumir
              daí, e abaixo da tabela, no footer dela, deve haver um resumo da coluna: total de
              entrada, saída, impostos…"*

              ⚠⚠ **O DINHEIRO DELA NÃO SUMIU — ELE MUDOU DE LUGAR, DUAS VEZES.** É lá que moram a
              folha e o imposto previsto sem dia, e some-los seria a tela mostrar menos dinheiro do
              que existe. Hoje eles entram (a) no RESULTADO ACUMULADO, que começa por eles, e
              (b) no TOTAL do rodapé. Por isso o último dia e o rodapé fecham no mesmo número.
            */}
            {/*
              ⚠⚠ A LINHA "sem dia" — O DINHEIRO QUE NÃO CABE EM DIA NENHUM (31/08/2026).
              >
              > Dono: *"pode atacar o dinheiro sem dia"*, depois de o teste de usabilidade medir que
              > **R$ 5.902,00** (folha + imposto sem dia) entravam no Resultado do dia 1 e no rodapé
              > e **não tinham linha nenhuma** — e que a série "Jantar com clientes" (R$ 1.180, sem
              > dia) era **inalcançável**: não havia onde clicar para lhe dar um dia.

              ⚠⚠ **ELA NÃO É A VOLTA DO "no mês" QUE VOCÊ MANDOU SUMIR.** Aquela estava SEMPRE lá,
              inclusive vazia, e repetia o total que hoje mora no rodapé. Esta só existe quando há
              dinheiro sem dia — na maioria dos meses ela não aparece — e mostra **só o que não tem
              dia**, nunca o total do mês.

              ⚠ A agregação é a que `linhasDosDias` **já devolvia** (`dodia.semDia`): nada é somado
              de novo aqui. Ela é a mesma que o acumulado do primeiro dia já usava — por isso a
              linha do dia 1 continua fechando com o que a tabela mostra.

              ⚠ Ela vem ANTES dos dias, e fora da rolagem dos dez: é contexto do mês inteiro, e
              rolar para achá-la seria o mesmo que não tê-la.
            */}
            {dodia.semDia ? (
              <tr data-linha-sem-dia="sim">
                <th scope="row">
                  <BotaoDoPeriodo aoAbrir={() => aoAbrir?.(null, null)}>sem dia</BotaoDoPeriodo>
                </th>
                <CelulasDoPeriodo
                  linha={dodia.semDia}
                  unidade={unidade}
                  comFolha={comFolha}
                  aoAbrir={(coluna) => aoAbrir?.(null, coluna)}
                  rotuloDoPeriodo="sem dia"
                  entradaDaBase={totalDoMes.entrada}
                />
              </tr>
            ) : null}
            {dias.map((d) => (
              /* ⚠ `data-hoje` é auditável no DOM, como `data-status` — e é ele que o CSS pinta de
                 ciano. Cor cravada no JSX não sobreviveria à troca de tema. */
              <tr key={d.dia} data-hoje={d.dia === diaDeHoje ? "sim" : undefined}>
                <th scope="row">
                  <BotaoDoPeriodo aoAbrir={() => aoAbrir?.(d.dia, null)}>
                    dia {String(d.dia).padStart(2, "0")}
                  </BotaoDoPeriodo>
                </th>
                <CelulasDoPeriodo
                  linha={d}
                  unidade={unidade}
                  comFolha={comFolha}
                  aoAbrir={(coluna) => aoAbrir?.(d.dia, coluna)}
                  rotuloDoPeriodo={`dia ${String(d.dia).padStart(2, "0")}`}
                  entradaDaBase={totalDoMes.entrada}
                />
              </tr>
            ))}
          </tbody>
          {/*
            ⚠⚠ O RESUMO DA COLUNA, NO RODAPÉ — dono, 30/08/2026. Ele é o total do MÊS INTEIRO, não
            o dos dez dias à vista: a tabela rola, e um total que mudasse com a rolagem seria um
            número diferente a cada olhada.
            ⚠ Ele sai de `linhaDoMes` sobre TODAS as linhas do mês — a mesma agregação que a tabela
            já usa, e por isso ele fecha com o acumulado do último dia. Uma segunda soma escrita
            aqui divergiria da primeira na correção seguinte.
            ⚠⚠ `<th scope="row">` no rodapé, nunca um `<td>` solto: para quem usa leitor de tela, a
            linha de total precisa ter nome — senão são cinco números órfãos.
          */}
          <tfoot>
            <tr className="fluxo-v4-total">
              <th scope="row">no mês</th>
              <CelulasDoPeriodo
                linha={totalDoMes}
                unidade={unidade}
                comFolha={comFolha}
                rotuloDoPeriodo="no mês"
              />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/**
 * ⚠⚠ O HORIZONTE — a grade TRANSPOSTA, com o rótulo do mês EMBAIXO.
 *
 * > *"botão para ver o horizonte e aí mudamos a tabela para mês, e mantemos lateralizado, ou seja,
 * > coluna com entrada, saída, impostos, folha e resultado e logo abaixo o mês a que se refere. Um
 * > mês ao lado do outro."*
 *
 * ⚠⚠ **O RÓTULO DE BAIXO É `<th scope="col">` DENTRO DE UM `<tfoot>`, nunca um `<td>` solto.** Uma
 * tabela transposta continua sendo tabela para quem usa leitor de tela; sem o `scope`, cada número
 * perde o nome da coluna a que pertence, e a tela vira uma parede de valores anônimos.
 *
 * ⚠ **Clicar na coluna volta para os dias DAQUELE mês** — o caminho de ida e volta é o mesmo, e é
 * por isso que o botão vive no rodapé, que é onde o nome do mês está.
 */
function Horizonte({ meses, unidade, comFolha, cicloAtual, aoAbrirMes }) {
  const g = gradeTransposta(meses, { comFolha });

  return (
    <div className="table-wrap">
      <table className="table table--fluxo-v4-horizonte">
        {/*
          ⚠⚠ **NÃO HÁ `<thead>`, E ISSO É DELIBERADO.** A primeira versão tinha um, com "Categoria"
          visível e os meses em `.sr-only` — e no navegador ele virava uma faixa cinza com uma
          palavra e onze células vazias, além de dar DOIS cabeçalhos de coluna para o mesmo mês (o
          de cima oculto e o de baixo visível), que o leitor de tela lê duas vezes.

          ⚠ A tabela continua íntegra sem ele: cada LINHA é nomeada pelo `<th scope="row">` da
          categoria, e cada COLUNA pelo `<th scope="col">` do `<tfoot>` — que é onde o dono pediu o
          nome do mês (*"e logo abaixo o mês a que se refere"*). O `<caption>` diz o que a tabela é
          para quem não a vê, e é `.sr-only` porque o card já tem título.
        */}
        <caption className="sr-only">
          Horizonte: cada coluna é um mês, e o nome dele está no rodapé da coluna.
        </caption>
        <tbody>
          {g.linhas.map((l) => (
            <tr key={l.chave} data-categoria={l.chave}>
              <th scope="row">{l.rotulo}</th>
              {l.celulas.map((celula, i) => (
                <Celula
                  key={g.competencias[i]}
                  celula={celula}
                  coluna={l.chave}
                  unidade={unidade}
                  entradaDoPeriodo={g.entradas[i]}
                />
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="col-periodo sr-only">Mês</th>
            {g.competencias.map((c) => (
              <th
                key={c}
                scope="col"
                data-agora={c === cicloAtual ? "sim" : undefined}
              >
                <button
                  type="button"
                  className="fluxo-v3-periodo"
                  onClick={() => aoAbrirMes(c)}
                  title={`Ver ${rotuloDoMes(c)} dia a dia`}
                >
                  {mesCurto(c)}
                </button>
              </th>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * O DRE GERENCIAL — e a partir de 29/08/2026 ele é REAL, montado pelo nosso plano de contas.
 *
 * > Dono: *"a nossa DRE para o cliente deve ser montada baseada no nosso plano de contas."*
 *
 * ⚠⚠ **O RÓTULO É "DRE GERENCIAL", E *"não é peça fiscal"* VAI NA TELA.** O projeto já recusa
 * entregar balanço e balancete a partir de lançamentos (`features/relatorios`), e um demonstrativo
 * com NOME DE PEÇA CONTÁBIL saindo de lançamento é exatamente o que aquela recusa existe para
 * impedir. ⚠ Isto **não** é a legenda que o critério de corte deste app manda cortar: ela não
 * descreve uma ausência visível, ela impede uma AFIRMAÇÃO — a de que este papel vale perante o
 * fisco.
 */
function Dre({ dados }) {
  /**
   * ⚠⚠ **VAZIO É RESPOSTA, E ELE TEM NOME.** Medido: 12 das 34 empresas não têm lançamento nenhum.
   * Um DRE de `R$ 0,00` em toda linha AFIRMA que a empresa não faturou nem gastou nada no mês —
   * e o que houve é que o contador ainda não lançou. As duas coisas pedem ações opostas: uma é
   * "seu mês foi zero", a outra é "fale com o seu contador".
   */
  if (dados?.semLancamento) {
    return (
      <div className="dre-vazio">
        <strong>Ainda não há lançamentos nesta competência.</strong>
        <span>
          O seu contador ainda não lançou este mês. Isto não quer dizer que a empresa não teve
          movimento — quer dizer que o DRE ainda não pode ser montado.
        </span>
      </div>
    );
  }

  return (
    <>
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

      {/*
        ⚠⚠ A LINHA "NÃO CLASSIFICADO" É OBRIGATÓRIA, e ela nunca vira zero nem some.

        Medido na base: a conta EM BRANCO carrega R$ 687.355,94 — dos quais R$ 321.822,26 de RECEITA
        e R$ 20.274,56 de DAS. **Some com ela e a empresa some do DRE**: os números acima passariam a
        descrever meia empresa, com cara de completos.

        ⚠ As causas vêm SEPARADAS porque o conserto é diferente, e a frase de cada uma vem do
        SERVIDOR. ⚠ Conta em branco NÃO é erro — a provisão de guia nasce assim.
      */}
      {(dados.naoClassificado || []).length ? (
        <div className="dre-nao-classificado">
          <strong>Fora do DRE, por enquanto</strong>
          {dados.naoClassificado.map((n) => (
            <p key={n.causa} data-causa={n.causa}>
              <span className="dre-nc-valor">{brl(n.valor)}</span>
              {" — "}
              {n.frase}
            </p>
          ))}
        </div>
      ) : null}

      {/* ⚠ O rótulo do que isto É. Ver o cabeçalho da função. */}
      <p className="dre-rodape">
        <strong>DRE gerencial</strong> — montado a partir dos lançamentos contábeis da sua empresa.
        Não é peça fiscal.
      </p>
    </>
  );
}

export function BlocoDeDemonstracao({ companyId, competencia, aoVerGuias, hoje: hojeInjetado = null }) {
  const [visao, setVisao] = useState("fluxo");
  /** ⚠ `rs` × `pct` — v3 §3.6. Ele combina livremente com Fluxo/DRE e sobrevive à troca de modo. */
  const [unidade, setUnidade] = useState("rs");
  /**
   * ⚠⚠ **DIAS É O ESTADO INICIAL (v4, 29/08/2026)** — e isto INVERTE o v3, em que os dias eram um
   * mergulho a partir da tabela de meses. Decisão do dono: *"ao invés de mostrar o mês ele vai
   * mostrar os dias mesmo"*. O `horizonte` é a antiga tabela de meses, transposta, atrás do botão.
   */
  const [modo, setModo] = useState("dias");
  /**
   * ⚠⚠ ONDE A TABELA COMEÇA — e são DUAS coisas diferentes, que já foram uma só e custaram caro.
   *
   * `competencia` é o "hoje" (o mês que a tela marca, e que decide o que é passado); `janelaInicio`
   * é a posição da CONSULTA (12 meses); `mesEsquerda` é o bloco da esquerda na visão de dias.
   * ⚠ `null` nos dois = padrão decidido pelo SERVIDOR (janela) e pelo ciclo (bloco). A tela não os
   * calcula — enquanto o início da janela e o "hoje" eram um valor só, andar com a seta movia o
   * "hoje" junto e a marca do mês corrente escorregava com a tabela.
   */
  const [janelaInicio, setJanelaInicio] = useState(null);
  const [mesEsquerda, setMesEsquerda] = useState(null);
  /** ⚠ Fechar o pop-up com Esc vale só para ESTA sessão — e não grava nada. */
  const [popUpDispensado, setPopUpDispensado] = useState(false);
  /**
   * ⚠⚠ A GAVETA — UMA SÓ, e o estado mora AQUI (30/08/2026).
   *
   * ⚠ Ela não pode viver dentro de `TabelaDeDias`: são DOIS blocos lado a lado, e um estado por
   * bloco deixaria duas gavetas abertas ao mesmo tempo — cada uma cobrindo metade da outra.
   * ⚠ `balde: null` é o clique no DIA (mostra tudo + o formulário); com balde, é o clique na
   * célula daquela coluna.
   */
  const [gaveta, setGaveta] = useState(null);

  /**
   * ⚠ O RELÓGIO É LIDO AQUI, na borda, e desce INJETADO — a regra pura (`janelaDeDias`) continua
   * sem ler relógio nenhum, que é a disciplina deste projeto inteiro.
   * ⚠ Acessadores UTC, como as competências são escritas: às 21h de Brasília o `getDate()` local e o
   * UTC divergem, e a linha de ciano cairia no dia errado.
   */
  /**
   * ⚠⚠ O DIA DE HOJE É INJETÁVEL, e a razão é teste — não gosto.
   *
   * A janela de 10 dias se ancora em hoje; lendo o relógio direto, o mesmo teste passaria em agosto
   * e cairia em setembro. É a mesma disciplina que `montarFluxoDeCaixa` já aplica no servidor
   * (*"o `hoje` é INJETADO"*), agora deste lado.
   * ⚠ O padrão continua sendo o relógio de verdade, lido AQUI na borda — a regra pura
   * (`janelaDeDias`) segue sem ler relógio nenhum.
   * ⚠ Acessador UTC, como as competências são escritas: às 21h de Brasília o dia local e o UTC
   * divergem, e a linha de ciano cairia no dia errado.
   */
  const diaDeHoje = Number.isInteger(hojeInjetado) ? hojeInjetado : new Date().getUTCDate();

  const fluxoQuery = useCarregamento(
    () => api.getFluxoCaixa(companyId, { competencia, janelaInicio }),
    [companyId, competencia, janelaInicio],
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

  const meses = Array.isArray(dados?.meses) ? dados.meses : [];
  const janela = dados?.janela || null;
  /** ⚠ O ciclo do servidor manda no bloco da esquerda enquanto ninguém tiver andado. */
  const esquerda = mesEsquerda || dados?.cicloAtual || competencia;
  const par = parDeMeses(meses, esquerda);
  const nav = navegacaoDoPar({ meses, esquerda, janela });
  /**
   * ⚠⚠ A COLUNA FOLHA SÓ EXISTE SE HOUVER FOLHA (v3 §3.2), e **quem decide é o servidor**.
   * ⚠ `!== false`: resposta que não trouxesse o campo mostraria a coluna vazia, que é barato —
   * escondê-la por omissão faria a folha sumir sem ninguém saber. Mesma regra do selo.
   */
  const comFolha = dados?.folha?.disponivel !== false;

  /**
   * ⚠⚠ O ALERTA SAI DO FLUXO, NUNCA DE `atual` (31/08/2026).
   *
   * Lia `dados?.alertaDeGuias`, e `dados` é o payload da visão ATUAL — no DRE ele não tem esse
   * campo, então a tabela de guias vencidas **sumia do Início** ao alternar. Quem deixasse o painel
   * em DRE deixava de ver a guia vencida, que é exatamente a perda que `GuiasVencidas` existe para
   * impedir (o corte do card "Próximos vencimentos" a deixou nomeada).
   *
   * ⚠ A visão nasce em `fluxo`, então quando alguém alterna para o DRE este payload já veio. Dado
   * de alguns segundos atrás sobre guia VENCIDA continua verdadeiro — e a alternativa (esconder)
   * é a que mente.
   */
  const alerta = fluxoQuery.dados?.alertaDeGuias || null;
  const mostraPopUp = visao === "fluxo" && !popUpDispensado
    && Boolean(alerta?.ackPending) && (alerta?.itens?.length > 0);

  /**
   * ⚠⚠ AS SETAS ANDAM **MÊS A MÊS** NA VISÃO DE DIAS, e **janela a janela** no horizonte.
   *
   * > Dono: *"setas cabeçalho para andar para frente e para trás entre os meses"*.
   *
   * ⚠ Não são dois botões com dois significados: nos dois modos elas movem **o período que está na
   * tela**, e é isso que o rótulo acessível diz. O que muda é o tamanho do passo, porque o que está
   * na tela é diferente.
   *
   * ⚠⚠ **DENTRO DA JANELA O PASSO NÃO VAI AO SERVIDOR** — os 12 meses já vieram na mesma consulta.
   * Só na BORDA dela a tela pede uma janela nova, e pede **com uma folga atrás**, para o passo
   * seguinte na mesma direção também ser de graça. Pedir a cada passo faria a seta parecer lenta na
   * navegação mais comum, que é andar um mês.
   */
  function andarNoTempo(passos) {
    if (modo === "horizonte") {
      const base = janela?.inicio;
      if (!base) return;
      setJanelaInicio(somarCompetencia(base, passos));
      return;
    }
    const alvo = somarCompetencia(esquerda, passos);
    if (!alvo) return;
    setMesEsquerda(alvo);
    const precisa = passos < 0 ? nav.precisaDeConsultaParaVoltar : nav.precisaDeConsultaParaAvancar;
    if (precisa) setJanelaInicio(somarCompetencia(alvo, -MESES_DE_FOLGA));
  }

  /** ⚠ Do horizonte para os dias DAQUELE mês — o caminho de ida e volta é o mesmo. */
  function abrirMes(comp) {
    setMesEsquerda(comp);
    setModo("dias");
  }

  const podeVoltar = modo === "horizonte" ? Boolean(janela?.podeVoltar) : nav.podeVoltar;
  const podeAvancar = modo === "horizonte" ? Boolean(janela?.podeAvancar) : nav.podeAvancar;

  return (
    <section
      /* ⚠ A moldura tracejada de `.demonstracao` é do que É demonstração. Com o fluxo real ela sai,
         senão a tela continuaria dizendo "isto é maquete" por desenho depois de o selo sumir. */
      className={demonstracao ? "card demonstracao" : "card"}
      aria-label="Fluxo de caixa e DRE"
      /* ⚠ Auditável no DOM, como `data-status` e `data-estado-nota`. */
      data-demonstracao={demonstracao ? "sim" : "nao"}
      data-modo-do-fluxo={visao === "fluxo" ? modo : undefined}
    >
      <div className="card-header">
        {/*
          ⚠⚠ O TÍTULO "Fluxo de caixa" SAIU DA ESQUERDA — decisão do dono, 30/08/2026: *"tire fluxo
          de caixa da esquerda"*. Ele repetia, em texto grande, a palavra que o botão pressionado ao
          lado já diz — e o alternador é quem manda, porque é ele que muda.
          ⚠ **O `<h2>` NÃO SUMIU: ele virou `.sr-only`.** Apagá-lo deixaria a seção sem cabeçalho de
          nível 2, e quem navega por lista de títulos perderia o bloco inteiro. ⚠ E ele mantém o nome
          LONGO ("Fluxo de caixa"), porque fora da tela não existe o botão ao lado para dar contexto.
        */}
        <h2 className="sr-only">{visao === "fluxo" ? "Fluxo de caixa" : "DRE"}</h2>
        <div className="page-actions">
          {/* ⚠ Trocar de visão NÃO navega — são botões, jamais `<a href>`. Inventar `#/dre` daria um
              hash que o `useRota` recusa e devolve ao padrão: o "filtro fantasma" dentro da tela. */}
          <div className="seg" role="group" aria-label="Visão do painel">
            {VISOES.map((v) => (
              <button
                key={v.chave}
                type="button"
                aria-pressed={v.chave === visao}
                onClick={() => setVisao(v.chave)}
              >
                {v.rotulo}
              </button>
            ))}
          </div>

          {visao === "fluxo" ? (
            <div className="seg" role="group" aria-label="Unidade">
              {UNIDADES.map((u) => (
                <button
                  key={u.chave}
                  type="button"
                  aria-pressed={u.chave === unidade}
                  onClick={() => setUnidade(u.chave)}
                >
                  {u.rotulo}
                </button>
              ))}
            </div>
          ) : null}

          {/* ⚠⚠ O BOTÃO DO HORIZONTE É UM ALTERNADOR, e ele DIZ o estado (`aria-pressed`) em vez de
              trocar de rótulo. Um botão que vira "Dias" quando está em dias faz a pessoa ler o
              rótulo como "você está aqui" metade das vezes e como "vá para lá" na outra metade. */}
          {visao === "fluxo" ? (
            <button
              type="button"
              className="btn btn-alternador"
              aria-pressed={modo === "horizonte"}
              onClick={() => setModo((m) => (m === "horizonte" ? "dias" : "horizonte"))}
            >
              Horizonte
            </button>
          ) : null}

          {visao === "fluxo" ? (
            <div className="fluxo-v3-navegacao">
              <button
                type="button"
                aria-label={modo === "horizonte" ? "Meses anteriores" : "Mês anterior"}
                /* ⚠ DESABILITA no limite, nunca some: botão que some esconde que a ação existe, e
                   botão que não responde parece defeito. O limite vem do SERVIDOR. */
                disabled={!podeVoltar}
                onClick={() => andarNoTempo(-1)}
              >‹</button>
              <button
                type="button"
                aria-label={modo === "horizonte" ? "Meses seguintes" : "Mês seguinte"}
                disabled={!podeAvancar}
                onClick={() => andarNoTempo(1)}
              >›</button>
            </div>
          ) : null}
        </div>
      </div>

      {demonstracao ? <Selo /> : null}

      {atual.carregando ? <Carregando /> : null}

      <AlertaErro
        erro={atual.erro}
        padrao="Não foi possível montar o painel."
        aoTentarNovamente={atual.recarregar}
      />

      {/*
        ⚠⚠ A TABELA DE GUIAS EM ATRASO, ACIMA DO FLUXO — decisão do dono, 30/08/2026: *"a parte que
        eu falei da tabela com as guias vencidas em cima do fluxo não aparece; ela deve aparecer com
        duas linhas e meia caso tenha mais de 3 guias, para que o cliente saiba que precisa rolar
        para ver mais."*

        ⚠⚠ ELA NÃO SUBSTITUI O POP-UP, e as duas respondem perguntas diferentes: o pop-up
        INTERROMPE uma vez e se dispensa com "Estou ciente"; a tabela FICA, e é onde o cliente volta
        para ver quanto e quando. Sem ela, dispensado o pop-up, a guia vencida some do Início — que
        é a perda que o corte do card "Próximos vencimentos" (28/08) deixou nomeada.

        ⚠⚠ ESTA LINHA DIZIA "só na visão de FLUXO: no DRE ela não tem o que fazer" — e ela
        contradizia o parágrafo logo acima, que é o motivo de o componente existir. Achado em teste
        de usabilidade em 31/08/2026: alternando para o DRE, a guia vencida sumia do Início, que é
        a perda que este bloco existe para impedir. Guia vencida não é assunto do fluxo — é a linha
        mais urgente da tela, e ela vale nas duas visões.
        ⚠ Ela some sozinha quando não há guia em atraso, e nada é dito — frase que descreve uma
        ausência já visível é ruído (critério do dono).
      */}
      {!atual.carregando && !atual.erro ? (
        <GuiasVencidas alerta={alerta} aoVerGuias={aoVerGuias} />
      ) : null}

      {!atual.carregando && !atual.erro && dados ? (
        visao === "fluxo" ? (
          modo === "dias" ? (
            /* ⚠⚠ "QUANDO A TELA PERMITIR" — abaixo de ~900px o segundo mês vai ABAIXO do primeiro,
               nunca some, e a página não rola para o lado. A regra é do CSS (`.fluxo-v4-par`), e o
               DOM é o mesmo nas duas larguras: esconder um bloco por media query faria a tela
               mostrar menos dinheiro no celular sem dizer. */
            <div className="fluxo-v4-par">
              {par.map((bloco) => (
                <TabelaDeDias
                  key={bloco.competencia}
                  bloco={bloco}
                  unidade={unidade}
                  comFolha={comFolha}
                  /* ⚠ O bloco diz QUAL mês é o dele — a gaveta precisa das linhas daquele mês, e
                     os dois blocos da tela são meses diferentes. */
                  aoAbrir={(dia, balde) => setGaveta({ competencia: bloco.competencia, dia, balde })}
                  /* ⚠⚠ SÓ O MÊS CORRENTE TEM "HOJE". Passar o dia para os outros pintaria de ciano
                     uma data que não significa nada naquele mês — e o ciano, nesta tela, quer dizer
                     "é aqui que você está". ⚠ Quem é o mês corrente é o SERVIDOR (`cicloAtual`),
                     nunca uma conta feita aqui. */
                  diaDeHoje={bloco.competencia === dados.cicloAtual ? diaDeHoje : null}
                  cabecalho={(
                    <h3
                      className="fluxo-v4-mes"
                      data-agora={bloco.competencia === dados.cicloAtual ? "sim" : undefined}
                    >
                      {rotuloDoMes(bloco.competencia)}
                    </h3>
                  )}
                />
              ))}
            </div>
          ) : (
            <Horizonte
              meses={meses}
              unidade={unidade}
              comFolha={comFolha}
              cicloAtual={dados.cicloAtual}
              aoAbrirMes={abrirMes}
            />
          )
        ) : <Dre dados={dados} />
      ) : null}

      {/*
        ⚠⚠ O PAINEL "SUAS SAÍDAS" SAIU DAQUI EM 30/08/2026 — dono: *"essa aba de saídas ao final da
        tabela tem que sumir daí, isso não existe."*

        Ele existia para o cliente ACRESCENTAR e REMOVER as próprias saídas, e a primeira metade
        mudou de lugar: hoje se acrescenta clicando na célula do dia, na GAVETA — que é onde ele já
        está olhando quando pensa na saída.

        ⚠⚠ **A PERDA FICA NOMEADA, e é real: com o painel some o botão de REMOVER** a saída
        pendente. A gaveta lista o que ele escreveu, mas ainda não oferece apagar. Enquanto isso, a
        recusa continua sendo do contador, na Conferência.
        ⚠ `SuasSaidas.jsx` **não foi apagado** — apagar componente é decisão à parte nesta casa, e o
        formulário dele é o molde do da gaveta.
      */}

      <GavetaDoDia
        aberta={Boolean(gaveta)}
        competencia={gaveta?.competencia}
        dia={gaveta?.dia ?? null}
        balde={gaveta?.balde ?? null}
        linhasDoMes={(meses.find((m) => m.competencia === gaveta?.competencia)?.linhas) || []}
        companyId={companyId}
        aoFechar={() => setGaveta(null)}
        /* ⚠ Criada a saída, quem recarrega é o BLOCO — com a MESMA consulta que desenha a tabela.
           Acrescentar a linha na mão faria a gaveta e a tabela discordarem até a próxima leitura. */
        aoMudar={() => { setGaveta(null); atual.recarregar(); }}
      />

      {mostraPopUp ? (
        <PopUpDeGuias
          companyId={companyId}
          alerta={alerta}
          aoVerGuias={() => { setPopUpDispensado(true); aoVerGuias?.(); }}
          /* ⚠⚠ `Esc` e o X fecham SEM gravar — a confirmação é só pelo botão (v3 §1). O aviso volta
             na próxima abertura, que é exatamente o desenho. */
          aoFechar={() => setPopUpDispensado(true)}
          /* ⚠ Gravou ⇒ o payload muda (`ackPending: false`), então a tela recarrega em vez de
             esconder o pop-up por conta própria: quem decide se avisa é o servidor. */
          aoConfirmar={() => { setPopUpDispensado(true); atual.recarregar(); }}
        />
      ) : null}
    </section>
  );
}

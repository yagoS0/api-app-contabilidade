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
import { mesCurto, rotuloDoMes } from "./lib/leituraDoFluxo";
// ⚠ A agregação das SEIS COLUNAS mora fora do espelho: `leituraDoFluxo.js` é cópia da do contador, e
// esta tabela só existe no portal do cliente. Ver o cabeçalho de `tabelaDoFluxo.js`.
import {
  COLUNAS, COLUNAS_EM_PERCENTUAL, STATUS, emPercentual, linhaDoMes, linhasDosDias,
} from "./lib/tabelaDoFluxo";
// ⚠ `diasDoMes` é aritmética de STRING, nunca `toISOString()`: às 22h de Brasília o ISO devolveria
// o dia seguinte. Ela é a única coisa que sobrou de `dadosDeDemonstracao` no caminho do fluxo.
import { diasDoMes } from "./lib/dadosDeDemonstracao";
import { PopUpDeGuias } from "./PopUpDeGuias";

/** ⚠ 10 por vez (v3 §3.7). O resto entra ao chegar no fim da rolagem. */
const DIAS_POR_VEZ = 10;

/** ⚠ R$ × % — v3 §3.6. Entrada e Resultado seguem em R$ nos dois. */
const UNIDADES = [
  { chave: "rs", rotulo: "R$" },
  { chave: "pct", rotulo: "%" },
];

/** Soma meses a uma competência. ⚠ Aritmética de string; dezembro + 1 vira janeiro do ano seguinte. */
function somarCompetencia(competencia, n) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(competencia || ""));
  if (!m) return null;
  const t = Number(m[1]) * 12 + (Number(m[2]) - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

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
 * `ressalvasDoFluxo` continuam em `lib/leituraDoFluxo.js`, com teste próprio, e continuam sendo
 * renderizadas **no portal do contador** — que é quem trabalha com elas. E a pergunta *"de onde veio
 * esse número?"* passou a ter lugar próprio: a camada 4 da Constituição, o drill-in de dias.
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
function Celula({ celula, coluna, unidade, entradaDoPeriodo }) {
  if (!celula) {
    return (
      <td className="num" data-coluna={coluna}>
        <span className="fluxo-v3-vazio" aria-hidden="true">–</span>
        <span className="sr-only">sem lançamento</span>
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
  return (
    <td className="num" data-coluna={coluna}>
      <span
        className="fluxo-v3-valor"
        data-coluna={coluna}
        data-status={celula.status}
        data-negativo={coluna === "resultado" && celula.valor < 0 ? "sim" : undefined}
        /* ⚠ O terceiro canal. "Previsto" é a palavra da Lei 5 — ela cobre compromisso E presunção,
           que por fora são a mesma cor. */
        aria-label={previsto ? `${ehPercentual ? pctFmt.format(pct) + "%" : naGrade(celula.valor)}, previsto` : undefined}
      >
        {ehPercentual ? `${pctFmt.format(pct)}%` : naGrade(celula.valor)}
      </span>
    </td>
  );
}

/** As cinco células de uma linha — mês ou dia, o mesmo desenho. */
function CelulasDoPeriodo({ linha, unidade, comFolha }) {
  return COLUNAS
    .filter((c) => comFolha || c.chave !== "folha")
    .map((c) => (
      <Celula
        key={c.chave}
        celula={linha[c.chave]}
        coluna={c.chave}
        unidade={unidade}
        entradaDoPeriodo={linha.entrada}
      />
    ));
}

/**
 * ⚠⚠ A MESMA TABELA MUDA — ela não abre uma segunda embaixo.
 *
 * > v3 §3.7: *"Clique numa linha de mês **substitui a tabela de meses pela tabela de dias daquele
 * > mês**. Não é expansão inline: os outros meses somem."*
 *
 * ⚠ As COLUNAS não mudam entre as duas visões — o que troca é o que a LINHA significa. Trocá-las
 * junto faria a pessoa reaprender a tabela a cada clique.
 *
 * ⚠⚠ **A LINHA DO MÊS NÃO RECEBE `role="button"`**, embora o mockup do dono o use: isso a tiraria da
 * semântica de tabela, e a decisão já estava escrita neste app antes do v3. Quem carrega o nome
 * acessível e o teclado é o `<button>` dentro do `<th scope="row">` — que dá Enter, Espaço e foco de
 * graça, sem `onKeyDown` à mão. A errata §7.5 da Constituição adotou exatamente isso.
 */
function TabelaDoFluxo({
  meses, cicloAtual, mesAberto, unidade, comFolha, diasVisiveis,
  aoAbrirMes, aoVoltar, aoRolar,
}) {
  const emDias = Boolean(mesAberto);
  const colunas = COLUNAS.filter((c) => comFolha || c.chave !== "folha");
  const dodia = emDias ? linhasDosDias(mesAberto, diasDoMes(mesAberto.competencia).length) : null;
  const visiveis = dodia ? dodia.dias.slice(0, diasVisiveis) : [];

  return (
    <div
      className={emDias ? "table-wrap table-wrap--dias" : "table-wrap"}
      onScroll={emDias ? aoRolar : undefined}
    >
      <table className="table table--fluxo-v3">
        <thead>
          <tr>
            <th scope="col" className="col-periodo">{emDias ? "Dia" : "Mês"}</th>
            {colunas.map((c) => (
              <th key={c.chave} scope="col" data-coluna={c.chave}>{c.rotulo}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!emDias && meses.map((mes) => {
            const linha = linhaDoMes(mes);
            const agora = mes.competencia === cicloAtual;
            return (
              <tr key={mes.competencia} data-agora={agora ? "sim" : undefined}>
                <th scope="row">
                  <button
                    type="button"
                    className="fluxo-v3-periodo"
                    onClick={() => aoAbrirMes(mes.competencia)}
                    title={`Ver ${rotuloDoMes(mes.competencia)} dia a dia`}
                  >
                    {mesCurto(mes.competencia)}
                  </button>
                </th>
                <CelulasDoPeriodo linha={linha} unidade={unidade} comFolha={comFolha} />
              </tr>
            );
          })}

          {emDias && (
            <>
              {/* ⚠⚠ "NO MÊS" VEM PRIMEIRO, E É A MAIORIA DO DINHEIRO. As projeções não têm dia (o
                  prazo de recebimento é contado em meses, a recorrência diz o ciclo, a folha é por
                  competência). Espalhá-las pelos dias inventaria precisão que ninguém informou. */}
              {dodia.semDia ? (
                <tr className="fluxo-v3-sem-dia">
                  <th scope="row">no mês</th>
                  <CelulasDoPeriodo linha={dodia.semDia} unidade={unidade} comFolha={comFolha} />
                </tr>
              ) : null}
              {visiveis.map((d) => (
                <tr key={d.dia}>
                  <th scope="row">dia {String(d.dia).padStart(2, "0")}</th>
                  <CelulasDoPeriodo linha={d} unidade={unidade} comFolha={comFolha} />
                </tr>
              ))}
            </>
          )}
        </tbody>
      </table>

      {/* ⚠ Ele some no fim, senão a frase promete um resto que não existe. */}
      {emDias && visiveis.length < dodia.dias.length ? (
        <span className="fluxo-v3-mais">Role para ver mais dias</span>
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

export function BlocoDeDemonstracao({ companyId, competencia, aoVerGuias }) {
  const [visao, setVisao] = useState("fluxo");
  /** ⚠ `rs` × `pct` — v3 §3.6. Ele combina livremente com Fluxo/DRE e sobrevive ao drill-in. */
  const [unidade, setUnidade] = useState("rs");
  /**
   * ⚠⚠ ONDE A TABELA COMEÇA — e ela é OUTRA COISA que a competência da casca.
   *
   * `competencia` é o "hoje" (o mês que a tela pinta de ciano, e que decide o que é passado);
   * `janelaInicio` é só navegação com as setas. Enquanto eram um valor só, andar com a seta movia
   * o "hoje" junto e o ciano escorregava com a tabela.
   * ⚠ `null` = posição padrão, decidida pelo servidor (corrente−4). A tela não a calcula.
   */
  const [janelaInicio, setJanelaInicio] = useState(null);
  /** ⚠ O mês aberto no drill-in. Nasce fechado: mergulho não é estado inicial. */
  const [mesAberto, setMesAberto] = useState(null);
  /** ⚠ 10 por vez, +10 ao fim da rolagem (v3 §3.7). */
  const [diasVisiveis, setDiasVisiveis] = useState(DIAS_POR_VEZ);
  /** ⚠ Fechar o pop-up com Esc vale só para ESTA sessão — e não grava nada. */
  const [popUpDispensado, setPopUpDispensado] = useState(false);

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
  const mesDoDrill = mesAberto ? meses.find((m) => m.competencia === mesAberto) || null : null;
  /**
   * ⚠⚠ A COLUNA FOLHA SÓ EXISTE SE HOUVER FOLHA (v3 §3.2), e **quem decide é o servidor**.
   * ⚠ `!== false`: resposta que não trouxesse o campo mostraria a coluna vazia, que é barato —
   * escondê-la por omissão faria a folha sumir sem ninguém saber. Mesma regra do selo.
   */
  const comFolha = dados?.folha?.disponivel !== false;

  const alerta = dados?.alertaDeGuias || null;
  const mostraPopUp = visao === "fluxo" && !popUpDispensado
    && Boolean(alerta?.ackPending) && (alerta?.itens?.length > 0);

  function andarJanela(passos) {
    const base = janela?.inicio;
    if (!base) return;
    setMesAberto(null);
    setJanelaInicio(somarCompetencia(base, passos));
  }

  function abrirMes(comp) {
    setMesAberto(comp);
    setDiasVisiveis(DIAS_POR_VEZ);
  }

  /** ⚠ Anexa mais 10 ao CHEGAR no fim, e nunca passa do número real de dias do mês. */
  function aoRolar(ev) {
    const el = ev.currentTarget;
    if (el.scrollTop + el.clientHeight < el.scrollHeight - 24) return;
    setDiasVisiveis((n) => n + DIAS_POR_VEZ);
  }

  return (
    <section
      /* ⚠ A moldura tracejada de `.demonstracao` é do que É demonstração. Com o fluxo real ela sai,
         senão a tela continuaria dizendo "isto é maquete" por desenho depois de o selo sumir. */
      className={demonstracao ? "card demonstracao" : "card"}
      aria-label="Fluxo de caixa e DRE"
      /* ⚠ Auditável no DOM, como `data-status` e `data-estado-nota`. */
      data-demonstracao={demonstracao ? "sim" : "nao"}
    >
      <div className="card-header">
        <h2>{visao === "fluxo" ? "Fluxo de caixa" : "DRE"}</h2>
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

          {/* ⚠⚠ AS SETAS SOMEM NO DRILL-IN (v3 §3.7): dentro dos dias elas navegariam a janela de
              MESES, que não está na tela — um controle que comanda o que ninguém vê. */}
          {visao === "fluxo" && !mesAberto ? (
            <div className="fluxo-v3-navegacao">
              <button
                type="button"
                aria-label="Meses anteriores"
                /* ⚠ DESABILITA no limite, nunca some: botão que some esconde que a ação existe, e
                   botão que não responde parece defeito. Os dois limites vêm do SERVIDOR. */
                disabled={!janela?.podeVoltar}
                onClick={() => andarJanela(-1)}
              >‹</button>
              <button
                type="button"
                aria-label="Meses seguintes"
                disabled={!janela?.podeAvancar}
                onClick={() => andarJanela(1)}
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

      {!atual.carregando && !atual.erro && dados ? (
        visao === "fluxo" ? (
          <>
            {mesDoDrill ? (
              <div className="fluxo-v3-migalha">
                {/* ⚠ A saída fica onde a pessoa entrou: ela clicou na tabela, e o caminho de volta
                    está na tabela. */}
                <button type="button" className="fluxo-v3-voltar" onClick={() => setMesAberto(null)}>
                  ‹ Voltar aos meses
                </button>
                <strong>{rotuloDoMes(mesDoDrill.competencia)}</strong>
              </div>
            ) : null}
            <TabelaDoFluxo
              meses={meses}
              cicloAtual={dados.cicloAtual}
              mesAberto={mesDoDrill}
              unidade={unidade}
              comFolha={comFolha}
              diasVisiveis={diasVisiveis}
              aoAbrirMes={abrirMes}
              aoRolar={aoRolar}
            />
          </>
        ) : <Dre dados={dados} />
      ) : null}

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

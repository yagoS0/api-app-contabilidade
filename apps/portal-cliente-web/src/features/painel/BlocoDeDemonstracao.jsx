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
  mesCurto,
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

/**
 * O DETALHE DE UM MÊS — as linhas, com a evidência de cada uma.
 *
 * ⚠⚠ ELE NÃO REPETE OS TOTAIS. A coluna daquele mês na planilha já os mostra, e duas leituras do
 * mesmo número lado a lado é como elas divergem. Até 27/08/2026 este bloco vinha DOZE vezes na tela,
 * cada um com `<h3>` + totais + tabela própria; medido no navegador, isso dava **1.723px — 74% da
 * página inicial — para 7 linhas de conteúdo**.
 */
function MesDoFluxo({ mes }) {
  return (
    <section className="fluxo-mes">
      <h3>{rotuloDoMes(mes?.competencia)}</h3>
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
 * ⚠⚠ A PLANILHA — UMA GRADE, MESES NAS COLUNAS.
 *
 * Pedido do dono em 27/08/2026, com a tela na frente: *"um monte de meses aparecendo, excesso de
 * tabela, o fluxo deve se parecer mais com uma planilha excel"*.
 *
 * ⚠ O QUE ELE VIA, MEDIDO NO NAVEGADOR (1280px, mock, 08/2026): o bloco do fluxo ocupava
 * **1.723px de 2.325px — 74% da página inicial** e montava **11 blocos empilhados e 3 tabelas para
 * 7 linhas de conteúdo**. Em 375px a página inteira tinha **4,4 telas de rolagem**, com linhas de
 * até **183px cada**. Uma linha de tabela normal tem ~40px.
 *
 * ⚠⚠ A CAUSA NÃO ERA A GRANULARIDADE, era renderizar UM COMPARTIMENTO POR PERÍODO. A forma anterior
 * a esta era diária e tinha a mesma doença: 31 linhas, 24 delas vazias. Trocar de dia para mês mudou
 * o eixo e manteve o vazio — 8 dos 12 meses não têm nada.
 *
 * ⚠ E a linha não era uma linha: era um parágrafo. Cada `<tr>` empilhava 4 a 6 blocos de texto numa
 * célula (rótulo, chip, origem, evidência, confronto), e a coluna "Quando" carregava frases
 * inteiras — *"A recorrência diz de quanto em quanto tempo, não em que dia do mês."* aparecia
 * **três vezes** na mesma tela.
 *
 * A grade inverte isso: uma linha é uma linha, o olho varre a coluna, e a evidência desce para o
 * detalhe do mês — ela **não some**, deixa de estar toda aberta ao mesmo tempo.
 *
 * ⚠⚠ **NÃO EXISTE LINHA DE TOTAL, E A AUSÊNCIA É O CONTRATO.** `TotaisDoMes` já registra que não há
 * uma quarta caixa somando `fato` e `previsão`; um rodapé "No mês" recriaria exatamente o número
 * único que a API se recusa a entregar. As quatro linhas **são** os totais, separados por
 * procedência — é por isso que são quatro, e não duas.
 */
const LINHAS_DA_PLANILHA = [
  { chave: "entra-fato", direcao: "Entra", procedencia: PROCEDENCIA.FATO, ler: (t) => t.fato.entrada },
  { chave: "entra-previsao", direcao: "Entra", procedencia: PROCEDENCIA.PREVISAO, ler: (t) => t.previsao.entrada },
  { chave: "sai-fato", direcao: "Sai", procedencia: PROCEDENCIA.FATO, ler: (t) => t.fato.saida },
  { chave: "sai-previsao", direcao: "Sai", procedencia: PROCEDENCIA.PREVISAO, ler: (t) => t.previsao.saida },
];

/**
 * O dinheiro DA GRADE — o mesmo número de `brl`, sem o `R$` repetido em cada célula.
 *
 * ⚠ A GRAMÁTICA DO NÚMERO NÃO É REESCRITA AQUI: milhar, decimal, sinal e o traço da ausência
 * continuam saindo de `brl` (que é espelho do `format.ts` do app mobile). O que se tira é o SÍMBOLO,
 * que numa planilha se diz uma vez no rótulo e não doze vezes por linha — é a convenção de qualquer
 * planilha, e é o que faz `12.500,00` caber numa coluna de 80px sem quebrar em duas linhas.
 *
 * ⚠ O traço passa intocado: `brl(null)` já devolve `—`, e `replace` num traço não acha o que trocar.
 */
const naGrade = (v) => brl(v).replace("R$ ", "");

function PlanilhaDoFluxo({ meses, competenciaAberta, aoAbrirMes }) {
  const colunas = meses.map((m) => ({ mes: m, t: totaisParaTela(m?.totais) }));
  // ⚠ A linha das indetermináveis só existe quando há alguma. Uma linha de traços permanente seria o
  // vazio voltando pela porta dos fundos.
  const temDesconhecido = colunas.some((c) => c.t.desconhecido.quantas > 0);

  return (
    /* ⚠ O `overflow-x` do `.table-wrap` é o que faz a planilha rolar DENTRO dela em 375px — sem ele a
       página inteira passa a rolar para o lado, defeito que este app já pagou duas vezes. */
    <div className="table-wrap">
      <table className="table table--planilha-fluxo">
        <thead>
          <tr>
            {/* ⚠ O canto não descreve linha nem coluna — por isso não tem `scope`. Ele carrega a
                UNIDADE, que numa planilha se diz uma vez e não em cada célula: as colunas mostram
                `12.500,00`, não `R$ 12.500,00`. Sem esta palavra o número ficaria sem moeda. */}
            <td className="planilha-canto">R$</td>
            {colunas.map(({ mes }) => {
              const aberta = mes?.competencia === competenciaAberta;
              return (
                <th key={mes?.competencia} scope="col" className="num">
                  {/* ⚠⚠ O CABEÇALHO É UM `<button>`, não um `<a>`: abrir o detalhe de um mês não é
                      navegação — não há URL para ele, e inventar uma daria um hash que o `useRota`
                      recusa e devolve ao padrão. É a mesma regra que separa Fluxo ⇄ DRE de rotas. */}
                  <button
                    type="button"
                    className="planilha-mes"
                    aria-pressed={aberta}
                    onClick={() => aoAbrirMes(aberta ? null : mes?.competencia)}
                    title={rotuloDoMes(mes?.competencia)}
                  >
                    {mesCurto(mes?.competencia)}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {LINHAS_DA_PLANILHA.map((linha) => (
            <tr key={linha.chave}>
              <th scope="row">
                {linha.direcao}
                {/* ⚠⚠ "previsto" VAI NO TEXTO, nunca só na cor — a regra que `LinhaDoMes` já segue.
                    Numa grade ela pesa mais: aqui o número está longe do rótulo. */}
                <span className="chip" data-procedencia={linha.procedencia}>
                  {leituraDaProcedencia(linha.procedencia).rotulo}
                </span>
              </th>
              {colunas.map(({ mes, t }) => {
                const valor = linha.ler(t);
                return (
                  <td key={mes?.competencia} className="num" data-vazio={valor ? undefined : "sim"}>
                    {/* ⚠ ZERO SAI COMO TRAÇO. `R$ 0,00` em toda célula vazia é exatamente a parede de
                        zeros que esta forma existe para desfazer — e "nada neste compartimento" não é
                        a mesma afirmação que "zero reais". */}
                    {valor ? naGrade(valor) : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
          {temDesconhecido ? (
            <tr>
              <th scope="row">
                <span className="chip" data-procedencia={PROCEDENCIA.DESCONHECIDO}>
                  {leituraDaProcedencia(PROCEDENCIA.DESCONHECIDO).rotulo}
                </span>
              </th>
              {colunas.map(({ mes, t }) => (
                /* ⚠⚠ CONTAGEM, nunca valor — a mesma regra do `TotaisDoMes`. O que não tem valor
                   somável não vira zero e não entra em soma nenhuma. */
                <td
                  key={mes?.competencia}
                  className="num"
                  data-vazio={t.desconhecido.quantas ? undefined : "sim"}
                >
                  {t.desconhecido.quantas ? `${t.desconhecido.quantas} linha(s)` : "—"}
                </td>
              ))}
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function Fluxo({ dados }) {
  const meses = Array.isArray(dados?.meses) ? dados.meses : [];
  // ⚠ Abre no primeiro mês QUE TEM ALGO, não no primeiro da lista: com nada aberto a grade ensina os
  // números e esconde a evidência; abrindo um mês vazio, ensina a frase de vazio. `null` quando não
  // há nenhum — e aí a planilha fica sozinha, que é a resposta certa.
  const [aberta, setAberta] = useState(() => meses.find(mesTemAlgo)?.competencia ?? null);
  const mesAberto = meses.find((m) => m?.competencia === aberta) || null;
  const ressalvas = ressalvasDoFluxo(dados);

  return (
    <div className="fluxo">
      {/* ⚠⚠ AS RESSALVAS DE TOM `aviso` CONTINUAM ANTES DA GRADE, e a razão escrita segue valendo: a
          guia vencida é a linha mais urgente do fluxo e não mora em mês nenhum.
          ⚠ As de tom `info` DESCERAM para depois da grade em 27/08/2026 — elas são contexto, não
          ação, e medidas as quatro caixas ocupavam **247px antes do primeiro número da tela**. */}
      {ressalvas.filter((r) => r.tom === "aviso").map((r, i) => (
        <p key={`aviso-${r.titulo || ""}-${i}`} className="alerta alerta-aviso" role="status">
          <strong>{r.titulo}</strong> {r.texto}
        </p>
      ))}

      <PlanilhaDoFluxo meses={meses} competenciaAberta={aberta} aoAbrirMes={setAberta} />

      {mesAberto ? <MesDoFluxo mes={mesAberto} /> : null}

      {/* ⚠⚠ AS DUAS FRASES SÃO OBRIGATÓRIAS: uma diz que a previsão não aconteceu, a outra diz por que
          não existe um número único. Sem elas, "previsto" se lê como compromisso e a ausência do total
          se lê como falta. ⚠ Elas desceram junto com as ressalvas de contexto: numa grade em que
          "previsto" está escrito em toda linha, a frase deixou de precisar vir antes. */}
      <p className="meta meta--bloco">{FRASE_DA_PREVISAO}</p>
      <p className="meta meta--bloco">{FRASE_SEM_TOTAL}</p>

      {ressalvas.filter((r) => r.tom !== "aviso").map((r, i) => (
        <p key={`info-${r.titulo || ""}-${i}`} className="alerta alerta-info" role="status">
          <strong>{r.titulo}</strong> {r.texto}
        </p>
      ))}
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

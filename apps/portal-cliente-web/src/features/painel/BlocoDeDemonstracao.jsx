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
// ⚠ A agregação da PLANILHA mora fora do espelho: `leituraDoFluxo.js` é cópia da do contador, e esta
// grade só existe no portal do cliente. Ver o cabeçalho de `planilhaDoFluxo.js`.
import { linhasDaPlanilha } from "./lib/planilhaDoFluxo";

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

function PlanilhaDoFluxo({ meses, competenciaAberta, aoAbrirMes }) {
  return (
    /* ⚠ O `.table-wrap` FICA mesmo cabendo em 375px: ele é o que impede a PÁGINA de rolar para o lado
       se um dia entrar uma sexta coluna. Custo zero quando não há o que rolar. */
    <div className="table-wrap">
      <table className="table table--planilha-fluxo">
        <thead>
          <tr>
            {/* ⚠ O canto carrega a UNIDADE — numa planilha a moeda se diz uma vez, não em cada
                célula. Sem esta palavra os números ficariam sem moeda. */}
            <td className="planilha-canto">R$</td>
            {COLUNAS_DA_PLANILHA.map((c) => (
              <th key={c.chave} scope="col" className="num" data-coluna={c.chave} title={c.ajuda}>
                {c.rotulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {meses.map((mes) => {
            const t = linhasDaPlanilha(mes);
            const aberta = mes?.competencia === competenciaAberta;
            return (
              <tr key={mes?.competencia}>
                <th scope="row">
                  {/* ⚠⚠ O MÊS É UM `<button>`, não um `<a>`: abrir o detalhe não é navegação — não há
                      URL para ele, e inventar uma daria um hash que o `useRota` recusa. É a mesma
                      regra que separa Fluxo ⇄ DRE de rotas. */}
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
                {COLUNAS_DA_PLANILHA.map((c) => {
                  const partes = c.partes(t).filter((p) => p.valor);
                  return (
                    <td
                      key={c.chave}
                      className="num"
                      data-coluna={c.chave}
                      data-vazio={partes.length ? undefined : "sim"}
                    >
                      {/* ⚠ ZERO SAI COMO TRAÇO. `R$ 0,00` em toda célula vazia é a parede de zeros
                          que esta forma existe para desfazer — e "nada aqui" não é "zero reais". */}
                      {partes.length === 0 ? "—" : partes.map((pt) => (
                        <span key={pt.procedencia} className="planilha-valor" data-procedencia-celula={pt.procedencia}>
                          {naGrade(pt.valor)}
                        </span>
                      ))}
                    </td>
                  );
                })}
              </tr>
            );
          })}
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
 * quem trabalha a guia é ele. Apagar de lá quebraria o espelho e esconderia a guia vencida de quem
 * tem de agir sobre ela.
 *
 * ⚠ O `startsWith` é porque a segunda tem sufixo dinâmico (`Sem mês — SIMPLES`, com o rótulo da guia).
 */
const RESSALVAS_FORA_DESTE_PORTAL = ["Guias já vencidas", "Sem mês"];

function Fluxo({ dados }) {
  const meses = Array.isArray(dados?.meses) ? dados.meses : [];
  // ⚠ Abre no primeiro mês QUE TEM ALGO, não no primeiro da lista: com nada aberto a grade ensina os
  // números e esconde a evidência; abrindo um mês vazio, ensina a frase de vazio.
  const [aberta, setAberta] = useState(() => meses.find(mesTemAlgo)?.competencia ?? null);
  const mesAberto = meses.find((m) => m?.competencia === aberta) || null;
  // ⚠⚠ AS RESSALVAS DE TOM `aviso` NÃO APARECEM NESTE PORTAL — decisão do dono, 27/08/2026, em duas
  // etapas: *"tire esses avisos da página"* e, depois, *"pode excluir isso também"*. São duas: a guia
  // já vencida e a guia sem mês.
  //
  // ⚠⚠ EU ARGUMENTEI CONTRA, E ELE DECIDIU — fica escrito porque o critério deste app manda o
  // contrário: *"fica o texto que muda uma decisão de quem lê ou avisa de consequência fiscal"*, e
  // "2 guias venceram, somando R$ 18.638,39" é as duas coisas.
  //
  // ⚠ O QUE SEGURA A DECISÃO, e por isso ela não deixa o cliente às cegas: **o fato continua chegando
  // por dois caminhos que já existiam** — o card "A vencer" do Painel (logo acima, na mesma tela) e a
  // aba Guias. O `CLAUDE.md` já registrava que os dois números conviviam e podiam divergir; tirar
  // este resolve aquela ambiguidade em vez de criá-la.
  //
  // ⚠⚠ A REGRA NÃO FOI TOCADA. `ressalvasDoFluxo` é ESPELHO da do contador — lá o aviso FICA, porque
  // quem trabalha a guia é ele. Apagar de lá para atender a um pedido daqui quebraria o espelho e
  // esconderia a guia vencida de quem tem de agir sobre ela.
  //
  // ⚠⚠ O CORTE É NOMINAL, E A PRIMEIRA VERSÃO ERRAVA NISSO. Ela filtrava por TOM (`tom !== "aviso"`)
  // e levava junto uma terceira ressalva que o dono não pediu para tirar — *"Repetições não lidas"*,
  // que avisa que a recorrência da empresa não pôde ser lida. **Quem pegou foi o teste**, não a
  // revisão: `nada some em silêncio › a AUSÊNCIA do imposto é dita` ficou vermelho na hora.
  // ⚠ Por isso a lista é FECHADA e por título: um aviso NOVO que o servidor passe a mandar **aparece**
  // — que é o comportamento certo. O silêncio é só para os dois que ele nomeou.
  const ressalvas = ressalvasDoFluxo(dados);
  const contexto = ressalvas.filter((r) => !RESSALVAS_FORA_DESTE_PORTAL.some((p) => String(r?.titulo || "").startsWith(p)));

  return (
    <div className="fluxo">
      <PlanilhaDoFluxo meses={meses} competenciaAberta={aberta} aoAbrirMes={setAberta} />

      {/* ⚠⚠ A COR NÃO PODE SER A ÚNICA MARCA, e desde que ela passou a marcar a CATEGORIA (a coluna)
          quem separa o que já existe do que é previsão é o PREENCHIMENTO — sólido × contorno. Essa é
          a metade que sobrevive à impressão em preto e branco e ao daltonismo; a cor, não.
          ⚠ Esta linha tem 18px e FICA, mesmo com o pedido de enxugar: sem ela a grade afirma por
          desenho uma distinção que ninguém consegue nomear. */}
      <p className="meta meta--bloco fluxo-legenda-cor">
        <span data-procedencia-celula="fato">preenchido</span> já existe ·{" "}
        <span data-procedencia-celula="previsao">contorno</span> previsto
      </p>

      {mesAberto ? <MesDoFluxo mes={mesAberto} /> : null}

      {/* ⚠⚠ TODAS AS LEGENDAS FORAM RECOLHIDAS — e as duas últimas por pedido explícito do dono
          (27/08/2026): *"enxugue essas legendas"* e, sobre as caixas da guia vencida e da guia sem
          mês, *"tire esses avisos da página"*.
          ⚠⚠ EU ARGUMENTEI CONTRA E ELE DECIDIU — fica registrado porque o critério escrito deste app
          manda o contrário: *"fica o texto que muda uma decisão de quem lê ou avisa de consequência
          fiscal"*, e "2 guias venceram, somando R$ 18.638,39" é as duas coisas.
          ⚠ O QUE SEGURA A DECISÃO: **nada foi apagado e o cliente não fica sem o fato.** A regra
          (`ressalvasDoFluxo`) continua produzindo as ressalvas, elas continuam nesta página — só
          recolhidas —, e a guia vencida continua chegando por DOIS outros caminhos que já existiam:
          o card "A vencer" do Painel e a aba Guias. O `CLAUDE.md` já registrava que os dois números
          conviviam e podiam divergir; recolher este resolve aquela ambiguidade em vez de criá-la.
          ⚠ Este `<details>` não precisa do efeito de impressão que o `apps/web/CLAUDE.md` exige: o
          fluxo deste portal não é impresso — não há `data-print-area` nesta tela. */}
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

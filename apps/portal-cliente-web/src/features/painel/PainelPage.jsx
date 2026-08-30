import { api } from "../../api";
import { AlertaErro, CardNumero, Carregando } from "../../components/ui";
import { useCarregamento } from "../../lib/hooks";
import { MOTIVO, aliquotaDoPainel } from "./lib/aliquotaDoPainel";
import { linhaDoMes } from "./lib/tabelaDoFluxo";
import { somarCompetencia } from "./lib/leituraDoFluxo";
import { BlocoDeDemonstracao } from "./BlocoDeDemonstracao";
import {
  TRACO,
  brl,
  competenciaPadrao,
  competenciasRecentes,
  fmtCompetencia,
  inteiro,
  pct,
  somaOuTraco,
} from "../../lib/format";

const OPCOES_COMPETENCIA = competenciasRecentes(12);

/**
 * O PAINEL — a tela padrão do portal do cliente (21/08/2026).
 *
 * Duas metades, e a fronteira entre elas é a coisa mais importante desta tela:
 *
 *  1. **O bloco de demonstração** (fluxo de caixa ⇄ DRE) — números FICTÍCIOS, com selo próprio.
 *  2. **O resumo do mês e os próximos vencimentos** — dado REAL, montado só com o que as rotas já
 *     devolvem: faturamento e nº de notas (`summary` de `GET /invoices`), alíquota do mês
 *     (`GET /aliquotas`) e o que está a vencer (`GET /fluxo`, as guias liberadas em aberto).
 *
 * ⚠⚠ NENHUM NÚMERO ATRAVESSA A FRONTEira. A saída fictícia do bloco de cima **não é somada nem
 * comparada** com o "A vencer" real — se os dois discordassem, a tela discordaria de si mesma no
 * número que o cliente usa para se planejar. E o selo fica NO BLOCO, nunca na página: na página,
 * ele faria o cliente ler os números verdadeiros como fictícios também, que é o defeito inverso e
 * igualmente caro.
 *
 * ⚠ UM SÓ CONTROLE DE COMPETÊNCIA nesta tela. Duas metades com recortes de tempo diferentes seriam
 * o mesmo defeito que a casca já consertou (três seletores para uma pergunta) — e há teste que
 * quebra por ambiguidade se aparecer um segundo rótulo "Competência".
 */
/**
 * A frase embaixo do número da alíquota.
 *
 * ⚠ CADA AUSÊNCIA TEM A SUA FRASE, e isso é o ponto: "não há faturamento", "nenhuma guia paga",
 * "a receita não foi lançada" e "o imposto não foi provisionado" pedem AÇÕES diferentes. Um traço
 * mudo para as quatro apagaria a diferença entre um problema do cliente e um trabalho do contador.
 *
 * ⚠ E QUANDO HÁ LINHA NÃO CLASSIFICADA A FRASE DIZ, mesmo com o número calculado: a alíquota saiu
 * por cima de provisões cuja conta contábil está em branco, então ela é um PISO, não o total.
 *
 * ⚠⚠ **A FRASE NOMEIA O MÊS, E DEIXOU DE DIZER "ESTA COMPETÊNCIA" EM 29/08/2026.** Ela morava
 * debaixo de um rótulo que dizia o mesmo mês, então "esta" era inequívoco. Quando o card de Imposto
 * passou a ser rotulado com o mês da ENTRADA (a competência + 1), a palavra ficou ambígua na tela:
 * *"Imposto líquido · 09/2026"* com *"nenhuma guia paga nesta competência ainda"* — e a guia de que
 * ela fala é a de **agosto**. Achado no navegador, no mock, depois de o conserto dos cards passar.
 *
 * ⚠ A alíquota **continua sendo a da competência ESCOLHIDA**, e é isso que ela deve ser: ela
 * responde *"quanto esta empresa paga de imposto?"* sobre o mês que o cliente selecionou. O que
 * mudou é ela dizer de qual mês fala, em vez de depender do rótulo do vizinho.
 */
/**
 * ⚠⚠ A FRASE QUANDO HÁ NÚMERO — e ela mudou DUAS VEZES no mesmo dia (30/08/2026).
 *
 * Ela dizia *"Alíquota da última apuração: X"*, e as duas metades ficaram falsas:
 *
 *  1. **NÃO É MAIS A ÚLTIMA APURAÇÃO.** O número vem do que foi LANÇADO na competência escolhida
 *     (dono: *"use sempre o que foi lançado"*). Chamar de apuração um número tirado do razão
 *     emprestaria a ele a autoridade de uma declaração transmitida à Receita.
 *  2. **O INSS PATRONAL ENTROU** (dono: *"não calcula o INSS junto"*), e com ele o percentual passa
 *     a ser MAIOR que o do extrato do Simples. ⚠⚠ Sem dizer isso, o dono compara 7,01% com os
 *     6,24% do extrato e conclui que a tela erra — que é exatamente o relato que originou o
 *     conserto. **A frase que descreve um comportamento é parte do comportamento.**
 *
 * ⚠ O mês nomeado é o da LINHA lida, não o da casca: são o mesmo hoje, e no dia em que não forem
 * a frase tem de contar a verdade sobre o número que está na tela.
 */
function fraseDaAliquota(l, competencia) {
  const mes = fmtCompetencia(l.competencia || competencia);
  const inss = l.comFolha && l.impostoSobreFolha > 0 ? " · INSS incluído" : "";
  return `Alíquota lançada em ${mes}: ${pct(l.valor)}${inss}`;
}

function textoDaAliquota(l, competencia) {
  const mes = fmtCompetencia(competencia);
  if (l.motivo === MOTIVO.SEM_DADOS) return `Sem dados para ${mes}`;
  if (l.motivo === MOTIVO.SEM_RECEITA_LANCADA) return `A receita de ${mes} ainda não foi lançada na contabilidade`;
  if (l.motivo === MOTIVO.SEM_IMPOSTO_LANCADO) return `Os impostos de ${mes} ainda não foram provisionados`;
  if (l.motivo === MOTIVO.SEM_LANCAMENTO) return `Não há lançamentos contábeis em ${mes}`;
  if (l.motivo === MOTIVO.BLOCO_AUSENTE) return "Não foi possível calcular pela contabilidade";

  // ⚠⚠ A FRASE NÃO É MAIS ESCOLHIDA PELA FONTE (30/08/2026) — há uma fonte só, a contabilidade.
  // O ramo antigo dizia *"Impostos pagos X sobre Y"*, e ele saiu com a conta por pagamento.
  // ⚠ O número de lançamentos SEM CONTA continua obrigatório na frase: uma alíquota calculada por
  // cima de metade das provisões seria menor que a real, e nada na tela diria isso.
  // ⚠⚠ A FRASE SEGUE O NÚMERO, NUNCA O CONTRÁRIO. Quando o INSS patronal está dentro, a frase diz
  // — senão o cliente compara 7,01% com os 6,24% do extrato do Simples e conclui que a tela erra.
  const comInss = l.comFolha && l.impostoSobreFolha > 0
    ? ` (INSS de ${somaOuTraco(l.impostoSobreFolha)} incluído)`
    : "";
  const base = `Impostos ${somaOuTraco(l.impostos)}${comInss} sobre receita de ${somaOuTraco(l.base)}`;
  return l.naoClassificadas > 0
    ? `${base} · ${inteiro(l.naoClassificadas)} lançamento(s) sem conta contábil ficaram de fora`
    : base;
}

export function PainelPage({ empresa, competencia: competenciaDaCasca, aoTrocarCompetencia, aoNavegar, aoEnviarExtrato }) {
  // ⚠⚠ A COMPETÊNCIA VEM DA CASCA — ver o comentário longo em `AppShell.jsx`. Era um
  // `useState(competenciaPadrao)` daqui, gêmeo do de `NotasPage`, e as duas abas discordavam.
  // O default não mudou: `competenciaPadrao` é o mês CORRENTE (dono, 18/08/2026).
  //
  // ⚠ "TODAS" (string vazia) É CONCEITO DE NOTAS, NÃO DAQUI. O resumo do mês precisa de UM mês;
  // com o filtro em "Todas", o Início cai no mês corrente — e não esconde isso: os rótulos dos
  // três cards e o texto de carregamento nomeiam a competência que estão mostrando, como já
  // faziam. O que não pode acontecer é o Início somar "o período todo" e chamar de mês.
  const competencia = competenciaDaCasca || competenciaPadrao();
  const setCompetencia = aoTrocarCompetencia || (() => {});
  const companyId = empresa.companyId;

  // limit:1 — aqui só interessa o `summary`, que o backend calcula sobre o
  // filtro inteiro (não sobre a página). Trazer 25 notas para descartá-las
  // seria pedir dado que ninguém vai mostrar.
  const notasQuery = useCarregamento(
    () => api.getInvoices(companyId, { competencia, page: 1, limit: 1 }),
    [companyId, competencia]
  );
  const aliquotaQuery = useCarregamento(
    () => api.getAliquotas(companyId, { from: competencia, to: competencia }),
    [companyId, competencia]
  );
  /*
   * ⚠⚠ `api.getFluxo` SAIU DESTA TELA em 28/08/2026, junto com "Próximos vencimentos".
   *
   * Ela é a lista de guias liberadas em aberto, e era o que alimentava aquele card e o antigo "A
   * vencer". Quem responde *"tem algo pegando fogo?"* hoje é o pop-up, que sai do FLUXO DE CAIXA —
   * a mesma consulta que a tabela usa. Duas leituras da mesma pergunta é o que fazia o card e a
   * ressalva mostrarem números diferentes na mesma página.
   * ⚠ A rota e o par mock/real continuam existindo; o que sumiu foi o consumidor daqui.
   */
  /**
   * ⚠⚠ O CARD DE RESULTADO LÊ O FLUXO DE CAIXA — e é uma SEGUNDA chamada do mesmo endpoint que o
   * bloco lá embaixo faz. O custo é declarado, e a alternativa foi recusada:
   *
   * ⚠ Erguer a consulta para cá e passá-la por prop obrigaria a subir junto o estado da JANELA (as
   * setas ‹ ›), que é navegação da tabela e não tem nada a ver com o resumo do mês. A página
   * passaria a guardar o estado do bloco, e o bloco a não saber recarregar sozinho.
   * ⚠ E as duas leituras **não podem discordar**: é o MESMO endpoint, com a MESMA competência. O
   * mês corrente está sempre dentro da janela, ande ela para onde andar (o início é no máximo
   * `corrente−4`, e a janela tem 12 meses).
   */
  const caixaQuery = useCarregamento(
    () => api.getFluxoCaixa(companyId, { competencia }),
    [companyId, competencia],
  );

  const resumo = notasQuery.dados?.summary || null;
  const aliquota = aliquotaQuery.dados?.[0] || null;
  /**
   * ⚠⚠ OS CARDS LEEM O MÊS **SEGUINTE**, E ISSO É CONSERTO DE UM DEFEITO RELATADO (29/08/2026).
   *
   * > Dono, com a tela na frente: *"o painel principal de receita, imposto líquido e resultado tem
   * > um bug: a receita está se tratando do mês seguinte e o resultado usando o mês corrente, o que
   * > gera confusão. Ele deve sempre usar o mês seguinte para as duas formas."*
   *
   * **O que estava errado, e por que só apareceu agora:** a receita das notas emitidas em AGOSTO cai
   * no fluxo em SETEMBRO (competência + 1, dia 1). O card "Receita · agosto" mostrava as notas de
   * agosto, e os cards "Imposto" e "Resultado · agosto" liam a linha do mês CORRENTE — cuja Entrada
   * é a receita de JULHO. Três cards lado a lado, com o mesmo rótulo de mês, falando de duas
   * receitas diferentes.
   *
   * ⚠ Os dois números estavam CERTOS cada um por si; o que estava errado era apresentá-los como se
   * fossem do mesmo mês. É a mesma família do "dois seletores para um valor" que a competência única
   * já consertou nesta casa.
   *
   * ⚠⚠ **O CARD DE RECEITA NÃO MUDOU DE FONTE**, e não pode mudar: Lei 5 — *Receita é nota emitida
   * no mês (competência), e nunca dinheiro recebido*. Ele continua sendo `resumo.totalAmount` da
   * competência escolhida. O que mudou é que Imposto e Resultado passaram a falar do mês em que essa
   * receita ENTRA, e **o rótulo deles diz qual mês é**.
   */
  const competenciaDaEntrada = somarCompetencia(competencia, 1);
  const mesDaEntrada = (caixaQuery.dados?.meses || [])
    .find((m) => m.competencia === competenciaDaEntrada) || null;
  const doMes = mesDaEntrada ? linhaDoMes(mesDaEntrada) : null;

  // ⚠⚠ ESTE CARD USA `efetiva` (impostos PAGOS ÷ faturamento, **INSS incluso**) DE PROPÓSITO, e a
  // nota fiscal usa a OUTRA conta da mesma rota (`deReceita`, só o DAS). Não são duas leituras do
  // mesmo número: são duas perguntas. Decisão do dono, 18/08/2026 — *"no painel isso está correto,
  // pois ali temos a alíquota efetiva total, com todos os impostos; no caso da nota precisamos
  // preencher apenas com a alíquota do Simples Nacional."*
  //   • aqui, PAINEL: *quanto esta empresa paga de imposto?* ⇒ tudo. É gestão.
  //   • na emissão: *quanto desta nota é tributo do Simples?* ⇒ só o DAS, porque `pTotTribSN` é
  //     "total de tributos do SIMPLES NACIONAL" e vai impresso ao tomador (Lei 12.741/2012).
  // ⚠ NÃO alinhe as duas. O porquê, com os números medidos em produção, está em
  // `features/emitir/lib/aliquotaEfetiva.js`.
  //
  // ⚠ A alíquota efetiva do backend é `impostosPagos / faturamento`, com
  // `d > 0 ? n/d*100 : 0`. Os DOIS lados fabricam zero:
  //  - sem faturamento, o denominador some e a conta devolve 0;
  //  - sem guia paga, o numerador é a soma de zero linhas e devolve 0.
  // Em ambos os casos a tela leria "sua alíquota é 0%", que é uma afirmação
  // fiscal que ninguém fez. O certo é traço + o motivo.
  // ⚠⚠ QUAL DAS CONTAS ESTE CARD MOSTRA DEPENDE DO REGIME (dono, 24/08/2026): o Presumido passa a
  // sair dos LANÇAMENTOS (provisão de imposto ÷ receita), o Simples continua saindo dos pagamentos.
  // A regra, com o porquê e os números medidos, está em `lib/aliquotaDoPainel.js` — e as guardas
  // contra o zero fabricado que moravam aqui inline foram para lá, com teste.
  const leituraAliquota = aliquotaDoPainel({ empresa, linha: aliquota });

  /**
   * ⚠⚠ "VER TODAS AS GUIAS" LIMPA A COMPETÊNCIA, e sem isso ele leva a uma tela VAZIA.
   *
   * A aba Guias abre no mês corrente, e a guia costuma sair no mês seguinte — o defeito já
   * registrado no commit `16e42653`. Agora o pop-up usa o MESMO caminho: dois botões com o mesmo
   * rótulo indo para lugares diferentes é como a tela começa a mentir.
   */
  const verTodasAsGuias = () => {
    aoTrocarCompetencia?.("");
    aoNavegar("guias");
  };

  const carregando = notasQuery.carregando || aliquotaQuery.carregando;
  const erro = notasQuery.erro || aliquotaQuery.erro;

  return (
    <>
      <div className="page-header">
        <h1>Início</h1>
        <div className="page-actions">
          <label htmlFor="competencia-home" className="sr-only">
            Competência
          </label>
          <select
            id="competencia-home"
            disabled={!aoTrocarCompetencia}
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            className="select-auto"
          >
            {OPCOES_COMPETENCIA.map((c) => (
              <option key={c} value={c}>
                {fmtCompetencia(c)}
              </option>
            ))}
          </select>
          {/* ⚠ O EXTRATO é um MODO desta rota, então o botão é <button> — não um <a href>: não há
              hash para ele, e inventar um daria um destino que o `useRota` recusa e devolve ao
              padrão (o "filtro fantasma" dentro da própria tela). Mesmo arranjo de "Emitir nota".
              ⚠ Sem o handler ele NÃO RENDERIZA: um botão em que a pessoa clica e nada acontece é
              pior que a ausência dele — a mesma regra que deixa o seletor de competência
              DESABILITADO quando a prop falta. */}
          {aoEnviarExtrato ? (
            <button type="button" className="btn" onClick={aoEnviarExtrato}>
              Enviar extrato
            </button>
          ) : null}
        </div>
      </div>

      <AlertaErro
        erro={erro}
        padrao="Não foi possível carregar o resumo do mês."
        aoTentarNovamente={() => {
          notasQuery.recarregar();
          aliquotaQuery.recarregar();
        }}
      />

      {carregando ? (
        <Carregando>Carregando o resumo de {fmtCompetencia(competencia)}…</Carregando>
      ) : (
        <div className="grid-3">
          {/* ⚠⚠ "RECEITA", não "Faturamento" — Lei 5 da `CONSTITUICAO-do-produto.md`: *Receita* é
              nota emitida no mês (competência), e **nunca** dinheiro recebido. Quem responde
              "dinheiro que entra no caixa" é a coluna **Entrada** da tabela, que é outra conta. */}
          <CardNumero
            rotulo={`Receita · ${fmtCompetencia(competencia)}`}
            valor={resumo ? somaOuTraco(resumo.totalAmount) : TRACO}
            apoio={
              resumo
                ? `${inteiro(resumo.totalInvoices)} nota(s) emitida(s)`
                : "Sem dados para esta competência"
            }
            destaque
          />

          {/* ⚠ O rótulo é "Imposto líquido" (v3 §2) e o VALOR é o imposto do mês, saído da mesma
              coluna da tabela. A sub-linha continua nomeando a PROCEDÊNCIA da alíquota — é ela que
              impede o número de virar uma afirmação sobre carga tributária que ninguém mediu. */}
          <CardNumero
            /* ⚠⚠ O RÓTULO DIZ O MÊS DA ENTRADA, não o da competência escolhida. Sem isso os três
               cards diriam "agosto" enquanto dois deles falam de setembro — que é exatamente a
               confusão que este conserto desfaz. */
            rotulo={`Imposto líquido · ${fmtCompetencia(competenciaDaEntrada)}`}
            valor={caixaQuery.carregando ? "…" : (doMes?.impostos ? somaOuTraco(doMes.impostos.valor) : TRACO)}
            /* ⚠⚠ SEM ESTA MARCA O CARD MENTE. Medido na tela: ele mostrava R$ 5.269,55 — a soma de
               duas guias EM ABERTO — com o peso de um valor liquidado, e a frase logo abaixo dizia
               "nenhuma guia paga nesta competência ainda". Com o âmbar, as duas passam a concordar:
               *este é o imposto do mês, e ele ainda não foi pago*. */
            status={doMes?.impostos?.status}
            /* ⚠ Quando HÁ alíquota, o apoio é ela (v3 §2). Quando não há, `textoDaAliquota` nomeia
               o que falta — e é ele que impede o número de virar uma afirmação sobre carga
               tributária que ninguém mediu. ⚠ A alíquota da FAIXA do Simples, que o v3 pede para
               quem nunca apurou, é Fase 2. */
            apoio={
              leituraAliquota.valor != null
                ? fraseDaAliquota(leituraAliquota, competencia)
                : textoDaAliquota(leituraAliquota, competencia)
            }
          />

          {/* ⚠⚠ O RESULTADO É DO PERÍODO, JAMAIS ACUMULADO (Lei 3 — sem âncora não há acumulado).
              ⚠ Ele soma fato com previsão, e isso é a reversão nº 1 do §6 da Constituição: o
              argumento derrubado é *"é o que alguém imprime e leva ao banco"*. O que a sustenta é o
              `status` — quando qualquer parcela é prevista, o número inteiro é previsto. */}
          <CardNumero
            rotulo={`Resultado · ${fmtCompetencia(competenciaDaEntrada)}`}
            valor={caixaQuery.carregando ? "…" : (doMes?.resultado ? somaOuTraco(doMes.resultado.valor) : TRACO)}
            /* ⚠ O apoio NOMEIA a ligação entre os dois rótulos: sem ele, "Receita · agosto" ao lado
               de "Resultado · setembro" parece erro de tela em vez de a mesma receita, um mês
               adiante. É a frase que impede a correção de virar uma confusão nova. */
            apoio={`Entrada − saídas, impostos e folha · a receita de ${fmtCompetencia(competencia)} entra aqui`}
            /* ⚠⚠ ISTO ERA `data-status=` E NÃO FAZIA NADA — `CardNumero` não aceitava a prop, e o
               React a descartava em silêncio num `<div>`... não: ela nem chegava ao DOM, porque o
               componente só espalha o que desestrutura. O card afirmava um resultado previsto com
               peso de fato. Hoje a prop existe e é a MESMA dos três canais das células. */
            status={doMes?.resultado?.status}
          />
        </div>
      )}

      {/*
        ⚠⚠ LÁPIDE — "PRÓXIMOS VENCIMENTOS" SAIU EM 28/08/2026, a pedido do dono: *"a aba de
        próximos vencimentos tem que sair, agora só o aviso do pop-up"*.

        Era um card com as 5 próximas guias liberadas em aberto (tipo · competência · vencimento ·
        valor), saído de `api.getFluxo`. Ele respondia a MESMA pergunta que o pop-up — a camada 1 da
        `CONSTITUICAO-do-produto.md`, *"tem algo pegando fogo?"* — e duas respostas para a mesma
        pergunta é como a tela começa a discordar de si mesma.

        ⚠⚠ **CONSEQUÊNCIA QUE FICA NOMEADA, porque é uma perda de verdade:** o pop-up só acende com
        guia **vencida** ou a **até 5 dias** do vencimento. A guia que vence em 15 dias aparecia
        aqui e **deixa de aparecer no Início** — o caminho para ela passa a ser a aba Guias.

        ⚠ O que NÃO se perdeu: a guia vencida continua no pop-up **e** dentro da coluna Impostos do
        mês corrente (ela é `COMPROMISSO` de lá, pela Lei 1). E `verTodasAsGuias` ficou — é o mesmo
        caminho que o botão daqui usava, hoje consumido pelo pop-up, e ele continua limpando a
        competência antes de navegar (senão a lista abre vazia).

        ⚠ `api.getFluxo` continua existindo na rota e no par mock/real; o que sumiu foi o consumidor
        desta tela.
      */}

      <BlocoDeDemonstracao companyId={companyId} competencia={competencia} aoVerGuias={verTodasAsGuias} />
    </>
  );
}

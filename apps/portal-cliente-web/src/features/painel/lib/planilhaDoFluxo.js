// A AGREGAÇÃO DA PLANILHA — quatro linhas por mês, a partir das linhas que o servidor manda.
//
// > Dono, 27/08/2026: *"deve ser coluna de meses e linha de entrada, saída, recorrente, diário.
// > Diário seria um cálculo das despesas variáveis mensais, daquelas que não se repetem, divididas
// > pelos dias do mês"* — e, precisando o critério: *"toda a série despesa é variável até que se
// > diga recorrente; ou seja, se em 3 meses seguidos as despesas foram por volta de 20.000, mais
// > desses 20.000 são 3 mil de gastos recorrentes, vamos pegar 17 mil e dividir por 30"*.
//
// ⚠⚠ **ISTO NÃO MORA EM `leituraDoFluxo.js`, E A SEPARAÇÃO É O PONTO.** Aquele arquivo é ESPELHO do
// `apps/web/src/features/fluxo/lib/leituraDoFluxo.js` — mudar lá muda aqui. Esta agregação é da
// PLANILHA do cliente, que o portal do contador não tem; escrevê-la lá faria o espelho divergir na
// primeira sincronização. Aqui só se LÊ o que aquele arquivo já expõe.
//
// ⚠⚠ **A CONTA SAI DAS `linhas`, NÃO DE `totais`** — e por um motivo: `totais` traz `fato`/`previsao`
// e **não traz recorrente**. Misturar as duas fontes faria `Saída − Recorrente` não fechar quando
// elas discordassem. Há teste exigindo que o que se calcula aqui **bata com `totaisParaTela`**: se um
// dia divergirem, é porque o servidor passou a somar coisa que não está em `linhas`.

import { DIRECAO, FONTE, PROCEDENCIA } from "./leituraDoFluxo";
import { diasDoMes } from "./dadosDeDemonstracao";

/**
 * ⚠⚠ O QUE CONTA COMO RECORRENTE — a lista é FECHADA, e o critério é do dono: *"toda a série despesa
 * é variável até que se diga recorrente"*. Ou seja, a pergunta não é *"isto parece variável?"*, é
 * **"alguém marcou isto como repetição?"**. Quem marca é a série (`SERIE_DESPESA`), que carrega
 * `visto N vezes` e a faixa de valor.
 *
 * ⚠ **CONSEQUÊNCIA MEDIDA, E ELA NÃO É ÓBVIA:** com o dado de hoje, tudo que sobra como "variável" é
 * **guia de imposto** (`GUIA`) e **imposto projetado** (`IMPOSTO_PROJETADO`) — não existe despesa
 * avulsa no contrato do fluxo, porque quem lança despesa é o escritório e ela não chega até aqui.
 * Então o "diário" de hoje é, na prática, **imposto por dia**. Isso é o que a regra do dono produz
 * com o dado que existe; no dia em que despesa avulsa entrar no fluxo, o número muda de tamanho
 * sozinho, sem ninguém mexer aqui — que é o comportamento certo.
 */
const FONTES_RECORRENTES = Object.freeze([FONTE.SERIE_DESPESA]);

const numero = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** ⚠ Só a saída entra na conta do diário — a receita que se repete não é despesa. */
const ehSaidaRecorrente = (l) =>
  l?.direcao === DIRECAO.SAIDA && FONTES_RECORRENTES.includes(l?.fonte);

/**
 * As quatro linhas da planilha, para UM mês.
 *
 * ⚠⚠ `entrada` e `saida` vêm SEPARADAS por procedência, e continuam assim: o contrato deste fluxo
 * (`TotaisDoMes`) diz que *"a ausência do número único é o contrato inteiro"* — `fato` e `previsão`
 * nunca viram um número só. O que mudou em 27/08/2026 é que a distinção deixou de ocupar DUAS LINHAS
 * e passou a viver na COR da célula, por decisão do dono: *"não vamos duplicar entre entrada entrada
 * e saída saída, vamos colocar em cor diferente"*. Os dois números continuam existindo lado a lado.
 *
 * @param {{competencia?: string, linhas?: Array}} mes
 */
export function linhasDaPlanilha(mes) {
  const linhas = Array.isArray(mes?.linhas) ? mes.linhas : [];
  const acc = {
    entrada: { fato: 0, previsao: 0 },
    saida: { fato: 0, previsao: 0 },
    recorrente: 0,
  };

  for (const l of linhas) {
    const v = numero(l?.valor);
    // ⚠ `DESCONHECIDO` não entra em soma nenhuma — é a mesma regra do `TotaisDoMes`: o que não tem
    // valor somável vira CONTAGEM, nunca zero.
    const chave = l?.procedencia === PROCEDENCIA.FATO ? "fato"
      : l?.procedencia === PROCEDENCIA.PREVISAO ? "previsao" : null;
    if (!chave) continue;

    if (l?.direcao === DIRECAO.ENTRADA) acc.entrada[chave] += v;
    else if (l?.direcao === DIRECAO.SAIDA) acc.saida[chave] += v;

    if (ehSaidaRecorrente(l)) acc.recorrente += v;
  }

  const saidaTotal = acc.saida.fato + acc.saida.previsao;
  // ⚠ `Math.max(0, …)`: recorrente não pode passar da saída total (ele é subconjunto dela), mas se um
  // dia passar — série contada duas vezes, por exemplo — um "variável" NEGATIVO viraria um diário
  // negativo na tela, que se lê como dinheiro entrando. Piso em zero, e o teste cobre o caso.
  const variavel = Math.max(0, saidaTotal - acc.recorrente);
  const dias = diasDoMes(mes?.competencia).length;

  return {
    ...acc,
    variavel,
    // ⚠⚠ `null`, NUNCA `0`, quando não dá para dividir. Competência ilegível ⇒ `diasDoMes` devolve
    // lista vazia ⇒ divisão por zero. `Infinity` na tela viraria "R$ Infinity"; `0` afirmaria que a
    // empresa não gasta nada por dia. As duas mentem; `null` vira traço.
    diario: dias > 0 ? variavel / dias : null,
    dias,
  };
}

/**
 * ⚠⚠ O MÊS ABERTO, DIA A DIA — e a razão de isto ser possível é a coluna `Diário`.
 *
 * > Dono, 27/08/2026: *"não quero que ao clicar no mês abra uma tabela embaixo, quero que a própria
 * > tabela mude para visualizar o mês, aparecendo 10 dias, e rolagem para rolar entre os dias"*.
 *
 * ⚠⚠ **A FORMA DIÁRIA JÁ TINHA SIDO ABANDONADA UMA VEZ, EM 27/08/2026, E O MOTIVO CONTINUA VERDADEIRO:**
 * as projeções NÃO TÊM DIA. Medido no payload: das 8 linhas dos 12 meses, **só 2 têm `dia`** (as
 * guias, pelo vencimento); as outras 6 vêm com `diaDesconhecido`, porque *o prazo de recebimento é
 * contado em meses e a recorrência diz o ciclo*. Espalhá-las pelos dias seria inventar precisão que
 * ninguém informou — a regra 1 deste projeto.
 *
 * ⚠⚠ **O QUE MUDOU É QUE AGORA EXISTE UMA COLUNA QUE VALE PARA TODO DIA.** `Diário` é, por definição
 * do dono, a média diária do que sai e não se repete — então **nenhuma linha de dia fica vazia**, que
 * era exatamente a doença das duas formas anteriores (31 linhas com 24 vazias; 12 meses com 8 vazios).
 * A grade diária só se sustenta por causa dela.
 *
 * ⚠ O que não tem dia **não é distribuído nem escondido**: vai para uma linha própria, `semDia`, que
 * a tela chama de "no mês". É a mesma resposta que o detalhe já dava em texto (*"ao longo do mês"*),
 * agora com lugar na grade.
 */
export function diasDaPlanilha(mes) {
  const totais = linhasDaPlanilha(mes);
  const dias = diasDoMes(mes?.competencia);
  const vazio = () => ({ entrada: { fato: 0, previsao: 0 }, saida: { fato: 0, previsao: 0 }, recorrente: 0 });

  const semDia = vazio();
  const porDia = new Map(dias.map((d, i) => [i + 1, { dia: i + 1, ...vazio() }]));

  for (const l of Array.isArray(mes?.linhas) ? mes.linhas : []) {
    const v = numero(l?.valor);
    const chave = l?.procedencia === PROCEDENCIA.FATO ? "fato"
      : l?.procedencia === PROCEDENCIA.PREVISAO ? "previsao" : null;
    if (!chave) continue;

    // ⚠ `dia` só vale quando o servidor o mandou. `diaDesconhecido` é a AFIRMAÇÃO de que não há dia —
    // ela não é a mesma coisa que "o campo veio vazio", e as duas caem aqui do mesmo jeito: sem dia.
    const alvo = (l?.dia && porDia.get(l.dia)) || semDia;
    if (l?.direcao === DIRECAO.ENTRADA) alvo.entrada[chave] += v;
    else if (l?.direcao === DIRECAO.SAIDA) alvo.saida[chave] += v;
    if (ehSaidaRecorrente(l)) alvo.recorrente += v;
  }

  return {
    semDia,
    dias: [...porDia.values()],
    // ⚠ O MESMO número em todos os dias, e é o que ele significa: uma MÉDIA. Recalculá-lo por dia
    // exigiria saber o gasto de cada dia — que é justamente o que não existe.
    diario: totais.diario,
  };
}

/**
 * ⚠ O que a CÉLULA mostra, por linha da planilha — já com a cor.
 *
 * ⚠⚠ A COR AQUI RESPONDE OUTRA PERGUNTA QUE A DO CHIP, e por isso não usa o mesmo vocabulário.
 * O chip de `LinhaDoMes` responde *"isto já aconteceu?"* (`neutro` × `aviso`). A célula da planilha
 * responde *"para que lado o dinheiro vai, e o quanto disso é certo?"* — que é a leitura de um fluxo
 * de caixa, e é a convenção universal (entra verde, sai vermelho).
 *
 * ⚠⚠ **ISTO REVERTE, PARA A GRADE, A LEI DE COR ESCRITA EM `leituraDoFluxo.js`** (*"a previsão nunca
 * recebe verde; o fato também não é verde, ele é NEUTRO"*). Decisão do dono, 27/08/2026, reafirmada
 * quando a ressalva foi feita: *"verde é o que sabemos, amarelo é previsto, no caso da saída é
 * vermelho e laranja (…) as saídas, que seriam as guias de impostos, sempre vermelho ou laranja"*.
 * ⚠ A ressalva que eu fiz e que ele decidiu contra, registrada para não ser redescoberta: verde neste
 * app quer dizer *pago/concluído*, e uma guia GERADA e em aberto não está paga — uma célula verde
 * pode ser lida como "já paguei". **A lei do CHIP não mudou**; ela continua valendo no detalhe do
 * mês, e é lá que a palavra "Já existe" aparece escrita.
 */
export const CELULA = Object.freeze({
  ENTRADA_FATO: "entrada-fato",
  ENTRADA_PREVISAO: "entrada-previsao",
  SAIDA_FATO: "saida-fato",
  SAIDA_PREVISAO: "saida-previsao",
  NEUTRA: "neutra",
});

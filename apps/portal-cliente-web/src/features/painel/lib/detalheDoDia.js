// O DETALHE DE UM DIA — o que a GAVETA mostra quando o cliente clica no dia, na saída ou no imposto.
//
// > Dono, com a tela na frente (30/08/2026): *"saída não deve ser um botão, ele deve clicar no
// > campo do dia, abre um menu lateral e aí ele digita a saída. Todos os blocos de saída devem e
// > podem ser clicados, isso abre um menu lateral que mostra as saídas naquele dia, com suas
// > descrições."* · *"o de impostos também, devo poder clicar para ver os impostos no menu
// > lateral."*
//
// ⚠⚠ **O BALDE SAI DA MESMA REGRA QUE A TABELA USA, E ISSO É O CONTRATO DESTE ARQUIVO.** A célula
// de "Impostos" da linha do dia 05 e a gaveta que abre ao clicar nela têm de responder à MESMA
// pergunta — *"esta linha é imposto ou é saída?"*. Duas leituras disso divergem na primeira
// correção (uma fonte nova de imposto entra numa e não na outra), e o desfecho é a gaveta abrindo
// vazia sobre uma célula que mostra um número, ou listando uma linha que a célula não somou. Nos
// dois casos a tela discorda de si mesma, e quem lê está planejando o caixa.
//
// ⚠⚠ **COMO A REUSA ACONTECE, já que `baldeDaLinha` não é exportada de `tabelaDoFluxo.js`:** este
// módulo chama `linhaDoMes({ linhas: [l] })` — a MESMA função que desenha a linha da tabela — com
// UMA linha, e pergunta qual das quatro células voltou preenchida. Não há uma segunda
// classificação escrita aqui, nem cópia das listas `FONTES_DE_IMPOSTO`/`FONTES_DE_FOLHA`. Trocar
// isto por um `if` de direção/fonte é barato de escrever e caro de manter: seria exatamente a
// segunda leitura que o parágrafo acima existe para impedir.
//
// ⚠ EFEITO COLATERAL DA REUSA, e ele é DESEJADO: `linhaDoMes` descarta a linha de procedência
// `DESCONHECIDO` (ver `celula`, em `tabelaDoFluxo.js`) — logo, ela também não aparece na gaveta. É
// o certo: se a célula não a somou, listá-la aqui faria a gaveta não bater com o número da tabela.
// O lugar dessas linhas é a ressalva "Sem mês" (`ressalvasDoFluxo`), que já as nomeia com o motivo.
//
// ⚠ ESTE MÓDULO NÃO CONSULTA NADA e não formata dinheiro: ele recebe as linhas que a tela JÁ tem
// (o array `mes.linhas` do payload do fluxo) e devolve o que a gaveta desenha. Uma segunda consulta
// para "as saídas do dia" traria de volta a pergunta *"por que a lista mostra uma linha que a
// tabela não tem?"* — o defeito que a competência única já pagou neste app.

import { rotuloDaFonte } from "./leituraDoFluxo";
import { COLUNAS, linhaDoMes } from "./tabelaDoFluxo";

/**
 * ⚠ OS BALDES QUE A GAVETA SERVE — as colunas da tabela, MENOS `resultado`.
 *
 * `resultado` é derivado (`Entrada − (Saída + Impostos + Folha)`), não um compartimento onde linha
 * nenhuma mora. Uma gaveta de "Resultado" teria de listar as linhas dos outros quatro baldes com
 * sinais trocados — e aí ela seria uma sexta leitura do fluxo, não o detalhe de uma célula.
 */
export const BALDES_DA_GAVETA = Object.freeze(
  COLUNAS.filter((c) => c.chave !== "resultado").map((c) => c.chave),
);

/**
 * O nome do balde na gaveta é o MESMO que está no cabeçalho da coluna clicada.
 *
 * ⚠ Sai de `COLUNAS`, nunca de um mapa novo: a pessoa clicou numa coluna chamada "Impostos", e a
 * gaveta que abriu precisa se chamar assim também. Um segundo mapa faria as duas palavras
 * divergirem no dia em que uma coluna mudar de nome — e o clique pareceria ter aberto outra coisa.
 */
export function rotuloDoBalde(balde) {
  const c = COLUNAS.find((x) => x.chave === balde);
  return c ? c.rotulo : null;
}

/**
 * ⚠⚠ EM QUE DIA A LINHA CAI — e a resposta tem de ser a MESMA de `linhasDosDias`, caso a caso.
 *
 * Aquela função monta um `Map` com as chaves 1..N e faz `if (l.dia && porDia.has(l.dia))`; o que
 * não casa vai para `semDia`. Reproduzido aqui:
 *   - `null`, `0`, `undefined`, string ou fracionário ⇒ **"no mês"** (não é chave daquele `Map`);
 *   - dia 31 num mês de 30 ⇒ **"no mês"** também, e é para isso que `quantosDias` existe.
 *
 * ⚠ `quantosDias` é OPCIONAL porque a regra não conhece o calendário — quem chama tem a
 * competência. Omiti-lo só afrouxa a borda do mês (o dia 31 continuaria valendo como dia 31); a
 * tela passa o número, e há teste sobre os dois modos.
 *
 * ⚠⚠ **TODA LINHA CAI EM EXATAMENTE UM LUGAR** — ou num dia, ou em "no mês". Um terceiro desfecho
 * (a linha que não é de dia nenhum nem do mês) seria uma linha invisível nas duas gavetas: some da
 * tela sem ninguém saber que ela existiu, que é o modo de falhar mais caro deste painel.
 */
function diaDaLinha(linha, quantosDias) {
  const d = linha?.dia;
  if (!Number.isInteger(d) || d < 1) return null;
  if (quantosDias != null && d > quantosDias) return null;
  return d;
}

/** ⚠ Reusa `linhaDoMes` com UMA linha — ver o cabeçalho. Não escreva um `if` de fonte aqui. */
function baldeDaLinha(linha) {
  const r = linhaDoMes({ linhas: [linha] });
  for (const chave of BALDES_DA_GAVETA) {
    if (r[chave]) return chave;
  }
  // ⚠ `null` = a tabela também não contou esta linha (procedência desconhecida, direção que não
  // existe). Ela não entra na gaveta pelo mesmo motivo que não entrou na célula.
  return null;
}

/**
 * AS LINHAS QUE A GAVETA MOSTRA.
 *
 * @param {Array} linhasDoMes o array `linhas` do mês, como veio do payload do fluxo
 * @param {object} opcoes
 * @param {number|null} opcoes.dia            o dia clicado — ⚠ `null` é o caso LEGÍTIMO do "no mês"
 * @param {string|null} [opcoes.balde]        `entrada|saida|impostos|folha`; ausente = todos
 * @param {number|null} [opcoes.quantosDias]  dias do mês, para a borda (ver `diaDaLinha`)
 * @returns {Array<{chave:string, rotulo:string, valor:number, procedencia:string, balde:string,
 *                  fonte:string, dia:number|null, frase:string|null}>}
 *
 * ⚠⚠ **`dia: null` NÃO É "SEM FILTRO", É UM FILTRO.** É a linha *"no mês"* que a tabela desenha
 * primeiro em cada bloco: as projeções que não têm dia (a recorrência diz o ciclo, a folha é por
 * competência, o imposto previsto não tem vencimento próprio). Ela é a maioria do dinheiro do mês e
 * é clicável como qualquer outra. Tratá-la como "traga tudo" faria a gaveta do dia 05 mostrar o mês
 * inteiro — e o cliente leria como saída do dia 05 o que sai em dia nenhum.
 *
 * ⚠⚠ **E OS DOIS CONJUNTOS NUNCA SE MISTURAM:** pedindo um dia, o que não tem dia fica de fora;
 * pedindo `null`, só vem o que não tem dia. Juntá-los seria espalhar pelo dia 05 um valor que
 * ninguém disse que sai no dia 05 — a regra nº 1 deste projeto ("dia ausente nunca vira dia
 * inventado"), agora do lado da leitura.
 *
 * ⚠ A ORDEM É A DO PAYLOAD, de propósito: é a mesma em que o servidor montou as linhas, e reordenar
 * aqui faria a gaveta discordar de qualquer outra leitura das mesmas linhas.
 */
export function linhasDoDia(linhasDoMes, opcoes = {}) {
  const { dia = null, balde = null, quantosDias = null } = opcoes;
  // ⚠ `null`/`undefined` valem "no mês"; o resto vira número. Um `dia` ilegível (NaN) não casa com
  // nada e devolve lista vazia — nunca cai em "no mês" por acidente, que seria mostrar as projeções
  // do mês debaixo do título de um dia.
  const alvo = dia == null ? null : Number(dia);
  const lista = Array.isArray(linhasDoMes) ? linhasDoMes : [];
  const saida = [];

  lista.forEach((l, i) => {
    if (!l) return;
    if (diaDaLinha(l, quantosDias) !== alvo) return;

    const baldeDesta = baldeDaLinha(l);
    if (!baldeDesta) return;
    if (balde && baldeDesta !== balde) return;

    const frase = String(l?.base?.frase ?? "").trim();
    saida.push({
      // ⚠ CHAVE DE RENDERIZAÇÃO, nunca identidade de servidor. `referencia.id` se repete entre
      // ocorrências da mesma série (é a MESMA saída aparecendo em 8 meses), então o índice entra
      // junto — sem ele o React reusaria o nó de uma linha para outra.
      chave: `${i}:${l?.referencia?.tipo || l?.fonte || "linha"}:${l?.referencia?.id ?? ""}`,
      // ⚠ Sem rótulo, o nome da FONTE (vocabulário já traduzido em `leituraDoFluxo`) — nunca uma
      // frase inventada aqui, e nunca vazio: linha sem nome vira um valor anônimo na gaveta.
      rotulo: l.rotulo || rotuloDaFonte(l.fonte),
      valor: Number(l.valor) || 0,
      // ⚠ CRU, como veio do servidor. Quem traduz é `leituraDaProcedencia`, na tela — e é lá que
      // mora a Lei de cor (previsão nunca é verde, e a palavra vai no TEXTO).
      procedencia: l.procedencia,
      balde: baldeDesta,
      fonte: l.fonte,
      dia: alvo,
      // ⚠⚠ A FRASE É O QUE DIZ DE ONDE O NÚMERO VEIO, e ela vem do SERVIDOR pronta. `null` quando
      // não há — a tela não escreve uma de reserva, senão as duas divergem na primeira correção.
      frase: frase || null,
      // ⚠⚠ A REFERÊNCIA viaja para a tela poder AGIR sobre a linha (mudar o dia, tirar do fluxo).
      // Sem ela a gaveta mostra a série e não tem como NOMEÁ-LA para o servidor.
      referencia: l?.referencia || null,
      // ⚠⚠ DE ONDE VEIO O DIA. É o que deixa a tela dizer "estimado pelas emissões" em vez de
      // mostrar um dia seco — que se lê como VENCIMENTO, e não é.
      origemDoDia: l?.base?.origemDoDia || null,
      // ⚠ Os dias observados: sem eles, "por que dia 4?" não tem resposta na tela de quem paga.
      diasObservados: Array.isArray(l?.base?.diasObservados) ? l.base.diasObservados : null,
      estadoDaSerie: l?.base?.estadoDaSerie || null,
    });
  });

  return saida;
}

// AS DUAS METADES DE UM CAMPO NUMÉRICO EM pt-BR — e elas têm de ser a MESMA conta, nos dois sentidos.
//
// ⚠⚠ ESTE ARQUIVO NASCEU DE UM DEFEITO MEDIDO EM PRODUÇÃO (25/08/2026), e é o pior tipo: o número
// na tela e o número que o motor calculava eram DIFERENTES, sem nada dizendo isso.
//
// O que acontecia: `deCampo` (que morava solta na página) remove todo ponto como separador de
// milhar — o que é CERTO para digitação brasileira, onde "1.250.000" é um milhão e duzentos e
// cinquenta mil. Mas o pré-preenchimento escrevia o número JS CRU no input, com `String(n)`:
//
//     String(888286.09)  ->  "888286.09"  ->  deCampo  ->  88.828.609      (×100)
//     String(718036.09)  ->  "718036.09"  ->  deCampo  ->  71.803.609      (×100)
//     String(31500)      ->  "31500"      ->  deCampo  ->  31.500          (ileso!)
//
// ⚠ Só valor COM CENTAVOS era afetado — e é por isso que nada pegou o defeito: o mock usava
// inteiros redondos, e o motor (medido em 01/09/2026: 356 testes na feature, 32 deles casos dourados
// calculados à mão) estava
// perfeito. O que ninguém media era a LIGAÇÃO prefill → input → cálculo.
//
// As duas consequências, exatamente como o dono as viu na tela:
//   · receita lida acima de R$ 78 mi  ⇒ "A empresa não é elegível a este regime" (Lucro Presumido)
//   · RBT12 lido acima de R$ 4,8 mi   ⇒ `faixaDoRbt12` devolve `null` ⇒ "Sem RBT12 não há alíquota"
//
// ⚠ E o "ponto de equilíbrio" continuava dando número no meio dos dois cards mortos, porque
// `pontoDeEquilibrio` varre com `rbt12: receita` interno e não toca no estado quebrado. Duas caixas
// dizendo "não dá para comparar" ao lado de uma terceira cravando R$ 1.250.000 — a contradição que
// o dono apontou não era descuido de texto, era este bug aparecendo por três lados.
//
// Medido em produção antes do conserto (`scripts/diag-planejamento-prefill.mjs`): **12 de 18**
// empresas com dado apurado estavam com o valor inflado; **3** com o card do Presumido morto e
// **7** com o do Simples morto.
//
// ⚠⚠ O CONSERTO NÃO É AFROUXAR `deCampo`. Em pt-BR "1.234" é genuinamente ambíguo (mil duzentos e
// trinta e quatro, ou um vírgula duzentos e trinta e quatro?), e quem digita numa tela brasileira
// quer a primeira leitura. Quem estava errado era quem ESCREVIA no campo. Por isso as duas metades
// passam a morar juntas, com um teste de ida e volta: separadas, elas divergem de novo.

/** O separador de milhar do pt-BR. Não interpolar `Intl` aqui: o formato é fixo e conhecido. */
const MAXIMO_DE_CASAS = 6;

/**
 * Número → o texto que vai para o `value` do input, em pt-BR.
 *
 * ⚠⚠ ELE GARANTE A VOLTA. Não basta formatar bonito: o contrato é `deCampo(paraCampo(n)) === n`.
 * Por isso a formatação começa em 2 casas (dinheiro) e ABRE mais casas enquanto a ida e volta não
 * fechar. Arredondar em silêncio poria na tela um número diferente do que o motor vai calcular —
 * que é, letra por letra, o defeito que este arquivo existe para impedir.
 *
 * @param {number|null|undefined} n
 * @returns {string} "" quando não há número — campo vazio é ausência, nunca zero.
 */
export function paraCampo(n) {
  if (n == null || n === "") return "";
  const v = Number(n);
  if (!Number.isFinite(v)) return "";

  for (let casas = 2; casas <= MAXIMO_DE_CASAS; casas += 1) {
    const texto = v.toLocaleString("pt-BR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: casas,
      // ⚠ `useGrouping` LIGADO de propósito: é o ponto de milhar que faz `deCampo` ler certo.
      useGrouping: true,
    });
    if (deCampo(texto) === v) return texto;
  }

  // ⚠ Último recurso, e ele NÃO é o `String(n)` que causou o defeito: aqui o ponto decimal vira
  // vírgula, que é o que `deCampo` entende. Sem agrupamento, para não haver ponto nenhum no texto.
  return String(v).replace(".", ",");
}

/**
 * O texto do input → número. **É a leitura brasileira, e continua sendo.**
 *
 * ⚠ Movida da página para cá SEM UMA MUDANÇA de comportamento — ela estava certa. O que mudou foi
 * ganhar o par (`paraCampo`) e um teste que exige que os dois concordem.
 *
 * @param {string|number|null|undefined} v
 * @returns {number|null} `null` para vazio ou ilegível — nunca `0`, que seria uma afirmação.
 */
export function deCampo(v) {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// ─── ⚠⚠ A CAMADA DE DINHEIRO (01/09/2026) ────────────────────────────────────────────────────────
//
// > Dono: *"os textos, os campos, devem ser melhorados"* · *"está tudo muito bugado"*.
//
// ⚠⚠ O CONSERTO DE 25/08 FOI METADE DO CAMINHO, e a outra metade ficou aberta por uma semana. O
// `deCampo` acima está CERTO para digitação pt-BR e continua intocado — o que faltava era impedir
// que chegasse nele um texto que ele lê de outro jeito. Medido agora, contra a função de verdade:
//
//     "889.286,09"     -> 889286.09     ✓
//     "1234.56"        -> 123456        ✗ ×100 EM SILÊNCIO — e é o formato que o Excel exporta
//     "1,500.00"       -> 1.5           ✗ ÷1000 — é o formato que uma planilha em inglês exporta
//     "R$ 889.286,09"  -> null          ✗ "não informada" para um valor copiado da PRÓPRIA tela
//     "-5"             -> -5            ✗ margem negativa entra na conta e o total sai negativo
//
// ⚠ Os dois primeiros são o defeito CARO: mudam a ordem de grandeza sem nada na tela dizendo, e o
// PDF que sai daqui vai ao cliente. `1234.56` lido como 123.456 põe a empresa duas faixas acima.
//
// ⚠⚠ A SOLUÇÃO NÃO É UM PARSER MAIS ESPERTO — é tornar a ambiguidade IMPOSSÍVEL DE ESCREVER. É a
// decisão que a emissão de nota fiscal já tomou, pelo mesmo motivo e com o mesmo custo (lá o erro
// emitia a nota por 1/1000 do valor). Por isso aqui se REUSA aquele módulo, e não se escreve um
// segundo: duas gramáticas de número dentro do MESMO app divergem na primeira correção, e a
// divergência apareceria como o mesmo texto virando dois números em duas telas.
//
// ⚠ ISTO NÃO VALE PARA PERCENTUAL. Alíquota de ISS e margem vão de 0 a 100 e não têm separador de
// milhar, logo não têm a ambiguidade — e a máscara de centavos transformaria `5` em `0,05`. Eles
// continuam em `deCampo`/`paraCampo`, agora com guarda de FAIXA (abaixo).

// ⚠ A autoridade de PERCENTUAL deste app — ver `lerPercentual`, mais abaixo.
import { lerPercentualCarga } from "../../../lib/nfse/cadastroEmissaoNfse";

export {
  mascararValorDigitado as mascararDinheiro,
  lerValorDoCampo as lerDinheiro,
  formatarValorParaCampo as dinheiroParaCampo,
  lerValorColado as colarDinheiro,
  textoDaRecusaDeColagem as textoDaRecusaDeColarDinheiro,
} from "../../notas/lib/valorDaNota";

/**
 * O leitor de PERCENTUAL — e ele NÃO pode ser o `deCampo` acima.
 *
 * ⚠⚠ DEFEITO ACHADO POR MEDIÇÃO EM 01/09/2026, e ele não estava no plano: `deCampo` remove TODO
 * ponto como separador de milhar, o que é certo para dinheiro em pt-BR e **errado para
 * percentual**. Medido:
 *
 *     deCampo("3.5")    -> 35        ✗ um ISS de 3,5% vira 35% — erro de DEZ vezes
 *     deCampo("11.33")  -> 1133      ✗ e este é o exemplo que o `apps/web/CLAUDE.md` já cita
 *
 * ⚠ A regra escrita desta casa sempre foi o contrário, e está no `CLAUDE.md` da feature de
 * empresas, sobre a carga tributária: *"**Vírgula E ponto** são aceitos como decimal (percentual de
 * 0 a 100 não tem milhar). ⚠ Não reuse o normalizador de moeda: ele trata ponto como milhar e faria
 * `11.33` virar `1133`"*. A regra existia; este campo é que não a seguia.
 *
 * ⚠⚠ POR ISSO ELE REUSA `lerPercentualCarga`, e não escreve uma segunda gramática. Aquela função já
 * é a autoridade de percentual deste app (vírgula→ponto, até duas casas, faixa 0–100), e duas
 * leituras do mesmo número divergem na primeira correção.
 *
 * ⚠⚠ E A FAIXA NÃO É DETALHE: negativo era aceito, `margem` negativa entra em `custoAnualReal` sem
 * guarda e produz **imposto negativo** — o `sort` do comparador coroaria o Lucro Real como vencedor
 * por causa disso, num PDF que vai ao cliente.
 *
 * ⚠ `null` NÃO é a mesma coisa que `fora`: campo vazio é ausência (a tela não afirma nada); fora de
 * faixa é um número que a pessoa digitou e que precisa ser DITO. Apagar em silêncio faria o campo
 * "não aceitar" sem explicar por quê.
 *
 * @returns {{valor: number|null, fora: boolean}}
 */
export function lerPercentual(v) {
  const r = lerPercentualCarga(v);
  if (!r.preenchido) return { valor: null, fora: false };
  if (r.problema) return { valor: null, fora: true };
  return { valor: r.valor, fora: false };
}

/** A frase da recusa — na TELA, ao lado do campo. Nunca só um campo que não aceita. */
export function textoDoPercentualForaDaFaixa(rotuloDoCampo) {
  return (
    `${rotuloDoCampo} precisa ser um percentual entre 0 e 100, com até duas casas `
    + "(ex.: 3,5 ou 3.5). O que está digitado não entrou na conta."
  );
}

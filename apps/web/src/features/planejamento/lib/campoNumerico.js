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
// inteiros redondos, e o motor (95 testes, 24 deles casos dourados calculados à mão) estava
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

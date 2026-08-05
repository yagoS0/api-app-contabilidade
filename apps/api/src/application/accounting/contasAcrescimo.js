// As contas de ACRÉSCIMO da baixa: juros e multa.
//
// Estavam escritas em três lugares — na fábrica de rotas (`routes/firm/accountingEntries.js`), no
// script de remediação (`scripts/separar-baixas-agrupadas.mjs`) e como literal de fallback no modal
// do front. Três cópias de um código de conta é o tipo de coisa que diverge sem ninguém notar: a
// baixa passaria a jogar juros numa conta e o cálculo de saldo procuraria em outra, e o passivo
// ficaria eternamente errado sem erro nenhum na tela.
//
// Conferidas no plano de contas (`ChartOfAccount`): 501 = JUROS, 506 = MULTAS.
//
// ⚠ Elas NÃO são o critério para saber o que é juros e o que é multa. O papel de cada linha vem
// marcado (`papel: PRINCIPAL|JUROS|MULTA`), porque o contador pode trocar a conta. Estas constantes
// são o valor PADRÃO sugerido — e é por elas que `CONTAS_ACRESCIMO` impede acréscimo de contar como
// amortização do principal.
export const CONTA_JUROS = "501";
export const CONTA_MULTA = "506";

export const CONTAS_ACRESCIMO = new Set([CONTA_JUROS, CONTA_MULTA]);

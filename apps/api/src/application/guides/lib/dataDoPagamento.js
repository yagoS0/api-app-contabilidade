/**
 * A DATA EM QUE O DINHEIRO SAIU — a leitura de uma data INFORMADA. Módulo PURO.
 *
 * ## ⚠⚠ Por que existe (relato do dono, 30/08/2026)
 *
 * > *"ao clicar em confirmar pagamento, o pagamento foi posto no dia 30 de agosto mesmo não sendo
 * > verdade."*
 *
 * `Guide.paymentConfirmedAt` **não é o instante do clique** — é o dia em que o dinheiro saiu, e é
 * dele que `FluxoDeCaixaService.linhasDasGuias` tira o **mês** e o **dia** da linha do fluxo. Os
 * três caminhos que marcavam a guia como paga gravavam `new Date()`, ou seja, o clique.
 *
 * ⚠⚠ **Medido em produção antes do conserto** (`scripts/diag-data-do-pagamento.mjs`): das 20 guias
 * pagas que têm comprovante do SERPRO guardado, **20 divergiam** da data real de arrecadação. E a
 * divergência não é de um dia: a LENTE tinha INSS de 04/2026 arrecadado em **16/07** gravado como
 * **27/08** — dois meses depois, num campo que decide em que MÊS o dinheiro aparece no fluxo.
 *
 * ## ⚠ O que este módulo NÃO faz
 *
 * Ele lê a data que **alguém informou**. Onde existe data MEDIDA — a arrecadação do comprovante do
 * SERPRO, ou a `dataPagamento` que o contador digitou para gerar a baixa —, é ela que vale, e este
 * módulo não entra: medido vence informado, e informado vence o relógio.
 */

/** Por que a data não serve. Vocabulário FECHADO — cada uma pede uma frase diferente na tela. */
export const RECUSA_DA_DATA = Object.freeze({
  AUSENTE: "DATA_DO_PAGAMENTO_AUSENTE",
  INVALIDA: "DATA_DO_PAGAMENTO_INVALIDA",
  NO_FUTURO: "DATA_DO_PAGAMENTO_NO_FUTURO",
});

export const FRASE_DA_RECUSA = Object.freeze({
  [RECUSA_DA_DATA.AUSENTE]: "Informe o dia em que você pagou esta guia.",
  [RECUSA_DA_DATA.INVALIDA]: "Esta data não existe. Informe o dia em que você pagou, no formato dia/mês/ano.",
  [RECUSA_DA_DATA.NO_FUTURO]: "Esta data ainda não chegou. Informe o dia em que você já pagou.",
});

const FORMA = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Lê `"AAAA-MM-DD"` (o valor de um `<input type="date">`) e devolve a data, ou a recusa nomeada.
 *
 * ⚠⚠ **A DATA É CONSTRUÍDA POR ARITMÉTICA DE STRING, NUNCA POR `new Date("2026-08-11")`.** O
 * construtor com string interpreta a forma só-data como **UTC** e a forma com hora como LOCAL — e o
 * projeto inteiro já paga por isso em outro lugar (*"às 22h de Brasília o ISO devolveria o dia
 * seguinte"*). Aqui o deslocamento moveria o pagamento de dia no fluxo, que é o defeito que este
 * módulo existe para consertar.
 *
 * ⚠ E a validação é por RECONSTRUÇÃO: `Date.UTC(2026, 1, 31)` não falha — ele **rola** para 3 de
 * março. Só comparar as três partes de volta pega o 31 de fevereiro.
 *
 * ⚠ **Futuro é recusado**, e é a única recusa de conteúdo: ninguém pagou amanhã. Não há piso — uma
 * guia antiga paga há anos é um fato legítimo, e inventar um limite recusaria verdade.
 *
 * @param {string} texto  "AAAA-MM-DD"
 * @param {{hoje?: Date}} [opcoes]  `hoje` INJETADO — sem ele o teste mudaria de resultado a cada dia
 * @returns {{data: Date|null, recusa: string|null}}
 */
export function lerDataDoPagamentoInformada(texto, { hoje = new Date() } = {}) {
  const bruto = String(texto ?? "").trim();
  if (!bruto) return { data: null, recusa: RECUSA_DA_DATA.AUSENTE };

  const m = FORMA.exec(bruto);
  if (!m) return { data: null, recusa: RECUSA_DA_DATA.INVALIDA };

  const [, a, mes, d] = m.map(Number);
  const data = new Date(Date.UTC(a, mes - 1, d));
  const reconstruiu = data.getUTCFullYear() === a
    && data.getUTCMonth() === mes - 1
    && data.getUTCDate() === d;
  if (!reconstruiu) return { data: null, recusa: RECUSA_DA_DATA.INVALIDA };

  // ⚠ A comparação é por DIA, em UTC: `hoje` carrega hora, e comparar instantes recusaria um
  // pagamento feito hoje mais cedo — que é o caso mais comum de todos.
  const limite = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate());
  if (data.getTime() > limite) return { data: null, recusa: RECUSA_DA_DATA.NO_FUTURO };

  return { data, recusa: null };
}

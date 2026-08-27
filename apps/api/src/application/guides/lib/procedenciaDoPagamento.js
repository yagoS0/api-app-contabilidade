// DE ONDE VEIO A AFIRMAÇÃO DE QUE ESTA GUIA FOI PAGA — e até onde ela alcança.
//
// ⚠⚠ POR QUE ISTO EXISTE AGORA. Até 27/08/2026 só o ESCRITÓRIO podia confirmar pagamento, e
// `paymentStatusSource` tinha dois valores: `SERPRO` (o comprovante foi localizado) e `MANUAL` (o
// contador marcou). O dono decidiu que o CLIENTE também pode confirmar, *"como a confirmação da
// consulta de pagamento"* — ou seja: **marca a guia e para aí**. Quem faz a baixa contábil continua
// sendo o contador, pela Circular.
//
// ⚠⚠ E ISSO EXIGE UMA GUARDA, PORQUE O ACOPLAMENTO JÁ EXISTE E JÁ ALCANÇA O RAZÃO.
// `GuideToProvisionService` deriva `isPaid` de `guide.paymentStatus` e grava
// **`statusPagamento: "PAGO"` na PROVISÃO CONTÁBIL**. Sem esta regra, o cliente passaria a marcar
// lançamento contábil como pago — sem baixa lançada, sem contrapartida, sem ninguém do escritório
// ter decidido isso. Confirmar recebimento de um documento não é dar baixa no razão.

/** As três procedências. ⚠ Lista FECHADA — é o mesmo vocabulário de `Guide.paymentStatusSource`. */
export const PROCEDENCIA_PAGAMENTO = Object.freeze({
  /** O comprovante foi localizado na Receita (PAGTOWEB). É prova. */
  SERPRO: "SERPRO",
  /** O contador marcou à mão. É afirmação de quem responde pela contabilidade. */
  MANUAL: "MANUAL",
  /** ⚠ O cliente disse que pagou. É afirmação de quem paga — e NÃO é prova. */
  CLIENTE: "CLIENTE",
});

const normalizar = (v) => String(v || "").trim().toUpperCase();

export function estaPaga(guide) {
  return normalizar(guide?.paymentStatus) === "PAID";
}

export function procedenciaDoPagamento(guide) {
  const p = normalizar(guide?.paymentStatusSource);
  return Object.prototype.hasOwnProperty.call(PROCEDENCIA_PAGAMENTO, p) ? p : null;
}

/**
 * ⚠⚠ A GUARDA: esta confirmação chega ao LANÇAMENTO CONTÁBIL?
 *
 *   · `SERPRO` .... sim. O comprovante existe; é o comportamento de sempre.
 *   · `MANUAL` .... sim. É o contador afirmando, e ele responde pela contabilidade. Comportamento
 *                   de sempre.
 *   · `CLIENTE` ... ⚠⚠ **NÃO.** Marca a guia e para. É o pedido literal do dono.
 *   · ausente ..... ⚠ SIM — e isto é deliberado. `paymentStatusSource` é `String?` sem default, e
 *                   há guias PAGAS gravadas antes de a coluna existir. Tratar a ausência como
 *                   "cliente" faria a provisão de linha ANTIGA deixar de ser marcada paga, mudando
 *                   contabilidade já fechada por causa de um campo que ninguém preencheu. Aqui o
 *                   default seguro é o COMPORTAMENTO ANTIGO.
 */
export function pagamentoAlcancaOContabil(guide) {
  if (!estaPaga(guide)) return false;
  return procedenciaDoPagamento(guide) !== PROCEDENCIA_PAGAMENTO.CLIENTE;
}

const LEITURA = Object.freeze({
  [PROCEDENCIA_PAGAMENTO.SERPRO]: {
    rotulo: "pagamento localizado na Receita",
    // ⚠ Só esta é PROVA. As outras duas são afirmações de pessoas.
    ehProva: true,
    detalhe: "O comprovante de arrecadação foi encontrado pela consulta ao SERPRO.",
  },
  [PROCEDENCIA_PAGAMENTO.MANUAL]: {
    rotulo: "marcado pelo contador",
    ehProva: false,
    detalhe: "Alguém do escritório marcou esta guia como paga.",
  },
  [PROCEDENCIA_PAGAMENTO.CLIENTE]: {
    rotulo: "o cliente confirmou",
    ehProva: false,
    // ⚠⚠ A frase diz as DUAS coisas que a distinguem: é afirmação (não comprovante) e ela NÃO
    // lançou baixa nenhuma. Sem isso, o contador lê "pago" e fecha o mês.
    detalhe: "O cliente informou pelo portal que pagou. Isto é uma afirmação dele, não um "
      + "comprovante — e não lançou a baixa contábil.",
  },
});

/**
 * ⚠⚠ O QUE A TELA MOSTRA — e a procedência é TEXTO VISÍVEL, não `title`.
 *
 * Hoje a Circular imprime o mesmo ✓ verde para "o SERPRO achou o comprovante" e para "o contador
 * marcou à mão", com a diferença escondida num `title` — que não aparece no teclado nem no toque.
 * Com uma terceira origem, que é afirmação de quem paga, isso deixa de ser detalhe estético.
 *
 * ⚠ Guia não paga devolve `null`: não há procedência de um pagamento que não foi afirmado.
 * ⚠ Procedência desconhecida (linha antiga, valor novo) NÃO vira "o cliente confirmou" nem
 * "marcado pelo contador" — ela sai como não registrada. Inventar quem disse o quê é pior que
 * dizer que não se sabe.
 */
export function leituraDoPagamento(guide) {
  if (!estaPaga(guide)) return null;
  const p = procedenciaDoPagamento(guide);
  if (!p) {
    return {
      procedencia: null,
      rotulo: "pagamento confirmado",
      ehProva: false,
      alcancaOContabil: true,
      detalhe: "Não há registro de quem confirmou este pagamento (guia anterior a esse controle).",
    };
  }
  return {
    procedencia: p,
    ...LEITURA[p],
    alcancaOContabil: pagamentoAlcancaOContabil(guide),
  };
}

// QUEM DISSE QUE ESTA GUIA FOI PAGA — e por que isso virou texto VISÍVEL.
//
// ⚠⚠ O DEFEITO QUE ISTO CONSERTA. A Circular imprime o MESMO ✓ verde para duas coisas muito
// diferentes — "o SERPRO localizou o comprovante" e "alguém do escritório marcou à mão" — e a
// diferença mora num `title`, que não aparece no teclado nem no toque. Enquanto eram duas origens
// internas, custava pouco. A partir de 27/08/2026 há uma TERCEIRA, e ela é afirmação de quem PAGA:
// o cliente confirma pelo portal.
//
// ⚠⚠ E a do cliente **não lança baixa contábil** (`pagamentoAlcancaOContabil`, no backend). Um ✓
// verde indistinguível ali faria o contador ler "pago, contabilizado" sobre uma linha em que nada
// foi lançado — e fechar o mês em cima disso.
//
// ⚠ ESTE É O ESPELHO de `apps/api/src/application/guides/lib/procedenciaDoPagamento.js`, amarrado
// por teste. Os dois apps não compartilham código; sem a amarração, a tela e o razão discordariam
// sobre a mesma guia.

export const PROCEDENCIA_PAGAMENTO = Object.freeze({
  SERPRO: "SERPRO",
  MANUAL: "MANUAL",
  CLIENTE: "CLIENTE",
});

const LEITURA = Object.freeze({
  [PROCEDENCIA_PAGAMENTO.SERPRO]: {
    // ⚠ O rótulo curto é o que cabe na célula; ele é a MARCA, e a cor é reforço.
    marca: "✓ Receita",
    rotulo: "pagamento localizado na Receita",
    ehProva: true,
    alcancaOContabil: true,
  },
  [PROCEDENCIA_PAGAMENTO.MANUAL]: {
    marca: "✓ contador",
    rotulo: "marcado pelo contador",
    ehProva: false,
    alcancaOContabil: true,
  },
  [PROCEDENCIA_PAGAMENTO.CLIENTE]: {
    marca: "✓ cliente",
    rotulo: "o cliente confirmou",
    ehProva: false,
    // ⚠⚠ É ESTE `false` QUE MUDA O QUE A TELA DEVE DIZER.
    alcancaOContabil: false,
  },
});

const normalizar = (v) => String(v || "").trim().toUpperCase();

/**
 * @param {object} guia  o `sourceGuide` da linha da Circular
 * @returns {null | {procedencia, marca, rotulo, ehProva, alcancaOContabil, detalhe}}
 */
export function leituraDoPagamento(guia) {
  if (normalizar(guia?.paymentStatus) !== "PAID") return null;
  const p = normalizar(guia?.paymentStatusSource);
  const conhecida = Object.prototype.hasOwnProperty.call(LEITURA, p) ? LEITURA[p] : null;

  if (!conhecida) {
    // ⚠⚠ PROCEDÊNCIA DESCONHECIDA NÃO VIRA UMA DAS TRÊS. Há guias pagas anteriores à coluna, e
    // inventar quem confirmou é pior que dizer que não se sabe. ⚠ E ela CONTINUA alcançando o
    // contábil — é o comportamento antigo, e mudá-lo mexeria em contabilidade já fechada.
    return {
      procedencia: null,
      marca: "✓",
      rotulo: "pagamento confirmado",
      ehProva: false,
      alcancaOContabil: true,
      detalhe: "Não há registro de quem confirmou este pagamento.",
    };
  }

  return {
    procedencia: p,
    ...conhecida,
    detalhe: conhecida.alcancaOContabil
      ? null
      // ⚠ A frase diz o que FALTA, não só de onde veio: é o que impede "pago" de ser lido como
      // "contabilizado".
      : "Afirmação do cliente, não comprovante — a baixa contábil ainda não foi lançada.",
  };
}

/**
 * ⚠ O `title` continua existindo, com a data — mas ele deixou de ser o ÚNICO lugar onde a
 * procedência aparece. Ele complementa a marca visível; não a substitui.
 */
export function tituloDoPagamento(guia, { dataFormatada = null } = {}) {
  const l = leituraDoPagamento(guia);
  if (!l) return null;
  return [
    `Pagamento confirmado${dataFormatada ? ` em ${dataFormatada}` : ""} — ${l.rotulo}.`,
    l.detalhe,
    guia?.comprovantePdfFileId ? "Comprovante de arrecadação disponível." : null,
  ].filter(Boolean).join(" ");
}

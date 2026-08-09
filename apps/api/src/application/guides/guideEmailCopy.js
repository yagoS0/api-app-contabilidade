import { normalizeGuideType } from "./guideContract.js";

const LABELS = {
  INSS: "INSS",
  SIMPLES: "Simples Nacional",
  FGTS: "FGTS",
  PIS: "PIS",
  COFINS: "COFINS",
  ISS: "ISS",
  OUTRA: "pagamento",
};

/**
 * Rótulo curto para assunto e corpo de e-mail.
 */
export function guideTypeEmailLabel(tipo) {
  const t = normalizeGuideType(tipo);
  return LABELS[t] || "pagamento";
}

/**
 * ⚠ NÃO EXISTE FILA DE ENVIO. NENHUMA MENSAGEM PODE DIZER QUE EXISTE.
 *
 * O laço automático foi REMOVIDO na Q55 (`server.js`: "nada roda sozinho") e nada drena
 * `emailNextRetryAt`. Ainda assim, quatro rotas respondiam ao contador com "ficará em fila",
 * "em fila — verifique os logs", "será tentado depois" e "em processamento". As quatro descreviam
 * um sistema que não existe: **a guia simplesmente não sai**, e o contador vai embora tranquilo
 * achando que o cliente vai receber.
 *
 * A frase mora aqui, e não no lugar de uso, porque foi escrevendo-a em quatro lugares que a
 * promessa falsa se espalhou — e cada cópia envelheceu por conta própria.
 *
 * O que se pode honestamente oferecer é **tentar de novo**: o envio manual não espera janela de
 * retry (`whereGuiaPendenteDeEnvio()` sem `retryAntesDe`), então clicar outra vez de fato tenta
 * outra vez. É isso, e só isso, que estas mensagens prometem.
 */
export const SEM_REENVIO_AUTOMATICO =
  "Não há reenvio automático: se você não clicar de novo, esta guia não sai.";

/**
 * Lock global preso (`runGuideEmailWorker*` devolveu `{ skipped:true, reason:"lock_active" }`).
 *
 * O lock tem TTL de 5 minutos e é liberado no `finally` — mas um processo morto no meio deixa o
 * registro válido até o TTL vencer. Nos dois casos (envio de verdade em andamento OU lock órfão) o
 * que o contador precisa saber é o mesmo: **este e-mail não foi enviado**, e nada vai tentar por
 * ele. Daí o prazo aparecer no texto: em até 5 minutos o clique volta a funcionar.
 */
export function mensagemEnvioNaoFeitoPorLock(prefixo = "") {
  return `${prefixo}O e-mail NÃO foi enviado: há outro envio em andamento (ou um envio anterior que travou). `
    + `${SEM_REENVIO_AUTOMATICO} Tente novamente em até 5 minutos.`;
}

/** Falha concreta do envio (exceção ou item com `status:"ERROR"`), com o motivo à vista. */
export function mensagemEnvioFalhou(motivo, prefixo = "") {
  const detalhe = String(motivo || "").trim();
  return `${prefixo}O e-mail NÃO foi enviado${detalhe ? `: ${detalhe}` : "."} ${SEM_REENVIO_AUTOMATICO}`;
}

/**
 * Guia capturada/processada, ainda não enviada.
 *
 * ⚠ Era "Guia processada e colocada na fila. O envio automático será tentado depois." — as duas
 * frases falsas na mesma linha. O envio é 100% manual desde a Q55.
 */
export const GUIA_AGUARDA_ENVIO_MANUAL =
  "Guia processada. O envio de e-mail é manual: use 'Envio de e-mails em lote' ou 'Liberar ao cliente'.";

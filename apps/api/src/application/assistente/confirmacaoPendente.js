// O PROTOCOLO DE CONFIRMAÇÃO — o código, a leitura da resposta e a expiração. Puro.
//
// ⚠⚠ A CONFIRMAÇÃO NÃO PASSA PELA IA. Quem reconhece "CONFIRMAR A7K2" é uma regex, ANTES de chamar o
// modelo — um modelo não pode ser a peça que decide se um ato fiscal irreversível acontece. E o
// código é POR PENDÊNCIA: "sim" solto nunca confirma, e uma resposta atrasada a uma pendência
// antiga não confirma a nova.
//
// ⚠ 10 minutos. Conferido na LEITURA (não há worker): pendência vencida responde "o pedido expirou,
// peça de novo". Sem 0/O/1/I no alfabeto — é digitado no celular, lido em voz alta.

export const TTL_MS = 10 * 60 * 1000;
export const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const TAMANHO_CODIGO = 4;

export const TIPOS = Object.freeze({
  EMITIR_NFSE: "EMITIR_NFSE",
  CANCELAR_NFSE: "CANCELAR_NFSE",
  RECALCULAR_GUIA: "RECALCULAR_GUIA",
});

export const STATUS = Object.freeze({
  PENDENTE: "pendente",
  CONFIRMADA: "confirmada",
  EXECUTADA: "executada",
  EXPIRADA: "expirada",
  CANCELADA: "cancelada",
});

/** @param {() => number} [rand] injetável (0 ≤ x < 1) — o teste não depende de sorte. */
export function gerarCodigo(rand = Math.random) {
  let s = "";
  for (let i = 0; i < TAMANHO_CODIGO; i += 1) s += ALFABETO[Math.floor(rand() * ALFABETO.length) % ALFABETO.length];
  return s;
}

/** A regex: "confirmar" + espaço(s) + 4 caracteres do alfabeto. Caixa e acento não importam. */
export const RE_CONFIRMACAO = /^\s*confirmar\s+([a-z0-9]{4})\s*[.!]?\s*$/i;
const RE_CANCELAR = /^\s*(cancelar|cancela|nao|não|desist\w*)\b/i;

/**
 * Lê a mensagem do cliente: é uma confirmação? de qual código?
 * @returns {{ehConfirmacao:boolean, codigo:string|null, ehCancelamento:boolean}}
 */
export function lerConfirmacao(texto) {
  const t = String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  const m = RE_CONFIRMACAO.exec(t);
  if (m) return { ehConfirmacao: true, codigo: m[1].toUpperCase(), ehCancelamento: false };
  return { ehConfirmacao: false, codigo: null, ehCancelamento: RE_CANCELAR.test(t) };
}

export function expirada(acao, agora = new Date()) {
  const fim = acao?.expiraEm instanceof Date ? acao.expiraEm : new Date(acao?.expiraEm || 0);
  return !(fim.getTime() > agora.getTime());
}

/**
 * A DECISÃO diante de uma resposta do cliente com pendência aberta (ou não).
 *
 * @param {object} p
 * @param {string} p.texto  a mensagem do cliente
 * @param {object|null} p.pendente  a ação pendente aberta no fio (status `pendente`), ou null
 * @param {Date} [p.agora]
 * @returns {{decisao: "EXECUTAR"|"CODIGO_ERRADO"|"EXPIRADA"|"CANCELAR"|"SEM_PENDENCIA"|"SEGUE_PARA_IA", acao: object|null}}
 */
export function decidirResposta({ texto, pendente, agora = new Date() } = {}) {
  const leitura = lerConfirmacao(texto);
  if (!pendente) {
    // Sem pendência, "CONFIRMAR XXXX" não confirma nada — e o modelo é quem explica.
    return { decisao: leitura.ehConfirmacao ? "SEM_PENDENCIA" : "SEGUE_PARA_IA", acao: null };
  }
  if (expirada(pendente, agora)) return { decisao: "EXPIRADA", acao: pendente };
  if (leitura.ehConfirmacao) {
    return leitura.codigo === String(pendente.codigo || "").toUpperCase()
      ? { decisao: "EXECUTAR", acao: pendente }
      : { decisao: "CODIGO_ERRADO", acao: pendente };
  }
  if (leitura.ehCancelamento) return { decisao: "CANCELAR", acao: pendente };
  // Qualquer outra resposta com pendência aberta: ela é CANCELADA (é o que o texto prometeu —
  // "qualquer outra resposta cancela"), e a mensagem segue para a IA como conversa normal.
  return { decisao: "CANCELAR", acao: pendente };
}

/** O rodapé que toda pendência carrega. */
export function rodapeDeConfirmacao(codigo) {
  return `Para confirmar, responda CONFIRMAR ${codigo}. Qualquer outra resposta cancela. Este pedido vale por 10 minutos.`;
}

export const FRASES = Object.freeze({
  CODIGO_ERRADO: (codigo) => `O código não bate com o pedido em aberto. Se quiser seguir, responda CONFIRMAR ${codigo}; qualquer outra resposta cancela.`,
  EXPIRADA: "Esse pedido expirou (valia por 10 minutos). Se ainda quiser, peça de novo que eu monto outra vez.",
  CANCELADA: "Certo, cancelei esse pedido. Nada foi feito.",
  SEM_PENDENCIA: "Não há nenhum pedido aguardando confirmação neste momento.",
});

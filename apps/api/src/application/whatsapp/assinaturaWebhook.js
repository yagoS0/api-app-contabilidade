// A PORTA PÚBLICA DO WEBHOOK — e aqui a ASSINATURA É A AUTENTICAÇÃO.
//
// ⚠ Esta é a ÚNICA rota do sistema sem `ensureAuthorized` / `requireFirmCompanyAccess`. Em todo o
// resto do projeto o `requireAuth` mora no router (`firm/index.js`, `client/index.js`); aqui não há
// usuário nenhum do outro lado — quem chama é a Meta, e o que prova que é ela é o HMAC do corpo com
// o App Secret. Por isso este arquivo é PURO (sem express, sem prisma, sem rede) e responde com
// nomes, nunca com booleano solto: quem lê o resultado precisa poder dizer no log QUAL das recusas
// aconteceu, e as consequências de cada uma são diferentes.
//
// ── ⚠ AUSÊNCIA DE SEGREDO NÃO PODE VIRAR "ACEITA TUDO" ──────────────────────────────────────────
// O erro clássico desta classe de código é `if (!APP_SECRET) return next()` — em ambiente sem a
// variável, a rota pública passa a aceitar qualquer corpo de qualquer origem, e nada na tela
// denuncia. Aqui a falta do segredo é uma RECUSA NOMEADA (`SEM_APP_SECRET`), do lado do servidor:
// nada é processado, e o log diz o que falta configurar. Vale igual para o `hub.verify_token` do
// handshake — com ele vazio, `token === VERIFY_TOKEN` seria verdadeiro para quem mandasse a query
// sem token, e qualquer um poderia "verificar" o nosso webhook no painel dele.
//
// ── FONTES ──────────────────────────────────────────────────────────────────────────────────────
// [W1] Meta — Webhooks, Getting Started (consultado em 2026-08-15):
//      https://developers.facebook.com/docs/graph-api/webhooks/getting-started
//      De lá, literalmente:
//        · verificação: `hub.mode` — "This value will always be set to `subscribe`";
//          `hub.challenge` — "An `int` you must pass back to us";
//          `hub.verify_token` — "A string that we grab from the Verify Token field in your app's
//          App Dashboard"; e "Respond with the `hub.challenge` value".
//        · assinatura: o header `X-Hub-Signature-256` vem "preceded with `sha256=`"; e
//          "Generate a SHA256 signature using the payload and your app's App Secret. Compare your
//          signature to the signature in the X-Hub-Signature-256 header (everything after
//          `sha256=`). If the signatures match, the payload is genuine."
// [W2] Meta — Webhooks for Messenger Platform, "Validating Payloads" (consultado em 2026-08-15):
//      https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks
//      ⚠ A frase que decide o desenho da rota: "we generate the signature using an *escaped
//      unicode* version of the payload, with lowercase hex digits" e "If you just calculate against
//      the decoded bytes, you will end up with a different signature" — o exemplo da própria página
//      é a string "äöå", que "should be escaped to" a sequência de três escapes unicode
//      correspondente. Ou seja: o HMAC é sobre os BYTES QUE CHEGARAM, que já vêm escapados.
//      Reserializar (`JSON.stringify(req.body)`) desfaz o escape e a assinatura NUNCA confere —
//      é por isso que o webhook é montado com `express.raw`, ANTES do `express.json()` global.
//
// ⚠ O QUE **NÃO** ESTÁ NA FONTE, e por isso não é decidido aqui: nenhuma das duas páginas declara
// o ALGORITMO de comparação (nós usamos tempo constante, decisão nossa e conservadora), nem se o
// hex do header pode vir em maiúsculas. Hex é indiferente a caixa por definição, então a comparação
// normaliza os dois lados para minúsculas antes de comparar — recusar por caixa seria recusar uma
// assinatura correta.

import crypto from "node:crypto";

/** O nome do header, num lugar só. [W1] */
export const CABECALHO_ASSINATURA = "x-hub-signature-256";

/** O prefixo obrigatório do valor do header. [W1] */
export const PREFIXO_ASSINATURA = "sha256=";

/** O valor fixo de `hub.mode` na verificação. [W1] */
export const MODO_VERIFICACAO = "subscribe";

export const ASSINATURA = Object.freeze({
  /** O corpo é genuíno. */
  VALIDA: "VALIDA",
  /** ⚠ CONFIGURAÇÃO NOSSA: `WHATSAPP_APP_SECRET` não definido. Nada é processado. */
  SEM_APP_SECRET: "SEM_APP_SECRET",
  /** Chamada sem o header nenhum — não veio da Meta (ou veio de um proxy que o removeu). */
  SEM_CABECALHO: "SEM_CABECALHO",
  /** Veio header, mas não no formato `sha256=<hex>`. */
  FORMATO_INESPERADO: "FORMATO_INESPERADO",
  /**
   * ⚠ Não há corpo BRUTO para conferir. Quase sempre significa que a rota foi montada DEPOIS do
   * `express.json()` e `req.body` chegou como objeto — o defeito que faria a assinatura nunca
   * conferir, e cuja causa é impossível de adivinhar olhando só o 403.
   */
  CORPO_AUSENTE: "CORPO_AUSENTE",
  /** Assinatura bem formada e diferente da nossa: corpo alterado, segredo errado ou falsificação. */
  NAO_CONFERE: "NAO_CONFERE",
});

const HEX_64 = /^[0-9a-fA-F]{64}$/;

/**
 * Comparação em TEMPO CONSTANTE.
 *
 * ⚠ `timingSafeEqual` **estoura** com buffers de tamanhos diferentes — por isso o tamanho é
 * conferido antes. O comprimento de um digest hex é público (sempre 64 caracteres), então essa
 * comparação prévia não vaza nada que o atacante já não saiba; o que não pode vazar é QUANTOS
 * caracteres iniciais ele acertou, e é disso que `timingSafeEqual` cuida.
 */
function iguaisEmTempoConstante(a, b) {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * O corpo é genuinamente da Meta?
 *
 * @param {object} entrada
 * @param {Buffer|string} entrada.corpoRaw  ⚠ O CORPO EXATO, como chegou. Não um objeto já parseado,
 *   não um `JSON.stringify` dele — ver [W2] no cabeçalho.
 * @param {string} entrada.cabecalho  valor de `X-Hub-Signature-256`.
 * @param {string} entrada.appSecret  `WHATSAPP_APP_SECRET`.
 * @returns {{ok: boolean, resultado: string, motivo: string}}
 */
export function conferirAssinatura({ corpoRaw, cabecalho, appSecret }) {
  const segredo = String(appSecret || "");
  if (!segredo) {
    return {
      ok: false,
      resultado: ASSINATURA.SEM_APP_SECRET,
      motivo:
        "WHATSAPP_APP_SECRET não está definido neste ambiente. Sem ele não há como distinguir a Meta "
        + "de qualquer outra origem, e esta rota é pública: nada é processado.",
    };
  }

  const ehBuffer = Buffer.isBuffer(corpoRaw);
  const ehTexto = typeof corpoRaw === "string";
  if (!ehBuffer && !ehTexto) {
    return {
      ok: false,
      resultado: ASSINATURA.CORPO_AUSENTE,
      motivo:
        "O corpo bruto da requisição não chegou até a conferência (veio objeto ou vazio). "
        + "Confira se o webhook está montado com express.raw ANTES do express.json() global.",
    };
  }
  // Corpo vazio COM assinatura é conferível (o HMAC de "" existe); corpo vazio SEM assinatura cai no
  // ramo de baixo. Não se recusa por tamanho: quem decide é o HMAC.
  const bytes = ehBuffer ? corpoRaw : Buffer.from(corpoRaw, "utf8");

  const bruto = String(cabecalho || "").trim();
  if (!bruto) {
    return {
      ok: false,
      resultado: ASSINATURA.SEM_CABECALHO,
      motivo: "Requisição sem o cabeçalho X-Hub-Signature-256.",
    };
  }
  if (!bruto.startsWith(PREFIXO_ASSINATURA)) {
    return {
      ok: false,
      resultado: ASSINATURA.FORMATO_INESPERADO,
      motivo: `Cabeçalho X-Hub-Signature-256 sem o prefixo "${PREFIXO_ASSINATURA}".`,
    };
  }
  const recebida = bruto.slice(PREFIXO_ASSINATURA.length);
  if (!HEX_64.test(recebida)) {
    return {
      ok: false,
      resultado: ASSINATURA.FORMATO_INESPERADO,
      motivo: "Cabeçalho X-Hub-Signature-256 não traz um digest SHA-256 em hexadecimal.",
    };
  }

  const esperada = crypto.createHmac("sha256", segredo).update(bytes).digest("hex");
  // Hex é indiferente a caixa; a normalização acontece dos DOIS lados, e nenhuma delas depende do
  // conteúdo do segredo.
  if (!iguaisEmTempoConstante(recebida.toLowerCase(), esperada)) {
    return {
      ok: false,
      resultado: ASSINATURA.NAO_CONFERE,
      motivo: "A assinatura não confere com o corpo recebido.",
    };
  }
  return { ok: true, resultado: ASSINATURA.VALIDA, motivo: "" };
}

export const HANDSHAKE = Object.freeze({
  /** Token confere: responder o `hub.challenge`. */
  OK: "OK",
  /** ⚠ CONFIGURAÇÃO NOSSA: `WHATSAPP_VERIFY_TOKEN` vazio. Recusa — ver o cabeçalho. */
  SEM_VERIFY_TOKEN: "SEM_VERIFY_TOKEN",
  /** `hub.mode` diferente de `subscribe`. [W1] */
  MODO_INESPERADO: "MODO_INESPERADO",
  /** Token errado — é o caso de quem tenta registrar o nosso endereço no app dele. */
  TOKEN_NAO_CONFERE: "TOKEN_NAO_CONFERE",
  /** Token certo e nada para devolver: a Meta espera o eco do challenge. [W1] */
  SEM_CHALLENGE: "SEM_CHALLENGE",
});

/**
 * O handshake do botão "Verificar e salvar" do painel da Meta. [W1]
 *
 * ⚠ O token é comparado em TEMPO CONSTANTE pelo mesmo motivo da assinatura: ele é um segredo
 * compartilhado, e a tela do painel pode ser chamada quantas vezes o atacante quiser.
 *
 * @returns {{ok: boolean, resultado: string, challenge: string|null, motivo: string}}
 */
export function conferirHandshake({ modo, token, challenge, verifyToken }) {
  const esperado = String(verifyToken || "");
  if (!esperado) {
    return {
      ok: false,
      resultado: HANDSHAKE.SEM_VERIFY_TOKEN,
      challenge: null,
      motivo:
        "WHATSAPP_VERIFY_TOKEN não está definido neste ambiente. Com ele vazio, uma chamada sem "
        + "token seria aceita como válida e qualquer app poderia registrar este endereço.",
    };
  }
  if (String(modo || "") !== MODO_VERIFICACAO) {
    return {
      ok: false,
      resultado: HANDSHAKE.MODO_INESPERADO,
      challenge: null,
      motivo: `hub.mode esperado "${MODO_VERIFICACAO}".`,
    };
  }
  if (!iguaisEmTempoConstante(String(token || ""), esperado)) {
    return {
      ok: false,
      resultado: HANDSHAKE.TOKEN_NAO_CONFERE,
      challenge: null,
      motivo: "hub.verify_token não confere.",
    };
  }
  const eco = challenge === undefined || challenge === null ? "" : String(challenge);
  if (!eco) {
    return {
      ok: false,
      resultado: HANDSHAKE.SEM_CHALLENGE,
      challenge: null,
      motivo: "hub.challenge não veio na chamada; não há o que devolver.",
    };
  }
  return { ok: true, resultado: HANDSHAKE.OK, challenge: eco, motivo: "" };
}

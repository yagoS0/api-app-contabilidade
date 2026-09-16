// Marcador de preenchimento não é uma resposta ao cliente. Sem nova chamada ao modelo.
export const respostaComMarcador = texto => /^\s*\[(?:mensagem|resposta|texto|placeholder|insira)\b[^\]]*\]\s*[.!]?\s*$/iu.test(String(texto || ''));

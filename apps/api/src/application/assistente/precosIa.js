// O PREÇO POR TOKEN — versionado no código, com a data e a fonte. Puro.
//
// ⚠ É ESTIMATIVA, e a tela diz que é. A fatura real é a do Console da Anthropic; o que se calcula
// aqui alimenta o TETO mensal (por empresa e do escritório) e a coluna `custoEstimadoCentavos` de
// `chamadas_ia`. Divergir alguns centavos é tolerável; não registrar nada não é.
//
// FONTE: a skill `claude-api` (referência de preços consultada em 02/09/2026): Opus 5 — US$ 5 por
// milhão de tokens de entrada, US$ 25 por milhão de saída; leitura de cache ≈ 0,1× da entrada;
// escrita de cache (5 min) ≈ 1,25× da entrada. ⚠ Modelo fora da tabela cai no preço do Opus 5, que
// é o MAIS CARO — superestimar protege o teto; subestimar o fura.

export const VIGENCIA_DA_TABELA = "2026-09-02";

/** US$ por MILHÃO de tokens, em centavos de dólar (500 = US$ 5,00). */
export const PRECOS_POR_MILHAO_CENTAVOS = Object.freeze({
  "claude-opus-5": Object.freeze({ entrada: 500, saida: 2500, cacheLeitura: 50, cacheEscrita: 625 }),
  "claude-sonnet-5": Object.freeze({ entrada: 300, saida: 1500, cacheLeitura: 30, cacheEscrita: 375 }),
  "claude-haiku-4-5-20251001": Object.freeze({ entrada: 100, saida: 500, cacheLeitura: 10, cacheEscrita: 125 }),
});

export const MODELO_MAIS_CARO = "claude-opus-5";

export function precoDoModelo(modelo) {
  return PRECOS_POR_MILHAO_CENTAVOS[String(modelo || "").trim()] || PRECOS_POR_MILHAO_CENTAVOS[MODELO_MAIS_CARO];
}

/**
 * O custo ESTIMADO de uma chamada, em centavos de dólar, ARREDONDADO PARA CIMA (nunca zero para
 * uma chamada que consumiu tokens — um custo que arredonda a zero nunca bateria no teto).
 *
 * @param {object} usage  o `usage` da resposta: `{ input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens }`
 */
export function custoEstimadoCentavos(usage, modelo) {
  const p = precoDoModelo(modelo);
  const u = usage || {};
  const n = (v) => Math.max(0, Number(v) || 0);
  const total =
    (n(u.input_tokens) * p.entrada
      + n(u.output_tokens) * p.saida
      + n(u.cache_read_input_tokens) * p.cacheLeitura
      + n(u.cache_creation_input_tokens) * p.cacheEscrita) / 1_000_000;
  if (total <= 0) return 0;
  return Math.max(1, Math.ceil(total));
}

/** Soma os `usage` de várias iterações de um turno num só. */
export function somarUsage(lista) {
  const soma = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  for (const u of lista || []) {
    if (!u) continue;
    for (const k of Object.keys(soma)) soma[k] += Math.max(0, Number(u[k]) || 0);
  }
  return soma;
}

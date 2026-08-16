// O CAMPO PRÉ-PREENCHIDO DO PLANEJAMENTO — valor + de onde ele veio, ou a ausência com o motivo.
//
// ⚠ ESTE MÓDULO EXISTE POR CAUSA DE UM ÚNICO DEFEITO, E ELE É CARO: **folha ausente virando zero**.
// O Fator R é `folha12m / rbt12` e decide Anexo III (≥ 0,28) ou Anexo V. Uma folha desconhecida que
// chega como `0` produz Fator R `0`, anexo V, e MUDA O REGIME RECOMENDADO — num PDF que vai para o
// cliente. O mesmo vale para receita, RBT12 e alíquota de ISS: ausência tem de chegar como
// ausência, e a tela precisa poder dizer "não foi possível apurar" em vez de mostrar um número.
//
// Por isso todo campo sai desta forma, sempre:
//   { valor, apurado, origem, motivoAusencia }
//
// Invariante: `apurado === false` ⇒ `valor === null` **e** `motivoAusencia` preenchido. Não existe
// campo ausente sem motivo — recusa vem com razão, como no resto do projeto.

/** Campo apurado: tem valor E tem de onde ele veio. Sem origem não há campo apurado. */
export function apurado(valor, origem) {
  if (valor === null || valor === undefined) {
    throw new Error("campoComOrigem: apurado() exige valor — use ausente() para o que não se sabe");
  }
  if (!origem) {
    throw new Error("campoComOrigem: apurado() exige origem — número sem procedência é número inventado");
  }
  return Object.freeze({ valor, apurado: true, origem: String(origem), motivoAusencia: null });
}

/** Campo NÃO apurado. O valor é `null` — nunca 0, nunca "", nunca um default plausível. */
export function ausente(motivoAusencia) {
  if (!motivoAusencia) {
    throw new Error("campoComOrigem: ausente() exige motivo — ausência sem explicação parece campo quebrado");
  }
  return Object.freeze({ valor: null, apurado: false, origem: null, motivoAusencia: String(motivoAusencia) });
}

/**
 * ⚠⚠ ZERO NÃO É RESPOSTA PARA VALOR MONETÁRIO APURADO DE BASE — e aqui isso não é preciosismo.
 *
 * `CalculoFiscal.calcularApuracaoParaCompetencia` GRAVA `fs12Manual: fs12`, com
 * `fs12 = circular?.fs12Manual != null ? Number(...) : 0`. Ou seja: toda empresa que passou por
 * aquele caminho sem folha digitada tem **um zero fabricado** guardado no banco, indistinguível de
 * um zero informado pelo contador. O mesmo caminho grava `fatorR: 0` quando `rb12` é 0.
 *
 * Ler esse zero como fato faria o planejamento repetir, num PDF que circula, o erro que ele existe
 * para impedir. Por isso `0` é tratado como NÃO APURADO em toda base monetária — e quem realmente
 * tem folha zero digita zero na tela, que aceita.
 */
export function valorMonetario(bruto, origem, motivoSeAusente) {
  const n = Number(bruto);
  if (bruto === null || bruto === undefined || !Number.isFinite(n) || n <= 0) {
    return ausente(motivoSeAusente);
  }
  return apurado(Math.round(n * 100) / 100, origem);
}

/**
 * A primeira fonte que responder. Cada candidata é `{ campo }` já montado — a ordem É a hierarquia
 * de autoridade, e ela fica escrita no chamador, não escondida aqui.
 */
export function primeiraFonteQueResponde(candidatas, motivoSeNenhuma) {
  for (const c of candidatas) {
    if (c && c.apurado) return c;
  }
  return ausente(motivoSeNenhuma);
}

/** "2026-06" → "06/2026". Rótulo de origem, não conta. */
export function competenciaBr(competencia) {
  const m = String(competencia || "").match(/^(\d{4})-(\d{2})$/);
  return m ? `${m[2]}/${m[1]}` : String(competencia || "");
}

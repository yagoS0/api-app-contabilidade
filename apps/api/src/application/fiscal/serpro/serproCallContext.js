// Contexto da chamada ao SERPRO: quem disparou, de onde, e se é para passar por cima do teto.
//
// POR QUE AsyncLocalStorage E NÃO UM PARÂMETRO
// A trava vive no ponto único por onde TODAS as chamadas passam (`SerproHttpClient.request`), e ele
// está a 3–4 saltos de quem sabe o usuário e a origem: rota → serviço de fechamento → serviço
// PGDAS → client. Enfiar um `contexto` em cada assinatura no caminho significaria mudar 21 pontos
// de chamada e, pior, deixar a trava dependente de alguém LEMBRAR de passar o parâmetro numa
// chamada nova — que é exatamente como uma guarda de custo morre.
//
// Aqui o contexto viaja sozinho. Chamada sem contexto (worker, script) simplesmente não tem
// usuário nem override — e continua sendo registrada e travada normalmente, que é o padrão seguro.

import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage();

/**
 * Roda `fn` com o contexto ativo para todas as chamadas SERPRO feitas dentro dela.
 * @param {{origem?: string, userId?: string, forcar?: boolean}} contexto
 */
export function comContextoSerpro(contexto, fn) {
  return store.run({ ...contexto }, fn);
}

/** Contexto atual, ou objeto vazio fora de um `comContextoSerpro`. */
export function contextoSerproAtual() {
  return store.getStore() || {};
}

/**
 * Quem pode furar o teto diário de consultas pagas: **ADMIN, e só pedindo explicitamente**
 * (`?forcar=1`).
 *
 * As duas condições importam. Sem o pedido explícito, todo ADMIN passaria sempre e o teto viraria
 * decoração; sem o papel, qualquer um contornaria a guarda pela URL. O uso fica gravado em
 * `serpro_chamadas.forcado` com o usuário — teto que se fura sem deixar rastro não protege nada.
 *
 * Mora aqui, e não em cada arquivo de rota, porque a regra tem que ser a MESMA nas quatro rotas que
 * gastam; duas cópias divergiriam e uma delas ficaria mais frouxa.
 */
export function podeForcarSerpro(req) {
  const papel = String(req?.auth?.user?.role || "").toLowerCase();
  return papel === "admin" && String(req?.query?.forcar || "") === "1";
}

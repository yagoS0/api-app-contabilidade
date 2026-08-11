import { prisma } from "../../infrastructure/db/prisma.js";
import { derivarAnalitica, resumirDerivacao } from "./lib/derivacaoAnalitica.js";

/**
 * A LIGAÇÃO entre a regra (pura, em `lib/derivacaoAnalitica.js`) e o banco.
 *
 * Aqui não mora regra nenhuma — mora só quem carregar, o que comparar com o quê e o que gravar.
 * A pergunta "esta conta é sintética?" tem UMA resposta, e ela está no módulo puro.
 *
 * ⚠ UM ESCOPO POR VEZ, SEMPRE. O `where` com `portalClientId` fixo é o que garante que a comparação
 * não cruza planos: global (`null`) com global, empresa com a própria. Quem chamar isto com um
 * filtro mais largo quebra a única invariante que o módulo puro não tem como defender sozinho.
 */

/**
 * Recalcula `analitica` de TODAS as contas de UM escopo, a partir dos `codigoCompleto` daquele
 * escopo. Idempotente: só escreve nas contas cuja resposta mudou.
 *
 * @param {string|null} portalClientId — `null` = escopo global
 * @param {{ tx?: object }} [opts]
 * @returns {Promise<{total:number, analiticas:number, sinteticas:number, semResposta:number, atualizadas:number}>}
 */
export async function rederivarAnaliticaDoEscopo(portalClientId, { tx } = {}) {
  const db = tx || prisma;
  const contas = await db.chartOfAccount.findMany({
    where: { portalClientId: portalClientId ?? null },
    select: { id: true, codigo: true, codigoCompleto: true, analitica: true },
  });

  // `derivarAnalitica` preserva a ordem, então o índice casa com a conta original.
  const derivadas = derivarAnalitica(contas);

  // ⚠ Só escreve quem MUDOU, e NUNCA escreve `null` por cima de resposta existente: `analitica`
  // nula é "não sei", e um recálculo que apagasse o que já se sabia seria a ausência engolindo
  // a resposta.
  const paraAnalitica = [];
  const paraSintetica = [];
  derivadas.forEach((derivada, i) => {
    const anterior = contas[i].analitica;
    if (derivada.analitica === true && anterior !== true) paraAnalitica.push(contas[i].id);
    if (derivada.analitica === false && anterior !== false) paraSintetica.push(contas[i].id);
  });

  if (paraAnalitica.length) {
    await db.chartOfAccount.updateMany({ where: { id: { in: paraAnalitica } }, data: { analitica: true } });
  }
  if (paraSintetica.length) {
    await db.chartOfAccount.updateMany({ where: { id: { in: paraSintetica } }, data: { analitica: false } });
  }

  return {
    ...resumirDerivacao(derivadas),
    atualizadas: paraAnalitica.length + paraSintetica.length,
  };
}

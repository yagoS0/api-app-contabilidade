/**
 * DERIVAÇÃO SINTÉTICA × ANALÍTICA — módulo PURO (sem prisma, sem I/O).
 *
 * A regra, uma frase: **uma conta é SINTÉTICA quando existe outro código completo, MAIS LONGO, que
 * começa com o dela.** É a definição de conta-mãe num plano de contas hierárquico: ela existe para
 * agregar as filhas, e lançar nela é lançar num total.
 *
 * ⚠ A COMPARAÇÃO É SÓ DENTRO DO MESMO ESCOPO — global com global, empresa com a própria. Cruzar
 * escopos afirmaria parentesco entre planos diferentes: o `111010001` do plano global não é filho
 * do `1` que uma empresa cadastrou por conta própria, ainda que a string diga que sim. Quem chama
 * passa UMA lista, de UM escopo; o módulo não sabe o que é escopo e por isso não tem como errar
 * isso sozinho.
 *
 * ⚠ AUSÊNCIA NUNCA É RESPOSTA. Conta sem `codigoCompleto` sai com `analitica: null`, nunca `false`:
 * `false` afirmaria que ela é sintética, e o que se sabe dela é nada. Conta que ainda não foi
 * reimportada não tem resposta — e é isso que o `null` diz.
 *
 * ⚠ O ERRO POSSÍVEL TEM DIREÇÃO, e é a direção segura. Comparar dentro de um conjunto MENOR (o
 * plano próprio de uma empresa, que pode ter a mãe sem as filhas) só encontra MENOS filhas, então
 * só produz MENOS sintéticas — no limite, marca como analítica uma conta que é mãe. Isso mantém a
 * conta na sugestão, que é o estado de hoje. O erro contrário — marcar de sintética uma analítica
 * em uso — é o que tiraria da lista uma conta que o contador usa, e ele não é alcançável por
 * conjunto pequeno.
 *
 * ⚠ A COMPARAÇÃO É PELO CÓDIGO **COMPLETO**, NUNCA PELO REDUZIDO. No arquivo real 42 códigos
 * existem nas duas colunas e 41 apontam para contas diferentes (`"5"` reduzido é CAIXA - MATRIZ;
 * `"5"` completo é (-) IRPJ/CSLL). Derivar do reduzido não dá erro nenhum — dá a resposta errada
 * em silêncio.
 */

/** Normaliza o código completo para comparação: string sem espaços. Vazio vira `null`. */
export function normalizarCodigoCompleto(valor) {
  const texto = String(valor ?? "").trim();
  return texto === "" ? null : texto;
}

/**
 * O conjunto de códigos completos conhecidos NAQUELE escopo — a única base de comparação.
 * @param {Array<{codigoCompleto?: string|null}>} contas
 * @returns {Set<string>}
 */
export function conjuntoDeCodigosCompletos(contas) {
  const set = new Set();
  for (const conta of contas || []) {
    const codigo = normalizarCodigoCompleto(conta?.codigoCompleto);
    if (codigo) set.add(codigo);
  }
  return set;
}

/**
 * É sintética? — existe, no conjunto, outro código MAIS LONGO que começa com este.
 *
 * ⚠ `o.length > codigo.length` também é o que exclui o próprio código da comparação: nenhum código
 * é mais longo que ele mesmo. Sem essa condição toda conta seria mãe de si.
 *
 * @param {string|null} codigoCompleto
 * @param {Set<string>|Iterable<string>} conjunto
 * @returns {boolean|null} `null` quando não há código completo — ausência não é resposta.
 */
export function ehSintetica(codigoCompleto, conjunto) {
  const codigo = normalizarCodigoCompleto(codigoCompleto);
  if (!codigo) return null;
  for (const outro of conjunto || []) {
    if (outro.length > codigo.length && outro.startsWith(codigo)) return true;
  }
  return false;
}

/**
 * Deriva `analitica` para cada conta de UM escopo.
 *
 * @param {Array<{codigo?: string, codigoCompleto?: string|null}>} contas — todas do MESMO escopo
 * @returns {Array<{codigo?: string, codigoCompleto: string|null, analitica: boolean|null}>}
 */
export function derivarAnalitica(contas) {
  const lista = Array.isArray(contas) ? contas : [];
  const conjunto = conjuntoDeCodigosCompletos(lista);
  return lista.map((conta) => {
    const codigoCompleto = normalizarCodigoCompleto(conta?.codigoCompleto);
    const sintetica = ehSintetica(codigoCompleto, conjunto);
    return {
      ...conta,
      codigoCompleto,
      // sintética = NÃO analítica; sem código completo, nem uma coisa nem outra.
      analitica: sintetica === null ? null : !sintetica,
    };
  });
}

/**
 * Resumo para o relatório do import — quantas de cada, e quantas ficaram sem resposta.
 * @param {Array<{analitica: boolean|null}>} derivadas
 */
export function resumirDerivacao(derivadas) {
  const lista = Array.isArray(derivadas) ? derivadas : [];
  return {
    total: lista.length,
    analiticas: lista.filter((c) => c.analitica === true).length,
    sinteticas: lista.filter((c) => c.analitica === false).length,
    semResposta: lista.filter((c) => c.analitica == null).length,
  };
}

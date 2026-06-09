// Q15.5 — Detecção de disparidade entre a atividade escolhida e o que o cadastro
// (CNAE) / a classificação das notas sugerem. NUNCA bloqueia — só avisa.

import { prisma } from "../../../../infrastructure/db/prisma.js";

/**
 * Compara as atividades escolhidas com o tipoReceita sugerido pelo CNAE principal
 * e pela classificação das notas. Retorna lista de avisos (não impeditivos).
 *
 * @param {Object} opts
 * @param {string} opts.portalClientId
 * @param {Array}  opts.atividadesEscolhidas — [{ idAtividade, tipoReceita, anexoImplicito, ... }]
 * @param {Object} [opts.receitaPorTipo]     — { TIPO: valor } da classificação das notas
 * @returns {Promise<Array<{ tipo, severidade, descricao }>>}
 */
export async function detectarDisparidades({ portalClientId, atividadesEscolhidas = [], receitaPorTipo = {} }) {
  const avisos = [];

  // 1. CNAE principal sugere um tipoReceita?
  const cadastro = await prisma.cadastroFiscal.findUnique({
    where: { portalClientId },
    select: { cnaePrincipal: true },
  });
  let tipoSugeridoCnae = null;
  if (cadastro?.cnaePrincipal) {
    const ref = await prisma.cnaeAnexo.findUnique({
      where: { cnae: cadastro.cnaePrincipal },
      select: { tipoReceitaSugerido: true, ambiguo: true, descricao: true },
    });
    if (ref && !ref.ambiguo) tipoSugeridoCnae = ref.tipoReceitaSugerido;
  }

  const tiposEscolhidos = new Set(
    atividadesEscolhidas.map((a) => a.tipoReceita).filter(Boolean)
  );

  // 2. Disparidade CNAE × atividade escolhida
  if (tipoSugeridoCnae && tiposEscolhidos.size > 0 && !tiposEscolhidos.has(tipoSugeridoCnae)) {
    avisos.push({
      tipo: "ATIVIDADE_DIVERGE_CNAE",
      severidade: "WARN",
      descricao: `O CNAE principal sugere "${tipoSugeridoCnae}", mas nenhuma atividade ` +
        `escolhida corresponde. Confirme se o enquadramento está correto.`,
    });
  }

  // 3. Receita classificada nas notas que não tem atividade escolhida
  for (const [tipo, valor] of Object.entries(receitaPorTipo)) {
    if (Number(valor) <= 0) continue;
    if (tipo === "RECEITA_NAO_CLASSIFICADA") continue;
    if (!tiposEscolhidos.has(tipo)) {
      avisos.push({
        tipo: "RECEITA_SEM_ATIVIDADE",
        severidade: "INFO",
        descricao: `Há receita classificada como "${tipo}" (R$ ${Number(valor).toFixed(2)}) ` +
          `sem atividade correspondente no fechamento. Verifique a segregação.`,
      });
    }
  }

  return avisos;
}

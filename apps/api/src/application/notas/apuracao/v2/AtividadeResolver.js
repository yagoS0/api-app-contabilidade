// Q15.2 — Resolve atividades do PGDAS-D a partir da classificação das notas.
//
// Converte a receita classificada (tipoReceita + flagExportacao) nas
// `atividades[]` que vão no payload TRANSDECLARACAO11. O contador pode ajustar
// no modal; este service só monta o DEFAULT a partir das notas.

import { prisma } from "../../../../infrastructure/db/prisma.js";

const ANEXOS_VALIDOS = new Set(["I", "II", "III", "IV", "V"]);

/**
 * Carrega o de-para vigente (idAtividade) indexado por (tipoReceita, mercado).
 */
export async function carregarAtividades(dataReferencia = new Date()) {
  const linhas = await prisma.atividadePgdasd.findMany({
    where: {
      vigenciaInicio: { lte: dataReferencia },
      OR: [{ vigenciaFim: null }, { vigenciaFim: { gte: dataReferencia } }],
    },
    orderBy: { vigenciaInicio: "desc" },
  });
  // index por tipoReceita+mercado (vigência mais recente vence)
  const map = new Map();
  for (const a of linhas) {
    const key = `${a.tipoReceita || "?"}|${a.mercado}`;
    if (!map.has(key)) map.set(key, a);
  }
  return { linhas, map };
}

/**
 * Monta atividades default a partir da receita segregada por tipo+mercado.
 *
 * @param {Object} opts
 * @param {Object} opts.receitaPorTipoMercado — { "SERVICO_FATOR_R|INTERNO": 1000, ... }
 * @param {Date}   opts.dataReferencia
 * @returns {Promise<{atividades, semMapeamento}>}
 *   atividades = [{ idAtividade, descricao, anexoImplicito, mercado, sujeitoFatorR,
 *                   tipoReceita, valorInterno, valorExterno }]
 *   semMapeamento = [{ tipoReceita, mercado, valor }] — receita sem idAtividade (pendência)
 */
export async function montarAtividadesDefault({ receitaPorTipoMercado, dataReferencia = new Date() }) {
  const { map } = await carregarAtividades(dataReferencia);
  const porId = new Map(); // idAtividade → atividade agregada
  const semMapeamento = [];

  for (const [chave, valor] of Object.entries(receitaPorTipoMercado || {})) {
    const v = Number(valor) || 0;
    if (v <= 0) continue;
    const [tipoReceita, mercado] = chave.split("|");
    const atv = map.get(`${tipoReceita}|${mercado}`);
    if (!atv) {
      semMapeamento.push({ tipoReceita, mercado, valor: v });
      continue;
    }
    const existing = porId.get(atv.idAtividade) || {
      idAtividade: atv.idAtividade,
      descricao: atv.descricao,
      anexoImplicito: atv.anexoImplicito,
      mercado: atv.mercado,
      sujeitoFatorR: atv.sujeitoFatorR,
      tipoReceita: atv.tipoReceita,
      valorInterno: 0,
      valorExterno: 0,
    };
    if (mercado === "EXTERNO") existing.valorExterno += v;
    else existing.valorInterno += v;
    porId.set(atv.idAtividade, existing);
  }

  // arredonda
  const atividades = [...porId.values()].map((a) => ({
    ...a,
    valorInterno: +a.valorInterno.toFixed(2),
    valorExterno: +a.valorExterno.toFixed(2),
  }));
  return { atividades, semMapeamento };
}

export { ANEXOS_VALIDOS };

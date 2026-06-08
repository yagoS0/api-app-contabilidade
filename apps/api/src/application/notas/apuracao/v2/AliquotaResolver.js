// Q14.3.a — Resolve a faixa de alíquota Simples Nacional para
// (anexo, RBT12, dataReferencia).
//
// Versionado por vigência: dataReferencia decide qual versão da tabela
// AliquotaSimplesNacional usar (LC 155/16, Reforma Tributária, etc).
//
// Falha explicitamente quando não há vigência cobrindo a data — JAMAIS
// usa "última conhecida" silenciosamente (regra do plano: nada chutado).

import { prisma } from "../../../../infrastructure/db/prisma.js";

const ANEXOS_VALIDOS = new Set(["I", "II", "III", "IV", "V"]);

export class AliquotaResolverError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * @param {Object} opts
 * @param {"I"|"II"|"III"|"IV"|"V"} opts.anexo
 * @param {number|string} opts.rbt12 — receita bruta 12 meses
 * @param {Date} opts.dataReferencia — data da competência (1º dia do mês)
 * @returns {Promise<{anexo, faixa, rbt12Min, rbt12Max, aliquotaNominal, parcelaDeduzir, vigenciaInicio, vigenciaFim}>}
 */
export async function resolverAliquota({ anexo, rbt12, dataReferencia }) {
  if (!ANEXOS_VALIDOS.has(anexo)) {
    throw new AliquotaResolverError("INVALID_ANEXO", `Anexo inválido: ${anexo}`);
  }
  const rbt12Num = Number(rbt12);
  if (!Number.isFinite(rbt12Num) || rbt12Num < 0) {
    throw new AliquotaResolverError("INVALID_RBT12", `RBT12 inválido: ${rbt12}`);
  }
  if (!(dataReferencia instanceof Date) || isNaN(dataReferencia.getTime())) {
    throw new AliquotaResolverError("INVALID_DATA", "dataReferencia deve ser Date válido");
  }

  // Busca vigência ativa pra essa data
  const linhas = await prisma.aliquotaSimplesNacional.findMany({
    where: {
      anexo,
      vigenciaInicio: { lte: dataReferencia },
      OR: [
        { vigenciaFim: null },
        { vigenciaFim: { gte: dataReferencia } },
      ],
    },
    orderBy: [{ vigenciaInicio: "desc" }, { faixa: "asc" }],
  });
  if (linhas.length === 0) {
    throw new AliquotaResolverError("NO_VIGENCIA",
      `Sem alíquota cadastrada pra ${anexo} em ${dataReferencia.toISOString().slice(0, 10)}. ` +
      `Cadastre AliquotaSimplesNacional pra essa vigência.`);
  }

  // Pega só linhas da vigência mais recente que cobre a data
  const vigenciaInicioMaisRecente = linhas[0].vigenciaInicio;
  const linhasVigencia = linhas.filter((l) =>
    l.vigenciaInicio.getTime() === vigenciaInicioMaisRecente.getTime()
  );

  // Acima do limite máximo (R$ 4.8 mi) → desenquadramento, não há SN
  const ultimaFaixa = linhasVigencia[linhasVigencia.length - 1];
  if (rbt12Num > Number(ultimaFaixa.rbt12Max)) {
    throw new AliquotaResolverError("RBT12_ACIMA_LIMITE",
      `RBT12 ${rbt12Num.toFixed(2)} excede limite do Simples Nacional ` +
      `(R$ ${Number(ultimaFaixa.rbt12Max).toFixed(2)} no anexo ${anexo}).`,
      { rbt12: rbt12Num, limiteMax: Number(ultimaFaixa.rbt12Max) });
  }

  // Acha faixa: rbt12Min <= RBT12 <= rbt12Max
  const faixa = linhasVigencia.find((l) =>
    rbt12Num >= Number(l.rbt12Min) && rbt12Num <= Number(l.rbt12Max)
  );
  if (!faixa) {
    // Bug de seed (gap entre faixas) — não deveria acontecer
    throw new AliquotaResolverError("NO_FAIXA",
      `Sem faixa cadastrada cobrindo RBT12 ${rbt12Num} no anexo ${anexo}.`);
  }

  return {
    anexo: faixa.anexo,
    faixa: faixa.faixa,
    rbt12Min: Number(faixa.rbt12Min),
    rbt12Max: Number(faixa.rbt12Max),
    aliquotaNominal: Number(faixa.aliquotaNominal),
    parcelaDeduzir: Number(faixa.parcelaDeduzir),
    vigenciaInicio: faixa.vigenciaInicio,
    vigenciaFim: faixa.vigenciaFim,
  };
}

/**
 * Alíquota EFETIVA = (RBT12 × nominal − parcelaDeduzir) / RBT12
 * Quando RBT12 == 0, retorna 0 (caso recém-iniciada).
 */
export function calcularAliquotaEfetiva({ rbt12, aliquotaNominal, parcelaDeduzir }) {
  const r = Number(rbt12);
  if (!Number.isFinite(r) || r <= 0) return 0;
  const efetiva = (r * Number(aliquotaNominal) - Number(parcelaDeduzir)) / r;
  return Math.max(0, +efetiva.toFixed(6));
}

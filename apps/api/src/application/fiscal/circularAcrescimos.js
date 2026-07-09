// Módulo Fiscal (Frente B) — grava o split principal/juros/multa por tributo na circular,
// MESCLANDO com o que já existe (não sobrescreve outros tributos da mesma competência).
//
// Chamado pelos fluxos de captura/recálculo (INSS, DAS, LP) DEPOIS que a circular já foi
// upsertada, para acrescentar/atualizar apenas o(s) tributo(s) daquele fluxo.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function limpar(v) {
  return { principal: round2(v?.principal), juros: round2(v?.juros), multa: round2(v?.multa) };
}

/**
 * @param {Object} opts
 * @param {import("@prisma/client").PrismaClient|any} opts.client  prisma ou tx
 * @param {string} opts.portalClientId
 * @param {string} opts.competencia  YYYY-MM
 * @param {Object} opts.valores      { <tributo>: {principal,juros,multa}, ... }
 * @returns {Promise<Object|null>} o objeto acrescimos mesclado (ou null se a circular não existir)
 */
export async function gravarAcrescimoCircular({ client, portalClientId, competencia, valores }) {
  if (!portalClientId || !competencia || !valores || typeof valores !== "object") return null;
  const where = { portalClientId_competencia: { portalClientId: String(portalClientId), competencia: String(competencia) } };
  const atual = await client.companyMonthlyCircular.findUnique({ where, select: { acrescimos: true } }).catch(() => null);
  if (!atual) return null; // circular deve existir (o fluxo upserta antes); no-op defensivo
  const base = atual.acrescimos && typeof atual.acrescimos === "object" ? atual.acrescimos : {};
  const merged = { ...base };
  for (const [tributo, v] of Object.entries(valores)) {
    if (v == null) continue;
    merged[tributo] = limpar(v);
  }
  await client.companyMonthlyCircular.update({ where, data: { acrescimos: merged } });
  return merged;
}

// Q14.4 — Decisão mensal do Fator R (III↔V) com log auditável.
//
// Fator R = folha 12m / RBT12
//   >= 0.28 → contribui pro Anexo III
//   <  0.28 → contribui pro Anexo V
//
// É decisão MENSAL — recalculada a cada apuração com os números do mês.
// Tudo persistido em LogDecisaoFatorR (1 linha por empresa+competência)
// pra auditoria fiscal.
//
// MVP: folha12m vem manual via input (CompanyMonthlyCircular.fs12Manual).
// Q15 (futuro) integra eSocial S-1200/S-5011.

import { prisma } from "../../../../infrastructure/db/prisma.js";

const THRESHOLD = 0.28;

export class FatorRError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * Tenta resolver folha12m pra (empresa, competência):
 *   1. CompanyMonthlyCircular.fs12Manual da competência atual
 *   2. fs12Manual mais recente anterior à competência (sugestão "use o último")
 *   3. null (precisa input manual)
 */
export async function resolverFolha12m({ portalClientId, competencia }) {
  const exact = await prisma.companyMonthlyCircular.findFirst({
    where: { portalClientId, competencia, fs12Manual: { not: null } },
    select: { fs12Manual: true, fs12Origem: true },
  });
  if (exact) return { folha12m: Number(exact.fs12Manual), origem: exact.fs12Origem || "MANUAL", fonte: "competencia_atual" };

  // Última conhecida anterior à competência
  const previa = await prisma.companyMonthlyCircular.findFirst({
    where: { portalClientId, competencia: { lt: competencia }, fs12Manual: { not: null } },
    orderBy: { competencia: "desc" },
    select: { fs12Manual: true, fs12Origem: true, competencia: true },
  });
  if (previa) return {
    folha12m: Number(previa.fs12Manual), origem: previa.fs12Origem || "MANUAL",
    fonte: `sugestao_de_${previa.competencia}`,
  };
  return { folha12m: null, origem: null, fonte: null };
}

/**
 * Calcula e persiste decisão Fator R pra (empresa, competência).
 *
 * @param {Object} opts
 * @param {string} opts.portalClientId
 * @param {string} opts.competencia — YYYY-MM
 * @param {number} opts.folha12m — fonte de verdade (vem do MotorApuracao)
 * @param {number} opts.rbt12 — calculado pelo motor
 * @param {string} [opts.fonteFolha=MANUAL]
 * @returns {Promise<{fatorR, anexoDecidido, threshold, folha12m, rbt12, log}>}
 */
export async function calcularEPersistirFatorR({
  portalClientId, competencia, folha12m, rbt12, fonteFolha = "MANUAL",
}) {
  if (!portalClientId) throw new FatorRError("MISSING_PORTAL", "portalClientId obrigatório");
  if (!/^\d{4}-\d{2}$/.test(competencia)) throw new FatorRError("INVALID_COMPETENCIA", "");

  const f = Number(folha12m);
  const r = Number(rbt12);
  if (!Number.isFinite(f) || f < 0) throw new FatorRError("INVALID_FOLHA", "folha12m inválida");
  if (!Number.isFinite(r) || r < 0) throw new FatorRError("INVALID_RBT12", "rbt12 inválido");

  const fatorR = r > 0 ? +(f / r).toFixed(4) : 0;
  const anexoDecidido = fatorR >= THRESHOLD ? "III" : "V";

  // Upsert log (1 por empresa+competência)
  const existing = await prisma.logDecisaoFatorR.findUnique({
    where: { portalClientId_competencia: { portalClientId, competencia } },
  });
  const data = {
    folha12m: f, rbt12: r, fatorR, threshold: THRESHOLD,
    anexoDecidido, fonteFolha,
  };
  const log = existing
    ? await prisma.logDecisaoFatorR.update({ where: { id: existing.id }, data })
    : await prisma.logDecisaoFatorR.create({ data: { ...data, portalClientId, competencia } });

  return { fatorR, anexoDecidido, threshold: THRESHOLD, folha12m: f, rbt12: r, log };
}

/**
 * Lista histórico de decisões (últimos N meses) — útil pra UI.
 */
export async function listarHistoricoFatorR({ portalClientId, limit = 12 } = {}) {
  return prisma.logDecisaoFatorR.findMany({
    where: { portalClientId },
    orderBy: { competencia: "desc" },
    take: limit,
  });
}

export { THRESHOLD };

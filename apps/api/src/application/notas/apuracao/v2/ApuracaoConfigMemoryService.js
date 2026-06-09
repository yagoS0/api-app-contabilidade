// Q15.4 — Memória da última configuração de apuração por empresa.
//
// Sempre que uma apuração é salva/transmitida, a config usada (atividades
// escolhidas, folha série, regime) é gravada. Na próxima competência, o modal
// de fechamento reabre pré-preenchido com a última config. Mesmo padrão do
// AccountingHistorico (memória de D/C).

import { prisma } from "../../../../infrastructure/db/prisma.js";

/**
 * Salva (upsert) a última config de apuração da empresa.
 * @param {Object} opts
 * @param {string} opts.portalClientId
 * @param {Array}  opts.atividadesEscolhidas
 * @param {Array}  [opts.folhaMensal12]  — série de 12 meses [{ pa, valor }]
 * @param {string} [opts.regimeApuracao]
 * @param {Object} [opts.flags]
 * @param {string} [opts.userId]
 */
export async function salvarConfigMemory({
  portalClientId, atividadesEscolhidas, folhaMensal12, regimeApuracao, flags, userId,
}) {
  if (!portalClientId) return null;
  const data = {
    atividadesEscolhidas: atividadesEscolhidas ?? [],
    folhaMensal12: folhaMensal12 ?? null,
    regimeApuracao: regimeApuracao ?? null,
    flags: flags ?? null,
    atualizadoEm: new Date(),
    atualizadoPor: userId ?? null,
  };
  const existing = await prisma.apuracaoConfigMemory.findUnique({ where: { portalClientId } });
  return existing
    ? prisma.apuracaoConfigMemory.update({ where: { portalClientId }, data })
    : prisma.apuracaoConfigMemory.create({ data: { ...data, portalClientId } });
}

/**
 * Lê a última config conhecida da empresa (ou null).
 * @returns {Promise<{atividadesEscolhidas, folhaMensal12, regimeApuracao, flags, atualizadoEm}|null>}
 */
export async function lerConfigMemory({ portalClientId }) {
  if (!portalClientId) return null;
  return prisma.apuracaoConfigMemory.findUnique({ where: { portalClientId } });
}

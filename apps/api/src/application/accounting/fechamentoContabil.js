// Q18: fechamento contábil — utilitário compartilhado.
// Uma competência está FECHADA quando CompanyMonthlyCircular.fechadoContabilEm != null.
// Mês fechado bloqueia novos lançamentos e upload/registro de guias naquele mês.
import { prisma } from "../../infrastructure/db/prisma.js";

// Transaction-scoped serialization fence shared by document persistence and the
// actual close/reopen commands. The tenant exists even before its first circular.
// A row lock alone/advisory lock is insufficient under Serializable: its snapshot
// may predate the wait. This unchanged non-key value creates a tuple version, so
// a stale Serializable contender aborts instead of closing against an old view.
// No business value (including updatedAt) changes; FK inserts remain compatible
// with the NO KEY UPDATE lock. Always call inside the caller's transaction.
export async function bloquearFechamentoContabil(tx, portalClientId) {
  let count;
  try {
    count = await tx.$executeRaw`UPDATE "PortalClient" SET "razao" = "razao" WHERE "id" = ${String(portalClientId)}`;
  } catch (error) {
    if (['40001', '40P01'].includes(error?.meta?.code)) {
      throw Object.assign(new Error('A base mudou durante o fechamento. Atualize e confira novamente.', { cause: error }), { code: 'P2034', status: 409 });
    }
    throw error;
  }
  if (count !== 1) throw Object.assign(new Error('Empresa não encontrada para proteger o fechamento.'), { code: 'CLIENT_NOT_FOUND', status: 404 });
}

export async function isMonthClosed(portalClientId, competencia, client = prisma) {
  if (!portalClientId || !competencia) return false;
  const circ = await client.companyMonthlyCircular.findUnique({
    where: { portalClientId_competencia: { portalClientId: String(portalClientId), competencia: String(competencia) } },
    select: { fechadoContabilEm: true },
  });
  return Boolean(circ?.fechadoContabilEm);
}

/**
 * ⚠ A MESMA PERGUNTA, PARA VÁRIAS COMPETÊNCIAS DE UMA VEZ.
 *
 * Existe porque a fila de conferência precisa dizer, **antes do clique**, quais linhas não poderão
 * ser contabilizadas — e uma tela de 50 linhas faria 50 chamadas a `isMonthClosed`. O precedente
 * está registrado em `apps/api/CLAUDE.md`: *"Pré-voo no GET (…): a tela lê o que já foi buscado
 * ANTES do POST. A resposta do POST chegaria tarde demais."*
 *
 * ⚠⚠ ELA MORA AQUI, COLADA NA IRMÃ, E NÃO NO CONSUMIDOR. São duas leituras da mesma coluna, e
 * separá-las em arquivos diferentes é como as quatro cópias do filtro de envio de guia divergiram.
 * Juntas, quem mudar o critério de "fechada" vê as duas na mesma tela. Há teste exigindo que
 * concordem.
 *
 * ⚠ `isMonthClosed` NÃO foi reescrita para delegar a esta: ela tem dezenas de chamadores em
 * caminhos críticos (baixa, DELETE, guia, parcela), e trocar a query deles não é assunto da fila.
 *
 * @returns {Promise<Set<string>>} só as competências FECHADAS. Competência sem circular não está
 *   no conjunto — sem linha não há fechamento, que é a mesma resposta de `isMonthClosed`.
 */
export async function competenciasFechadas(portalClientId, competencias, client = prisma) {
  const alvo = [...new Set((competencias || []).filter(Boolean).map(String))];
  if (!portalClientId || !alvo.length) return new Set();
  const linhas = await client.companyMonthlyCircular.findMany({
    where: { portalClientId: String(portalClientId), competencia: { in: alvo } },
    select: { competencia: true, fechadoContabilEm: true },
  });
  return new Set(linhas.filter((l) => l.fechadoContabilEm).map((l) => l.competencia));
}

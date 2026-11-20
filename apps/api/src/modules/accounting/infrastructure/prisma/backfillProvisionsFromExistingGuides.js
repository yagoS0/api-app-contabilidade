import { prisma } from '../../../../infrastructure/db/prisma.js';
import { bloquearFechamentoContabil, isMonthClosed } from '../../../../application/accounting/fechamentoContabil.js';
import { generateProvisionsFromGuide } from '../../../../application/accounting/GuideToProvisionService.js';
import { TIPOS_BACKFILL } from '../../domain/backfillDeProvisoes.js';

export function criarPortasBackfill(db = prisma) {
  return {
    listar: ({ portalClientId, competencia }) => db.guide.findMany({
      where: { portalClientId, competencia, status: 'PROCESSED', tipo: { in: TIPOS_BACKFILL }, parcelamentoId: null, accountingEntries: { none: {} } },
      select: { id: true, portalClientId: true, competencia: true, updatedAt: true },
      take: 500, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    }),
    emTransacao: executar => db.$transaction(tx => executar({
      bloquear: portalClientId => bloquearFechamentoContabil(tx, portalClientId),
      ler: (id, portalClientId) => tx.guide.findFirst({ where: { id, portalClientId }, include: { accountingEntries: { select: { id: true } } } }),
      mesFechado: (portalClientId, competencia) => isMonthClosed(portalClientId, competencia, tx),
      gerar: guideId => generateProvisionsFromGuide({ guideId, tx }),
    }), { isolationLevel: 'Serializable', timeout: 30000 }),
  };
}

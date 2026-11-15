import { prisma } from '../../../../infrastructure/db/prisma.js';
import { evidenciaCircular445, evidenciaLancamento445 } from '../../domain/evidenciasConciliacaoDas445.js';
export function criarLeiturasContabeis445(db = prisma) {
  return {
    async circular({ companyId, competencia, limit }) {
      const row = await db.companyMonthlyCircular.findUnique({ where: { portalClientId_competencia: { portalClientId: companyId, competencia } },
        select: { id: true, competencia: true, dasTotal: true, dasNumeroDocumento: true, metadata: true,
          fechadoContabilEm: true, updatedAt: true, hasAccountingDivergence: true } });
      return { items: row ? [evidenciaCircular445(row)] : [], truncated: false, limit, lacunas: [] };
    },
    async lancamentos({ companyId, competencia, guias, limit }) {
      const rows = await db.accountingEntry.findMany({ where: { portalClientId: companyId, competencia,
        OR: [{ sourceGuideId: { in: guias.map(g => g.id) } }, { sourceGuideId: null, parcelamentoId: null,
          OR: [{ subtipo: { in: ['SIMPLES','DAS'] } }, { eventType: 'DAS_SIMPLES' }] }] },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: limit + 1,
        select: { id: true, competencia: true, circularId: true, sourceGuideId: true, tipo: true, status: true, openEntryId: true, updatedAt: true,
          lines: { orderBy: [{ ordem: 'asc' }, { id: 'asc' }], take: limit + 1, select: { id: true, tipo: true, valor: true, tipoLinha: true } } } });
      return { items: rows.slice(0, limit).map(r => evidenciaLancamento445(r, guias, limit)), truncated: rows.length > limit, limit, lacunas: [] };
    },
  };
}

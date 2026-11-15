import { prisma } from '../../../../infrastructure/db/prisma.js';
import { evidenciaExecucao445 } from '../../domain/evidenciasConciliacaoDas445.js';
export function criarLeiturasOperacionais445(db = prisma) {
  return {
    async execucoes({ companyId, competencia, limit }) {
      const rows = await db.fiscalExecutionLog.findMany({ where: { portalClientId: companyId, competencia, action: 'search_guides' },
        orderBy: [{ startedAt: 'desc' }, { id: 'asc' }], take: limit + 1,
        select: { id: true, status: true, action: true, startedAt: true, completedAt: true, entriesGenerated: true, circularUpdated: true } });
      return { items: rows.slice(0, limit).map(evidenciaExecucao445), truncated: rows.length > limit, limit, lacunas: [] };
    },
    async worker({ companyId, competencia, limit }) {
      // JSON array containment filters at the database, not after a global page of companies.
      const match = { companyId, competencia };
      const rows = await db.appSetting.findMany({ where: { key: { startsWith: 'serpro_pgdasd_log:' }, AND: [{ value: { path: ['competencia'], equals: competencia } }], OR: [
        { value: { path: ['summary','results'], array_contains: [match] } },
        { value: { path: ['summary','extratoResults'], array_contains: [match] } },
      ] }, orderBy: { key: 'desc' }, take: limit + 1, select: { key: true, value: true } });
      const items = rows.slice(0, limit).flatMap(r => ['results','extratoResults'].flatMap(field =>
        (Array.isArray(r.value?.summary?.[field]) ? r.value.summary[field] : []).filter(item => item.companyId === companyId && item.competencia === competencia && !String(item.status || '').startsWith('lp_'))
          .map(item => ({ registro: r.key, grupo: field, status: ['captured','error','skipped_procuration_inactive','extrato_ja_sincronizado','extrato_ok','extrato_erro','extrato_incompleto','declaracao_nao_localizada','already_exists','skipped','aguardando_conferencia','documentos_ja_recuperados'].includes(item.status) ? item.status : 'outro_estado_local' }))));
      return { items: items.slice(0, limit), truncated: rows.length > limit || items.length > limit, limit,
        lacunas: ['RESUMO_MULTIEMPRESA_NAO_EXPOSTO', 'LOG_SEM_IDENTIDADE_COMPLETA_NAO_ASSOCIADO'] };
    },
  };
}

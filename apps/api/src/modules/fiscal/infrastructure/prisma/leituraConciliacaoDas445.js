import { prisma } from '../../../../infrastructure/db/prisma.js';
import { SERVICOS_DAS_445, evidenciaChamada445, evidenciaCache445 } from '../../domain/evidenciasConciliacaoDas445.js';

const page = (rows, limit, map = x => x) => ({ items: rows.slice(0, limit).map(map), truncated: rows.length > limit, limit, lacunas: [] });
export function criarLeiturasFiscais445(db = prisma) {
  return {
    async chamadas({ companyId, competencia, servico, limit }) {
      const rows = await db.serproChamada.findMany({ where: { portalClientId: companyId, competencia, idSistema: 'PGDASD',
        idServico: servico || { in: SERVICOS_DAS_445 } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: limit + 1,
        select: { id: true, assinatura: true, idServico: true, status: true, httpStatus: true, createdAt: true } });
      return page(rows, limit, evidenciaChamada445);
    },
    async cache(input) {
      const { chamadas, limit } = input;
      const chaves = [...new Set(chamadas.map(r => r.assinatura).filter(Boolean))];
      if (!chaves.length) return page([], limit);
      const rows = await db.serproRespostaCache.findMany({ where: { chave: { in: chaves } }, orderBy: { chave: 'asc' },
        take: limit + 1, select: { chave: true, resposta: true, expiraEm: true } });
      return page(rows, limit, r => evidenciaCache445(r, input));
    },
    async despachos({ chamadas, companyId, limit }) {
      if (!chamadas.length) return page([], limit);
      const ids = new Set(chamadas.map(r => r.id));
      const rows = await db.appSetting.findMany({ where: { key: { in: [...ids].map(id => `serpro_dispatch:${id}`) } },
        orderBy: { key: 'asc' }, take: limit + 1, select: { key: true, value: true } });
      const valid = rows.filter(r => r.value?.companyId === companyId && ids.has(r.value?.reservaId) && r.key === `serpro_dispatch:${r.value.reservaId}`);
      const result = page(valid, limit, r => ({ reservaId: r.value.reservaId, autorizadoEm: r.value.authorizedAt || null }));
      result.truncated = rows.length > limit;
      if (valid.length !== rows.length) result.lacunas.push('IDENTIDADE_DESPACHO_DIVERGENTE');
      return result;
    },
  };
}

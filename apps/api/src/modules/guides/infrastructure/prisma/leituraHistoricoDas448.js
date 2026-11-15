import { prisma } from '../../../../infrastructure/db/prisma.js';
import { confirmacaoDoEscopo448, projetarConfirmacaoHistorica448 } from '../../domain/evidenciasHistoricasDas448.js';

// No global hash/sourceFileId lookup, storage access or mutating cache helper.
export function criarLeituraHistoricoDas448(db = prisma) {
  return async function lerHistorico({ companyId, competencia, limit }) {
    const rows = await db.appSetting.findMany({ where: {
      key: { startsWith: `contabil:cliente:confirmacao:${companyId}:` },
      AND: [{ value: { path: ['companyId'], equals: companyId } },
        { value: { path: ['documento','competencia'], equals: competencia } }],
    }, orderBy: { key: 'asc' }, take: limit + 1, select: { key: true, value: true } });
    const scoped = rows.slice(0, limit).filter(r => confirmacaoDoEscopo448(r, { companyId, competencia }));
    const valid = scoped.filter(r => ['SIMPLES','DAS'].includes(r.value.documento?.tipo));
    const tipoDesconhecido = scoped.some(r => !r.value.documento?.tipo);
    const ids = [...new Set(valid.map(r => r.value.guideId))];
    const guias = ids.length ? await db.guide.findMany({ where: { portalClientId: companyId, id: { in: ids } },
      select: { id: true, hash: true, competencia: true } }) : [];
    const byId = new Map(guias.map(g => [g.id, g]));
    const documentos = await db.guide.findMany({ where: { portalClientId: companyId, competencia,
      tipo: { in: ['SIMPLES','DAS'] }, parcelamentoId: null, parcela: { is: null },
      OR: [{ sourceFileId: null }, { NOT: { sourceFileId: { startsWith: 'PARC-' } } }] },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: limit + 1,
      select: { id: true, extracted: true } });
    return { items: valid.map(r => projetarConfirmacaoHistorica448(r, byId.get(r.value.guideId))),
      documentos: documentos.slice(0, limit).map(g => ({ id: g.id,
        revisaoAnteriorRegistrada: g.extracted?.recalculoGuia?.guiaId === g.id
          && typeof g.extracted.recalculoGuia.recalculadoEm === 'string'
          && Number.isFinite(Date.parse(g.extracted.recalculoGuia.recalculadoEm)) })),
      truncated: rows.length > limit || documentos.length > limit, limit,
      lacunas: ['HISTORICO_NAO_POSSUI_TOMBSTONE_GERAL', 'CONFIRMACOES_SEM_COMPETENCIA_DOCUMENTAL_NAO_ASSOCIAVEIS',
        ...(tipoDesconhecido ? ['TIPO_HISTORICO_NAO_ASSOCIAVEL_A_DAS'] : []),
        ...(scoped.length !== Math.min(rows.length, limit) ? ['IDENTIDADE_HISTORICA_INCONSISTENTE'] : [])] };
  };
}

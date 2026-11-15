import { prisma } from '../../../../infrastructure/db/prisma.js';
import { evidenciaGuia445 } from '../../domain/evidenciasConciliacaoDas445.js';
import { versaoPagamentoGuia } from '../../../../application/guides/ConfirmacaoPagamentoClienteService.js';
const page = (rows, limit, map = x => x) => ({ items: rows.slice(0, limit).map(map), truncated: rows.length > limit, limit, lacunas: [] });
export function criarLeiturasGuias445(db = prisma) {
  return {
    async guias({ companyId, competencia, documentoId, servico, limit }) {
      const rows = await db.guide.findMany({ where: { portalClientId: companyId, competencia, tipo: { in: ['SIMPLES','DAS'] },
        parcelamentoId: null, parcela: { is: null }, OR: [{ sourceFileId: null }, { NOT: { sourceFileId: { startsWith: 'PARC-' } } }],
        ...(documentoId ? { id: documentoId } : {}) }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: limit + 1,
        select: { id: true, portalClientId: true, tipo: true, parcelamentoId: true, numeroParcela: true,
          competencia: true, sourceFileId: true, hash: true, updatedAt: true, source: true,
          serproService: true, status: true, valor: true, vencimento: true, pdfBytes: true, storageKey: true, storageUrl: true,
          extracted: true, paymentStatus: true, paymentStatusSource: true, paymentConfirmedAt: true, clienteConfirmouEm: true,
          comprovantePdfFileId: true, baixada: true, lancamentoId: true } });
      const result = page(rows, limit, r => evidenciaGuia445(r, versaoPagamentoGuia(r)));
      result.recorte = { criterio: 'EMPRESA_COMPETENCIA_DOCUMENTO_OPCIONAL', servicoSolicitado: servico || null,
        filtroServicoAplicado: false };
      if (servico) result.lacunas.push('SERVICO_FISCAL_NAO_RESTRINGE_DOCUMENTOS_MENSAIS');
      return result;
    },
    async pagamentos({ companyId, guias, limit }) {
      if (!guias.length) return page([], limit);
      const ids = new Set(guias.map(g => g.id));
      const rows = await db.appSetting.findMany({ where: { key: { startsWith: `contabil:cliente:confirmacao:${companyId}:` },
        AND: [{ value: { path: ['companyId'], equals: companyId } },
          { OR: [...ids].map(id => ({ value: { path: ['guideId'], equals: id } })) }] }, orderBy: { key: 'asc' }, take: limit + 1,
        select: { key: true, value: true } });
      const valid = rows.filter(r => r.value?.companyId === companyId && ids.has(r.value?.guideId) && r.key === `contabil:cliente:confirmacao:${companyId}:${r.value.id}`);
      const stateKeys = valid.slice(0, limit).map(r => `contabil:cliente:estado:${companyId}:${r.value.id}`);
      const states = stateKeys.length ? await db.appSetting.findMany({ where: { key: { in: stateKeys } }, select: { key: true, value: true } }) : [];
      const stateByKey = new Map(states.filter(r => stateKeys.includes(r.key)).map(r => [r.key, r.value]));
      const result = page(valid, limit, r => {
        const atual = guias.find(g => g.id === r.value.guideId)?.revisao?.versaoPagamento;
        const historica = /^[a-f0-9]{64}$/i.test(r.value.versaoGuia || '') ? r.value.versaoGuia : null;
        const state = stateByKey.get(`contabil:cliente:estado:${companyId}:${r.value.id}`);
        return { id: r.value.id, guideId: r.value.guideId,
        versaoGuia: /^[a-f0-9]{64}$/i.test(r.value.versaoGuia || '') ? r.value.versaoGuia : null,
        revisaoCompativel: historica && atual ? historica === atual : null,
        origem: r.value.origem === 'CLIENTE' ? 'CLIENTE' : null,
        confirmadoEm: r.value.confirmadoEm || null, pagoEm: r.value.pagoEm || null,
        estadoBaixaNoEvento: ['PENDENTE','CONCLUIDA','SUBSTITUIDA'].includes(r.value.estadoBaixa) ? r.value.estadoBaixa : null,
        estadoAtualRegistrado: state ? { estadoBaixa: ['PENDENTE','CONCLUIDA','SUBSTITUIDA'].includes(state.estadoBaixa) ? state.estadoBaixa : null,
          revisao: Number.isInteger(state.revisao) ? state.revisao : null,
          fato: 'ESTADO_LOCAL_NAO_COMPROVA_BAIXA_CONTABIL' } : null };
      });
      result.truncated = rows.length > limit;
      result.lacunas.push('EVENTO_HISTORICO_NAO_COMPROVA_BAIXA_ATUAL_OU_REVISAO_VIGENTE');
      if (result.items.some(r => !r.estadoAtualRegistrado)) result.lacunas.push('ESTADO_SEPARADO_CONFIRMACAO_AUSENTE');
      if (valid.length !== rows.length) result.lacunas.push('IDENTIDADE_CONFIRMACAO_DIVERGENTE');
      return result;
    },
  };
}

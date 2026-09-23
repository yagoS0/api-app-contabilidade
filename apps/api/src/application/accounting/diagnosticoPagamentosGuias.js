import { carregarBaixasDasGuias, resolverPagamentoGuia } from './pagamentoGuiaEfetivo.js';

// Diagnóstico somente leitura e com empresa obrigatória. Nenhum backfill implícito.
export async function diagnosticarPagamentosGuias({ portalClientId, competencia, client }) {
  if (!portalClientId || !client) throw new Error('Informe empresa e cliente de leitura.');
  if (competencia && !/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)) throw new Error('Competência inválida.');
  const guias = await client.guide.findMany({ where: { portalClientId, paymentStatus: 'PAID',
    ...(competencia ? { competencia } : {}) }, select: {
    id: true, competencia: true, tipo: true, valor: true, valorOriginal: true,
    paymentStatus: true, paymentStatusSource: true, paymentConfirmedAt: true, extracted: true,
  } });
  const movimentos = await carregarBaixasDasGuias(client, portalClientId, guias.map(g => g.id));
  const competencias = [...new Set([...guias.map(g => g.competencia), ...movimentos.map(e => e.competencia)].filter(Boolean))];
  const circulares = competencias.length ? await client.companyMonthlyCircular.findMany({
    where: { portalClientId, competencia: { in: competencias } },
    select: { competencia: true, fechadoContabilEm: true },
  }) : [];
  const fechadas = new Set(circulares.filter(c => c.fechadoContabilEm).map(c => c.competencia));
  return guias.map(g => {
    const pagamento = resolverPagamentoGuia({ guia: g, baixas: movimentos, portalClientId });
    const ids = new Set(pagamento?.entryIds || []);
    const entradas = movimentos.filter(e => ids.has(e.id));
    return { guideId: g.id, competencia: g.competencia, tributo: g.tipo,
      valorDocumento: g.valor == null ? null : Number(g.valor),
      valorPrimeiraCaptura: g.valorOriginal == null ? null : Number(g.valorOriginal),
      pagamento, requerConferencia: !pagamento || Boolean(pagamento.pendencia || pagamento.divergencia),
      documentoDivergente: Boolean(pagamento?.divergencias?.valorGuia),
      competenciaFechada: fechadas.has(g.competencia) || entradas.some(e => fechadas.has(e.competencia)),
      possuiExportado: entradas.some(e => e.status === 'EXPORTADO'),
      estornos: movimentos.filter(e => e.tipo === 'ESTORNO' && (e.sourceGuideId === g.id || e.openEntry?.sourceGuideId === g.id)).map(e => e.id),
    };
  });
}

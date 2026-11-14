const valor = v => v == null ? null : String(v);
export function evidenciaCircular445(r) {
  return { id: r.id, competencia: r.competencia, dasTotal: valor(r.dasTotal),
    numeroDocumento: /^\d{15,25}$/.test(r.dasNumeroDocumento || r.metadata?.numeroDocumento || '') ? (r.dasNumeroDocumento || r.metadata.numeroDocumento) : null,
    fechadoContabilEm: r.fechadoContabilEm, atualizadaEm: r.updatedAt,
    divergenciaRegistrada: r.hasAccountingDivergence === true,
    metadata: { presente: r.metadata != null, origemSerpro: r.metadata?.integrationSource === 'SERPRO_PGDASD',
      servico: ['GERARDAS12','GERARDASCOBRANCA17'].includes(r.metadata?.servico) ? r.metadata.servico : null,
      referenciaCompativel: r.metadata?.referencia == null ? null : r.metadata.referencia === r.competencia } };
}
export function evidenciaLancamento445(r, guias, limit) {
  const vinculo = guias.some(g => g.id === r.sourceGuideId);
  return { id: r.id, circularId: r.circularId, sourceGuideId: vinculo ? r.sourceGuideId : null,
    associacao: vinculo ? 'SOURCE_GUIDE_ID' : 'SEM_VINCULO_DOCUMENTAL_INEQUIVOCO',
    tipo: ['PROVISAO','BAIXA','ESTORNO','DESPESA','RECEITA','OUTRO'].includes(r.tipo) ? r.tipo : null,
    status: ['RASCUNHO','CONFIRMADO','EXPORTADO'].includes(r.status) ? r.status : null,
    competencia: r.competencia, openEntryId: r.openEntryId, atualizadaEm: r.updatedAt,
    linhas: r.lines.slice(0, limit).map(l => ({ id: l.id, tipo: ['D','C'].includes(l.tipo) ? l.tipo : null,
      valor: valor(l.valor), tipoLinha: ['PRINCIPAL','PARC','JUROS','MULTA','CAIXA','CONTRAPARTIDA','TOTAL','PARC_DAS'].includes(l.tipoLinha) ? l.tipoLinha : null })),
    linhasTruncadas: r.lines.length > limit };
}
export function projetarContabilidade445(circular, lancamentos, guias) {
  const c = circular.items?.[0]; const entries = lancamentos.items || [];
  const lacunas = ['CIRCULAR_NAO_COMPROVA_PROVISAO', 'LINHAS_NAO_CERTIFICAM_CORRECAO_CONTABIL'];
  const leituraLancamentosDisponivel = Array.isArray(lancamentos.items) && !['falhou','nao_consultada'].includes(lancamentos.consulta);
  const leituraCompleta = leituraLancamentosDisponivel && !lancamentos.truncated;
  if (!leituraLancamentosDisponivel) lacunas.push('LANCAMENTOS_NAO_VERIFICAVEIS_POR_FALHA_DE_LEITURA');
  if (lancamentos.truncated) lacunas.push('LANCAMENTOS_TRUNCADOS_VINCULOS_AUSENTES_NAO_DETERMINAVEIS');
  if (!Array.isArray(circular.items) || ['falhou','nao_consultada'].includes(circular.consulta)) lacunas.push('CIRCULAR_E_FECHAMENTO_NAO_VERIFICAVEIS');
  if (leituraCompleta && !entries.length) lacunas.push('SEM_LANCAMENTO_NO_RECORTE_NAO_COMPROVA_PROVISAO_CONCLUIDA');
  if (entries.some(e => e.associacao !== 'SOURCE_GUIDE_ID')) lacunas.push('LANCAMENTO_SEM_VINCULO_DOCUMENTAL_INEQUIVOCO');
  for (const g of guias.items || []) {
    if (!entries.some(e => e.sourceGuideId === g.id && e.tipo === 'PROVISAO')) lacunas.push(`${leituraCompleta ? 'GUIA_SEM_PROVISAO_VINCULADA' : 'VINCULO_PROVISAO_NAO_VERIFICAVEL'}:${g.id}`);
  }
  if (entries.some(e => e.linhasTruncadas)) lacunas.push('LINHAS_TRUNCADAS_COMPOSICAO_CONTABIL_NAO_VERIFICAVEL');
  if (c?.divergenciaRegistrada || c?.metadata.referenciaCompativel === false) lacunas.push('DIVERGENCIA_REGISTRADA_NA_CIRCULAR');
  return { estado: c?.fechadoContabilEm ? 'Bloqueado' : c || entries.length ? 'Parcial' : 'Não verificável',
    bloqueio: c?.fechadoContabilEm ? 'COMPETENCIA_CONTABIL_FECHADA_NAO_IMPEDE_ESTA_LEITURA' : null,
    circular, lancamentos, lacunas };
}

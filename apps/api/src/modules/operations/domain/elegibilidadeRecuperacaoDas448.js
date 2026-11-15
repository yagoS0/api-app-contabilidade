// Explicit attestations belong to the supplying domains, never to consumer input.
export const PROVAS_OBRIGATORIAS_448 = Object.freeze([
  'identidadeFiscal', 'servico', 'reservaEDespacho', 'integridadePdf',
  'correlacaoRespostaTentativaDocumento', 'revisaoEHash', 'historicoDocumentalCompleto',
  'pagamentosEComprovantesCompletos', 'contabilidadeCompleta', 'fontesCompletas',
]);
export function classificarElegibilidade448({ provas = {}, bloqueios = [], lacunas = [], documentoEquivalente = false } = {}) {
  const faltantes = PROVAS_OBRIGATORIAS_448.filter(k => provas[k] !== true).map(k => `PROVA_AUSENTE:${k}`);
  const gaps = [...new Set([...lacunas, ...faltantes])].sort();
  const impedimentos = [...new Set(bloqueios)].sort();
  return { classificacao: impedimentos.length ? 'BLOQUEADO' : gaps.length ? 'NAO_VERIFICAVEL'
    : documentoEquivalente === true ? 'SEM_ALTERACAO_NECESSARIA' : 'POTENCIALMENTE_ELEGIVEL',
    bloqueios: impedimentos, lacunas: gaps, efeitosPermitidos: [],
    declaracao: 'CLASSIFICACAO_NAO_AUTORIZA_ESCRITA_RECUPERACAO_REEMISSAO_OU_DESBLOQUEIO' };
}

// Interpret only facts already exposed by the read-only 445 contracts.
export function fatosDaObservacao448(contexto, historico, documentoId) {
  const bloqueios = []; const lacunas = [];
  if (!contexto) return { bloqueios, lacunas: ['CONTEXTO_INDISPONIVEL'], provas: {} };
  const fontes = [contexto.fiscal?.chamadas, contexto.fiscal?.cache, contexto.fiscal?.despachos,
    contexto.guias?.guias, contexto.guias?.pagamentos, contexto.contabilidade?.circular,
    contexto.contabilidade?.lancamentos, historico, contexto.operacoes?.execucoes, contexto.operacoes?.worker];
  if (fontes.some(f => f?.consulta !== 'ok' || !Array.isArray(f.items))) lacunas.push('FONTE_INDISPONIVEL');
  if (fontes.some(f => f?.truncated !== false)) lacunas.push('COMPLETUDE_NAO_COMPROVADA');
  const docs = contexto.guias?.guias?.items || [];
  if (documentoId && !docs.some(g => g.id === documentoId)) lacunas.push('DOCUMENTO_NAO_LOCALIZADO_NO_ESCOPO');
  if (docs.length > 1) lacunas.push('MULTIPLAS_GUIAS_REVISAO_AMBIGUA');
  for (const r of contexto.fiscal?.chamadas?.items || []) {
    if (r.estadoLocal === 'incerta') bloqueios.push('RESERVA_INCERTA');
    if (r.estadoLocal === 'reservada') bloqueios.push('RESERVA_RESERVADA');
  }
  const caches = contexto.fiscal?.cache?.items || [];
  if (!caches.length) lacunas.push('RESPOSTA_LOCAL_NAO_OBSERVADA');
  if (caches.some(c => c.vigente !== true)) lacunas.push('RESPOSTA_LOCAL_EXPIRADA_OU_VIGENCIA_DESCONHECIDA');
  if (caches.some(c => c.pdfNaResposta !== true)) lacunas.push('PDF_NAO_IDENTIFICADO_NA_RESPOSTA_LOCAL');
  if ((contexto.fiscal?.despachos?.items || []).length === 0) lacunas.push('DESPACHO_NAO_OBSERVADO');
  if (contexto.fiscal?.despachos?.lacunas?.includes('IDENTIDADE_DESPACHO_DIVERGENTE')) bloqueios.push('IDENTIDADE_DESPACHO_DIVERGENTE');
  const assinaturas = (contexto.fiscal?.chamadas?.items || []).map(r => r.assinatura).filter(Boolean);
  if (new Set(assinaturas).size < assinaturas.length) lacunas.push('ASSINATURA_COMPARTILHADA_ENTRE_TENTATIVAS');
  for (const g of docs) {
    const p = g.pagamento || {};
    if (p.estadoLocal === 'PAID' || p.confirmadoEm || p.clienteConfirmouEm || p.referenciaComprovante || p.baixadaLocal || p.lancamentoReferenciado) bloqueios.push('PAGAMENTO_OU_VINCULO_FINANCEIRO_CONHECIDO');
    if (!g.hash || !g.revisao?.atualizadaEm) lacunas.push('REVISAO_OU_HASH_AUSENTE');
    if (!g.documento?.conteudoVerificado) lacunas.push('PDF_NAO_VALIDADO');
  }
  if (contexto.guias?.pagamentos?.items?.length || historico?.items?.length) bloqueios.push('CONFIRMACAO_PAGAMENTO_CONHECIDA');
  if (historico?.items?.some(e => e.guiaLocalizada === false)) bloqueios.push('CONFIRMACAO_ORFA');
  if (historico?.items?.some(e => e.hashDocumentalCoincidente === false)) bloqueios.push('HASH_DOCUMENTAL_DIVERGENTE');
  if (historico?.items?.some(e => e.competenciaAtualCompativel === false)) bloqueios.push('COMPETENCIA_DOCUMENTAL_DIVERGENTE');
  if (contexto.guias?.pagamentos?.items?.some(e => e.revisaoCompativel === false)) bloqueios.push('CONFIRMACAO_DE_REVISAO_ANTERIOR');
  if (historico?.documentos?.some(d => d.revisaoAnteriorRegistrada)) bloqueios.push('DOCUMENTO_SUBSTITUIDO_OU_RECALCULADO');
  if (contexto.contabilidade?.circular?.items?.some(c => c.fechadoContabilEm)) bloqueios.push('COMPETENCIA_CONTABIL_FECHADA');
  for (const e of contexto.contabilidade?.lancamentos?.items || []) {
    if (e.tipo === 'BAIXA') bloqueios.push('BAIXA_CONTABIL_CONHECIDA');
    if (e.associacao !== 'SOURCE_GUIDE_ID') lacunas.push('LANCAMENTO_SEM_VINCULO_DOCUMENTAL');
    if (e.linhasTruncadas) lacunas.push('LINHAS_TRUNCADAS');
    if (e.status === 'EXPORTADO') bloqueios.push('LANCAMENTO_EXPORTADO');
  }
  lacunas.push('IDENTIDADE_RESPOSTA_NAO_ATESTADA', 'INTEGRIDADE_PDF_NAO_ATESTADA',
    'CORRELACAO_RESPOSTA_TENTATIVA_NAO_ATESTADA', 'HISTORICO_REMOCAO_SUBSTITUICAO_INCOMPLETO',
    'EXPORTACOES_E_ENTREGA_NAO_ATESTADAS', 'UNICIDADE_HASH_SOURCE_FILE_ID_FORA_ESCOPO_NAO_CONSULTADA');
  for (const g of contexto.lacunas || []) {
    // Return only controlled reason codes, not arbitrary source text.
    if (['DOCUMENTO_GUIA_CIRCULAR_DIVERGENTE','VALOR_GUIA_CIRCULAR_DIVERGENTE'].includes(g)) bloqueios.push(g);
  }
  if (historico?.lacunas?.length) lacunas.push('HISTORICO_PARCIAL_OU_INCONSISTENTE');
  for (const motivo of ['TIPO_HISTORICO_NAO_ASSOCIAVEL_A_DAS','IDENTIDADE_HISTORICA_INCONSISTENTE']) {
    if (historico?.lacunas?.includes(motivo)) lacunas.push(motivo);
  }
  return { bloqueios, lacunas, provas: {} };
}


// Only allowlisted metadata from domain-owned read contracts. Never raw provider data.
export function resumirObservacao448({ contexto, historico }) {
  const pick = (item, keys) => Object.fromEntries(keys.map(k => [k, item[k] ?? null]));
  const source = (origem, value, project) => ({ origem, consulta: value?.consulta || 'nao_consultada',
    quantidade: value?.consulta === 'ok' && Array.isArray(value.items) ? value.items.length : null,
    limite: value?.limit ?? null, truncado: value?.truncated ?? null,
    registros: (value?.items || []).map(project) });
  return { consultadoEm: contexto?.consultadoEm ?? null, fontes: [
    source('Fiscal.chamadas445', contexto?.fiscal?.chamadas, r => pick(r, ['id','servico','estadoLocal','assinatura','registradaEm'])),
    source('Fiscal.cache445', contexto?.fiscal?.cache, r => pick(r, ['assinatura','expiraEm','vigente','interpretacao','pdfNaResposta','numeroDocumento'])),
    source('Fiscal.despachos445', contexto?.fiscal?.despachos, r => pick(r, ['reservaId','autorizadoEm'])),
    source('Guias.documentos445', contexto?.guias?.guias, g => ({ ...pick(g, ['id','sourceFileId','hash','competencia','servico','numeroDocumento']),
      revisao: pick(g.revisao || {}, ['atualizadaEm','hash','versaoPagamento']),
      documento: pick(g.documento || {}, ['bytesLocais','referenciaStorage','conteudoVerificado']),
      pagamento: pick(g.pagamento || {}, ['estadoLocal','origem','confirmadoEm','clienteConfirmouEm','referenciaComprovante','baixadaLocal','lancamentoReferenciado']) })),
    source('Guias.pagamentos445', contexto?.guias?.pagamentos, r => pick(r, ['id','guideId','revisaoCompativel','origem','confirmadoEm','estadoBaixaNoEvento'])),
    source('Guias.historico448', historico, r => pick(r, ['id','guideId','guiaLocalizada','hashDocumentalRegistrado','hashDocumentalAtual','hashDocumentalCoincidente','competenciaAtualCompativel','confirmacaoSubstituida'])),
    source('Contabilidade.circular445', contexto?.contabilidade?.circular, r => pick(r, ['id','competencia','fechadoContabilEm','atualizadaEm','divergenciaRegistrada'])),
    source('Contabilidade.lancamentos445', contexto?.contabilidade?.lancamentos, r => pick(r, ['id','sourceGuideId','associacao','tipo','status','atualizadaEm','linhasTruncadas'])),
    source('Operacoes.execucoes445', contexto?.operacoes?.execucoes, r => pick(r, ['id','status','entriesGenerated','resultadoContabil'])),
    source('Operacoes.worker445', contexto?.operacoes?.worker, r => pick(r, ['registro','grupo','status'])),
  ], registrosDocumentaisHistoricos: (historico?.documentos || []).map(r => pick(r, ['id','revisaoAnteriorRegistrada'])) };
}

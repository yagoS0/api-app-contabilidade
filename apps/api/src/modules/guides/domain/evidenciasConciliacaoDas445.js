const allowed = (v, values) => values.includes(v) ? v : null;
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/i.test(v) ? v : null;
export function evidenciaGuia445(r, versaoPagamento = null) {
  return { id: r.id, competencia: r.competencia, sourceFileId: r.sourceFileId, hash: hash(r.hash),
    revisao: { atualizadaEm: r.updatedAt, hash: hash(r.hash), versaoPagamento: hash(versaoPagamento),
      criterio: 'VERSAO_PAGAMENTO_LEGADA_NAO_TOKEN_DE_CORRECAO' },
    numeroDocumento: /^\d{15,25}$/.test(r.extracted?.numeroDocumento || '') ? r.extracted.numeroDocumento : null,
    origem: allowed(r.source, ['SERPRO','LOCAL','DRIVE','UPLOAD','MANUAL']),
    servico: allowed(r.serproService, ['GERARDAS12','GERARDASCOBRANCA17']),
    estadoLocal: allowed(r.status, ['PENDING','PROCESSING','PROCESSED','NEEDS_REVIEW','ERROR','VAZIO']),
    valor: r.valor == null ? null : String(r.valor), vencimento: r.vencimento,
    documento: { bytesLocais: Boolean(r.pdfBytes?.length), referenciaStorage: Boolean(r.storageKey || r.storageUrl),
      conteudoVerificado: false },
    pagamento: { estadoLocal: allowed(r.paymentStatus, ['OPEN','PAID','OVERDUE']),
      origem: allowed(r.paymentStatusSource, ['CLIENTE','SERPRO','MANUAL']), confirmadoEm: r.paymentConfirmedAt,
      clienteConfirmouEm: r.clienteConfirmouEm, referenciaComprovante: Boolean(r.comprovantePdfFileId),
      baixadaLocal: r.baixada === true, lancamentoReferenciado: r.lancamentoId || null },
  };
}
export function projetarGuias445(guias, pagamentos) {
  const items = guias.items || [];
  const lacunas = ['PDF_NAO_BAIXADO_NEM_VALIDADO', 'ORIGEM_DOCUMENTAL_NAO_COMPROVA_CONSULTA_SERPRO', 'ENTREGA_NAO_VERIFICADA'];
  const leituraDisponivel = Array.isArray(guias.items) && !['falhou','nao_consultada'].includes(guias.consulta);
  if (!leituraDisponivel) lacunas.push('DOCUMENTOS_NAO_VERIFICAVEIS_POR_FALHA_DE_LEITURA');
  if (leituraDisponivel && !items.length && !guias.truncated) lacunas.push('SEM_DOCUMENTO_NO_RECORTE_NAO_AUTORIZA_RETRY');
  if (guias.truncated) lacunas.push('RECORTE_DOCUMENTAL_TRUNCADO_UNICIDADE_NAO_VERIFICAVEL');
  if (items.length > 1) lacunas.push('MULTIPLAS_GUIAS_REVISAO_VIGENTE_NAO_DETERMINADA');
  if (items.some(g => g.pagamento.estadoLocal === 'PAID' && !g.pagamento.origem)) lacunas.push('PAGAMENTO_SEM_ORIGEM_VERIFICAVEL');
  if (pagamentos.items?.some(p => p.revisaoCompativel === false)) lacunas.push('CONFIRMACAO_PAGAMENTO_DE_REVISAO_ANTERIOR');
  if (!Array.isArray(pagamentos.items) || ['falhou','nao_consultada'].includes(pagamentos.consulta)) lacunas.push('HISTORICO_PAGAMENTO_NAO_VERIFICAVEL');
  if (pagamentos.truncated) lacunas.push('HISTORICO_PAGAMENTO_TRUNCADO');
  return { estado: leituraDisponivel && !guias.truncated && items.length === 1 && items[0].estadoLocal === 'PROCESSED' ? 'Confirmado pela evidência local' : items.length ? 'Parcial' : 'Não verificável',
    fatoConfirmado: items.length ? 'REGISTRO_DOCUMENTAL_LOCAL_APENAS' : null, guias, pagamentos, lacunas };
}

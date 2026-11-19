// TRANSDECLARACAO11: HTTP aceito e cálculo não comprovam transmissão.
// O contexto é o da requisição feita pelo servidor, nunca um eco do navegador.
export function classificarResultadoPgdas(raw, { indicadorTransmissao, contribuinteCnpj, competencia }) {
  let dados = raw?.dados ?? raw?.dadosSaida;
  if (typeof dados === 'string') {
    try { dados = JSON.parse(dados); } catch { dados = null; }
  }
  const declaracao = Array.isArray(dados) ? (dados.length === 1 ? dados[0] : null) : dados;
  const mensagens = Array.isArray(raw?.mensagens) ? raw.mensagens : [];
  const status = Number(raw?.status);
  const falha = (estado, code, mensagem) => ({ estado, code, mensagem, mensagens, confirmada: false });
  if (raw?.status != null && ![200, 400, 422].includes(status)) {
    return falha(indicadorTransmissao ? 'RESULTADO_INCERTO' : 'ERRO_TECNICO', 'PGDAS_RESPOSTA_INCONCLUSIVA', 'O retorno não comprova a conclusão da operação.');
  }
  const recusas = mensagens.filter(m => /^\[?(Erro|EntradaIncorreta|AcessoNegado)(-|\])/i.test(String(m?.codigo || '')));
  if ((recusas.length || [400, 422].includes(status)) && declaracao?.idDeclaracao) {
    return falha('RESULTADO_INCERTO', 'PGDAS_RESPOSTA_CONTRADITORIA', 'O retorno combina declaração e recusa. Concilie antes de repetir.');
  }
  if (recusas.length) {
    return falha('ERRO_VALIDACAO', 'SERPRO_BUSINESS_ERROR', recusas.map(m => m.texto).filter(Boolean).join(' · ') || 'Declaração recusada pelo SERPRO.');
  }
  if ([400, 422].includes(status)) {
    return falha('ERRO_VALIDACAO', 'SERPRO_BUSINESS_ERROR', mensagens.map(m => m?.texto).filter(Boolean).join(' · ') || 'Declaração recusada pelo SERPRO.');
  }
  if ((raw?.status != null && status !== 200) || !declaracao || typeof declaracao !== 'object') {
    return falha(indicadorTransmissao ? 'RESULTADO_INCERTO' : 'ERRO_TECNICO', 'PGDAS_RESPOSTA_INCONCLUSIVA', 'O retorno não comprova a conclusão da operação.');
  }
  // Os ecos não são obrigatórios no contrato, mas divergência explícita invalida o retorno.
  const cnpj = String(contribuinteCnpj || '').replace(/\D/g, '');
  const pa = String(competencia || '').replace('-', '');
  if ((declaracao.cnpjCompleto != null && String(declaracao.cnpjCompleto).replace(/\D/g, '') !== cnpj)
    || (declaracao.pa != null && String(declaracao.pa) !== pa)) {
    return falha('RESULTADO_INCERTO', 'PGDAS_IDENTIDADE_DIVERGENTE', 'O retorno não corresponde à empresa ou competência solicitada.');
  }
  if (!indicadorTransmissao) return { estado: 'SIMULACAO_CONCLUIDA', confirmada: false, mensagens };
  if (declaracao.indicadorTransmissao === false || typeof declaracao.idDeclaracao !== 'string' || !declaracao.idDeclaracao.trim()) {
    return falha('RESULTADO_INCERTO', 'PGDAS_TRANSMISSAO_NAO_COMPROVADA', 'O retorno não identifica uma declaração transmitida. Concilie antes de repetir.');
  }
  return { estado: 'TRANSMITIDA', confirmada: true, mensagens,
    evidencia: { origem: 'ALTAN', contribuinteCnpj: cnpj, competencia,
      numeroDeclaracao: declaracao.idDeclaracao,
      dataHoraTransmissao: declaracao.dataHoraTransmissao ?? null,
      protocolo: declaracao.protocolo ?? null } };
}

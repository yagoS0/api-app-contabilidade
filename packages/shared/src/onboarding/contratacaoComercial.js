const canonico = valor => JSON.stringify(valor, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);

export const POLITICA_COMERCIAL_C1 = 'COMERCIAL_2026_10_V1';
export function politicaComercial(onboarding = {}) {
  const politica = onboarding.politicaComercial;
  if (politica == null) return null;
  if (politica !== POLITICA_COMERCIAL_C1) {
    const erro = new Error('Política comercial desconhecida. Confira a versão do atendimento.');
    erro.code = 'politica_comercial_desconhecida'; erro.status = 409;
    throw erro;
  }
  return politica;
}

// A condição é declaração estruturada do gestor sobre cláusula do documento congelado.
// Não interpretamos texto livre nem acrescentamos cláusulas ao modelo aprovado.
export function condicaoFuturaValida(condicao, texto) {
  return Boolean(condicao && condicao.versao === 1 && condicao.tipo === 'PAGAMENTO_FUTURO'
    && condicao.carteiraAntesDoPagamento === true
    && typeof condicao.vencimento === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(condicao.vencimento)
    && Number.isFinite(Date.parse(condicao.vencimento))
    && new Date(condicao.vencimento).toISOString().slice(0, 10) === condicao.vencimento
    && typeof condicao.clausula === 'string' && condicao.clausula.trim().length >= 10
    && condicao.clausula.length <= 2000 && typeof texto === 'string' && texto.includes(condicao.clausula));
}
export function pagamentoFuturoDoContrato(onboarding, proposta, contrato) {
  const c = contrato?.dados?.condicaoPagamento;
  return Boolean(politicaComercial(onboarding) === POLITICA_COMERCIAL_C1
    && contratoAptoPagamento(proposta, contrato) && contrato.aprovadoEm && contrato.aprovadoPor
    && condicaoFuturaValida(c, contrato.texto) && c.propostaId === proposta.id && c.propostaVersao === proposta.versao
    && Number.isFinite(new Date(contrato.aprovadoEm).getTime()) && c.vencimento > new Date(contrato.aprovadoEm).toISOString().slice(0, 10));
}

export function aberturaConstituida(onboarding = {}) {
  return Boolean(/^\d{14}$/.test(onboarding.cnpj || '') && ['viabilidade_registro', 'cnpj_definitivo'].every(chave =>
    onboarding.etapas?.some(e => e.chave === chave && e.concluidaEm && e.concluidaPorId)));
}

export function urlCobrancaSegura(valor) {
  try {
    const u = new URL(valor);
    if (typeof valor !== 'string' || valor.length > 2000 || u.protocol !== 'https:' || u.username || u.password
      || u.port || !u.hostname.includes('.') || /^[\d.]+$/.test(u.hostname) || u.hostname.includes(':')
      || /(^|\.)(localhost|local|internal|test|invalid)$/.test(u.hostname)) return null;
    return u.href;
  } catch { return null; }
}

export function contratoCorresponde(proposta, contrato) {
  return Boolean(proposta?.status === 'ACEITA' && !proposta.revogadaEm && contrato?.propostaId === proposta.id
    && proposta.opcaoAceita && contrato.dados?.opcao?.chave === proposta.opcaoAceita);
}
export const contratoAptoPagamento = (proposta, contrato) => contratoCorresponde(proposta, contrato)
  && ['AGUARDANDO_ASSINATURA', 'ASSINADO_CONFERIDO'].includes(contrato.status);

// Conteúdo congelado, sem incluir assinatura posterior: assinar não invalida recebimento.
export function contextoContrato(proposta, contrato) {
  return canonico({ propostaId: proposta.id, propostaVersao: proposta.versao, opcaoAceita: proposta.opcaoAceita,
    snapshot: proposta.snapshot, contratoId: contrato.id, aprovadoEm: contrato.aprovadoEm,
    modeloId: contrato.modeloId, texto: contrato.texto, dados: contrato.dados });
}
export function pagamentoDoContrato(proposta, contrato, marcos = []) {
  if (!contratoAptoPagamento(proposta, contrato)) return null;
  return marcos.find(m => m.tipo === 'PAGAMENTO_HONORARIOS_CONFERIDO' && m.dados?.contratoId === contrato.id
    && (m.dados.politica === 'R35' ? Boolean(m.atorId && m.dados.confirmadoEm
      && m.dados.contextoContrato === contextoContrato(proposta, contrato)) : contrato.status === 'ASSINADO_CONFERIDO')) || null;
}

// Projeção de fatos persistidos. Legados mantêm sua política; não há backfill.
export function projetarContratacao({ onboarding = {}, propostas = [], contratos = [], marcos = [] } = {}) {
  const politica = politicaComercial(onboarding);
  const nova = politica === POLITICA_COMERCIAL_C1;
  const proposta = propostas.find(p => p.status === 'ACEITA' && !p.revogadaEm) || propostas.find(p => !p.revogadaEm);
  const corresponde = c => contratoCorresponde(proposta, c);
  const contrato = contratos.find(c => corresponde(c) && c.status === 'ASSINADO_CONFERIDO') || contratos.find(c => corresponde(c));
  const pagamento = pagamentoDoContrato(proposta, contrato, nova ? marcos.filter(m => m.dados?.politica === 'R35') : marcos);
  const ganha = Boolean(pagamento || !nova && contrato?.status === 'ASSINADO_CONFERIDO' && contrato.dados?.politicaContratacao !== 'R35');
  const pagamentoFuturo = pagamentoFuturoDoContrato(onboarding, proposta, contrato);
  const constituida = onboarding.origem !== 'ABERTURA' || aberturaConstituida(onboarding);
  const externa = marcos.find(m => m.tipo === 'CONVERTIDO' && m.dados?.contratacao?.origem === 'EXTERNA')?.dados.contratacao || null;
  return {
    proposta, contrato, pagamento, ganha, externa, politica, pagamentoFuturo,
    // C5 resolve requisitos por atividade. Capacidade não materializa execução ou entrega.
    execucaoIndependePagamento: nova,
    implantacaoPermitida: nova ? onboarding.origem !== 'PESSOA_FISICA' && constituida : ganha || Boolean(externa),
    naCarteira: onboarding.status === 'CONVERTIDO',
    carteiraPermitida: onboarding.origem !== 'PESSOA_FISICA' && (!nova || constituida)
      && contrato?.dados?.opcao?.recorrente === true && (nova ? Boolean(pagamento) || pagamentoFuturo : ganha && Boolean(pagamento))
      && (onboarding.dados?.cadastroRevisao || 0) === (proposta?.snapshot?.cadastroRevisao || 0),
    excecaoAplicavel: onboarding.origem !== 'PESSOA_FISICA' && !['CONVERTIDO', 'DESISTIU', 'CONCLUIDO_AVULSO'].includes(onboarding.status) && propostas.length === 0 && contratos.length === 0,
  };
}

export function validarContratacaoExterna(valor, versao) {
  if (!valor || typeof valor !== 'object' || valor.confirmada !== true) return 'Confirme explicitamente a contratação externa.';
  if (!Number.isInteger(valor.versao) || valor.versao !== versao) return 'A ficha mudou. Recarregue antes de registrar a contratação externa.';
  for (const [campo, nome] of [['justificativa', 'justificativa'], ['evidencia', 'evidência ou referência da contratação externa']]) {
    if (typeof valor[campo] !== 'string' || valor[campo].trim().length < 10 || valor[campo].length > 2000) return `Informe ${nome} entre 10 e 2000 caracteres.`;
  }
  return null;
}

// DTO público: lista/ficha não recebem tokens, preços privados ou o corpo contratual.
export function resumirContratacao(c) {
  const e = c.externa;
  return {
    politica: c.politica, pagamentoFuturo: c.pagamentoFuturo,
    execucaoIndependePagamento: c.execucaoIndependePagamento,
    ganha: c.ganha, implantacaoPermitida: c.implantacaoPermitida,
    naCarteira: c.naCarteira, carteiraPermitida: c.carteiraPermitida, excecaoAplicavel: c.excecaoAplicavel,
    propostaId: c.proposta?.id || null, contratoId: c.contrato?.id || null,
    pagamentoConferido: Boolean(c.pagamento),
    externa: e ? { origem: 'EXTERNA', justificativa: e.justificativa, evidencia: e.evidencia, atorId: e.atorId, registradaEm: e.registradaEm, onboardingId: e.onboardingId, portalClientId: e.portalClientId, versao: e.versao } : null,
  };
}

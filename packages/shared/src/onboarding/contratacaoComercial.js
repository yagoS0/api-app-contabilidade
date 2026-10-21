const canonico = valor => JSON.stringify(valor, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);

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
  const proposta = propostas.find(p => p.status === 'ACEITA' && !p.revogadaEm) || propostas.find(p => !p.revogadaEm);
  const corresponde = c => contratoCorresponde(proposta, c);
  const contrato = contratos.find(c => corresponde(c) && c.status === 'ASSINADO_CONFERIDO') || contratos.find(c => corresponde(c));
  const pagamento = pagamentoDoContrato(proposta, contrato, marcos);
  const ganha = Boolean(pagamento || contrato?.status === 'ASSINADO_CONFERIDO' && contrato.dados?.politicaContratacao !== 'R35');
  const externa = marcos.find(m => m.tipo === 'CONVERTIDO' && m.dados?.contratacao?.origem === 'EXTERNA')?.dados.contratacao || null;
  return {
    proposta, contrato, pagamento, ganha, externa,
    implantacaoPermitida: ganha || Boolean(externa),
    naCarteira: onboarding.status === 'CONVERTIDO',
    carteiraPermitida: onboarding.origem !== 'PESSOA_FISICA' && ganha && contrato.dados?.opcao?.recorrente === true && Boolean(pagamento)
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
    ganha: c.ganha, implantacaoPermitida: c.implantacaoPermitida,
    naCarteira: c.naCarteira, carteiraPermitida: c.carteiraPermitida, excecaoAplicavel: c.excecaoAplicavel,
    propostaId: c.proposta?.id || null, contratoId: c.contrato?.id || null,
    pagamentoConferido: Boolean(c.pagamento),
    externa: e ? { origem: 'EXTERNA', justificativa: e.justificativa, evidencia: e.evidencia, atorId: e.atorId, registradaEm: e.registradaEm, onboardingId: e.onboardingId, portalClientId: e.portalClientId, versao: e.versao } : null,
  };
}

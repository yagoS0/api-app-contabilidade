// Projeção de fatos persistidos. Nunca transforma fase manual ou checklist em contrato.
export function projetarContratacao({ onboarding = {}, propostas = [], contratos = [], marcos = [] } = {}) {
  const proposta = propostas.find(p => p.status === 'ACEITA' && !p.revogadaEm) || propostas.find(p => !p.revogadaEm);
  const corresponde = c => proposta?.status === 'ACEITA' && !proposta.revogadaEm && c.propostaId === proposta.id
    && Boolean(proposta.opcaoAceita) && c.dados?.opcao?.chave === proposta.opcaoAceita;
  const contrato = contratos.find(c => corresponde(c) && c.status === 'ASSINADO_CONFERIDO') || contratos.find(c => corresponde(c));
  const ganha = Boolean(contrato?.status === 'ASSINADO_CONFERIDO');
  const pagamento = ganha ? marcos.find(m => m.tipo === 'PAGAMENTO_HONORARIOS_CONFERIDO' && m.dados?.contratoId === contrato.id) || null : null;
  const externa = marcos.find(m => m.tipo === 'CONVERTIDO' && m.dados?.contratacao?.origem === 'EXTERNA')?.dados.contratacao || null;
  return {
    proposta, contrato, pagamento, ganha, externa,
    implantacaoPermitida: ganha || Boolean(externa),
    naCarteira: onboarding.status === 'CONVERTIDO',
    carteiraPermitida: onboarding.origem !== 'PESSOA_FISICA' && ganha && contrato.dados?.opcao?.recorrente === true && Boolean(pagamento),
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

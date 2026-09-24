// Projeção de apresentação: nunca concede RBAC nem autorização de consulta/emissão.
export function classificarRelacionamento({ contatos = [], caso = null, interlocutor = null, vinculoNumero = null } = {}) {
  const ativos = contatos.filter(c => c.ativo !== false && c.portalClientId
    && (!vinculoNumero?.id || c.vinculoNumeroId === vinculoNumero.id));
  const usuarios = new Set(ativos.map(c => c.userId).filter(Boolean));
  const revisao = interlocutor?.estado === 'EM_REVISAO' || Boolean(vinculoNumero?.encerrouEm) || usuarios.size > 1;
  const pre = caso?.triagem?.preatendimento;
  const comercial = Boolean(caso && !caso.encerradoEm && (caso.onboardingId || caso.triagem?.origem
    || ['ABERTURA', 'TRANSFERENCIA', 'INATIVA', 'PLANEJAMENTO', 'GESTAO'].includes(pre?.intencao)));
  const tipo = ativos.length ? 'CLIENTE' : comercial ? 'LEAD' : 'A_IDENTIFICAR';
  return {
    relacionamento: {
      tipo, motivo: ativos.length ? 'CONTATO_ATIVO_CADASTRADO' : comercial ? 'SOLICITACAO_COMERCIAL_CONFIRMADA'
        : contatos.length ? 'CADASTRO_ANTERIOR' : 'SEM_EVIDENCIA_DE_RELACIONAMENTO',
      fonte: ativos.length ? 'CONTATO_WHATSAPP' : comercial ? 'ATENDIMENTO_LEAD' : null,
      versao: interlocutor?.versao || 1,
    },
    identidade: {
      estado: revisao ? 'EM_REVISAO' : interlocutor?.tipo === 'COMPARTILHADO' ? 'COMPARTILHADA'
        : ativos.length ? 'RECONHECIDA_NO_CADASTRO' : 'NAO_VERIFICADA',
      origemNome: interlocutor?.nome || ativos.some(c => c.nome) ? 'CADASTRO' : 'PERFIL_OBSERVADO',
      vinculoNumeroId: vinculoNumero?.id || null, versao: interlocutor?.versao || 1,
      evidencia: vinculoNumero?.evidencia || null, verificadoEm: vinculoNumero?.verificadoEm || null, verificadoPor: vinculoNumero?.verificadoPor || null,
    },
    solicitacaoComercial: comercial ? { id: caso.id, onboardingId: caso.onboardingId || null,
      origem: caso.onboarding?.origem || caso.triagem?.origem || null, intencao: pre?.intencao || null,
      etapa: caso.onboarding?.status || pre?.estado || 'COLETA' } : null,
  };
}

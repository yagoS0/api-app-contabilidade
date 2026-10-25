export class SolicitacaoError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export const exigir = (condition, code, status = 400) => { if (!condition) throw new SolicitacaoError(code, status); };
export function texto(value, field, max = 200, nullable = false) {
  if (nullable && value == null) return null;
  exigir(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max, `${field}_invalido`);
  return value.trim();
}
export function dataCivil(value) {
  if (value === null) return null;
  exigir(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'prazo_invalido');
  const date = new Date(`${value}T12:00:00.000Z`);
  exigir(value.slice(0, 4) !== '0000' && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value, 'prazo_invalido');
  return value;
}
export function interno(user) {
  return Boolean(user && user.status === 'active' && (user.accountType === 'FIRM' || user.role === 'admin'));
}
export function gestor(user) { return interno(user) && ['admin', 'contador'].includes(user.role); }

// Context comes from authenticated internal code, never from the command payload.
// Roles, activity and membership are always reloaded inside the transaction.
export async function carregarEscopo(tx, contexto) {
  exigir(contexto?.canal === 'INTERNO', 'contexto_interno_obrigatorio', 403);
  const id = texto(contexto.atorId, 'ator');
  const user = await tx.user.findUnique({ where: { id } });
  exigir(interno(user), 'ator_nao_autorizado', 403);
  const empresas = gestor(user)
    ? await tx.portalClient.findMany({ select: { id: true } })
    : (await tx.companyFirmAccess.findMany({ where: { userId: id, status: 'ACTIVE', role: { in: ['STAFF', 'ACCOUNTANT', 'FIRM_ADMIN'] } }, select: { companyId: true } })).map(x => ({ id: x.companyId }));
  return { atorId: id, empresas: [...new Set(empresas.map(x => x.id))].sort(), triagem: gestor(user) };
}

export function exigirEmpresa(escopo, portalClientId) {
  exigir(portalClientId ? escopo.empresas.includes(portalClientId) : escopo.triagem, 'solicitacao_nao_encontrada', 404);
}

// S1 intentionally excludes protected identity groups. S2 must adapt these readers
// with the complete person/group authorization before exposing the new service.
export function conversaPermitida(conversa, portalClientId) {
  return Boolean(conversa && !conversa.excluidaEm && !conversa.atendimentoId && !conversa.vinculoNumeroId
    && !conversa.chaveEscopo?.startsWith('legado:') && conversa.portalClientId === portalClientId);
}

export async function validarVinculos(tx, escopo, data) {
  exigirEmpresa(escopo, data.portalClientId);
  if (data.conversaId) {
    const conversa = await tx.conversaWhatsapp.findUnique({ where: { id: data.conversaId } });
    exigir(conversaPermitida(conversa, data.portalClientId), 'vinculo_conversa_invalido', 404);
  }
  if (data.mensagemId) {
    exigir(Boolean(data.conversaId), 'mensagem_sem_conversa');
    const mensagem = await tx.mensagemWhatsapp.findUnique({ where: { id: data.mensagemId } });
    exigir(mensagem?.conversaId === data.conversaId, 'vinculo_mensagem_invalido', 404);
  }
  if (data.anotacaoId) {
    const anotacao = await tx.companyNote.findUnique({ where: { id: data.anotacaoId } });
    exigir(Boolean(data.portalClientId) && anotacao?.portalClientId === data.portalClientId, 'vinculo_anotacao_invalido', 404);
  }
  if (data.responsavelId) {
    const responsavel = await tx.user.findUnique({ where: { id: data.responsavelId } });
    exigir(interno(responsavel), 'responsavel_invalido');
    const acesso = data.portalClientId && await tx.companyFirmAccess.findUnique({ where: { companyId_userId: { companyId: data.portalClientId, userId: data.responsavelId } } });
    exigir(gestor(responsavel) || (data.portalClientId && acesso?.status === 'ACTIVE' && ['STAFF', 'ACCOUNTANT', 'FIRM_ADMIN'].includes(acesso.role)), 'responsavel_fora_escopo');
  }
}

export function normalizarDados(input, criar = false) {
  exigir(input && typeof input === 'object' && !Array.isArray(input), 'dados_invalidos');
  const allowed = ['titulo', 'resumo', 'prioridade', 'prazoCivil', 'responsavelId', 'portalClientId', ...(criar ? ['conversaId', 'mensagemId', 'anotacaoId'] : ['situacao', 'mensagemComplementarId'])];
  exigir(Object.keys(input).every(k => allowed.includes(k)), 'campo_nao_permitido');
  const out = {};
  for (const key of ['titulo', 'resumo']) if (criar || key in input) out[key] = texto(input[key], key, key === 'titulo' ? 200 : 10000);
  for (const key of ['portalClientId', 'conversaId', 'mensagemId', 'anotacaoId', 'responsavelId', 'mensagemComplementarId']) {
    if (key in input) out[key] = texto(input[key], key, 200, true);
  }
  if ('prioridade' in input) {
    exigir(input.prioridade === null || ['ALTA', 'MEDIA', 'BAIXA'].includes(input.prioridade), 'prioridade_invalida');
    out.prioridade = input.prioridade;
  }
  if ('prazoCivil' in input) out.prazoCivil = dataCivil(input.prazoCivil);
  if ('situacao' in input) {
    const states = { NOVA: 'AGUARDANDO', EM_ATENDIMENTO: 'EM_ATENDIMENTO', AGUARDANDO_CLIENTE: 'AGUARDANDO_CLIENTE' };
    exigir(Object.hasOwn(states, input.situacao), 'situacao_invalida');
    out.estado = states[input.situacao];
  }
  if (criar) for (const key of ['portalClientId', 'conversaId', 'mensagemId', 'anotacaoId', 'responsavelId', 'prioridade', 'prazoCivil']) out[key] ??= null;
  return out;
}

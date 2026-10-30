import { registrarOrigemWhatsapp } from '../solicitacoes/SolicitacoesOrigemWhatsappService.js';
import { SolicitacoesService } from '../solicitacoes/SolicitacoesService.js';
import { prisma } from '../../infrastructure/db/prisma.js';
import { randomUUID } from 'node:crypto';
import { carregarEscopo, exigir } from '../solicitacoes/solicitacoesPolicy.js';
import { json } from '../solicitacoes/solicitacoesProjection.js';
import { escopoDasSolicitacoes } from '../solicitacoes/solicitacoesEscopoWhatsapp.js';

// Recebe a transação que pausa o atendimento. O registro é também o aviso persistente do portal.
export async function registrarEncaminhamentoSuporte({ conversa, mensagem, motivo, client, agora = new Date(), origem = { tipo: 'HANDOFF_MENSAGEM' } }) {
  const motivos = { OPENAI_REDE: 'Falha de conexão com o assistente', OPENAI_TIMEOUT: 'O assistente não concluiu a resposta a tempo',
    TETO_PILOTO: 'Limite de uso do assistente atingido', TETO_PILOTO_INVALIDO: 'Configuração do assistente precisa de revisão',
    OPENAI_SEM_CHAVE: 'Assistente indisponível', OPENAI_USO_AUSENTE: 'Não foi possível confirmar o consumo do assistente',
    TETO_OPENAI_COMPARTILHADO: 'Limite compartilhado de IA atingido' };
  return registrarOrigemWhatsapp({ client, conversaId: conversa.id, mensagemId: mensagem.id, origem, agora,
    motivo: String(motivos[motivo] || motivo || 'Atendimento precisa da equipe').slice(0, 500) });
}

export async function listarEncaminhamentosSuporte({ contexto, companyId = null, cursor = null, client = prisma }) {
  const service = new SolicitacoesService({ client });
  const lista = await service.listar({ contexto, filtros: { situacao: 'ABERTAS', ...(companyId ? { portalClientId: companyId } : {}) }, limite: 100, cursor });
  const empresas = await client.portalClient.findMany({ where: { id: { in: [...new Set(lista.itens.map(i => i.portalClientId).filter(Boolean))] } }, select: { id: true, razao: true } });
  const nomes = new Map(empresas.map(e => [e.id, e.razao]));
  return { total: lista.total, porEmpresa: lista.porEmpresa, proximoCursor: lista.proximoCursor,
    itens: lista.itens.map(item => ({ ...item, estado: item.estadoLegado, empresaId: item.portalClientId, empresa: nomes.get(item.portalClientId) || '' })) };
}

export async function atualizarEncaminhamentosSuporte({ conversaId, estado, responsavelId, atorId, client = prisma }) {
  const work = async tx => {
    const rows = await tx.encaminhamentoSuporte.findMany({ where: { conversaId, contratoVersao: null, estado: { not: 'RESOLVIDO' } } });
    if (rows.length) exigir(typeof atorId === 'string' && atorId.length > 0, 'autor_atendimento_obrigatorio');
    const now = new Date();
    const data = { estado, responsavelId: responsavelId || null, revisao: { increment: 1 }, ...(estado === 'RESOLVIDO' ? { resolvidoEm: now } : {}) };
    const result = await tx.encaminhamentoSuporte.updateMany({ where: { conversaId, contratoVersao: null, estado: { not: 'RESOLVIDO' }, id: { in: rows.map(r => r.id) },
      ...(rows.length ? { OR: rows.map(r => ({ id: r.id, revisao: r.revisao, updatedAt: r.updatedAt, estado: r.estado, responsavelId: r.responsavelId })) } : {}) }, data });
    exigir(result.count === rows.length, 'legado_alterado', 409);
    for (const before of rows) {
      const after = await tx.encaminhamentoSuporte.findUnique({ where: { id: before.id } });
      await tx.solicitacaoEvento.create({ data: { id: randomUUID(), solicitacaoId: before.id, revisao: after.revisao,
        tipo: 'ATENDIMENTO_LEGADO_ALTERADO', atorId, ocorridoEm: now, antes: json(before), depois: json(after) } });
    }
    return result;
  };
  return client.$transaction ? client.$transaction(work, { isolationLevel: 'Serializable' }) : work(client);
}

// Adoption and archive compete on the same revision. This compatibility command
// records an archive, never fabricates evidence of a human resolution.
export async function arquivarEncaminhamentoLegado({ contexto, conversaId, id, client = prisma }) {
  return client.$transaction(async tx => {
    const escopo = await carregarEscopo(tx, contexto);
    exigir(escopo.triagem, 'forbidden_admin_or_contador_only', 403);
    const conversa = await tx.conversaWhatsapp.findUnique({ where: { id: conversaId } });
    exigir(conversa && !conversa.excluidaEm && escopo.empresas.includes(conversa.portalClientId), 'demanda_nao_encontrada', 404);
    exigir(!conversa.atendidaPor || conversa.atendidaPor === escopo.atorId, 'ATENDIMENTO_OCUPADO', 409);
    const before = await tx.encaminhamentoSuporte.findFirst({ where: { id, conversaId } });
    exigir(before, 'demanda_nao_encontrada', 404);
    const efetivo = await escopoDasSolicitacoes(tx, escopo);
    exigir(efetivo.solicitacaoIds.includes(id), 'demanda_nao_encontrada', 404);
    exigir(before.contratoVersao == null, 'SOLICITACAO_INDIVIDUAL_OBRIGATORIA', 409);
    if (before.estado === 'RESOLVIDO') return;
    const now = new Date();
    const result = await tx.encaminhamentoSuporte.updateMany({ where: {
      id, conversaId, contratoVersao: null, revisao: before.revisao, updatedAt: before.updatedAt,
      estado: before.estado, responsavelId: before.responsavelId, resolvidoEm: before.resolvidoEm,
      conversa: { excluidaEm: null, portalClientId: { in: escopo.empresas }, OR: [{ atendidaPor: null }, { atendidaPor: escopo.atorId }] },
    }, data: { estado: 'RESOLVIDO', responsavelId: escopo.atorId, resolvidoEm: now, revisao: { increment: 1 } } });
    exigir(result.count === 1, 'DEMANDA_ALTERADA', 409);
    const after = await tx.encaminhamentoSuporte.findUnique({ where: { id } });
    await tx.solicitacaoEvento.create({ data: { id: randomUUID(), solicitacaoId: id, revisao: after.revisao,
      tipo: 'LEGADO_ARQUIVADO', atorId: escopo.atorId, ocorridoEm: now, antes: json(before), depois: json(after) } });
  }, { isolationLevel: 'Serializable' });
}

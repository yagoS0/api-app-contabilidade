import { prisma } from '../../infrastructure/db/prisma.js';
import { identidadeDoCaso, filtroCasoDaConversa, exigirConversaDoCaso, emTransacaoComercial } from './ContextoComercialService.js';
import { iniciarAtendimento, encerrado } from './LeadService.js';
import { registrarContingenciaComercialPush } from '../whatsapp/AtendimentoPushService.js';

export function dadosContingenciaIa({ motivo, mensagemId, agora = new Date() }) {
  // Nunca persistir mensagem de erro do provedor, credenciais ou texto do cliente no alerta.
  const codigo = /^[A-Z][A-Z0-9_]{0,79}$/.test(String(motivo || '')) ? motivo : 'IA_INDISPONIVEL';
  return { estado: 'PENDENTE', motivo: codigo, mensagemId, criadaEm: agora.toISOString() };
}

/** Watchdog: pausa a automação e cria tarefa humana; não tenta reenviar saída incerta. */
export async function encaminharContingenciaComercial({ conversaId, mensagemId, motivo, exigirSemResposta = false,
  client = prisma, agora = new Date() }) {
  return emTransacaoComercial(client, async tx => {
    const inicial = await tx.conversaWhatsapp.findUnique({ where: { id: conversaId }, include: { canalWhatsapp: true } });
    if (!inicial || inicial.excluidaEm || inicial.canalWhatsapp?.finalidade !== 'COMERCIAL' || inicial.canalWhatsapp?.ativo === false)
      return { encaminhado: false, motivo: 'FORA_DO_COMERCIAL' };
    const interlocutorId = await identidadeDoCaso(inicial, tx, { travar: true });
    await tx.conversaWhatsapp.updateMany({ where: { id: conversaId, excluidaEm: null }, data: { updatedAt: agora } });
    const conversa = await tx.conversaWhatsapp.findUnique({ where: { id: conversaId } });
    if (!conversa || conversa.excluidaEm || conversa.vinculoNumeroId !== inicial.vinculoNumeroId || conversa.canalId !== inicial.canalId)
      return { encaminhado: false, motivo: 'IDENTIDADE_ALTERADA' };
    const pessoa = interlocutorId ? await tx.interlocutorComunicacao.findUnique({ where: { id: interlocutorId } }) : null;
    if (conversa.atendidaPor || pessoa?.atendidaPor || pessoa && pessoa.estado !== 'ATIVO')
      return { encaminhado: false, motivo: 'HUMANO_OU_IDENTIDADE' };
    const mensagem = await tx.mensagemWhatsapp.findUnique({ where: { id: mensagemId } });
    if (!mensagem || mensagem.conversaId !== conversaId || mensagem.direcao !== 'in'
      || conversa.automacaoInvalidadaEm && new Date(mensagem.registradaEm) <= new Date(conversa.automacaoInvalidadaEm))
      return { encaminhado: false, motivo: 'MENSAGEM_FORA_DO_ESCOPO' };
    let caso = await tx.atendimentoLead.findFirst({ where: { ...filtroCasoDaConversa(conversa, interlocutorId), encerradoEm: null }, include: { onboarding: true } });
    if (caso && (encerrado(caso.onboarding) || caso.conversaId !== conversaId)) return { encaminhado: false, motivo: 'CASO_INDISPONIVEL' };
    if (caso?.triagem?.contingenciaIa?.estado === 'PENDENTE' && caso.triagem.contingenciaIa.mensagemId === mensagemId)
      return { encaminhado: true, atendimentoId: caso.id, repetido: true };
    if (exigirSemResposta) {
      const ultima = await tx.mensagemWhatsapp.findFirst({ where: { conversaId, direcao: 'in', tipo: { not: 'reaction' } }, orderBy: [{ registradaEm: 'desc' }, { id: 'desc' }] });
      const resposta = await tx.mensagemWhatsapp.findFirst({ where: { conversaId, direcao: 'out', registradaEm: { gte: mensagem.registradaEm }, statusEnvio: { in: ['enviado', 'entregue', 'lido'] } } });
      if (ultima?.id !== mensagemId || resposta) return { encaminhado: false, motivo: 'TURNO_SUPERADO_OU_RESPONDIDO' };
    }
    // Um handoff fiscal sem resposta entregue também pode precisar de aviso de falha de envio.
    if ((conversa.atendidaDesde || pessoa?.atendidaDesde) && (!exigirSemResposta || caso?.triagem?.preatendimento?.estado !== 'ENCAMINHADO'))
      return { encaminhado: false, motivo: 'ATENDIMENTO_HUMANO' };
    caso ||= await iniciarAtendimento({ conversaId, client: tx });
    await exigirConversaDoCaso(caso, conversa, tx);
    const triagem = caso.triagem || {};
    await tx.atendimentoLead.update({ where: { id: caso.id }, data: { versao: { increment: 1 }, triagem: {
      ...triagem, contingenciaIa: dadosContingenciaIa({ motivo, mensagemId, agora }),
      preatendimento: { ...triagem.preatendimento, ultimoRelato: String(mensagem.corpo || triagem.preatendimento?.ultimoRelato || '').slice(0, 4000), estado: 'ENCAMINHADO', encaminhadoEm: agora.toISOString() },
    } } });
    await tx.conversaWhatsapp.update({ where: { id: conversaId }, data: { atendidaDesde: conversa.atendidaDesde || agora } });
    if (interlocutorId) await tx.interlocutorComunicacao.update({ where: { id: interlocutorId }, data: { atendidaDesde: pessoa.atendidaDesde || agora } });
    await registrarContingenciaComercialPush({ atendimentoId: caso.id, mensagemId, conversaId, client: tx, agora });
    return { encaminhado: true, atendimentoId: caso.id };
  });
}

/** Chamado na mesma transação que devolve o atendimento à automação. */
export async function resolverContingenciasComerciais({ conversaIds, responsavelId = null, client = prisma, agora = new Date() }) {
  const casos = await client.atendimentoLead.findMany({ where: { conversaId: { in: conversaIds }, encerradoEm: null,
    triagem: { path: ['contingenciaIa', 'estado'], equals: 'PENDENTE' } } });
  for (const caso of casos) {
    const pendencia = caso.triagem?.contingenciaIa;
    if (pendencia?.estado !== 'PENDENTE') continue;
    await client.atendimentoLead.update({ where: { id: caso.id }, data: { versao: { increment: 1 }, triagem: {
      ...caso.triagem, contingenciaIa: { ...pendencia, estado: 'RESOLVIDA', resolvidaEm: agora.toISOString(), responsavelId },
    } } });
  }
  return { resolvidas: casos.length };
}

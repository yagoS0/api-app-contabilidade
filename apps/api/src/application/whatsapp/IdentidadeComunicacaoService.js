import { prisma } from '../../infrastructure/db/prisma.js';
import { normalizarE164 } from './telefone.js';
import { classificarRelacionamento } from './ClassificacaoAtendimentoService.js';

export const erroIdentidade = (code, message = 'A identificação mudou. Confira o cadastro antes de continuar.') => Object.assign(new Error(message), { code, status: 409 });

/** Chamado por comandos/entradas, nunca pelo polling. Uma vigência encerrada nunca é reaberta. */
export async function garantirIdentidadeWhatsapp({ telefone, canalId = null, client = prisma } = {}) {
  const e164 = normalizarE164(telefone);
  if (!e164) throw erroIdentidade('TELEFONE_INVALIDO', 'Informe um telefone válido.');
  let vinculoNumero = await client.vinculoNumeroInterlocutor.findFirst({ where: { telefoneE164: e164, encerrouEm: null }, include: { interlocutor: true } });
  const aliases = await client.contatoWhatsapp.findMany({ where: { ativo: true, waId: e164, vinculoNumeroId: { not: null } }, include: { vinculoNumero: { include: { interlocutor: true } } } });
  const candidatos = [...new Map([vinculoNumero, ...aliases.map(c => c.vinculoNumero)].filter(v => v && !v.encerrouEm).map(v => [v.id, v])).values()];
  const conflitoAlias = candidatos.length > 1;
  if (conflitoAlias) {
    await client.interlocutorComunicacao.updateMany({ where: { id: { in: candidatos.map(v => v.interlocutorId) }, estado: { not: 'EM_REVISAO' } }, data: { estado: 'EM_REVISAO', versao: { increment: 1 } } });
    // Conservar entrada e exibir fila de revisão; não escolher uma empresa dentre aliases conflitantes.
    if (vinculoNumero) return { interlocutor: { ...vinculoNumero.interlocutor, estado: 'EM_REVISAO' }, vinculoNumero: { ...vinculoNumero, interlocutor: { ...vinculoNumero.interlocutor, estado: 'EM_REVISAO' } }, canalId, revisaoIdentidade: true };
  }
  vinculoNumero = conflitoAlias ? null : candidatos[0] || null;
  if (!vinculoNumero) {
    const anterior = await client.vinculoNumeroInterlocutor.findFirst({ where: { telefoneE164: e164 }, orderBy: { geracao: 'desc' } });
    try {
      vinculoNumero = await client.vinculoNumeroInterlocutor.create({ data: { telefoneE164: e164, geracao: (anterior?.geracao || 0) + 1,
        interlocutor: { create: conflitoAlias ? { estado: 'EM_REVISAO' } : {} } }, include: { interlocutor: true } });
    } catch (err) {
      if (err?.code !== 'P2002') throw err;
      vinculoNumero = await client.vinculoNumeroInterlocutor.findFirst({ where: { telefoneE164: e164, encerrouEm: null }, include: { interlocutor: true } });
      if (!vinculoNumero) throw err;
    }
    // Somente primeiro cadastro: um contato antigo não passa ao novo titular por coincidência.
    if (!anterior && !conflitoAlias) await client.contatoWhatsapp.updateMany({ where: { telefoneE164: e164, vinculoNumeroId: null }, data: { vinculoNumeroId: vinculoNumero.id } });
  }
  return { interlocutor: vinculoNumero.interlocutor, vinculoNumero, canalId };
}

export async function conferirIdentidadeVigente({ vinculoNumeroId, telefone = null, permitirRevisao = false, client = prisma } = {}) {
  if (!vinculoNumeroId) throw erroIdentidade('IDENTIDADE_NAO_MIGRADA');
  const vinculoNumero = await client.vinculoNumeroInterlocutor.findUnique({ where: { id: String(vinculoNumeroId) }, include: { interlocutor: true } });
  if (!vinculoNumero || vinculoNumero.encerrouEm) throw erroIdentidade('IDENTIDADE_ALTERADA');
  if (telefone && normalizarE164(telefone) !== vinculoNumero.telefoneE164) {
    const alias = await client.contatoWhatsapp.findFirst({ where: { vinculoNumeroId: vinculoNumero.id, ativo: true, waId: normalizarE164(telefone) } });
    if (!alias) throw erroIdentidade('IDENTIDADE_ALTERADA');
  }
  if (!permitirRevisao && vinculoNumero.interlocutor.estado !== 'ATIVO') throw erroIdentidade('IDENTIDADE_EM_REVISAO');
  return { vinculoNumero, interlocutor: vinculoNumero.interlocutor };
}

export async function projetarIdentidadeConversa(conversa, { client = prisma } = {}) {
  const vinculo = conversa?.vinculoNumero || (conversa?.vinculoNumeroId
    ? await client.vinculoNumeroInterlocutor.findUnique({ where: { id: conversa.vinculoNumeroId }, include: { interlocutor: true } }) : null);
  if (!vinculo) return classificarRelacionamento();
  const [contatos, caso] = await Promise.all([
    client.contatoWhatsapp.findMany({ where: { vinculoNumeroId: vinculo.id } }),
    client.atendimentoLead.findFirst({ where: { interlocutorId: vinculo.interlocutorId, encerradoEm: null }, include: { onboarding: true } }),
  ]);
  return { interlocutorId: vinculo.interlocutorId, ...classificarRelacionamento({ contatos, caso, interlocutor: vinculo.interlocutor, vinculoNumero: vinculo }) };
}

/** Conferência não concede acesso. NOVO_TITULAR mantém contatos/arquivos anteriores na vigência antiga. */
export async function conferirIdentificacao({ vinculoNumeroId, versao, acao, evidencia, atorId, nome = null, tipo = 'PESSOA', client = prisma }) {
  if (!['CONFIRMAR', 'CONTESTAR', 'NOVO_TITULAR'].includes(acao) || !String(evidencia || '').trim() || !atorId || !Number.isInteger(versao)) throw erroIdentidade('CONFERENCIA_INVALIDA');
  if (!['PESSOA', 'COMPARTILHADO'].includes(tipo)) throw erroIdentidade('CONFERENCIA_INVALIDA');
  const executar = async tx => {
    const atual = await tx.vinculoNumeroInterlocutor.findUnique({ where: { id: vinculoNumeroId }, include: { interlocutor: true } });
    if (!atual || atual.encerrouEm) throw erroIdentidade('IDENTIDADE_ALTERADA');
    const quando = new Date();
    const mudou = await tx.interlocutorComunicacao.updateMany({ where: { id: atual.interlocutorId, versao }, data: { versao: { increment: 1 },
      estado: acao === 'CONFIRMAR' ? 'ATIVO' : 'EM_REVISAO', ...(acao === 'CONFIRMAR' ? { tipo, ...(nome ? { nome: String(nome).trim().slice(0, 120) } : {}) } : {}) } });
    if (!mudou.count) throw erroIdentidade('IDENTIDADE_ALTERADA');
    await tx.eventoIdentidadeComunicacao.create({ data: { interlocutorId: atual.interlocutorId, vinculoNumeroId: atual.id, versaoAnterior: versao,
      acao, atorId, evidencia: String(evidencia).trim().slice(0, 2000), dados: { tipo, nome: nome || null } } });
    await tx.vinculoNumeroInterlocutor.update({ where: { id: atual.id }, data: { evidencia: String(evidencia).trim().slice(0, 2000), verificadoEm: quando, verificadoPor: atorId,
      ...(acao === 'NOVO_TITULAR' ? { encerrouEm: quando } : {}) } });
    const segmentos = await tx.conversaWhatsapp.findMany({ where: { vinculoNumero: { interlocutorId: atual.interlocutorId } }, select: { id: true } });
    const ids = segmentos.map(c => c.id);
    await tx.conversaWhatsapp.updateMany({ where: { id: { in: ids } }, data: { automacaoInvalidadaEm: quando, atendidaDesde: quando } });
    await tx.atendimentoResponsavelWhatsapp.updateMany({ where: { vinculoNumero: { interlocutorId: atual.interlocutorId } }, data: { versao: { increment: 1 }, aguardandoSelecao: true, expiraEm: null, automacaoInvalidadaEm: quando, atendidaDesde: quando } });
    await tx.acaoPendenteWhatsapp.updateMany({ where: { conversaId: { in: ids }, status: 'pendente' }, data: { status: 'cancelada' } });
    await tx.turnoIaWhatsapp.updateMany({ where: { conversaId: { in: ids }, status: { in: ['pendente', 'falhou', 'processando'] } }, data: { status: 'ignorado', motivo: 'IDENTIDADE_ALTERADA', reservaToken: null, leaseAte: null, concluidoEm: quando } });
    if (acao === 'NOVO_TITULAR') {
      const novo = await tx.vinculoNumeroInterlocutor.create({ data: { telefoneE164: atual.telefoneE164, geracao: atual.geracao + 1, origem: 'NOVO_TITULAR_CONFERIDO',
        evidencia: String(evidencia).trim().slice(0, 2000), verificadoEm: quando, verificadoPor: atorId, interlocutor: { create: { tipo, nome } } }, include: { interlocutor: true } });
      return { vinculoNumero: novo, interlocutor: novo.interlocutor };
    }
    return tx.vinculoNumeroInterlocutor.findUnique({ where: { id: atual.id }, include: { interlocutor: true } });
  };
  return typeof client.$transaction === 'function' ? client.$transaction(executar) : executar(client);
}

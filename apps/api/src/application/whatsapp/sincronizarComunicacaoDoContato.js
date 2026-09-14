import { resolverVinculoPorTelefone } from './ContatoWhatsappService.js';
import { empresasParaComunicacao } from './comunicacaoDoContato.js';
import { garantirConversa } from './ConversaWhatsappService.js';
import { garantirAtendimentoResponsavel } from './AtendimentoResponsavelWhatsappService.js';

/** Atualiza somente a organização dos chats; não concede acesso ao portal nem envia mensagens. */
export async function sincronizarComunicacaoDoContato({ telefone, conversa = null, client,
  resolverVinculo = resolverVinculoPorTelefone, garantirAtendimento = garantirAtendimentoResponsavel,
  garantirSegmento = garantirConversa }) {
  if (!telefone || conversa?.excluidaEm || String(conversa?.chaveEscopo || '').startsWith('legado:')) return conversa;
  const vinculo = await resolverVinculo(telefone, { client });
  const acesso = empresasParaComunicacao(vinculo);
  if (acesso.bloqueado || !acesso.empresas.length
    || (conversa?.portalClientId && !acesso.empresas.some(e => e.portalClientId === conversa.portalClientId))) return conversa;
  const segmentos = await client.conversaWhatsapp.findMany({
    where: { telefoneE164: vinculo.e164, NOT: { chaveEscopo: { startsWith: 'legado:' } } },
    select: { id: true, portalClientId: true, atendimentoId: true },
  });
  if (conversa?.atendimentoId && acesso.empresas.every(e => segmentos.some(s => s.portalClientId === e.portalClientId && s.atendimentoId === conversa.atendimentoId))) return conversa;
  const origem = conversa || await garantirSegmento({ telefone: vinculo.e164, portalClientId: acesso.empresas[0].portalClientId, client });
  const atendimento = await garantirAtendimento({ conversa: origem, empresas: acesso.empresas, userId: acesso.userId, client });
  return { ...origem, atendimentoId: atendimento.id, atendimento };
}

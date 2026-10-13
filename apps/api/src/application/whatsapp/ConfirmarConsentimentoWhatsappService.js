import { prisma } from '../../infrastructure/db/prisma.js';
import { lerConsentimentoWhatsapp } from './ConsentimentoWhatsappService.js';
import { comLeaseDoAtendimento } from './AtendimentoResponsavelWhatsappService.js';
import { conferirIdentidadeVigente } from './IdentidadeComunicacaoService.js';
import { janelaDaConversa } from './ConversaWhatsappService.js';
import { whatsappPorCanal } from './CanalWhatsappService.js';
import { enviarMensagemRastreada } from './SaidaWhatsappService.js';

export const TEXTO_CONSENTIMENTO = 'Combinado! Enviaremos as guias por este número. Quando precisar, pode falar conosco por aqui.';

// Confirmação determinística, sem GPT, seletor de empresa ou chamada fiscal.
export async function confirmarConsentimentoWhatsapp({ conversa, mensagem, consentimento }, {
  client = prisma, comLease = comLeaseDoAtendimento, lerConsentimento = lerConsentimentoWhatsapp,
  conferirIdentidade = conferirIdentidadeVigente, conferirJanela = janelaDaConversa,
  resolverCloud = whatsappPorCanal, enviar = enviarMensagemRastreada,
} = {}) {
  if (consentimento?.status !== 'AUTORIZADO' || !consentimento.aplicado || consentimento.mensagemId !== mensagem?.id) return { enviado: false };
  return comLease({ conversa, client }, async conferirLease => {
    const turnoIaId = `consentimento:${mensagem.id}`;
    // Inclusive falha/timeout: conferir histórico, nunca repetir uma saída incerta.
    if (await client.mensagemWhatsapp.findFirst({ where: { turnoIaId, direcao: 'out' } })) return { enviado: false, motivo: 'JA_REGISTRADO' };
    const permitido = async () => {
      await conferirLease();
      const atual = await client.conversaWhatsapp.findUnique({ where: { id: conversa.id } });
      if (!atual || atual.excluidaEm || atual.atendidaPor || atual.atendidaDesde
        || atual.telefoneE164 !== conversa.telefoneE164 || atual.canalId !== conversa.canalId
        || atual.vinculoNumeroId !== conversa.vinculoNumeroId
        || atual.automacaoInvalidadaEm && new Date(mensagem.registradaEm) <= new Date(atual.automacaoInvalidadaEm)) return false;
      if (atual.vinculoNumeroId) {
        const { interlocutor } = await conferirIdentidade({ vinculoNumeroId: atual.vinculoNumeroId, telefone: atual.telefoneE164, client });
        if (interlocutor.atendidaPor || interlocutor.atendidaDesde) return false;
      }
      const vigente = await lerConsentimento(atual.telefoneE164, client);
      if (vigente?.status !== 'AUTORIZADO' || vigente.mensagemId !== mensagem.id) return false;
      // Não reaparecer no meio de uma conversa que já continuou após essa autorização.
      if (await client.mensagemWhatsapp.findFirst({ where: { conversa: { telefoneE164: atual.telefoneE164, canalId: atual.canalId }, registradaEm: { gt: new Date(mensagem.registradaEm) }, OR: [{ turnoIaId: null }, { turnoIaId: { not: turnoIaId } }] } })) return false;
      return (await conferirJanela(atual.id, new Date())).situacao === 'ABERTA';
    };
    if (!await permitido()) return { enviado: false, motivo: 'CONTEXTO_ALTERADO' };
    const cloud = await resolverCloud(conversa, { client });
    await enviar({ conversa, tipo: 'text', corpo: TEXTO_CONSENTIMENTO, autor: 'SISTEMA', turnoIaId, client,
      antesDeEnviar: async () => { if (!await permitido()) throw Object.assign(new Error('Contexto da autorização mudou antes da confirmação.'), { codigo: 'CONSENTIMENTO_ALTERADO' }); },
      enviar: () => cloud.enviarTexto({ telefone: conversa.telefoneE164, texto: TEXTO_CONSENTIMENTO }) });
    return { enviado: true };
  });
}

import { createHash } from 'node:crypto';
import { prisma } from '../../infrastructure/db/prisma.js';
import { normalizarE164 } from './telefone.js';
import { BOTOES_CONSENTIMENTO } from './templateConsentimentoWhatsapp.js';

const normalizar = texto => String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.!?,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
export const chaveConsentimento = telefone => 'whatsapp_consentimento:' + createHash('sha256').update(telefone).digest('hex');
const falha = () => Object.assign(new Error('Cliente pediu para não receber WhatsApp. Somente uma nova autorização enviada pelo próprio cliente libera este número.'), {code:'WHATSAPP_CONSENTIMENTO_REVOGADO',codigo:'WHATSAPP_CONSENTIMENTO_REVOGADO',httpStatus:409,mensagemUsuario:'Envio bloqueado por solicitação do cliente. Peça que ele envie “Autorizo receber as guias pelo WhatsApp” ao suporte.'});

export function interpretarConsentimento(texto, perguntaDeConsentimento = false) {
 const t=normalizar(texto);
 if (/^(?:sair|stop|pare|parar|cancelar mensagens)$/.test(t)
   || /\b(?:nao quero|nao desejo|nao autorizo|nao aceito|pare de|parem de|parar de|deixe de) (?:mais )?(?:receber|enviar|mandar) (?:mais )?(?:(?:as|suas|essas|estas) )?(?:mensagens|guias|notificacoes|whatsapp)\b/.test(t)
   || /\bnao (?:me )?(?:envie|enviem|mande|mandem) (?:mais )?(?:(?:as|suas) )?(?:mensagens|guias|notificacoes|nada)\b/.test(t)
   || /\bnao quero (?:mais )?(?:mensagens|notificacoes|whatsapp)\b/.test(t)
   || /\b(?:remova|retire|exclua) (?:meu numero|meu contato|me da lista)\b/.test(t)
   || perguntaDeConsentimento && /^(?:nao|nao obrigado|nao obrigada|nao quero|nao quero receber|nao tenho interesse|nao autorizo|prefiro nao)$/.test(t)) return 'REVOGADO';
 // Não inferir autorização de "oi", de identidade reconhecida ou de confirmação de pagamento.
 if (/^(?:eu )?autorizo (?:o envio (?:de|das)|(?:a )?receber (?:as )?) ?(?:guias|mensagens)(?: (?:aqui|neste numero|nesse numero|pelo whatsapp|por whatsapp))?$/.test(t)
   || /^(?:sim )?podem? (?:me )?(?:enviar|mandar) (?:as )?guias(?: (?:aqui|neste numero|nesse numero|pelo whatsapp))?$/.test(t)
   || perguntaDeConsentimento && /^(?:sim|sim autorizo|autorizo|sim pode|pode enviar|podem enviar)$/.test(t)) return 'AUTORIZADO';
 return null;
}

async function destino(telefone, client) {
 const numero=normalizarE164(telefone);if(!numero)return null;
 // wa_id é um alias comprovado pela Meta, nunca um nono dígito presumido.
 const aliases=await client.contatoWhatsapp.findMany({where:{waId:numero,ativo:true},select:{telefoneE164:true}});
 const destinos=[...new Set(aliases.map(c=>c.telefoneE164).filter(Boolean))];
 if(destinos.length>1)throw Object.assign(new Error('Identidade do número precisa de conferência.'),{code:'IDENTIDADE_EM_REVISAO',codigo:'IDENTIDADE_EM_REVISAO',httpStatus:409});
 return destinos[0] || numero;
}
export async function lerConsentimentoWhatsapp(telefone, client=prisma) {
 const numero=await destino(telefone,client);if(!numero)return null;
 return (await client.appSetting.findUnique({where:{key:chaveConsentimento(numero)}}))?.value || null;
}
export async function conferirEnvioConsentido(telefone, client=prisma) {
 if((await lerConsentimentoWhatsapp(telefone,client))?.status==='REVOGADO')throw falha();
}

export async function processarConsentimentoWhatsapp({conversa,mensagem,interacao}, {client=prisma}={}) {
 if(!conversa?.telefoneE164 || !mensagem?.id || mensagem.direcao!=='in')return null;
 const botao=['button','interactive'].includes(mensagem.tipo) ? BOTOES_CONSENTIMENTO.find(b=>b.id===interacao?.id) : null;
 if(mensagem.tipo!=='text'&&!botao)return null;
 const texto=normalizar(mensagem.corpo);
 let acao=botao?null:interpretarConsentimento(texto);
 const curta=/^(?:nao|nao obrigado|nao obrigada|nao quero|nao quero receber|nao tenho interesse|nao autorizo|prefiro nao|sim|sim autorizo|autorizo|sim pode|pode enviar|podem enviar)$/.test(texto);
 if(!acao&&!curta&&!botao)return null;
 const numero=await destino(conversa.telefoneE164,client);
 const registrada=new Date(mensagem.registradaEm);
 const ocorrida=new Date(mensagem.ocorridaEmProvedor || mensagem.registradaEm);
 const instante=new Date(Math.min(registrada.getTime(),ocorrida.getTime()));
 if(!Number.isFinite(instante.getTime()))return null;
 if(!acao){
  // "Não paguei" e respostas a outros fluxos nunca viram recusa de comunicação.
  const anterior=await client.mensagemWhatsapp.findFirst({where:{conversa:{telefoneE164:conversa.telefoneE164,canalId:conversa.canalId},registradaEm:{lt:registrada,gte:new Date(registrada.getTime()-7*86400000)},...(mensagem.respostaAProviderMessageId?{direcao:'out',providerMessageId:mensagem.respostaAProviderMessageId}:{})},orderBy:{registradaEm:'desc'}});
  const pergunta=anterior?.direcao==='out' && anterior.tipo==='template' && anterior.statusEnvio!=='falhou' && /Podemos enviar por este número\?/.test(anterior.corpo||'');
  acao=botao?(pergunta?botao.status:null):interpretarConsentimento(texto,pergunta);if(!acao)return null;
 }
 const key=chaveConsentimento(numero),audit='whatsapp_consentimento_evento:'+mensagem.id;
 for(let attempt=0;attempt<3;attempt++){
  try{return await client.$transaction(async tx=>{
   const recibo=await tx.appSetting.findUnique({where:{key:audit}});if(recibo)return recibo.value;
   const anterior=(await tx.appSetting.findUnique({where:{key}}))?.value;
   const anteriorEm=Date.parse(anterior?.ocorridaEm || '');
   // Em empate de timestamp a recusa prevalece. Mensagens antigas nunca reabrem o canal.
   const aplicar=!Number.isFinite(anteriorEm)||instante.getTime()>anteriorEm||(instante.getTime()===anteriorEm&&acao==='REVOGADO'&&anterior.status!=='REVOGADO');
   const value={status:acao,origem:'MENSAGEM_WHATSAPP',mensagemId:mensagem.id,providerMessageId:mensagem.providerMessageId,conversaId:conversa.id,canalId:conversa.canalId||'principal',ocorridaEm:instante.toISOString(),registradaEm:registrada.toISOString(),aplicado:aplicar};
   if(aplicar){
    await tx.appSetting.upsert({where:{key},create:{key,value},update:{value}});
    await tx.contatoWhatsapp.updateMany({where:{telefoneE164:numero,...(acao==='AUTORIZADO'?{ativo:true}:{})},data:acao==='REVOGADO'?{optInEm:null,optInOrigem:'Revogado pelo cliente via WhatsApp'}:{optInEm:instante,optInOrigem:'Autorização explícita do cliente via WhatsApp; mensagem '+mensagem.id}});
   }
   await tx.appSetting.create({data:{key:audit,value}});
   return value;
  },{isolationLevel:'Serializable'});}catch(e){if(!['P2034','P2002'].includes(e.code)||attempt===2)throw e;}
 }
}

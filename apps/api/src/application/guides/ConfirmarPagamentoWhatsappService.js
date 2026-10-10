import { createHash, randomUUID } from 'node:crypto';
import { lerDataDoPagamentoInformada, FRASE_DA_RECUSA } from './lib/dataDoPagamento.js';
import { calendarioAvisosGuia } from './calendarioAvisosGuia.js';
export const PREFIXO_PAGAMENTO = 'altan.payment.confirm.';
const respostaDoBotao = id => /^altan\.payment\.answer\.([0-9a-f-]{36})\.(today|due|date|no_proof)\.([0-9a-f-]{36})$/.exec(String(id || ''));
export const ehInteracaoPagamento = id => /^altan\.payment\.(confirm|recalculate|answer)\./.test(String(id || ''));
export function tokenDaInteracaoPagamento(id) {
 const resposta = respostaDoBotao(id);
 return resposta ? PREFIXO_PAGAMENTO + resposta[1] : ehInteracaoPagamento(id) ? id : null;
}
function botoesDoFluxo(fluxo) {
 if (!fluxo?.nonce) return [];
 const opcoes = fluxo.etapa === 'DATA' ? [['today', 'Hoje'], ['due', 'Data de vencimento'], ['date', 'Digitar uma data']]
   : fluxo.etapa === 'COMPROVANTE' ? [['no_proof', 'Sem comprovante']] : [];
 return opcoes.map(([acao, titulo]) => ({ id: `altan.payment.answer.${fluxo.token.slice(PREFIXO_PAGAMENTO.length)}.${acao}.${fluxo.nonce}`, titulo }));
}
const RECUSA = 'Não foi possível confirmar por este botão. Solicite uma nova confirmação ao escritório.';
export const chaveFluxoPagamento = c => 'pagamento_fluxo:' + createHash('sha256').update((c.canalId || 'principal') + ':' + c.telefoneE164).digest('hex');
export async function fluxoPagamentoAtual(client, conversa, agora = new Date()) {
 const r=await client.appSetting.findUnique({where:{key:chaveFluxoPagamento(conversa)}});
 return r?.value?.etapa && Date.parse(r.value.expiraEm)>agora.getTime() ? r.value : null;
}
export function lerDataWhatsapp(texto, agora) {
 const t=String(texto||'').trim(), m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
 const partes=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(agora);
 const hoje=['year','month','day'].map(k=>partes.find(p=>p.type===k).value).join('-');
 return lerDataDoPagamentoInformada(m ? m[3]+'-'+m[2]+'-'+m[1] : /^hoje$/i.test(t)?hoje:t,{hoje:new Date(hoje+'T12:00:00Z')});
}
export async function confirmarPagamentoWhatsapp({ id, conversa, mensagem, client, conferirAcesso, agora = new Date() }) {
 const clique=String(id||'').startsWith(PREFIXO_PAGAMENTO);
 const resposta = respostaDoBotao(id);
 const cliqueResposta = String(id || '').startsWith('altan.payment.answer.');
 if (!conversa?.portalClientId || mensagem?.direcao!=='in' || mensagem.conversaId!==conversa.id) return clique||cliqueResposta?{texto:RECUSA}:null;
 if(clique&&!/^altan\.payment\.confirm\.[0-9a-f-]{36}$/.test(id)) return {texto:RECUSA};
 if(cliqueResposta&&!resposta)return {texto:RECUSA};
 const fluxo=clique?null:await fluxoPagamentoAtual(client,conversa,agora);
 if(!clique&&(!fluxo||fluxo.companyId!==conversa.portalClientId)) return cliqueResposta?{texto:RECUSA}:null;
 await conferirAcesso();
 for(let tentativa=0;tentativa<3;tentativa++){
  try{return await client.$transaction(async tx=>{
   const reciboKey='pagamento_resposta:'+mensagem.id;
   const recibo=await tx.appSetting.findUnique({where:{key:reciboKey}});
   if(recibo?.value?.companyId===conversa.portalClientId&&recibo.value.conversaId===conversa.id) return recibo.value.resultado;
   const fluxoKey=chaveFluxoPagamento(conversa);
   const ativo=clique?null:await fluxoPagamentoAtual(tx,conversa,agora);
   if(!clique&&(!ativo||ativo.token!==fluxo.token)) return {texto:'A confirmação mudou. Clique novamente na guia desejada.'};
   if(resposta && (ativo.token!==PREFIXO_PAGAMENTO+resposta[1] || ativo.nonce!==resposta[3]
     || (resposta[2]==='no_proof' ? ativo.etapa!=='COMPROVANTE' : ativo.etapa!=='DATA')))return {texto:'Este botão pertence a uma etapa anterior. Use os botões da mensagem mais recente da guia.'};
   const token=clique?id:ativo.token;
   const registro=await tx.appSetting.findUnique({where:{key:token}}),v=registro?.value;
   if(!v||v.companyId!==conversa.portalClientId||v.telefone!==conversa.telefoneE164||!(Date.parse(v.expiraEm)>agora.getTime()))return {texto:RECUSA};
   const contato=await tx.contatoWhatsapp.findFirst({where:{id:v.contatoId,portalClientId:v.companyId,telefoneE164:v.telefone,ativo:true,optInEm:{not:null}}});
   if(!contato)return {texto:RECUSA};
   const guia=await tx.guide.findFirst({where:{id:v.guideId,portalClientId:v.companyId,liberadaCliente:true,status:'PROCESSED'}});
   if(!guia||(guia.competencia||null)!==(v.competencia||null)||(guia.hash||null)!==(v.hash||null))return {texto:RECUSA};
   let etapaAtual=ativo;
   const salvarFluxo=async etapa=>{const value={token,companyId:v.companyId,etapa,nonce:randomUUID(),conversaId:conversa.id,expiraEm:v.expiraEm};await tx.appSetting.upsert({where:{key:fluxoKey},create:{key:fluxoKey,value},update:{value}});etapaAtual=value;};
   const responder=async (texto,botoes=botoesDoFluxo(etapaAtual))=>{const resultado={texto,...(botoes.length?{botoes}:{})};await tx.appSetting.create({data:{key:reciboKey,value:{companyId:v.companyId,conversaId:conversa.id,resultado}}});return resultado;};
   await conferirAcesso();
   if(clique){
    if(v.confirmadoEm){await salvarFluxo('COMPROVANTE');return responder('O pagamento já foi informado. Envie o comprovante em PDF ou foto, ou toque em Sem comprovante.');}
    if(guia.paymentStatus==='PAID'||guia.baixada||guia.clienteConfirmouEm)return responder('O pagamento desta guia já está registrado.');
    await salvarFluxo('DATA');
    return responder('Em que data você pagou '+guia.tipo+' ('+guia.competencia+')? Escolha abaixo. Data de vencimento considera o dia útil. Para desistir, escreva cancelar pagamento.');
   }
   const texto=String(mensagem.corpo||'').trim();
   if(/^cancelar pagamento[.!]?$/i.test(texto)){await salvarFluxo(null);return responder('Conversa de confirmação encerrada. Os pagamentos já informados foram preservados.');}
   if(ativo.etapa==='DATA'){
    if(resposta?.[2]==='date')return responder('Digite a data do pagamento no formato DD/MM/AAAA, por exemplo 09/10/2026.',[]);
    let dataTexto=resposta?.[2]==='today'?'hoje':texto;
    if(resposta?.[2]==='due'){
     const empresa=await tx.portalClient.findUnique({where:{id:v.companyId},select:{municipio:true}});
     const feriados=await tx.feriado.findMany({});
     dataTexto=calendarioAvisosGuia(guia.vencimento,feriados,empresa?.municipio)?.vencimento;
     if(!dataTexto)return responder('Esta guia não tem vencimento válido. Digite a data em que pagou.');
    }
    const leitura=lerDataWhatsapp(dataTexto,agora);
    if(leitura.recusa)return responder(FRASE_DA_RECUSA[leitura.recusa]+' Exemplo: 15/09/2026.');
    if(guia.paymentStatus==='PAID'||guia.baixada||guia.clienteConfirmouEm){await salvarFluxo(null);return responder('O pagamento desta guia já foi registrado; mantive os dados existentes.');}
    const r=await tx.guide.updateMany({where:{id:guia.id,portalClientId:v.companyId,updatedAt:guia.updatedAt,liberadaCliente:true,status:'PROCESSED',baixada:false,clienteConfirmouEm:null,OR:[{paymentStatus:null},{paymentStatus:{not:'PAID'}}]},data:{paymentStatus:'PAID',paymentStatusSource:'CLIENTE',clienteConfirmouEm:agora,clienteConfirmouPorUserId:contato.userId||null,paymentConfirmedAt:leitura.data,paymentConfirmedByUserId:contato.userId||null,serproLastCheckResult:'CLIENTE_CONFIRMOU'}});
    if(r.count!==1)throw Object.assign(Error('Guia alterada'),{code:'P2034'});
    await tx.appSetting.update({where:{key:token},data:{value:{...v,confirmadoEm:agora.toISOString(),dataInformada:leitura.data.toISOString(),mensagemId:mensagem.id,conversaId:conversa.id}}});
    await salvarFluxo('COMPROVANTE');
    return responder('Pagamento informado em '+leitura.data.toISOString().slice(0,10).split('-').reverse().join('/')+'. Se tiver o comprovante, envie agora um PDF ou foto desta guia. É opcional: para concluir sem anexo, toque em Sem comprovante.');
   }
   if(resposta?.[2]==='no_proof'||/^sem comprovante[.!]?$/i.test(texto)){await salvarFluxo(null);return responder('Pagamento registrado com a data informada. Obrigado!');}
   if(['image','document'].includes(mensagem.tipo)&&mensagem.midiaProvedorId){
    const arquivo=await tx.arquivoWhatsapp.findUnique({where:{mensagemId:mensagem.id},include:{mensagem:{include:{conversa:true}}}});
    const origem=arquivo?.mensagem?.conversa;
    const atribuir=arquivo && !arquivo.portalClientId && origem?.telefoneE164===conversa.telefoneE164 && (origem.canalId||'principal')===(conversa.canalId||'principal');
    if(!arquivo||(arquivo.portalClientId!==v.companyId&&!atribuir))return responder('Ainda não consegui vincular o arquivo à empresa. Reenvie o comprovante nesta conversa.');
    if(arquivo.mimeType&&!['application/pdf','image/png','image/jpeg'].includes(arquivo.mimeType))return responder('Envie o comprovante em PDF, JPG ou PNG.');
    const vinculo=await tx.arquivoWhatsapp.updateMany({where:{id:arquivo.id,portalClientId:atribuir?null:v.companyId,OR:[{comprovanteGuiaId:null},{comprovanteGuiaId:guia.id}]},data:{portalClientId:v.companyId,comprovanteGuiaId:guia.id,dataPagamentoDeclarada:new Date(v.dataInformada),analiseComprovante:{status:'AGUARDANDO_ARQUIVO',guiaTipo:guia.tipo,competencia:guia.competencia,confiavel:false,contatoId:contato.id,mensagemId:mensagem.id}}});
    if(vinculo.count!==1)return responder('Este arquivo já está vinculado a outra guia. Envie o comprovante correto.');
    await salvarFluxo(null);
    return responder('Comprovante recebido para esta guia. O escritório conferirá o documento e a data; seu pagamento continua registrado como informado por você.');
   }
   return responder('Envie o comprovante em PDF ou foto, ou toque em Sem comprovante para concluir.');
  },{isolationLevel:'Serializable',timeout:15000});}catch(e){if(!['P2034','P2002'].includes(e.code)||tentativa===2)throw e;}
 }
}

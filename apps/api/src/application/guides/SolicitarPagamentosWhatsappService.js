import { prisma } from '../../infrastructure/db/prisma.js';
import { idsComRotinaAtiva } from '../fiscal/serpro/CompanyRotinasService.js';
import { avisarPagamentoNaoConfirmado } from './AvisoPagamentoService.js';
import { faseAvisoGuia } from './calendarioAvisosGuia.js';
export async function solicitarPagamentosWhatsapp({ portalClientId=null, scheduledAt, assertActive=()=>{}, agora=new Date() }={}, {db=prisma, idsAtivos=idsComRotinaAtiva, avisar=avisarPagamentoNaoConfirmado}={}) {
 if(!scheduledAt)return {total:0,resultados:[]};
 const ids=portalClientId?[portalClientId]:[...await idsAtivos('pagamento')];
 if(!ids.length)return {total:0,resultados:[]};
 const feriados=await db.feriado.findMany({});
 let cursor;const resultados=[];
 while(true){await assertActive();const guias=await db.guide.findMany({where:{portalClientId:{in:ids},status:'PROCESSED',liberadaCliente:true,baixada:false,clienteConfirmouEm:null,OR:[{paymentStatus:null},{paymentStatus:{in:['OPEN','OVERDUE']}}],...(cursor?{id:{gt:cursor}}:{})},select:{id:true,vencimento:true,portalClient:{select:{municipio:true}}},orderBy:{id:'asc'},take:100});
 for(const g of guias){await assertActive();if(!faseAvisoGuia(g.vencimento,agora,feriados,g.portalClient?.municipio))continue;
 try{resultados.push({guideId:g.id,...await avisar({guideId:g.id,scheduledAt,assertActive,agora},{db,feriados})});}catch{await assertActive();resultados.push({guideId:g.id,status:'PENDENTE',motivo:'FALHA_SOLICITACAO'});}}
 if(guias.length<100)break;cursor=guias.at(-1).id;}
 return {total:resultados.length,avisosPendentes:resultados.filter(r=>r.status==='PENDENTE').length,resultados};
}

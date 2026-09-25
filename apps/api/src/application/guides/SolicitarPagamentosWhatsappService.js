import { prisma } from '../../infrastructure/db/prisma.js';
import { idsComRotinaAtiva } from '../fiscal/serpro/CompanyRotinasService.js';
import { avisarPagamentoNaoConfirmado } from './AvisoPagamentoService.js';
import { elegibilidadeVencimentoAutomatico } from '../fiscal/serpro/ConsultaPagamentoAutomaticaService.js';
export async function solicitarPagamentosWhatsapp({ portalClientId=null, scheduledAt, assertActive=()=>{}, agora=new Date() }={}, {db=prisma, idsAtivos=idsComRotinaAtiva, avisar=avisarPagamentoNaoConfirmado}={}) {
 if(!scheduledAt)return {total:0,resultados:[]};
 const ids=portalClientId?[portalClientId]:[...await idsAtivos('pagamento')];
 if(!ids.length)return {total:0,resultados:[]};
 let cursor;const resultados=[];
 while(true){await assertActive();const guias=await db.guide.findMany({where:{portalClientId:{in:ids},status:'PROCESSED',liberadaCliente:true,baixada:false,clienteConfirmouEm:null,OR:[{paymentStatus:null},{paymentStatus:{in:['OPEN','OVERDUE']}}],...(cursor?{id:{gt:cursor}}:{})},select:{id:true,vencimento:true},orderBy:{id:'asc'},take:100});
 for(const g of guias){await assertActive();if(elegibilidadeVencimentoAutomatico(g.vencimento,agora))continue;
 try{resultados.push({guideId:g.id,...await avisar({guideId:g.id,scheduledAt,assertActive})});}catch{resultados.push({guideId:g.id,status:'PENDENTE',motivo:'FALHA_SOLICITACAO'});}}
 if(guias.length<100)break;cursor=guias.at(-1).id;}
 return {total:resultados.length,resultados};
}

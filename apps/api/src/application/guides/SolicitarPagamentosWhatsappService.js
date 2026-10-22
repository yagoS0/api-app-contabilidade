import { prisma } from '../../infrastructure/db/prisma.js';
import { idsComRotinaAtiva } from '../fiscal/serpro/CompanyRotinasService.js';
import { avisarPagamentoNaoConfirmado } from './AvisoPagamentoService.js';
import { faseAvisoGuia, calendarioAvisosGuia } from './calendarioAvisosGuia.js';
export async function solicitarPagamentosWhatsapp({ portalClientId=null, scheduledAt, assertActive=()=>{}, agora=new Date() }={}, {db=prisma, idsAtivos=idsComRotinaAtiva, avisar=avisarPagamentoNaoConfirmado}={}) {
 if(!scheduledAt)return {total:0,resultados:[]};
 const ativos=[...await idsAtivos('pagamento')];
 const ids=portalClientId?ativos.filter(id=>id===portalClientId):ativos;
 if(!ids.length)return {total:0,resultados:[]};
 const feriados=await db.feriado.findMany({});
 let cursor;const resultados=[];
 while(true){await assertActive();const guias=await db.guide.findMany({where:{portalClientId:{in:ids},status:'PROCESSED',liberadaCliente:true,baixada:false,clienteConfirmouEm:null,OR:[{paymentStatus:null},{paymentStatus:{in:['OPEN','OVERDUE']}}],...(cursor?{id:{gt:cursor}}:{})},select:{id:true,portalClientId:true,vencimento:true,portalClient:{select:{municipio:true}}},orderBy:{id:'asc'},take:100});
 for(const g of guias){await assertActive();if(!calendarioAvisosGuia(g.vencimento,feriados,g.portalClient?.municipio)){resultados.push({guideId:g.id,status:'PENDENTE',motivo:'VENCIMENTO_INVALIDO',mensagem:'Confira o vencimento da guia antes de avisar o cliente.'});continue;}if(!faseAvisoGuia(g.vencimento,agora,feriados,g.portalClient?.municipio))continue;
 try{const conferirEmpresa=async()=>{await assertActive();if(![...await idsAtivos('pagamento')].includes(g.portalClientId))throw Object.assign(new Error('Rotina desabilitada nesta empresa.'),{code:'ROTINA_EMPRESA_DESABILITADA'});};
 await conferirEmpresa();resultados.push({guideId:g.id,...await avisar({guideId:g.id,scheduledAt,assertActive:conferirEmpresa,agora},{db,feriados})});}catch{await assertActive();resultados.push({guideId:g.id,status:'PENDENTE',motivo:'FALHA_SOLICITACAO'});}}
 if(guias.length<100)break;cursor=guias.at(-1).id;}
 return {total:resultados.length,avisosPendentes:resultados.filter(r=>r.status==='PENDENTE').length,resultados,results:resultados};
}

import { prisma } from '../../infrastructure/db/prisma.js';
import { lerDataWhatsapp } from './ConfirmarPagamentoWhatsappService.js';
export function extrairSugestoesComprovante(texto, declarada, agora=new Date()) {
 const datas=[...String(texto||'').matchAll(/data\s+(?:do\s+)?pagamento\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/gi)].map(m=>lerDataWhatsapp(m[1],agora).data?.toISOString().slice(0,10)).filter(Boolean);
 const valores=[...String(texto||'').matchAll(/valor\s+(?:total\s+)?(?:pago|do\s+pagamento)\s*[:\-]?\s*(?:R\$\s*)?([\d.]+,\d{2})/gi)].map(m=>Number(m[1].replaceAll('.','').replace(',','.'))).filter(Number.isFinite);
 const data=[...new Set(datas)],valor=[...new Set(valores)];
 const dataLida=data.length===1?data[0]:null,valorLido=valor.length===1?valor[0]:null;
 return {status:'AGUARDA_CONFERENCIA',confiavel:false,dataLida,valorLido,dataDivergente:Boolean(dataLida&&declarada&&dataLida!==new Date(declarada).toISOString().slice(0,10)),motivo:data.length>1||valor.length>1?'LEITURA_AMBIGUA':!dataLida?'DATA_NAO_IDENTIFICADA':'CONFERIR_DOCUMENTO_E_GUIA'};
}
async function textoPdf(buffer){const {default:parse}=await import('pdf-parse/lib/pdf-parse.js');return (await parse(buffer,{max:10})).text;}
export async function analisarComprovantesCliente({db=prisma,lerPdf=textoPdf,agora=new Date()}={}){
 const arquivos=await db.arquivoWhatsapp.findMany({where:{comprovanteGuiaId:{not:null},estado:'DISPONIVEL',analiseComprovante:{path:['status'],equals:'AGUARDANDO_ARQUIVO'}},take:10,orderBy:{recebidoEm:'asc'}});
 for(const a of arquivos){
  const guia=await db.guide.findFirst({where:{id:a.comprovanteGuiaId,portalClientId:a.portalClientId},select:{id:true}});if(!guia)continue;
  let leitura;try{leitura=a.mimeType==='application/pdf'?extrairSugestoesComprovante(await lerPdf(Buffer.from(a.conteudo)),a.dataPagamentoDeclarada,agora):{status:'AGUARDA_CONFERENCIA',confiavel:false,motivo:'FOTO_REQUER_CONFERENCIA'};}catch{leitura={status:'AGUARDA_CONFERENCIA',confiavel:false,motivo:'LEITURA_INDISPONIVEL'};}
  await db.arquivoWhatsapp.updateMany({where:{id:a.id,portalClientId:a.portalClientId,comprovanteGuiaId:a.comprovanteGuiaId,sha256:a.sha256,analiseComprovante:{path:['status'],equals:'AGUARDANDO_ARQUIVO'}},data:{analiseComprovante:{...a.analiseComprovante,...leitura,analisadoEm:agora.toISOString()}}});
 }
 return {analisados:arquivos.length};
}

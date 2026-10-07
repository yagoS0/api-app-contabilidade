import { createHash } from 'node:crypto';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { computeSaldoProvisao } from '../saldoProvisao.js';
import { familiaDaModalidade } from './contracts.js';
import { resumoOrigensParcelamento } from '../../../../../../packages/shared/src/accounting/composicaoParcelamento.js';

export const composicaoHabilitada = () => process.env.PARCELAMENTO_ORIGENS_ENABLED === 'true';
export class ComposicaoError extends Error {
 constructor(code,message,status=409){super(message);this.code=code;this.status=status;}
}
const cents=n=>Math.round(Number(n)*100);
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const tributo=e=>({SIMPLES:'DAS',DAS_SIMPLES:'DAS'})[e.subtipo || e.eventType] || e.subtipo || e.eventType || 'Tributo';
const codigos={PIS:'8109',COFINS:'2172',IRPJ:'2089',CSLL:'2372'};
function compativel(tipo,imposto){
 const familia=familiaDaModalidade(tipo);
 if(familia) return ['DAS','SIMPLES','MEI'].includes(imposto);
 if(tipo==='INSS')return imposto==='INSS';
 if(tipo==='LUCRO_PRESUMIDO')return Object.hasOwn(codigos,imposto);
 return tipo==='OUTRO';
}
export async function bloquearComposicaoEmpresa(tx,portalClientId){
 await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${'origens-parcelamento:'+portalClientId}))`;
}
export async function candidatosComposicao({portalClientId,tipo,parcelamentoId=null},db=prisma){
 const [entries,guias,vinculos]=await Promise.all([
  db.accountingEntry.findMany({where:{portalClientId,tipo:'PROVISAO'},include:{lines:true,baixas:{include:{lines:true}},sourceGuide:true},orderBy:[{competencia:'asc'},{id:'asc'}]}),
  db.guide.findMany({where:{portalClientId,tipo:{in:['INSS','SIMPLES']},parcelamentoId:null},orderBy:[{competencia:'asc'},{id:'asc'}]}),
  db.parcelamentoDebitoOrigem.findMany({where:{portalClientId},include:{parcelamento:{select:{status:true,numeroParcelamento:true}}}}),
 ]);
 const porChave=new Map(vinculos.map(v=>[v.origemChave,v]));
 const guiasRepresentadas=new Set(entries.map(e=>e.sourceGuideId).filter(Boolean));
 const dasRepresentados=new Set(entries.filter(e=>tributo(e)==='DAS').map(e=>e.competencia));
 const candidatos=entries.filter(e=>['ABERTO','PARCIAL'].includes(e.statusPagamento) && !String(e.subtipo || '').startsWith('PARC') && e.origem!=='TEMPLATE').map(e=>{
  const info=computeSaldoProvisao(e),credito=e.lines.filter(l=>l.tipo==='C' && Number(l.valor)>0);
  return {chave:'entry:'+e.id,entryId:e.id,guideId:e.sourceGuideId || null,tributo:tributo(e),competencia:e.competencia,
   vencimento:e.sourceGuide?.vencimento?.toISOString?.().slice(0,10) || null,saldo:info.saldo,contaPassivo:credito.length===1?credito[0].conta:null,
   codigoTributo:e.codigoTributo || codigos[tributo(e)] || null,historico:e.historico,
   legado:e.parcelamentoId || null,versao:digest([e.updatedAt,e.lines,e.baixas]),semProvisao:false};
 });
 for(const g of guias){
  if(guiasRepresentadas.has(g.id) || g.tipo==='SIMPLES' && dasRepresentados.has(g.competencia) || g.numeroParcela || g.baixada || ['PAGO','PAID','CONFIRMADO'].includes(g.paymentStatus))continue;
  candidatos.push({chave:'guide:'+g.id,guideId:g.id,entryId:null,tributo:g.tipo==='SIMPLES'?'DAS':'INSS',competencia:g.competencia,
   vencimento:g.vencimento?.toISOString?.().slice(0,10) || null,saldo:Number(g.valor),contaPassivo:null,codigoTributo:null,historico:'Guia sem provisão contábil',semProvisao:true,versao:digest([g.updatedAt,g.valor,g.paymentStatus,g.lancamentoId])});
 }
 return candidatos.filter(c=>Number.isFinite(c.saldo)&&c.saldo>0).map(c=>{
  const v=porChave.get(c.chave) || (c.guideId && porChave.get('guide:'+c.guideId));
  const motivo=c.legado&&c.legado!==parcelamentoId?'Vínculo antigo: revisar composição no acordo correspondente.':v?'Já incluído em outro acordo.':!compativel(tipo,c.tributo)?'Tributo incompatível com a modalidade.':!c.semProvisao&&!c.contaPassivo?'Confira a conta do passivo na provisão original.':null;
  return {...c,elegivel:!motivo,motivo,parcelamentoId:v?.parcelamentoId || c.legado || null};
 });
}
export async function incluirComposicaoTx(tx,{portalClientId,parcelamento,origens,userId,provisaoLines,permitirExistente=false}){
 if(!Array.isArray(origens)||!origens.length)return [];
 if(origens.length>500 || origens.some(o=>!o || typeof o.chave!=='string' || !Number.isFinite(Number(o.saldo)) || Number(o.saldo)<=0) || new Set(origens.map(o=>o.chave)).size!==origens.length)throw new ComposicaoError('ORIGENS_INVALIDAS','Selecione até 500 dívidas distintas com saldo positivo.',400);
 await bloquearComposicaoEmpresa(tx,portalClientId);
 const atual=await tx.parcelamento.findFirst({where:{id:parcelamento.id,portalClientId}});
 if(!atual || atual.status!=='ATIVO')throw new ComposicaoError('ACORDO_INATIVO','Selecione um acordo ativo.');
 parcelamento=atual;
 const anteriores=await tx.parcelamentoDebitoOrigem.findMany({where:{portalClientId,parcelamentoId:parcelamento.id}});
 if(anteriores.length){
  if(anteriores.length===origens.length && anteriores.every(a=>origens.some(o=>o.chave===a.origemChave && cents(o.saldo)===cents(a.principalIncluido))))return anteriores;
  throw new ComposicaoError('COMPOSICAO_EXISTENTE','Este acordo já tem composição. Revise o ato existente antes de alterar as origens.');
 }
 if(parcelamento.aberturaEntryId&&!permitirExistente)throw new ComposicaoError('ACORDO_JA_CONTABILIZADO','Acordo já contabilizado: confira a reclassificação antes de incluir novas dívidas.');
 const candidatos=await candidatosComposicao({portalClientId,tipo:parcelamento.tipo,parcelamentoId:permitirExistente?parcelamento.id:null},tx),selecionados=[];
 for(const entrada of origens){
  const c=candidatos.find(o=>o.chave===entrada.chave);
  if(!c || !c.elegivel)throw new ComposicaoError('ORIGEM_INDISPONIVEL',c?.motivo || 'Uma dívida selecionada não está mais disponível. Atualize a seleção.');
  if(entrada.versao!==c.versao || cents(entrada.saldo)!==cents(c.saldo))throw new ComposicaoError('ORIGEM_MUDOU','O saldo ou a provisão mudou. Atualize a seleção antes de confirmar.');
  selecionados.push(c);
 }
 const total=selecionados.reduce((s,o)=>s+cents(o.saldo),0);
 if(total!==cents(parcelamento.principalTotal))throw new ComposicaoError('PRINCIPAL_DIVERGENTE','O principal do acordo deve conferir com o saldo das dívidas selecionadas.');
 // O principal já reconhecido transfere o passivo; não reconhece a despesa uma segunda vez.
 if(!Array.isArray(provisaoLines)||!provisaoLines.length||provisaoLines.some(l=>!l || !['D','C'].includes(l.tipo)||!String(l.conta || '').trim()||!Number.isFinite(Number(l.valor))||Number(l.valor)<0))throw new ComposicaoError('PROVISAO_INVALIDA','Confira valores, contas e lados dos lançamentos de abertura.',400);
 const soma=lado=>provisaoLines.filter(l=>l.tipo===lado).reduce((s,l)=>s+cents(l.valor || 0),0);
 if(soma('D')!==soma('C') || !Number.isFinite(soma('D')))throw new ComposicaoError('PROVISAO_DESBALANCEADA','Confira os débitos e créditos da abertura.');
 const exigido=new Map(),debitos=new Map();
 for(const o of selecionados.filter(o=>!o.semProvisao)){const k=o.contaPassivo+'|'+(o.codigoTributo||'');exigido.set(k,(exigido.get(k)||0)+cents(o.saldo));}
 for(const l of provisaoLines || [])if(l.tipo==='D' && l.tipoLinha==='PRINCIPAL'){const k=l.conta+'|'+(l.codigoTributo||'');debitos.set(k,(debitos.get(k)||0)+cents(l.valor));}
 for(const [k,v] of exigido)if(debitos.get(k)!==v)throw new ComposicaoError('RECLASSIFICACAO_DIVERGENTE','Confira os débitos de principal contra as contas do passivo das provisões selecionadas.');
 if([...debitos.values()].reduce((s,v)=>s+v,0)!==total)throw new ComposicaoError('RECLASSIFICACAO_DIVERGENTE','O principal dos lançamentos deve ser igual ao principal selecionado.');
 const resultado=[];
 for(const o of selecionados){
  // Conversão explícita do legado do próprio acordo: o snapshot preserva o vínculo anterior.
  // A reclassificação foi conferida acima; nenhuma linha D/C da origem é alterada.
  if(o.legado && o.entryId)await tx.accountingEntry.update({where:{id:o.entryId},data:{parcelamentoId:null}});
  resultado.push(await tx.parcelamentoDebitoOrigem.create({data:{portalClientId,parcelamentoId:parcelamento.id,origemChave:o.chave,entryId:o.entryId,guideId:o.guideId,tributo:o.tributo,competencia:o.competencia,principalIncluido:o.saldo,snapshot:o,criadoPorId:userId || null}}));
 }
 return resultado;
}
export async function enriquecerOrigens(db,portalClientId,entries){
 const vinculos=await db.parcelamentoDebitoOrigem.findMany({where:{portalClientId},include:{parcelamento:{select:{status:true,numeroParcelamento:true}}}});
 const legados=entries.filter(e=>e.parcelamentoId && !String(e.subtipo || '').startsWith('PARC'));
 const contratos=legados.length?await db.parcelamento.findMany({where:{portalClientId,id:{in:[...new Set(legados.map(e=>e.parcelamentoId))]}},select:{id:true,numeroParcelamento:true}}):[];
 return entries.map(e=>{
  const v=vinculos.find(o=>o.entryId===e.id || !o.entryId && (e.sourceGuideId===o.guideId || e.id==='synthetic-inss-'+o.guideId || e.id==='synthetic-das-'+o.guideId));
  if(v)return {...e,parcelamentoOrigem:{id:v.id,parcelamentoId:v.parcelamentoId,numero:v.parcelamento.numeroParcelamento,statusContrato:v.parcelamento.status,principalIncluido:Number(v.principalIncluido)}};
  const legado=contratos.find(p=>p.id===e.parcelamentoId);
  return legado?{...e,parcelamentoOrigem:{id:'legado:'+e.id,parcelamentoId:legado.id,numero:legado.numeroParcelamento,statusContrato:'A_CONCILIAR',legado:true,principalIncluido:null}}:e;
 });
}
export async function exigirBaixaForaDaComposicao(tx,portalClientId,entryId,guideId=null){
 await bloquearComposicaoEmpresa(tx,portalClientId);
 const v=await tx.parcelamentoDebitoOrigem.findFirst({where:{portalClientId,OR:[...(entryId?[{entryId}]:[]),...(guideId?[{guideId,entryId:null}]:[])]}});
 if(v)throw new ComposicaoError('DIVIDA_PARCELADA','A dívida integra um parcelamento. Confira o acordo para registrar o pagamento.');
}
export { resumoOrigensParcelamento };

export async function salvarComposicaoExistente({portalClientId,parcelamentoId,origens,userId},db=prisma){
 return db.$transaction(async tx=>{
  await bloquearComposicaoEmpresa(tx,portalClientId);
  const p=await tx.parcelamento.findFirst({where:{id:parcelamentoId,portalClientId}});
  if(!p)throw new ComposicaoError('ACORDO_NAO_ENCONTRADO','Parcelamento não encontrado.',404);
  const lancamentos=await tx.accountingEntry.findMany({where:{portalClientId,parcelamentoId,tipo:'PROVISAO',subtipo:{startsWith:'PARC_'},numeroParcela:null},include:{lines:true}});
  const provisaoLines=lancamentos.filter(e=>!String(e.loteImportacao || '').includes('RESCISAO')).flatMap(e=>e.lines);
  if(!provisaoLines.length)throw new ComposicaoError('ABERTURA_INEXISTENTE','Contabilize a abertura do acordo antes de vincular dívidas.');
  return incluirComposicaoTx(tx,{portalClientId,parcelamento:p,origens,userId,provisaoLines,permitirExistente:true});
 });
}

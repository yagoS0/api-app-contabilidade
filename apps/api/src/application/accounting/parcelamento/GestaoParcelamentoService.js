import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { competenciasFechadas } from '../fechamentoContabil.js';
import { quadroGestaoParcelamento } from '../../../../../../packages/shared/src/accounting/gestaoParcelamento.js';

export class GestaoParcelamentoError extends Error {
  constructor(message, status=409) { super(message); this.status=status; this.code='GESTAO_PARCELAMENTO'; }
}
const recusar = (s,status) => { throw new GestaoParcelamentoError(s,status); };
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const civil = x => x ? new Date(x).toISOString().slice(0,10) : null;
const cents = x => Math.round(Number(x)*100);
function dataCivil(x) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x || '') || !Number.isFinite(new Date(x).getTime()) || civil(x)!==x) recusar('Informe um vencimento válido.',400);
  return new Date(x+'T12:00:00Z');
}
export async function carregarGestaoParcelamento({companyId,parcelamentoId},db=prisma) {
  const acordo=await db.parcelamento.findFirst({where:{id:parcelamentoId,portalClientId:companyId, status:{not:'EXCLUIDO'}},include:{
    parcelasContratadas:{orderBy:{numeroParcela:'asc'},include:{guia:{select:{id:true,numeroParcela:true,competencia:true,vencimento:true,valor:true,paymentStatus:true,paymentStatusSource:true,clienteConfirmouEm:true,baixada:true,lancamentoId:true,updatedAt:true}}}},
    debitosOrigem:true,
  }});
  if(!acordo)recusar('Parcelamento não encontrado.',404);
  const lancamentos=await db.accountingEntry.findMany({where:{portalClientId:companyId,parcelamentoId},orderBy:{id:'asc'},select:{id:true,numeroParcela:true,sourceGuideId:true,tipo:true,status:true,competencia:true,updatedAt:true,openEntryId:true,lines:{orderBy:{ordem:'asc'},select:{tipo:true,tipoLinha:true,valor:true}}}});
  const revisao=hash([acordo,lancamentos]);
  return {acordo,lancamentos,revisao};
}
export async function consultarGestaoParcelamento(args,db=prisma) {
  const base=await carregarGestaoParcelamento(args,db);
  const eventos=await db.appSetting.findMany({where:{key:{startsWith:`parcelamento_gestao:${args.parcelamentoId}:`}},orderBy:{key:'desc'},take:100});
  const acordo={...base.acordo,parcelasContratadas:base.acordo.parcelasContratadas.map(p=>{
    const baixas=base.lancamentos.filter(e=>e.tipo==='BAIXA'&&(p.guiaId?e.sourceGuideId===p.guiaId:!e.sourceGuideId&&e.numeroParcela===p.numeroParcela));
    const creditos=baixas.flatMap(e=>e.lines).filter(l=>l.tipo==='C');
    return {...p,valorBaixa:creditos.length?creditos.reduce((s,l)=>s+Number(l.valor),0):null};
  })};
  return {...base,acordo,eventos:eventos.map(e=>e.value),quadro:quadroGestaoParcelamento(acordo,args.referencia || new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date()).slice(0,7))};
}
export async function auditarGestao(tx,{companyId,parcelamentoId,userId,tipo,antes,depois,motivo}) {
  await tx.appSetting.create({data:{key:`parcelamento_gestao:${parcelamentoId}:${Date.now()}:${randomUUID()}`,value:{companyId,parcelamentoId,userId,tipo,antes:JSON.parse(JSON.stringify(antes)),depois:JSON.parse(JSON.stringify(depois)),motivo,em:new Date().toISOString()}}});
}
export async function preverCorrecaoParcelamento(args,db=prisma) {
  const base=await carregarGestaoParcelamento(args,db);
  const {acordo,lancamentos}=base;
  if(acordo.status!=='ATIVO')recusar('Somente acordos ativos podem ser corrigidos. Revise a situação do contrato.');
  const body=args.alteracao || {};
  if(typeof body.motivo!=='string'||body.motivo.trim().length<5)recusar('Informe o motivo da correção (mínimo de 5 caracteres).',400);
  const rows=body.parcelas;
  if(!Array.isArray(rows)||rows.length!==acordo.parcelasContratadas.length || rows.length>1000)recusar('Confira o cronograma completo antes de corrigir.',400);
  const ids=new Set(), numeros=new Set(),alteracoes=[];
  const normalizadas=[];
  for(const row of rows){
    const p=acordo.parcelasContratadas.find(p=>p.id===row.id);
    if(!p||ids.has(row.id))recusar('O cronograma contém parcelas inválidas ou repetidas.',400);
    ids.add(row.id);
    const n=Number(row.numeroParcela), valor=Number(row.valorPrevisto);
    if(!Number.isInteger(n)||n<1||n>Number(acordo.numParcelas)||numeros.has(n))recusar('A numeração deve ser única e estar dentro do total contratado.',400);
    numeros.add(n);
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(row.competencia||''))recusar('Informe a referência de cada parcela.',400);
    const vencimento=dataCivil(row.vencimento);
    if(!Number.isFinite(valor)||valor<=0||Math.abs(valor*100-cents(valor))>0.00001)recusar('Informe valores positivos com até duas casas decimais.',400);
    if(!['ENTRADA','PARCELA'].includes(row.tipo))recusar('Informe o tipo da parcela.',400);
    const tipo=row.tipo;
    const oldTipo=acordo.cronogramaParcelas?.find(c=>c.numeroParcela===p.numeroParcela)?.tipo || (p.numeroParcela<=acordo.numEntradas?'ENTRADA':'PARCELA');
    const antes={numeroParcela:p.numeroParcela,competencia:p.competencia,vencimento:civil(p.vencimento),valorPrevisto:p.valorPrevisto==null?null:Number(p.valorPrevisto),tipo:oldTipo};
    const depois={numeroParcela:n,competencia:row.competencia,vencimento:row.vencimento,valorPrevisto:valor,tipo};
    const entries=lancamentos.filter(e=>e.sourceGuideId ? e.sourceGuideId===p.guiaId : e.numeroParcela!=null && e.numeroParcela===p.numeroParcela);
    const protegida=Boolean(p.origemBaixa||p.pagamentoStatus==='CONFIRMADO'||p.guia?.paymentStatus==='PAID'||p.guia?.baixada||entries.length);
    if(protegida && (cents(antes.valorPrevisto)!==cents(valor)||antes.competencia!==depois.competencia||antes.vencimento!==depois.vencimento||antes.tipo!==tipo))recusar(`Parcela ${p.numeroParcela}: pagamento ou lançamento existente. Preserve valores e datas; ajuste a numeração ou revise a baixa nos Lançamentos.`);
    if(p.guiaId && (antes.competencia!==depois.competencia||antes.vencimento!==depois.vencimento))recusar(`Parcela ${p.numeroParcela}: corrija a competência da guia na aba Guias. O vencimento do documento é preservado.`);
    if(hash(antes)!==hash(depois)){
      if((await competenciasFechadas(args.companyId,[p.competencia,row.competencia,...entries.map(e=>e.competencia)],db)).size)recusar(`Parcela ${p.numeroParcela}: há competência fechada. Reabra antes de corrigir.`);
      alteracoes.push({id:p.id,antes,depois,guiaId:p.guiaId,lancamentos:entries.map(e=>e.id)});
    }
    normalizadas.push({id:p.id,...depois});
  }
  const cadastro={label:String(body.label??acordo.label).trim(),numeroParcelamento:String(body.numeroParcelamento??acordo.numeroParcelamento??'').trim()||null,observacoes:String(body.observacoes??acordo.observacoes??'').trim(),formaPagamento:body.formaPagamento===undefined?acordo.formaPagamento:body.formaPagamento||null};
  if(!cadastro.label||cadastro.label.length>200||cadastro.observacoes.length>4000||![null,'GUIA_MENSAL','DEBITO_AUTOMATICO'].includes(cadastro.formaPagamento))recusar('Confira nome, descrição e forma de pagamento.',400);
  if(cadastro.numeroParcelamento && cadastro.numeroParcelamento!==acordo.numeroParcelamento && await db.parcelamento.findFirst({where:{portalClientId:args.companyId,tipo:acordo.tipo,numeroParcelamento:cadastro.numeroParcelamento,id:{not:acordo.id}}}))recusar('Já existe um acordo com esse número e modalidade.');
  const ordenadas=[...normalizadas].sort((a,b)=>a.numeroParcela-b.numeroParcela);
  let encontrouParcela=false;
  for(const p of ordenadas){if(p.tipo==='PARCELA')encontrouParcela=true;else if(encontrouParcela)recusar('As entradas devem preceder as parcelas normais.',400);}
  const cadastroAnterior={label:acordo.label,numeroParcelamento:acordo.numeroParcelamento,observacoes:acordo.observacoes||'',formaPagamento:acordo.formaPagamento};
  return {companyId:args.companyId,parcelamentoId:acordo.id,revisao:base.revisao,alteracoes,cadastro,cadastroAnterior,parcelas:normalizadas,motivo:body.motivo.trim(),confirmacao:hash([base.revisao,cadastro,normalizadas,body.motivo.trim()])};
}
export async function corrigirParcelamento(args,db=prisma) {
  if(!args.userId||!args.confirmacao)recusar('Confira a alteração antes de confirmar.',400);
  try{return await db.$transaction(async tx=>{
    const preview=await preverCorrecaoParcelamento(args,tx);
    if(preview.confirmacao!==args.confirmacao)recusar('Os dados mudaram. Confira novamente antes de salvar.');
    const atual=await carregarGestaoParcelamento(args,tx);
    // Numeração temporariamente nula permite trocar números sem violar a chave única.
    // A transação serializável impede uma baixa concorrente sobre a versão antiga.
    for(const a of preview.alteracoes.filter(a=>a.antes.numeroParcela!==a.depois.numeroParcela)){
      await tx.parcela.update({where:{id:a.id},data:{numeroParcela:null}});
      if(a.lancamentos.length)await tx.accountingEntry.updateMany({where:{portalClientId:args.companyId,id:{in:a.lancamentos}},data:{numeroParcela:null}});
    }
    for(const a of preview.alteracoes){
      await tx.parcela.update({where:{id:a.id},data:{numeroParcela:a.depois.numeroParcela,competencia:a.depois.competencia,anoMesParcela:a.depois.competencia.replace('-',''),vencimento:dataCivil(a.depois.vencimento),valorPrevisto:a.depois.valorPrevisto}});
      if(a.guiaId && a.antes.numeroParcela!==a.depois.numeroParcela)await tx.guide.update({where:{id:a.guiaId},data:{numeroParcela:a.depois.numeroParcela}});
      if(a.lancamentos.length && a.antes.numeroParcela!==a.depois.numeroParcela)await tx.accountingEntry.updateMany({where:{portalClientId:args.companyId,id:{in:a.lancamentos}},data:{numeroParcela:a.depois.numeroParcela}});
    }
    const cronograma=preview.parcelas.map(({id,valorPrevisto,...p})=>({...p,valorPrevisto})).sort((a,b)=>a.numeroParcela-b.numeroParcela);
    await tx.parcelamento.update({where:{id:args.parcelamentoId},data:{...preview.cadastro,cronogramaParcelas:cronograma,numEntradas:cronograma.filter(p=>p.tipo==='ENTRADA').length}});
    await auditarGestao(tx,{...args,tipo:'CORRECAO_CADASTRO',antes:{cadastro:preview.cadastroAnterior,parcelas:atual.acordo.parcelasContratadas.map(p=>({id:p.id,numeroParcela:p.numeroParcela,competencia:p.competencia,vencimento:p.vencimento,valorPrevisto:p.valorPrevisto}))},depois:{cadastro:preview.cadastro,parcelas:preview.parcelas},motivo:preview.motivo});
    return {ok:true,parcelamentoId:args.parcelamentoId,alteradas:preview.alteracoes.length};
  },{isolationLevel:'Serializable',timeout:20000});}catch(e){if(e.code==='P2034'||e.code==='P2002')recusar('Houve uma alteração simultânea ou conflito de numeração. Recarregue e confira.');throw e;}
}

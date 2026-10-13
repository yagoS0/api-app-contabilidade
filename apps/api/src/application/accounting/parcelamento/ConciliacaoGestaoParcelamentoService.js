import { createHash } from 'node:crypto';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { carregarGestaoParcelamento, auditarGestao, GestaoParcelamentoError } from './GestaoParcelamentoService.js';
import { validarLinhasBaixa } from './BaixaGestaoParcelamentoService.js';
import { competenciasFechadas } from '../fechamentoContabil.js';
import { conferenciaDoPassivoPorContrato } from './ParcelamentoV2Service.js';
import { ORIGEM_BAIXA } from '../ancoraBaixa.js';

const fail=message=>{throw new GestaoParcelamentoError(message);};
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const cent=x=>Math.round(Number(x)*100);

export async function candidatosConciliacao({companyId},db=prisma){
  // Apenas lotes de pagamento ainda sem vínculo. Não convertemos despesas em baixa.
  const entries=await db.accountingEntry.findMany({where:{portalClientId:companyId,tipo:'BAIXA',parcelamentoId:null,sourceGuideId:null,openEntryId:null,loteImportacao:{not:null},status:{not:'EXPORTADO'}},include:{lines:{orderBy:{ordem:'asc'}}},orderBy:[{data:'desc'},{id:'asc'}],take:500});
  const grupos=new Map();
  for(const e of entries){const g=grupos.get(e.loteImportacao)||[];g.push(e);grupos.set(e.loteImportacao,g);}
  return [...grupos].map(([lote,es])=>({lote,entries:es,ids:es.map(e=>e.id),competencia:es[0].competencia,historico:es[0].historico,principal:es.flatMap(e=>e.lines).filter(l=>l.tipo==='D'&&l.tipoLinha==='PARC').reduce((s,l)=>s+Number(l.valor),0)})).filter(g=>g.principal>0);
}

export async function preverConciliacao(args,db=prisma){
  const base=await carregarGestaoParcelamento(args,db),{acordo,lancamentos}=base;
  const pedido=args.conciliacao||{};
  if(!args.userId||String(pedido.motivo||'').trim().length<5)fail('Informe o motivo da conciliação.');
  if(acordo.status!=='ATIVO'||!acordo.aberturaEntryId)fail('O contrato deve estar ativo e possuir provisão.');
  if(!Array.isArray(pedido.parcelaIds))fail('Selecione as parcelas a conciliar.');
  const ids=[...new Set(pedido.parcelaIds)];
  if(!ids.length||ids.length>1000)fail('Selecione as parcelas a conciliar.');
  const parcelas=ids.map(id=>acordo.parcelasContratadas.find(p=>p.id===id));
  if(parcelas.some(p=>!p||!p.numeroParcela||p.origemBaixa||p.guia?.baixada||p.guia?.lancamentoId||lancamentos.some(e=>e.tipo==='BAIXA'&&(e.numeroParcela===p.numeroParcela||p.guiaId&&e.sourceGuideId===p.guiaId))))fail('Há parcela inválida ou já contabilizada na seleção.');
  let grupo=null,conferencia=null;
  if(pedido.tipo==='HISTORICO'){
    const corte=pedido.dataCorte;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(corte||'')||!Number.isFinite(new Date(corte).getTime())||new Date(corte).toISOString().slice(0,10)!==corte)fail('Informe a data de início do acompanhamento.');
    if(corte>new Date().toISOString().slice(0,10))fail('O início do acompanhamento não pode estar no futuro.');
    if(parcelas.some(p=>!(Number(p.valorPrevisto)>0)||!p.vencimento||new Date(p.vencimento).toISOString().slice(0,10)>=corte||p.guiaId||p.pagamentoStatus==='CONFIRMADO'))fail('Histórico anterior só aceita parcelas com valor e vencimento definidos, sem guia ou confirmação fiscal e anteriores à data de corte.');
    if(acordo.dataAbertura&&corte>new Date(acordo.dataAbertura).toISOString().slice(0,10))fail('A data de corte deve ser anterior ou igual à abertura contábil.');
    conferencia=(await conferenciaDoPassivoPorContrato(db,{portalClientId:args.companyId,parcelamentoIds:[acordo.id]}))[acordo.id];
    const saldoRestante=conferencia.somaPrestacoes-parcelas.reduce((s,p)=>s+Number(p.valorPrevisto||0),0);
    if(conferencia.principalProvisionado==null||cent(saldoRestante)!==cent(conferencia.principalProvisionado))fail('O saldo da provisão ainda inclui essas parcelas ou diverge do cronograma. Confira a abertura nos Lançamentos antes de declarar o histórico; nenhum lançamento será apagado.');
    if((await competenciasFechadas(args.companyId,parcelas.map(p=>p.competencia),db)).size)fail('Há competência fechada na seleção. Reabra antes de conciliar.');
    conferencia={...conferencia,saldoRestante};
  }else if(pedido.tipo==='VINCULO'){
    if(parcelas.length!==1)fail('Vincule um lote a uma parcela por vez.');
    grupo=(await candidatosConciliacao(args,db)).find(g=>g.lote===pedido.lote);
    if(!grupo)fail('O lote não está mais disponível para vínculo.');
    // A busca limitada não pode autorizar vincular parte de um lote maior.
    const inteiro=await db.accountingEntry.count({where:{portalClientId:args.companyId,loteImportacao:grupo.lote}});
    if(inteiro!==grupo.entries.length)fail('O lote contém outros lançamentos. Confira-o na aba Lançamentos.');
    if(new Set(grupo.entries.map(e=>e.competencia)).size!==1||new Set(grupo.entries.map(e=>e.data.toISOString().slice(0,10))).size!==1)fail('O lote deve representar um pagamento na mesma data e competência.');
    const ls=grupo.entries.flatMap(e=>e.lines.map(l=>({...l,historico:e.historico})));
    validarLinhasBaixa(ls,parcelas[0].valorPrevisto);
    if((await competenciasFechadas(args.companyId,grupo.entries.map(e=>e.competencia),db)).size)fail('O lote está em competência fechada. Reabra antes de vincular.');
  }else fail('Escolha vínculo de lançamento ou histórico anterior.');
  const normalizado={...pedido,parcelaIds:ids,motivo:pedido.motivo.trim()};
  return {base,parcelas,grupo,conferencia,pedido:normalizado,confirmacao:hash([base.revisao,normalizado,grupo,conferencia])};
}

export async function executarConciliacao(args,db=prisma){
  try{return await db.$transaction(async tx=>{
    const p=await preverConciliacao(args,tx);
    if(!args.confirmacao||args.confirmacao!==p.confirmacao)fail('Confira novamente a conciliação: os dados podem ter mudado.');
    const {acordo}=p.base;
    if(p.pedido.tipo==='HISTORICO'){
      for(const parcela of p.parcelas)await tx.parcela.update({where:{id:parcela.id},data:{origemBaixa:ORIGEM_BAIXA.HISTORICO,baixadaEm:new Date()}});
    }else{
      const parcela=p.parcelas[0],entries=p.grupo.entries;
      await tx.accountingEntry.updateMany({where:{portalClientId:args.companyId,id:{in:p.grupo.ids}},data:{parcelamentoId:acordo.id,numeroParcela:parcela.numeroParcela,openEntryId:acordo.aberturaEntryId,sourceGuideId:parcela.guiaId}});
      if(parcela.guiaId)await tx.guide.update({where:{id:parcela.guiaId},data:{baixada:true,lancamentoId:entries[0].id,dataBaixa:entries[0].data}});
      else await tx.parcela.update({where:{id:parcela.id},data:{origemBaixa:ORIGEM_BAIXA.MANUAL,baixadaEm:entries[0].data}});
    }
    await auditarGestao(tx,{...args,tipo:p.pedido.tipo==='HISTORICO'?'HISTORICO_ANTERIOR':'VINCULO_EXISTENTE',antes:{parcelas:p.parcelas,lancamentos:p.grupo?.entries||[]},depois:{pedido:p.pedido,conferencia:p.conferencia},motivo:p.pedido.motivo});
    return {ok:true,parcelas:p.parcelas.length,lancamentosCriados:0};
  },{isolationLevel:'Serializable',timeout:20000});}catch(e){if(['P2034','P2002'].includes(e.code))fail('Houve uma alteração simultânea. Recarregue e confira os vínculos.');throw e;}
}

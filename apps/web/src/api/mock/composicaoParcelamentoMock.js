// Estado apenas da demonstração. Nunca usado como fallback de respostas reais.
import { projetarPendenciasContabeis } from '../../../../../packages/shared/src/fiscal/pendenciasContabeis.js';
const composicoes=new Map();
const filas=new Map();
const cents=n=>Math.round(Number(n)*100);
export function withComposicaoParcelamentoMock(api,getEntries){
 const original={...api};
 const daEmpresa=id=>{if(!composicoes.has(id))composicoes.set(id,[]);return composicoes.get(id);};
 const metodoOriginal=(name,...args)=>original[name](...args);
 const serializar=(companyId,fn)=>{const anterior=filas.get(companyId)||Promise.resolve();const atual=anterior.catch(()=>{}).then(fn);filas.set(companyId,atual);return atual;};
 const enriquecer=async(companyId,entries)=>{
  const contratos=await metodoOriginal('listParcelamentos',companyId);
  return entries.map(e=>{const o=daEmpresa(companyId).find(o=>o.entryId===e.id),p=o&&contratos.find(p=>p.id===o.parcelamentoId);return o?{...e,pendenciaFechamento:false,parcelamentoOrigem:{id:o.id,parcelamentoId:o.parcelamentoId,numero:p?.numeroParcelamento,statusContrato:p?.status || 'A_CONCILIAR',principalIncluido:o.principalIncluido}}:e;});
 };
 api.listDebitosCircularParcelamento=async(companyId,tipo,parcelamentoId)=>{
  let entries=getEntries(companyId);
  if(!entries.length)entries=(await metodoOriginal('getCircular',companyId,{year:new Date().getFullYear()})).provisoes;
  const rows=entries.filter(e=>e.tipo==='PROVISAO'&&!e.placeholder&&e.origem!=='TEMPLATE'&&!String(e.subtipo || '').startsWith('PARC')&&['ABERTO','PARCIAL'].includes(e.statusPagamento)).map(e=>{
   const tributo=['SIMPLES','DAS_SIMPLES'].includes(e.subtipo || e.eventType)?'DAS':e.subtipo || e.eventType;
   const saldo=Number(e.saldo??e.valor??e.totalD??(e.lines||[]).filter(l=>l.tipo==='D').reduce((s,l)=>s+Number(l.valor),0));
   const credito=(e.lines || []).filter(l=>l.tipo==='C');
   const familia=['PARCSN','PARCSN_ESPECIAL','PERT_SN','RELP_SN','PARCMEI','PARCMEI_ESPECIAL','PERT_MEI','RELP_MEI'].includes(tipo);
   const compativel=tipo==='OUTRO'||familia&&tributo==='DAS'||tipo==='INSS'&&tributo==='INSS'||tipo==='LUCRO_PRESUMIDO'&&['PIS','COFINS','IRPJ','CSLL'].includes(tributo);
   const chave='entry:'+e.id,v=daEmpresa(companyId).find(o=>o.origemChave===chave);
   const motivo=e.parcelamentoId&&e.parcelamentoId!==parcelamentoId?'Vínculo antigo: revisar composição.':v?'Já incluído em outro acordo.':!compativel?'Tributo incompatível com a modalidade.':credito.length!==1?'Confira a conta do passivo na provisão original.':null;
   return {chave,entryId:e.id,tributo,competencia:e.competencia,saldo,contaPassivo:credito[0]?.conta,codigoTributo:({PIS:'8109',COFINS:'2172',IRPJ:'2089',CSLL:'2372'})[tributo] || null,semProvisao:false,versao:JSON.stringify([e.id,e.competencia,saldo,e.lines]),elegivel:!motivo,motivo};
  }).filter(o=>o.saldo>0);
  return {ok:true,habilitado:true,debitos:rows};
 };
 api.listParcelamentos=async companyId=>(await metodoOriginal('listParcelamentos',companyId)).map(p=>({...p,composicaoHabilitada:true,debitosOrigem:daEmpresa(companyId).filter(o=>o.parcelamentoId===p.id)}));
 const validarLinhas=(origens,lines)=>{
  const valor=lado=>(lines||[]).filter(l=>l.tipo===lado).reduce((s,l)=>s+cents(l.valor),0);
  if(!lines?.length||lines.some(l=>!l.conta||!Number.isFinite(Number(l.valor))||Number(l.valor)<0)||valor('D')!==valor('C'))throw new Error('Confira contas e balanceamento da abertura.');
  const esperado=new Map(),lancado=new Map();
  for(const o of origens){const k=o.contaPassivo+'|'+(o.codigoTributo||'');esperado.set(k,(esperado.get(k)||0)+cents(o.saldo));}
  for(const l of lines.filter(l=>l.tipo==='D'&&l.tipoLinha==='PRINCIPAL')){const k=l.conta+'|'+(l.codigoTributo||'');lancado.set(k,(lancado.get(k)||0)+cents(l.valor));}
  if(esperado.size!==lancado.size||[...esperado].some(([k,v])=>lancado.get(k)!==v))throw new Error('Confira a reclassificação contra o passivo das dívidas selecionadas.');
 };
 api.ingestParcelamento=async(companyId,body)=>serializar(companyId,async()=>{
  const origens=body.origensCircular || [];
  if(origens.length){
   if(origens.some(o=>!o)||new Set(origens.map(o=>o.chave)).size!==origens.length)throw new Error('Selecione dívidas distintas.');
   const anterior=daEmpresa(companyId).find(o=>o.pedido===JSON.stringify(body));
   if(anterior)return {ok:true,data:{parcelamentoId:anterior.parcelamentoId}};
   const lista=(await api.listDebitosCircularParcelamento(companyId,body.header.tipo)).debitos;
   for(const o of origens){const c=lista.find(x=>x.chave===o.chave);if(!c?.elegivel||c.versao!==o.versao||cents(c.saldo)!==cents(o.saldo))throw new Error('Uma dívida mudou. Atualize a seleção.');}
   if(origens.reduce((s,o)=>s+cents(o.saldo),0)!==cents(body.header.valorPrincipal))throw new Error('O principal deve conferir com as dívidas selecionadas.');
   validarLinhas(origens,body.provisaoLines);
  }
  const r=await metodoOriginal('ingestParcelamento',companyId,body);
  if(r?.ok!==false&&origens.length){const id=r.data.parcelamentoId;for(const o of origens)daEmpresa(companyId).push({...o,id:crypto.randomUUID(),origemChave:o.chave,parcelamentoId:id,principalIncluido:o.saldo,pedido:JSON.stringify(body)});}
  return r;
 });
 api.salvarComposicaoParcelamento=async(companyId,id,origens)=>serializar(companyId,async()=>{
  const p=(await metodoOriginal('listParcelamentos',companyId)).find(p=>p.id===id);
  if(!p||p.status!=='ATIVO')throw new Error('Selecione um acordo ativo.');
  const anteriores=daEmpresa(companyId).filter(o=>o.parcelamentoId===id);
  if(anteriores.length){if(anteriores.length===origens.length&&anteriores.every(a=>origens.some(o=>o.chave===a.origemChave&&cents(o.saldo)===cents(a.principalIncluido))))return {ok:true,data:anteriores};throw new Error('Este acordo já tem composição.');}
  const lista=(await api.listDebitosCircularParcelamento(companyId,p.tipo,id)).debitos;
  if(!origens.length||new Set(origens.map(o=>o.chave)).size!==origens.length||origens.some(o=>!lista.some(c=>c.chave===o.chave&&c.elegivel&&c.versao===o.versao&&cents(c.saldo)===cents(o.saldo))))throw new Error('Uma dívida mudou. Atualize a seleção.');
  if(origens.reduce((s,o)=>s+cents(o.saldo),0)!==cents(p.principalTotal))throw new Error('O principal deve conferir com as dívidas selecionadas.');
  validarLinhas(origens,getEntries(companyId).filter(e=>e.parcelamentoId===id&&e.tipo==='PROVISAO'&&String(e.subtipo||'').startsWith('PARC_')).flatMap(e=>e.lines||[]));
  for(const o of origens)daEmpresa(companyId).push({...o,id:crypto.randomUUID(),origemChave:o.chave,parcelamentoId:id,principalIncluido:o.saldo});
  return {ok:true};
 });
 api.getCircular=async(companyId,params)=>{
  const r=await metodoOriginal('getCircular',companyId,params);
  return {...r,provisoes:await enriquecer(companyId,r.provisoes)};
 };
 if(original.getPagamentosPendentes)api.getPagamentosPendentes=async(companyId,comp)=>{const r=await metodoOriginal('getPagamentosPendentes',companyId,comp);return {...r,itens:(await enriquecer(companyId,r.itens)).filter(e=>!e.parcelamentoOrigem)};};
 if(original.listPendenciasContabeis)api.listPendenciasContabeis=async companyId=>{
  const r=await metodoOriginal('listPendenciasContabeis',companyId),origens=daEmpresa(companyId);
  const itens=await enriquecer(companyId,origens.map(o=>({id:o.entryId,subtipo:o.tributo,competencia:o.competencia})));
  return {...r,itens:[...r.itens.filter(e=>!origens.some(o=>o.entryId===e.entryId)),...projetarPendenciasContabeis(itens)]};
 };
 for(const name of ['createBaixa','updateAccountingEntry','deleteAccountingEntry','estornarBaixa'])if(original[name])api[name]=async(companyId,entryId,...args)=>{
  const e=getEntries(companyId).find(e=>e.id===entryId);
  if(daEmpresa(companyId).some(o=>[entryId,e?.openEntryId].includes(o.entryId)))throw new Error('A dívida integra um parcelamento. Confira o acordo.');
  return metodoOriginal(name,companyId,entryId,...args);
 };
 if(original.excluirParcelamento)api.excluirParcelamento=async(companyId,id,...args)=>{if(daEmpresa(companyId).some(o=>o.parcelamentoId===id))throw new Error('Confira a composição e os pagamentos antes de excluir o acordo.');return metodoOriginal('excluirParcelamento',companyId,id,...args);};
 if(original.vincularEntryParcelamento)api.vincularEntryParcelamento=async()=>{throw new Error('Abra o parcelamento e confira as dívidas incluídas.');};
 return api;
}

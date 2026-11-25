import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {exigirDespachoPgdasFs12Permitido,exigirEnvelopePgdasFs12Permitido} from '../../domain/guardaPgdasFs12.js';
import {associarReservaComandoFs12,conferirComandoAntesMarcadorFs12} from '../../application/coordenarComandoFs12.js';
const store=new AsyncLocalStorage(),registered=new WeakMap();
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=(code='FS12_CAPACIDADE_INVALIDA')=>{throw Object.assign(new Error('Comando fiscal sem contexto válido. Reabra a apuração e confira a tentativa anterior.'),{code,status:409});};
const copy=v=>JSON.parse(JSON.stringify(v));
const active=()=>{const ctx=store.getStore();return ctx?.active===true?ctx:null;};
const relevant=p=>p?.pedidoDados?.idSistema==='PGDASD'&&p?.pedidoDados?.idServico==='TRANSDECLARACAO11';
export function criarContextoComandoFs12({comando,envelopeBytes,persistencia,observarResposta}){
  if(!comando?.id||!Buffer.isBuffer(envelopeBytes)||envelopeBytes.length>16777216
    ||hash(envelopeBytes)!==comando.esperado?.envelopeHash
    ||typeof persistencia?.naTransacaoDoGuard!=='function'||typeof observarResposta!=='function')fail();
  const cap=Object.freeze(Object.create(null));
  registered.set(cap,{comando:copy(comando),envelopeBytes:Buffer.from(envelopeBytes),
    persistencia,observarResposta,active:false,used:false,reservaId:null,marcador:null,result:null});
  return cap;
}
export async function comComandoFs12(cap,fn){
  const ctx=registered.get(cap);
  if(!ctx||ctx.used||typeof fn!=='function')fail();
  ctx.used=true;ctx.active=true;
  try{return await store.run(ctx,fn);}finally{ctx.active=false;ctx.envelopeBytes.fill(0);}
}
export function resultadoComandoFs12(cap){
  const ctx=registered.get(cap);if(!ctx)fail();
  return ctx.result?copy(ctx.result):null;
}
export function exigirDespachoComandoFs12({competencia}={}){
  try{exigirDespachoPgdasFs12Permitido({competencia});}
  catch(error){
    const ctx=active();
    if(error.code!=='FS12_INTEGRACAO_B33_PENDENTE'||!ctx||ctx.comando.competencia!==competencia
      ||!['2026-11','2026-12'].includes(competencia))throw error;
  }
}
export function prepararTransporteComandoFs12({payload,rota,method='POST',params}){
  if(!relevant(payload)){exigirEnvelopePgdasFs12Permitido({payload});return null;}
  const ctx=active();
  if(!ctx){exigirEnvelopePgdasFs12Permitido({payload});return null;}
  let dados;try{dados=JSON.parse(payload.pedidoDados.dados);}catch{fail();}
  const c=ctx.comando;
  if(!['2026-11','2026-12'].includes(c.competencia)){exigirDespachoPgdasFs12Permitido({competencia:c.competencia});fail('FS12_COMANDO_FORA_ESCOPO');}
  if(rota!=='/Declarar'||method.toUpperCase()!=='POST'||params!=null
    ||String(dados.pa)!==c.competencia.replace('-','')
    ||(dados._periodoApuracao!=null&&String(dados._periodoApuracao)!==String(dados.pa))
    ||String(payload.contribuinte?.numero)!==c.cnpj||String(dados.cnpjCompleto)!==c.cnpj
    ||dados.indicadorTransmissao!==(c.intencao!=='SIMULAR')
    ||hash(Buffer.from(JSON.stringify(payload)))!==c.esperado.envelopeHash
    ||!Buffer.from(JSON.stringify(payload)).equals(ctx.envelopeBytes))fail('FS12_ENVELOPE_DIVERGENTE');
  return {bytes:Buffer.from(ctx.envelopeBytes),comandoId:c.id};
}
export function identidadeComandoFs12Atual(){
  const ctx=active();if(!ctx)return null;
  const c=ctx.comando;
  return {comandoId:c.id,autorId:c.autorId,portalClientId:c.portalClientId,competencia:c.competencia,origem:c.origem};
}
async function naTx(tx,ctx,fn){
  const c=ctx.comando,scope={autorId:c.autorId,portalClientId:c.portalClientId,competencia:c.competencia};
  return ctx.persistencia.naTransacaoDoGuard(tx,scope,async ports=>{
    const saved=await ports.lerComando(c.id);
    if(!saved||ports.hash(saved.esperado)!==ports.hash(c.esperado)||saved.comandoHash!==c.comandoHash
      ||saved.tentativaId!==c.tentativaId||saved.cnpj!==c.cnpj)fail();
    return fn(ports);
  });
}
export async function associarReservaFs12NaTx(tx,{reserva,payload,rota}){
  if(!relevant(payload))return;
  const prepared=prepararTransporteComandoFs12({payload,rota});
  if(!prepared)return;
  const ctx=active();
  if(ctx.reservaId||reserva.portalClientId!==ctx.comando.portalClientId)fail('FS12_COMANDO_JA_RESERVADO');
  await naTx(tx,ctx,p=>associarReservaComandoFs12({comandoId:ctx.comando.id,reservaId:reserva.id},p));
}
export function registrarReservaFs12(autorizacao){
  const ctx=active();if(ctx){if(ctx.reservaId)fail();ctx.reservaId=autorizacao.id;}
}
export async function revalidarFs12NaTx(tx,reserva){
  const ctx=active();
  if(!ctx){
    if(reserva.idSistema==='PGDASD'&&reserva.idServico==='TRANSDECLARACAO11')
      exigirDespachoPgdasFs12Permitido({competencia:reserva.competencia});
    return;
  }
  if(reserva.idSistema!=='PGDASD'||reserva.idServico!=='TRANSDECLARACAO11')return;
  if(ctx.reservaId!==reserva.id||reserva.acaoId!==ctx.comando.id)fail();
  await naTx(tx,ctx,p=>conferirComandoAntesMarcadorFs12({comandoId:ctx.comando.id,reservaId:reserva.id},p));
}
export function registrarMarcadorFs12(autorizacao,marcador){
  const ctx=active();if(!ctx)return;
  if(ctx.reservaId!==autorizacao.id||marcador?.reservaId!==autorizacao.id
    ||marcador.companyId!==ctx.comando.portalClientId)fail();
  ctx.marcador=copy(marcador);
}
export async function custodiarRespostaComandoFs12(autorizacao,{corpo,httpStatus,recebidoEm}){
  const ctx=active();
  if(!ctx||ctx.reservaId!==autorizacao.id||!ctx.marcador||!Buffer.isBuffer(corpo)
    ||corpo.length>16777216||!Number.isInteger(httpStatus)||httpStatus<100||httpStatus>599)fail();
  const result=await ctx.observarResposta({comando:copy(ctx.comando),reservaId:autorizacao.id,
    marcador:copy(ctx.marcador),corpo:Buffer.from(corpo),httpStatus,recebidoEm});
  if(result?.respostaId!==ctx.comando.esperado.custodia.respostaId
    ||typeof result.custodiaId!=='string'||!result.custodiaId
    ||result.corpoHash!==hash(corpo)||result.stageId!==hash(Buffer.from(result.respostaId)))fail('FS12_CUSTODIA_NAO_CONFIRMADA');
  ctx.result={comandoId:ctx.comando.id,tentativaId:ctx.comando.tentativaId,reservaId:autorizacao.id,
    respostaId:result.respostaId,custodiaId:result.custodiaId,stageId:result.stageId,corpoHash:result.corpoHash};
  return copy(ctx.result);
}

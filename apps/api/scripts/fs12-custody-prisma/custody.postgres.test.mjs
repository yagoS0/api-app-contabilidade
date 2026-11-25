import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { clients,seed,adapter,hashContexto,insert,randomUUID } from './fixture.mjs';
import http from 'node:http';
import https from 'node:https';
const forbidden=()=>{throw Error('HTTP_FORBIDDEN');};
http.request=http.get=https.request=https.get=globalThis.fetch=forbidden;
async function setup(t){const c=await clients();t.after(()=>c.close());const f=await seed(c.sql,c.db);t.after(()=>f.key.fill(0));return {...c,...f};}
// Immutable fiscal fixtures intentionally remain in this EXCLUSIVE disposable database.
// Never disable triggers or delete evidence; database teardown belongs to the test provisioner.

test('PG: authenticated bytes, semantic replay with new nonce, original revision and no promotion',async t=>{
 const f=await setup(t);
 const one=await f.custody.importDurably(f.input);
 assert.equal(one.durable,true);
 const secondEnvelope=await f.cifra.cifrar({corpo:f.input.corpo,contexto:f.input.contexto,keyId:'synthetic-history'});
 assert.notEqual(secondEnvelope.nonce,f.input.envelope.nonce);
 assert.deepEqual(await f.custody.importDurably({...f.input,envelope:secondEnvelope}),one);
 await insert(f.sql,'apuracao_fs12_revisoes',{id:randomUUID(),portalClientId:f.f.portalClientId,companyId:f.f.companyId,
 competencia:f.f.competencia,revisao:2,serie:JSON.stringify([{mes:f.f.competencia,valorCentavos:1}]),politicaVersao:f.f.politicaVersao,
 contexto:{synthetic:true},contextoRevisao:f.f.contextoHash,serieHash:f.f.serieHash,comandoHash:'c'.repeat(64),autorId:f.f.autorId,chaveIdempotencia:randomUUID(),motivo:'Synthetic new revision'});
 assert.equal((await f.custody.resolveOrigin(f.hints)).revisaoFs12,1);
 assert.deepEqual(await f.custody.importDurably(f.input),one);
 assert.equal(await f.db.fs12ComandoResposta.count({where:{comandoId:f.c.id}}),1);
 assert.equal(await f.db.fs12ComandoCalculo.count({where:{comandoId:f.c.id}}),0);
 assert.equal(await f.db.apuracaoSnapshot.count({where:{portalClientId:f.f.portalClientId}}),0);
});

test('PG: changed observation, wrong identity and forged ciphertext cannot obtain receipt',async t=>{
 const f=await setup(t);await f.custody.importDurably(f.input);
 const contexto={...f.input.contexto,recebidoEm:'2026-11-25T12:00:01.000Z'};
 const envelope=await f.cifra.cifrar({corpo:f.input.corpo,contexto,keyId:'synthetic-history'});
 await assert.rejects(f.custody.importDurably({...f.input,contexto,envelope,contextHash:hashContexto(contexto)}),{code:'FS12_CUSTODIA_CONFLITO'});
 await assert.rejects(f.custody.resolveOrigin({...f.hints,tentativaId:randomUUID()}),{code:'FS12_CUSTODIA_ORIGEM_INVALIDA'});
 await assert.rejects(f.custody.importDurably({...f.input,envelope:{...f.input.envelope,tag:Buffer.alloc(16).toString('base64')}}));
 assert.equal(await f.db.fs12ComandoResposta.count({where:{comandoId:f.c.id}}),1);
});

test('PG: SQL failure after INSERT rolls back, no durable receipt; clean retry commits',async t=>{
 const f=await setup(t);let inserted=false;
 const db={ $transaction:(fn,options)=>f.db.$transaction(async tx=>{
   const result=await fn(tx);inserted=true;await tx.$executeRaw`SELECT 1/0`;return result;
 },options) };
 await assert.rejects(adapter(db,f.key).custody.importDurably(f.input));
 assert.equal(inserted,true);assert.equal(await f.db.fs12ComandoResposta.count({where:{comandoId:f.c.id}}),0);
 assert.equal((await f.custody.importDurably(f.input)).durable,true);
});

function child(t,f,{crash=false}={}){
 const proc=fork(new URL('./process.worker.mjs',import.meta.url),[],{stdio:['ignore','ignore','pipe','ipc'],execArgv:[],windowsHide:true});
 let exited=false,stderr='';const messages=[],waiters=[];
 proc.stderr.on('data',v=>{stderr+=v;});
 const done=new Promise((resolve,reject)=>{proc.once('error',reject);proc.once('exit',(code,signal)=>{
  exited=true;for(const w of waiters.splice(0))w.reject(Error('Child exited before '+w.type));resolve({code,signal,messages,stderr});
 });});
 proc.on('message',m=>{messages.push(m);for(let i=waiters.length-1;i>=0;i--)if(waiters[i].type===m.type)waiters.splice(i,1)[0].resolve(m);});
 t.after(async()=>{if(!exited)proc.kill();await done;});
 const {corpo,...input}=f.input;
 proc.send({type:'start',crash,keyBase64:f.key.toString('base64'),input:{...input,corpoBase64:corpo.toString('base64')}});
 return {proc,done,wait:type=>{const m=messages.find(x=>x.type===type);return m?Promise.resolve(m):exited?Promise.reject(Error('Child exited')):new Promise((resolve,reject)=>waiters.push({type,resolve,reject}));}};
}
const success=r=>{assert.equal(r.code,0,JSON.stringify(r));assert.equal(r.messages.find(m=>m.type==='result').calls,0);};
test('PG two REAL processes: concurrent import yields one row, both receipts, no HTTP', {timeout:60000},async t=>{
 const f=await setup(t),a=child(t,f),b=child(t,f);
 const ready=await Promise.all([a.wait('ready'),b.wait('ready')]);assert.notEqual(ready[0].pid,ready[1].pid);
 a.proc.send({type:'go'});b.proc.send({type:'go'});
 const results=await Promise.all([a.done,b.done]);results.forEach(success);
 assert.deepEqual(results[0].messages.find(m=>m.type==='result').receipt,results[1].messages.find(m=>m.type==='result').receipt);
 assert.equal(await f.db.fs12ComandoResposta.count({where:{comandoId:f.c.id}}),1);
});
test('PG commit then process exit before delivery: new process replays without second custody',{timeout:60000},async t=>{
 const f=await setup(t),a=child(t,f,{crash:true});await a.wait('ready');a.proc.send({type:'go'});
 const crashed=await a.done;assert.equal(crashed.code,23);assert.equal(crashed.messages.find(m=>m.type==='committed').calls,0);
 const before=await f.db.fs12ComandoResposta.findUnique({where:{id:f.input.contexto.respostaId}});assert.ok(before);
 const b=child(t,f);await b.wait('ready');b.proc.send({type:'go'});success(await b.done);
 assert.deepEqual(await f.db.fs12ComandoResposta.findUnique({where:{id:before.id}}),before);
});

test('PG secondary unique key collision with another response ID remains conflict, never replay',async t=>{
 const f=await setup(t),ctx={...f.input.contexto,respostaId:randomUUID()};
 const sealed=await f.cifra.cifrar({corpo:f.input.corpo,contexto:ctx,keyId:'synthetic-history'});
 await f.db.fs12ComandoResposta.create({data:{id:ctx.respostaId,comandoId:ctx.comandoId,reservaId:ctx.reservaId,
  marcadorKey:f.m.key,httpStatus:ctx.httpStatus,corpoCifrado:sealed,corpoHash:ctx.corpoHash,recebidoEm:new Date(ctx.recebidoEm),
  custodianteId:ctx.custodianteId,capacidadeId:ctx.capacidadeId,marcadorObservado:f.m.value}});
 await assert.rejects(f.custody.importDurably(f.input),{code:'FS12_CUSTODIA_CONFLITO'});
 assert.equal(await f.db.fs12ComandoResposta.count({where:{comandoId:f.c.id}}),1);
});

test('PG ledger mismatch or changed marker hash prevents custody; no state promotion',async t=>{
 const f=await setup(t);
 await f.db.serproChamada.update({where:{id:f.r.id},data:{cnpj:'00000000000000'}});
 await assert.rejects(f.custody.importDurably(f.input),{code:'FS12_CUSTODIA_CADEIA_INVALIDA'});
 await f.db.serproChamada.update({where:{id:f.r.id},data:{cnpj:f.c.cnpj}});
 await f.db.appSetting.update({where:{key:f.m.key},data:{value:{...f.m.value,authorizedAt:'2026-11-25T13:00:00.000Z'}}});
 await assert.rejects(f.custody.importDurably(f.input),{code:'FS12_CUSTODIA_ORIGEM_DIVERGENTE'});
 assert.equal(await f.db.fs12ComandoResposta.count({where:{comandoId:f.c.id}}),0);
});

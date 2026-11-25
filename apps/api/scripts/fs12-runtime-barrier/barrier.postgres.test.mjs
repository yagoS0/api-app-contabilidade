import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {clients} from '../fs12-runtime/fixture.mjs';
function child(t,input){
  const process=fork(new URL('./worker.mjs',import.meta.url),[],{
    stdio:['ignore','ignore','inherit','ipc'],windowsHide:true,execArgv:[],
  });
  const queue=[],waiters=[]; let exited=false,terminalError=null;
  const fail=error=>{
    terminalError ||= error;
    for(const waiter of waiters.splice(0)) waiter.reject(terminalError);
  };
  const finished=new Promise(resolve=>process.once('close',(code,signal)=>{
    exited=true;
    fail(Error(`Worker closed before the next protocol message (code=${code}, signal=${signal||'none'})`));
    resolve(code);
  }));
  process.once('exit',(code,signal)=>{
    exited=true;
    fail(Error(`Worker exited before the next protocol message (code=${code}, signal=${signal||'none'})`));
  });
  process.on('message',message=>{
    if(message?.event==='FAILED'){fail(Error(message.message||message.code||'Worker failed'));return;}
    if(waiters.length) waiters.shift().resolve(message); else queue.push(message);
  });
  process.on('error',fail);
  const send=message=>process.send(message,error=>{if(error)fail(error);});
  t.after(async()=>{if(!exited)process.kill();await finished;});
  send(input);
  return {next:()=>queue.length?Promise.resolve(queue.shift()):terminalError?Promise.reject(terminalError)
      :new Promise((resolve,reject)=>waiters.push({resolve,reject})),
    resume:()=>send({event:'RESUME'}),finished};
}
for(const phase of ['T1','RESERVA']){
  test(`real process barrier: explicit runtime closure wins at ${phase}; delayed original cannot dispatch`,{timeout:60000},async t=>{
    const {db,close}=await clients();t.after(close);
    const original=child(t,{role:'ORIGINAL',phase});
    const ready=await original.next();assert.equal(ready.event,'READY',ready.message);
    const closer=child(t,{role:'CLOSER',...ready});
    const closed=await closer.next();assert.equal(closed.event,'CLOSED',closed.message);
    assert.equal(closed.result.encerradaSemDespacho,true);
    assert.equal(await closer.finished,0);
    original.resume();
    const result=await original.next();assert.equal(result.event,'FINISHED',result.message);
    if(phase==='T1') assert.equal(result.code,'FS12_COMANDO_ENCERRADO_SEM_DESPACHO');
    // Reserved phase may be refused by the legacy reserved-status guard before
    // reaching tombstone; both are before any HTTP. Never require a weaker guard.
    if(phase==='RESERVA') assert.ok(['SERPRO_REGISTRO_INDETERMINADO','FS12_COMANDO_ENCERRADO_SEM_DESPACHO'].includes(result.code));
    assert.equal(result.countHttp,0);
    assert.equal(await original.finished,0);
    const snapshot=await db.apuracaoSnapshot.findUnique({where:{id:ready.snapshotId}});
    assert.equal(snapshot.estado,'fechada');
    assert.notEqual(snapshot.simulacaoSerpro?._portalTransmissao?.comandoId===ready.comandoId && snapshot.estado==='transmitindo',true);
    assert.ok(await db.appSetting.findUnique({where:{key:'fs12_comando_sem_despacho:'+ready.comandoId}}));
    const reserva=await db.fs12ComandoReserva.findUnique({where:{comandoId:ready.comandoId}});
    if(phase==='T1') assert.equal(reserva,null);
    if(reserva) assert.equal(await db.appSetting.findUnique({where:{key:'serpro_dispatch:'+reserva.reservaId}}),null);
  });
}
test('real process barrier: committed marker wins; closer preserves UNKNOWN and at most one fake dispatch',{timeout:60000},async t=>{
  const {db,close}=await clients();t.after(close);
  const original=child(t,{role:'ORIGINAL',phase:'MARKER'});
  const ready=await original.next();assert.equal(ready.event,'READY',ready.message);
  const closer=child(t,{role:'CLOSER',...ready});
  const closed=await closer.next();assert.equal(closed.event,'CLOSED',closed.message);
  assert.equal(closed.result.encerradaSemDespacho,undefined);
  assert.equal(closed.result.estado,'DESCONHECIDA');
  assert.equal(await closer.finished,0);
  assert.equal(await db.appSetting.findUnique({where:{key:'fs12_comando_sem_despacho:'+ready.comandoId}}),null);
  assert.ok(await db.appSetting.findUnique({where:{key:'serpro_dispatch:'+ready.reservaId}}));
  assert.equal((await db.apuracaoSnapshot.findUnique({where:{id:ready.snapshotId}})).estado,'transmitindo');
  original.resume();
  const result=await original.next();assert.equal(result.event,'FINISHED',result.message);
  assert.equal(result.countHttp,1);assert.equal(result.code,undefined);
  assert.equal(await original.finished,0);
  assert.equal((await db.serproChamada.findUnique({where:{id:ready.reservaId}})).status,'incerta');
});



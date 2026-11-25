import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {clients,seed,application} from './fixture.mjs';
import {criarPersistenciaFs12} from '../../src/modules/fiscal/infrastructure/prisma/fs12DaApuracao.js';
import {confirmarFs12DaApuracao} from '../../src/modules/fiscal/publicFs12.js';
import {randomUUID} from 'node:crypto';
const worker=(f,mode)=>new Promise((resolve,reject)=>{
  const child=fork(new URL('./worker.mjs',import.meta.url),[],{stdio:['ignore','ignore','inherit','ipc']});
  let output;
  child.once('message',m=>{output=m;});child.once('error',reject);
  child.once('exit',code=>code===0?resolve(output):reject(Error('child failed '+code)));
  child.send({comandoId:f.c.id,autorId:f.identidade.autorId,mode,portalClientId:f.identidade.portalClientId,competencia:f.identidade.competencia,key:f.key.toString('base64')});
});
test('T3b real PostgreSQL: atomic B32/B33, replay after process restart, independent processes',async()=>{
  const {db,sql,close}=await clients();
  try {
    const f=await seed(db,sql);
    const results=await Promise.all([worker(f),worker(f)]);
    assert.ok(results.some(r=>r.ok));
    assert.equal(await db.apuracaoFs12Calculo.count({where:{portalClientId:f.identidade.portalClientId}}),1);
    assert.equal(await db.fs12ComandoCalculo.count({where:{comandoId:f.c.id}}),1);
    const snapshot=await db.apuracaoSnapshot.findUnique({where:{portalClientId_competencia:{portalClientId:f.identidade.portalClientId,competencia:'2026-11'}}});
    assert.equal(snapshot.idempotencyKey,f.calculo.calculoId);
    assert.equal(Number(snapshot.dasSimuladoSerpro),0);
    assert.equal((await db.serproChamada.findUnique({where:{id:f.r.id}})).status,'ok');
    assert.equal((await worker(f)).recuperado,true);
  }finally{await close();}
});
test('new B31 revision prevents promotion and preserves T3a custody',async()=>{
  const {db,sql,close}=await clients();
  try {
    const f=await seed(db,sql);
    await confirmarFs12DaApuracao({...f.identidade,serie:[{mes:'2026-11',valorCentavos:100}],revisaoEsperada:1,
      contextoRevisao:f.revisao.contextoRevisao,chaveIdempotencia:randomUUID(),motivo:'Synthetic changed revision'},criarPersistenciaFs12(db));
    await assert.rejects(application(db,f.key).aplicar({comandoId:f.c.id,autorId:f.identidade.autorId}));
    assert.equal(await db.fs12ComandoCalculo.count({where:{comandoId:f.c.id}}),0);
    assert.equal(await db.apuracaoSnapshot.count({where:{portalClientId:f.identidade.portalClientId}}),0);
    assert.equal(await db.fs12ComandoResposta.count({where:{id:f.respostaId}}),1);
  }finally{await close();}
});
test('failure at B33 insert rolls back snapshot and B32 without losing ciphertext',async()=>{
  const {db,sql,close}=await clients();
  try {
    const f=await seed(db,sql);
    const failing=new Proxy(db,{get(target,key){
      if(key==='$transaction') return (callback,options)=>target.$transaction(tx=>callback(new Proxy(tx,{get(t,k){
        if(k==='fs12ComandoCalculo') return new Proxy(t[k],{get(delegate,method){
          if(method==='create') return async()=>{throw Error('SYNTHETIC_INSERT_FAILURE');};
          const value=delegate[method];return typeof value==='function'?value.bind(delegate):value;
        }});
        const value=t[k];return typeof value==='function'?value.bind(t):value;
      }})),options);
      const value=target[key];return typeof value==='function'?value.bind(target):value;
    }});
    await assert.rejects(application(failing,f.key).aplicar({comandoId:f.c.id,autorId:f.identidade.autorId}),/SYNTHETIC_INSERT_FAILURE/);
    assert.equal(await db.apuracaoSnapshot.count({where:{portalClientId:f.identidade.portalClientId}}),0);
    assert.equal(await db.apuracaoFs12Calculo.count({where:{portalClientId:f.identidade.portalClientId}}),0);
    assert.equal(await db.fs12ComandoCalculo.count({where:{comandoId:f.c.id}}),0);
    assert.equal(await db.fs12ComandoResposta.count({where:{id:f.respostaId}}),1);
    assert.equal((await application(db,f.key).aplicar({comandoId:f.c.id,autorId:f.identidade.autorId})).ok,true);
  }finally{await close();}
});
test('explicit recovery serializes duplicate technical closure in two processes; marker wins',async()=>{
  const {db,sql,close}=await clients();
  try {
    for(const phase of ['T1','RESERVA']) {
      const f=await seed(db,sql,{phase});
      const results=await Promise.all([worker(f,'RECOVER'),worker(f,'RECOVER')]);
      assert.ok(results.every(r=>r.encerradaSemDespacho===true));
      const closed=await db.appSetting.findUnique({where:{key:'fs12_comando_sem_despacho:'+f.c.id}});
      assert.equal(closed.value.comandoId,f.c.id);
      assert.equal(await db.fs12ComandoCalculo.count({where:{comandoId:f.c.id}}),0);
    }
    const dispatched=await seed(db,sql);
    assert.equal((await worker(dispatched,'RECOVER')).encerradaSemDespacho,undefined);
    assert.equal(await db.appSetting.count({where:{key:'fs12_comando_sem_despacho:'+dispatched.c.id}}),0);
    assert.equal(await db.fs12ComandoCalculo.count({where:{comandoId:dispatched.c.id}}),1);
  }finally{await close();}
});

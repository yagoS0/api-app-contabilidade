import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {chaveCoordenacaoFs12} from '../../src/modules/fiscal/infrastructure/prisma/coordenacaoFs12.js';
const worker=new URL('./coordination.worker.mjs',import.meta.url);
const children=new Set();
async function stopChildren(){
  await Promise.all([...children].map(child=>new Promise(resolve=>{
    if(child.exitCode!==null)return resolve();
    child.once('exit',resolve);child.kill();
  })));
}
function launch(t,options){
  const child=fork(worker,[],{stdio:['ignore','ignore','pipe','ipc'],execArgv:[]});
  children.add(child);child.once('exit',()=>children.delete(child));
  const messages=[],waiters=[];
  const done=new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('exit',code=>{
      for(const w of waiters.splice(0))w.reject(Error('Child exited before '+w.type));
      resolve({code,messages});
    });
  });
  child.stderr.resume();
  child.on('message',message=>{
    messages.push(message);
    for(let i=waiters.length-1;i>=0;i--)if(waiters[i].type===message.type)waiters.splice(i,1)[0].resolve(message);
  });
  t.after(()=>{if(child.exitCode===null)child.kill();});
  child.send({type:'start',...options});
  return {child,done,wait:type=>{
    const m=messages.find(x=>x.type===type);
    return m?Promise.resolve(m):new Promise((resolve,reject)=>waiters.push({type,resolve,reject}));
  }};
}
async function database(t){
  const url=process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
  const p=new URL(url);
  if(process.env.NODE_ENV!=='test'||url!==process.env.DATABASE_URL
    ||p.hostname!=='127.0.0.1'||!['postgres:','postgresql:'].includes(p.protocol)
    ||!p.pathname.endsWith('_governance_test')||p.search||p.hash)throw Error('EXPLICIT_DISPOSABLE_PG_REQUIRED');
  const db=new PrismaClient({datasources:{db:{url}}});await db.$connect();
  const [{version}]=await db.$queryRaw`SELECT current_setting('server_version_num')::int AS version`;
  assert.ok(version>=160000&&version<170000);
  // Return cleanup to test so fixture deletes happen before disconnect.
  return {db,url};
}
test('PG16 dois processos: B31 Serializable coordena antes de ler; T2 ReadCommitted espera e le nova revisao', {timeout:30000},async t=>{
  const {db,url}=await database(t);
  const scope={portalClientId:'synthetic-'+randomUUID(),competencia:'2026-11',autorId:'synthetic-actor'};
  const keys=[chaveCoordenacaoFs12(scope)];
  t.after(async()=>{await stopChildren();await db.appSetting.deleteMany({where:{key:{in:keys}}});await db.$disconnect();});
  const a=launch(t,{url,scope,isolationLevel:'Serializable',hold:true});
  const first=await a.wait('acquired');
  const b=launch(t,{url,scope,isolationLevel:'ReadCommitted',hold:false});
  const second=await b.wait('entering');
  assert.notEqual(first.pid,second.pid);
  let blocked=false;
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){
    const [{pids}]=await db.$queryRaw`SELECT pg_blocking_pids(${second.pid}::int) AS pids`;
    if(pids.includes(first.pid)){blocked=true;break;}
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.equal(blocked,true,'real PostgreSQL wait observed, not inferred from Promise timing');
  a.child.send({type:'release'});
  assert.equal((await a.done).code,0);
  const bResult=await b.done;assert.equal(bResult.code,0);
  assert.equal(bResult.messages.find(x=>x.type==='observed').revision,2);
});
test('PG16 escopos distintos nao compartilham coordenacao (PortalClient/PA)',{timeout:30000},async t=>{
  const {db,url}=await database(t);
  const one={portalClientId:'synthetic-'+randomUUID(),competencia:'2026-11',autorId:'synthetic-actor'};
  const other={...one,competencia:'2026-12'},third={...one,portalClientId:'synthetic-'+randomUUID()};
  t.after(async()=>{await stopChildren();await db.appSetting.deleteMany({where:{key:{in:[one,other,third].map(chaveCoordenacaoFs12)}}});await db.$disconnect();});
  const held=launch(t,{url,scope:one,isolationLevel:'Serializable',hold:true});await held.wait('acquired');
  for(const scope of [other,third]){
    const free=launch(t,{url,scope,isolationLevel:'ReadCommitted',hold:false});
    assert.equal((await free.done).code,0);
  }
  held.child.send({type:'release'});assert.equal((await held.done).code,0);
});

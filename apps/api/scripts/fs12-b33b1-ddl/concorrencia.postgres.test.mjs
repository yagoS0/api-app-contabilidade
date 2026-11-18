// Experimental transaction protocol, never imported by production composition.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { connect, fixture, chain, command, reserve, reservationData, marker, insert, responseData, associationData, uid, hashB } from './helpers.mjs';
import { criarPersistenciaFs12 } from '../../src/modules/fiscal/infrastructure/prisma/fs12DaApuracao.js';
import { consultarFs12DaApuracao } from '../../src/modules/fiscal/application/consultarFs12DaApuracao.js';
import { confirmarFs12DaApuracao } from '../../src/modules/fiscal/application/confirmarFs12DaApuracao.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function lock(db, portal) { await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", ['company_automation:' + portal]); }
async function counter(db, portal) {
  const key = 'fs12_coord:' + portal;
  const created = await db.query('INSERT INTO "AppSetting" (key,value,"createdAt","updatedAt") VALUES ($1,\'{"v":1,"sequencia":1}\',now(),now()) ON CONFLICT DO NOTHING RETURNING key', [key]);
  if (created.rowCount) return;
  const { rows: [row] } = await db.query('SELECT value FROM "AppSetting" WHERE key=$1', [key]);
  const v = row?.value;
  assert.ok(v && Object.keys(v).sort().join() === 'sequencia,v' && v.v === 1 && Number.isSafeInteger(v.sequencia) && v.sequencia >= 1 && v.sequencia < Number.MAX_SAFE_INTEGER, 'Invalid coordination counter');
  const changed = await db.query('UPDATE "AppSetting" SET value=jsonb_build_object(\'v\',1,\'sequencia\',$2::bigint+1),"updatedAt"=now() WHERE key=$1 AND value=$3::jsonb RETURNING key', [key, v.sequencia, JSON.stringify(v)]);
  assert.equal(changed.rowCount, 1);
}
async function observedWait(observer, pid) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const { rows: [row] } = await observer.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid]);
    if (row?.wait_event_type === 'Lock') return;
    await new Promise(r => setTimeout(r, 5));
  }
  throw Error('No PostgreSQL lock wait observed');
}
async function clients(run) {
  const db = await connect(), a = await connect(), b = await connect();
  try { await run(db, a, b); } finally {
    await Promise.all([a.query('ROLLBACK'), b.query('ROLLBACK')]);
    await Promise.all([db.end(), a.end(), b.end()]);
  }
}

test('advisory alone does not refresh a Serializable snapshot', () => clients(async (db,a,b) => {
  const f = await fixture(db);
  await a.query('BEGIN ISOLATION LEVEL SERIALIZABLE'); await lock(a,f.portalClientId);
  await b.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  const pid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const waiting = lock(b,f.portalClientId); await observedWait(db,pid);
  await a.query('INSERT INTO "AppSetting" (key,value,"createdAt","updatedAt") VALUES ($1,\'{}\',now(),now())', ['probe:'+f.portalClientId]);
  await a.query('COMMIT'); await waiting;
  assert.equal((await b.query('SELECT key FROM "AppSetting" WHERE key=$1',['probe:'+f.portalClientId])).rowCount,0);
  await b.query('COMMIT');
  assert.equal((await db.query('SELECT key FROM "AppSetting" WHERE key=$1',['probe:'+f.portalClientId])).rowCount,1);
}));

for (const initial of [false,true]) test(`shared counter rejects stale Serializable snapshot; existing=${initial}`, () => clients(async(db,a,b)=>{
  const f=await fixture(db);
  if(initial) await counter(db,f.portalClientId);
  await a.query('BEGIN ISOLATION LEVEL SERIALIZABLE'); await lock(a,f.portalClientId); await counter(a,f.portalClientId);
  await b.query('BEGIN ISOLATION LEVEL SERIALIZABLE'); const pid=(await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const waiting=lock(b,f.portalClientId); await observedWait(db,pid); await a.query('COMMIT'); await waiting;
  await assert.rejects(counter(b,f.portalClientId), e=>e.code==='40001');
  await b.query('ROLLBACK');
}));

test('counter malformed and overflow fail closed without replacing stored value',()=>clients(async(db)=>{
  for(const value of [{v:1,sequencia:Number.MAX_SAFE_INTEGER},{v:1,sequencia:0},{v:1,sequencia:2,extra:true},{}]){
    const portal=uid(); await insert(db,'AppSetting',{key:'fs12_coord:'+portal,value,updatedAt:new Date()});
    await assert.rejects(counter(db,portal));
    assert.deepEqual((await db.query('SELECT value FROM "AppSetting" WHERE key=$1',['fs12_coord:'+portal])).rows[0].value,value);
  }
}));

for(const winner of ['custody','promotion']) test(`T3a/T3b real rows, winner=${winner}; divergence never overwrites evidence`,()=>clients(async(db,a,b)=>{
  const f=await fixture(db), s=await chain(db,f); await counter(db,f.portalClientId);
  await a.query('BEGIN ISOLATION LEVEL SERIALIZABLE'); await lock(a,f.portalClientId); await counter(a,f.portalClientId);
  await b.query('BEGIN ISOLATION LEVEL SERIALIZABLE'); const pid=(await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const waiting=lock(b,f.portalClientId); await observedWait(db,pid);
  if(winner==='custody') await insert(a,'fs12_comando_respostas',responseData(s.c,s.r,s.m,{corpoHash:hashB}));
  else await insert(a,'fs12_comando_calculos',associationData(f,s.c,s.response,s.calc));
  await a.query('COMMIT'); await waiting;
  await assert.rejects(counter(b,f.portalClientId),e=>e.code==='40001'); await b.query('ROLLBACK');
  await b.query('BEGIN ISOLATION LEVEL SERIALIZABLE'); await lock(b,f.portalClientId); await counter(b,f.portalClientId);
  if(winner==='custody') assert.equal((await b.query('SELECT id FROM fs12_comando_respostas WHERE "comandoId"=$1',[s.c.id])).rowCount,2);
  else await insert(b,'fs12_comando_respostas',responseData(s.c,s.r,s.m,{corpoHash:hashB}));
  await b.query('COMMIT');
  assert.equal((await db.query('SELECT id FROM fs12_comando_respostas WHERE "comandoId"=$1',[s.c.id])).rowCount,2);
  assert.equal((await db.query('SELECT "comandoId" FROM fs12_comando_calculos WHERE "comandoId"=$1',[s.c.id])).rowCount,winner==='promotion'?1:0);
}));

test('promotion rollback preserves independently committed custody',()=>clients(async(db,a)=>{
  const f=await fixture(db),s=await chain(db,f);
  await a.query('BEGIN ISOLATION LEVEL SERIALIZABLE'); await lock(a,f.portalClientId); await counter(a,f.portalClientId);
  await insert(a,'fs12_comando_calculos',associationData(f,s.c,s.response,s.calc));
  await a.query('ROLLBACK');
  assert.equal((await db.query('SELECT id FROM fs12_comando_respostas WHERE id=$1',[s.response.id])).rowCount,1);
  assert.equal((await db.query('SELECT "comandoId" FROM fs12_comando_calculos WHERE "comandoId"=$1',[s.c.id])).rowCount,0);
}));

test('reservation CAS and response replay are idempotent',()=>clients(async(db,a,b)=>{
  const f=await fixture(db),s=await chain(db,f);
  const results=await Promise.all([a,b].map(c=>c.query('UPDATE serpro_chamadas SET status=\'incerta\' WHERE id=$1 AND status=\'reservada\' RETURNING id',[s.r.id])));
  assert.equal(results.reduce((n,r)=>n+r.rowCount,0),1);
  // Independent existing connection observes committed marker; no HTTP is attempted.
  assert.equal((await b.query('SELECT value FROM "AppSetting" WHERE key=$1',[s.m.key])).rowCount,1);
  assert.equal((await b.query('SELECT status FROM serpro_chamadas WHERE id=$1',[s.r.id])).rows[0].status,'incerta');
  await assert.rejects(insert(b,'fs12_comando_respostas',responseData(s.c,s.r,s.m)),e=>e.code==='23505');
}));

test('new connection observes committed reservation and marker without any response',()=>clients(async(db)=>{
  const f=await fixture(db),c=await command(db,f),r=await reserve(db,c);
  await insert(db,'fs12_comando_reservas',reservationData(c,r)); const m=await marker(db,c,r);
  const reader=await connect();
  try {
    assert.equal((await reader.query('SELECT status FROM serpro_chamadas WHERE id=$1',[r.id])).rows[0].status,'reservada');
    assert.equal((await reader.query('SELECT key FROM "AppSetting" WHERE key=$1',[m.key])).rowCount,1);
    assert.equal((await reader.query('SELECT id FROM fs12_comando_respostas WHERE "comandoId"=$1',[c.id])).rowCount,0);
  } finally {await reader.end();}
}));

// Wrap the REAL B31 transaction in the proposed technical lock/counter, only here.
// Existing production confirmarFs12DaApuracao/criarPersistenciaFs12 stay unchanged.
async function realFixture(prisma) {
  const id=uid(), cnpj=String(Date.now()).padStart(14,'0');
  const client=await prisma.client.create({data:{name:'SYNTHETIC CONCURRENCY',login:id,email:id+'@example.test',passwordHash:'not-a-login'}});
  const company=await prisma.company.create({data:{clientId:client.id,razaoSocial:'SYNTHETIC',cnpj,atividades:[],dataAbertura:new Date('2026-11-01Z')}});
  const portal=await prisma.portalClient.create({data:{companyId:company.id,razao:'SYNTHETIC',cnpj}});
  const user=await prisma.user.create({data:{name:'SYNTHETIC',email:uid()+'@example.test',passwordHash:'not-a-login',role:'contador',accountType:'FIRM',status:'active'}});
  await prisma.companyFirmAccess.create({data:{companyId:portal.id,userId:user.id,role:'ACCOUNTANT',status:'ACTIVE'}});
  await prisma.regimeHistorico.create({data:{companyId:company.id,regime:'SIMPLES',vigenciaInicio:new Date('2026-11-01Z')}});
  const identity={portalClientId:portal.id,autorId:user.id,competencia:'2026-11'};
  const context=await consultarFs12DaApuracao(identity,criarPersistenciaFs12(prisma));
  const input={...identity,serie:[{mes:'2026-11',valorCentavos:0}],revisaoEsperada:0,chaveIdempotencia:uid(),contextoRevisao:context.contextoRevisao};
  await confirmarFs12DaApuracao(input,criarPersistenciaFs12(prisma));
  return {...identity,companyId:company.id,input:{...input,revisaoEsperada:1,chaveIdempotencia:uid(),motivo:'Synthetic replacement'}};
}
async function wrappedB31(prisma, f, inside=async()=>{}, onPid=()=>{}) {
  const wrapped={$transaction:(callback,options)=>prisma.$transaction(async tx=>{
    const facade={query:async(sql,args=[])=>{
      const rows=await tx.$queryRawUnsafe(sql,...args); return {rows,rowCount:rows.length};
    }};
    const [{pid}]=await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid'); onPid(pid);
    await tx.$queryRawUnsafe("SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext($1))",'company_automation:'+f.portalClientId);
    await counter(facade,f.portalClientId); await inside(tx);
    return callback(tx);
  },{...options,timeout:15000})};
  return confirmarFs12DaApuracao(f.input,criarPersistenciaFs12(wrapped));
}
for(const first of ['confirmation','authorization']) test(`REAL B31 with test-only coordination wrapper, first=${first}`,()=>clients(async(db,a)=>{
  const prisma=new PrismaClient({datasources:{db:{url:process.env.ALTAN_FS12_DDL_DATABASE_URL}}});
  try{
    const f=await realFixture(prisma); await counter(db,f.portalClientId);
    if(first==='confirmation'){
      const held=deferred(),release=deferred();
      const confirmation=wrappedB31(prisma,f,async()=>{held.resolve();await release.promise;}); await held.promise;
      await a.query('BEGIN ISOLATION LEVEL SERIALIZABLE');const pid=(await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const waiting=lock(a,f.portalClientId);await observedWait(db,pid);release.resolve(); await confirmation;await waiting;
      await assert.rejects(counter(a,f.portalClientId),e=>e.code==='40001');await a.query('ROLLBACK');
      assert.equal((await db.query('SELECT max(revisao) AS r FROM apuracao_fs12_revisoes WHERE "portalClientId"=$1',[f.portalClientId])).rows[0].r,2);
    } else {
      await a.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await lock(a,f.portalClientId);await counter(a,f.portalClientId);
      let started=false;
      const backend=deferred();
      const confirming=wrappedB31(prisma,f,async()=>{started=true;},backend.resolve);
      await observedWait(db,await backend.promise);assert.equal(started,false);
      assert.equal((await a.query('SELECT max(revisao) AS r FROM apuracao_fs12_revisoes WHERE "portalClientId"=$1',[f.portalClientId])).rows[0].r,1);
      await insert(a,'AppSetting',{key:'synthetic_t2:'+f.portalClientId,value:{revisao:1,nenhumaRede:true},updatedAt:new Date()});
      await a.query('COMMIT');
      // Prisma reports raw SQL serialization as P2010/meta.code=40001, not P2034.
      // Characterize this integration gap rather than silently broadening production retry.
      await assert.rejects(confirming,e=>e.code==='P2010' && e.meta?.code==='40001');
      assert.equal((await db.query('SELECT max(revisao) AS r FROM apuracao_fs12_revisoes WHERE "portalClientId"=$1',[f.portalClientId])).rows[0].r,1);
      await wrappedB31(prisma,f); // explicit local test retry, never transport
      assert.equal((await db.query('SELECT value FROM "AppSetting" WHERE key=$1',['synthetic_t2:'+f.portalClientId])).rows[0].value.revisao,1);
      assert.equal((await db.query('SELECT max(revisao) AS r FROM apuracao_fs12_revisoes WHERE "portalClientId"=$1',[f.portalClientId])).rows[0].r,2);
    }
    // Existing ACL still rejects revoked users; no confirmation is manufactured.
    await prisma.user.update({where:{id:f.autorId},data:{status:'inactive'}});
    await assert.rejects(confirmarFs12DaApuracao({...f.input,revisaoEsperada:2,chaveIdempotencia:uid()},criarPersistenciaFs12(prisma)),e=>e.code==='FS12_ACESSO_NEGADO');
  } finally {await prisma.$disconnect();}
}));

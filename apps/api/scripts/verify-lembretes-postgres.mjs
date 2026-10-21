import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
const url=new URL(process.argv[2]||'invalid:');
assert.equal(url.protocol,'postgresql:');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55490');assert.equal(url.username,'altan_guias_test');assert.equal(url.pathname,'/altan_lembretes_20261021_governance_test');
Object.assign(process.env,{DATABASE_URL:url.href,NODE_ENV:'test',LOG_LEVEL:'fatal',INTEGRACAO_WHATSAPP:'0'});
let network=0;const deny=()=>{network++;throw Error('Rede externa proibida');};globalThis.fetch=http.request=http.get=https.request=https.get=deny;
const {prisma:db}=await import('../src/infrastructure/db/prisma.js');
const {claimScheduledRun,finishScheduledRun}=await import('../src/workers/scheduledRoutineService.js');
const {runGuideWhatsappReminderTick}=await import('../src/workers/guideWhatsappReminderWorker.js');
const routine=`test_lembretes_${randomUUID()}`,now=new Date('2026-10-21T11:00:05Z'),config={enabled:true,frequency:'DAILY',hour:8};
let calls=0;
try{
 const claims=await Promise.all(Array.from({length:12},()=>claimScheduledRun({routine,config,now,db})));
 assert.equal(claims.filter(Boolean).length,1);
 const claim=claims.find(Boolean);
 await finishScheduledRun(claim,{solicitacoesWhatsapp:{avisosPendentes:1}},null,{db,now});
 assert.equal((await db.appSetting.findUnique({where:{key:claim.key}})).value.status,'FAILED');
 assert.equal(await claimScheduledRun({routine,config,now,db}),null);
 assert.ok(await claimScheduledRun({routine,config,now:new Date('2026-10-22T11:00:05Z'),db}));
 const fiscal={enabled:true,day:25,hour:8,frequency:'MONTHLY'};
 const settings=async()=>({enabled:false,rotinas:{pagamento:fiscal,avisos_guias_whatsapp:config}});
 await runGuideWhatsappReminderTick({agora:now,ligado:true,settings,schedule:async(_,saved,run)=>{assert.deepEqual(saved,config);return run({scheduledAt:now.toISOString(),assertActive:()=>{}});},solicitar:async()=>{calls++;return {avisosPendentes:0,total:0};}});
 assert.equal(calls,1);assert.deepEqual(fiscal,{enabled:true,day:25,hour:8,frequency:'MONTHLY'});assert.equal(network,0);
 console.log('PASS: 12 reservas concorrentes/um dono, pendência aninhada, sem replay, próximo dia independente, agenda fiscal intacta e zero rede.');
}finally{await db.appSetting.deleteMany({where:{key:{startsWith:`fiscal_schedule:${routine}:`}}});await db.$disconnect();}

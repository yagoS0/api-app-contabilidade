jest.mock('../../../config.js',()=>({JWT_SECRET:'test-only-secret-email-login',REFRESH_TOKEN_EXPIRES_IN:'7d'}));
jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:{}}));
jest.mock('../../../infrastructure/mail/EmailService.js',()=>({EmailService:class {async send(){}}}));
import { EmailLoginService } from '../EmailLoginService.js';
import { ClientSessionService } from '../ClientSessionService.js';
function banco(){
 const store={rows:[],sessions:[],user:{id:'u1',email:'cliente@example.com',passwordHash:'hash-password',status:'active',accountType:'CLIENT',role:'user'},active:true};
 const copy=v=>v?structuredClone(v):null;
 const tx={
 emailLoginChallenge:{
 findUnique:async({where})=>copy(store.rows.find(r=>Object.entries(where).every(([k,v])=>r[k]===v))),
 upsert:async({where,create,update})=>{let row=store.rows.find(r=>r.emailKey===where.emailKey);if(row)Object.assign(row,update);else{row={...create};store.rows.push(row);}return copy(row);},
 update:async({where,data})=>{const row=store.rows.find(r=>r.emailKey===where.emailKey);for(const[k,v]of Object.entries(data))row[k]=v&&v.increment?row[k]+v.increment:v;return copy(row);}
 },
 user:{findUnique:async({where})=>Object.entries(where).every(([k,v])=>store.user?.[k]===v)?copy(store.user):null},
 companyClientUser:{findFirst:async()=>store.active?{userId:'u1'}:null},
 clientSession:{create:async({data})=>{const row={id:'s'+store.sessions.length,...data};store.sessions.push(row);return row;}}
 };
 let queue=Promise.resolve();
 const client={$transaction:jest.fn(fn=>{const operation=queue.then(()=>fn(tx));queue=operation.catch(()=>{});return operation;})};
 return {store,client};
}
const now=new Date('2026-09-24T22:00:00Z');
test('somente conta CLIENT ativa com vínculo recebe código; resposta pública equivalente',async()=>{
 for(const tipo of ['valid','missing','inactive','firm','admin','unlinked']){
  const {store,client}=banco();
  if(tipo==='missing')store.user=null;
  if(tipo==='inactive')store.user.status='pending';
  if(tipo==='firm')store.user.accountType='FIRM';
  if(tipo==='admin')store.user.role='admin';
  if(tipo==='unlinked')store.active=false;
  const r=await EmailLoginService.solicitar(' CLIENTE@example.com ',{client,now});
  expect(r.challengeId).toMatch(/^[a-f0-9]{64}$/);
  expect(Boolean(r.delivery)).toBe(tipo==='valid');
  if(r.delivery){expect(r.delivery.code).toMatch(/^\d{8}$/);expect(JSON.stringify(store.rows)).not.toContain(r.delivery.code);}
 }
});
test('código correto cria uma sessão; repetição e requisições simultâneas só têm um vencedor',async()=>{
 const {store,client}=banco();const r=await EmailLoginService.solicitar('cliente@example.com',{client,now});
 const results=await Promise.all([1,2].map(()=>EmailLoginService.confirmar(r.challengeId,r.delivery.code,{client,now})));
 expect(results.filter(Boolean)).toHaveLength(1);expect(store.sessions).toHaveLength(1);
 expect(store.sessions[0].refreshTokenHash).not.toBe(results.find(Boolean).refreshToken);
 expect(await EmailLoginService.confirmar(r.challengeId,r.delivery.code,{client,now})).toBeNull();
});
test('cinco erros bloqueiam mesmo o código correto; expiração também recusa',async()=>{
 const {client}=banco();const r=await EmailLoginService.solicitar('cliente@example.com',{client,now});
 const wrong=r.delivery.code==='00000000'?'11111111':'00000000';
 for(let i=0;i<5;i++)expect(await EmailLoginService.confirmar(r.challengeId,wrong,{client,now})).toBeNull();
 expect(await EmailLoginService.confirmar(r.challengeId,r.delivery.code,{client,now})).toBeNull();
 const b=banco();const s=await EmailLoginService.solicitar('cliente@example.com',{client:b.client,now});
 expect(await EmailLoginService.confirmar(s.challengeId,s.delivery.code,{client:b.client,now:new Date(now.getTime()+600000)})).toBeNull();
});
test('reenvio invalida anterior, respeita intervalo e cinco envios por hora',async()=>{
 const {store,client}=banco();let r=await EmailLoginService.solicitar('cliente@example.com',{client,now});
 expect((await EmailLoginService.solicitar('cliente@example.com',{client,now})).delivery).toBeUndefined();
 const original=r;
 for(let i=1;i<5;i++)r=await EmailLoginService.solicitar('cliente@example.com',{client,now:new Date(now.getTime()+61000*i)});
 expect(store.rows[0].sentCount).toBe(5);
 expect((await EmailLoginService.solicitar('cliente@example.com',{client,now:new Date(now.getTime()+61000*5)})).delivery).toBeUndefined();
 expect(await EmailLoginService.confirmar(original.challengeId,original.delivery.code,{client,now})).toBeNull();
});
test.each(['email','passwordHash','status','membership'])('revalida %s antes de conceder sessão',async(field)=>{
 const {store,client}=banco();const r=await EmailLoginService.solicitar('cliente@example.com',{client,now});
 if(field==='membership')store.active=false;else store.user[field]=field==='status'?'rejected':'changed';
 expect(await EmailLoginService.confirmar(r.challengeId,r.delivery.code,{client,now})).toBeNull();expect(store.sessions).toHaveLength(0);
});

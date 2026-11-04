import { assertDisposablePostgres } from '../../../../test-support/disposablePostgresGuard.js';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { lerAutomacaoEmpresa, salvarAutomacaoEmpresa } from '../CompanyAutomationService.js';

const raw=process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
if(process.env.NODE_ENV!=='test'||!raw)throw Error('Explicit disposable database required');
const url=new URL(raw);
if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!/^\/[a-zA-Z0-9_]+_governance_test$/.test(url.pathname)||url.search||url.hash)throw Error('Disposable loopback database required');
const db=new PrismaClient({datasources:{db:{url:raw}}}),companyId=randomUUID(),userId=randomUUID();
beforeAll(async()=>{
  const [actual]=await db.$queryRaw`SELECT current_database() AS name,current_user AS username,host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('server_version_num') AS "versionNumber"`;
  expect(actual.name).toBe(url.pathname.slice(1));
  assertDisposablePostgres({raw,actual});
  await db.user.create({data:{id:userId,email:`${userId}@example.invalid`,passwordHash:'NOT_USABLE',role:'admin',accountType:'FIRM',status:'active'}});
  await db.portalClient.create({data:{id:companyId,razao:'R2 synthetic fixture',cnpj:`test-${companyId}`}});
});
afterAll(async()=>{await db.$disconnect();}); // Fixtures belong only to the disposable database.
test('concurrent adoption, replay, unchanged flags, stale CAS, audit rollback and revoked actor',async()=>{
  const before=await lerAutomacaoEmpresa(db,companyId);
  const input={expectedRevision:before.revision,requestId:randomUUID(),agendaEventos:{executionMode:'RELATIVO_V1'}};
  const results=await Promise.allSettled([salvarAutomacaoEmpresa(db,companyId,userId,input,{isAdmin:true}),salvarAutomacaoEmpresa(db,companyId,userId,input,{isAdmin:true})]);
  expect(results.filter(r=>r.status==='fulfilled').length).toBeGreaterThanOrEqual(1);
  for(const failed of results.filter(r=>r.status==='rejected'))expect(['P2034','P2002']).toContain(failed.reason.code);
  const saved=await salvarAutomacaoEmpresa(db,companyId,userId,input,{isAdmin:true});
  expect(saved.agendaEventos).toMatchObject({executionMode:'RELATIVO_V1',modeVersion:1,capabilities:{capture:false}});
  for(const key of ['rotinas','lembretes','automationPolicy','globalAutomationPolicy','serproPolicy','cicloSimples','envioGuias'])expect(saved[key]).toEqual(before[key]);
  expect(await db.appSetting.count({where:{key:`company_automation_request:${userId}:${input.requestId}`}})).toBe(1);
  await expect(salvarAutomacaoEmpresa(db,companyId,userId,{...input,requestId:randomUUID()},{isAdmin:true})).rejects.toMatchObject({code:'AUTOMATION_CHANGED'});
  const broken={$transaction:(fn,options)=>db.$transaction(tx=>fn(new Proxy(tx,{get(target,key){
    if(key==='appSetting')return new Proxy(target.appSetting,{get(model,method){if(method==='create')return args=>{if(args.data.key.startsWith('company_automation_request:'))throw Error('audit-failed');return model.create(args);};const value=model[method];return typeof value==='function'?value.bind(model):value;}});
    const value=target[key];return typeof value==='function'?value.bind(target):value;
  }})),options)};
  await expect(salvarAutomacaoEmpresa(broken,companyId,userId,{expectedRevision:saved.revision,requestId:randomUUID(),agendaEventos:{patch:{defaults:{captura:{hour:9}}}}},{isAdmin:true})).rejects.toThrow('audit-failed');
  expect((await lerAutomacaoEmpresa(db,companyId)).revision).toBe(saved.revision);
  const changed=await salvarAutomacaoEmpresa(db,companyId,userId,{expectedRevision:saved.revision,requestId:randomUUID(),agendaEventos:{patch:{defaults:{captura:{hour:10}}}}},{isAdmin:true});
  expect(changed.revision).not.toBe(saved.revision);
  await expect(salvarAutomacaoEmpresa(db,companyId,userId,input,{isAdmin:true})).rejects.toMatchObject({code:'AUTOMATION_CHANGED'});
  await db.user.update({where:{id:userId},data:{status:'inactive'}});
  await expect(salvarAutomacaoEmpresa(db,companyId,userId,input,{isAdmin:true})).rejects.toMatchObject({status:403});
},30000);

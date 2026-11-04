import { assertDisposablePostgres } from '../../../test-support/disposablePostgresGuard.js';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { lerReferenciaVencimento, salvarReferenciaVencimento } from '../ReferenciaVencimentoService.js';

const raw=process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
if(process.env.NODE_ENV!=='test'||!raw)throw Error('Explicit disposable database required');
const url=new URL(raw);
if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!/^\/[a-zA-Z0-9_]+_governance_test$/.test(url.pathname)||url.search||url.hash)throw Error('Disposable loopback database required');
const db=new PrismaClient({datasources:{db:{url:raw}}}),companyId=randomUUID(),userId=randomUUID();
const identity={tributo:'IRPJ',tipoPeriodo:'TRIMESTRAL',competencia:'2026-T3'};
beforeAll(async()=>{
  const [actual]=await db.$queryRaw`SELECT current_database() AS name,current_user AS username,host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('server_version_num') AS "versionNumber"`;
  expect(actual.name).toBe(url.pathname.slice(1));
  assertDisposablePostgres({raw,actual});
  await db.user.create({data:{id:userId,email:`${userId}@example.invalid`,passwordHash:'NOT_USABLE',role:'admin',accountType:'FIRM',status:'active'}});
  await db.portalClient.create({data:{id:companyId,razao:'R2 reference synthetic fixture',cnpj:`test-${companyId}`}});
});
afterAll(async()=>{await db.$disconnect();}); // Immutable evidence remains in this disposable database only.
test('SQL concurrent CAS, replay, monthly isolation, immutable audit and revocation',async()=>{
  const command={identidade:identity,acao:'CONFIRMAR',expectedRevision:0,requestId:randomUUID(),dataCivil:'2026-10-30',origem:'CONFIRMADA_CONTADOR',descricaoFonte:'Synthetic evidence',confirmacao:true,motivo:'Isolated test'};
  const attempts=await Promise.allSettled([salvarReferenciaVencimento(db,companyId,userId,command),salvarReferenciaVencimento(db,companyId,userId,command)]);
  expect(attempts.filter(r=>r.status==='fulfilled').length).toBeGreaterThanOrEqual(1);
  for(const failed of attempts.filter(r=>r.status==='rejected'))expect(['P2034','P2002']).toContain(failed.reason.code);
  const saved=await salvarReferenciaVencimento(db,companyId,userId,command);
  expect(saved).toMatchObject({revision:1,referenceConsumerReady:false,captureCapabilityGranted:false,reference:{companyId,tipoPeriodo:'TRIMESTRAL',confirmedBy:userId,dataCivil:'2026-10-30'}});
  expect(await db.referenciaVencimentoFiscalEvento.count({where:{referenceId:saved.reference.id}})).toBe(1);
  expect(await lerReferenciaVencimento(db,companyId,userId,{tributo:'IRPJ',tipoPeriodo:'MENSAL',competencia:'2026-09'})).toMatchObject({reference:null,revision:0});
  const event=await db.referenciaVencimentoFiscalEvento.findFirst({where:{referenceId:saved.reference.id}});
  await expect(db.referenciaVencimentoFiscalEvento.update({where:{id:event.id},data:{motivo:'forged'}})).rejects.toThrow();
  await expect(db.referenciaVencimentoFiscalEvento.delete({where:{id:event.id}})).rejects.toThrow();
  const broken={$transaction:(fn,options)=>db.$transaction(tx=>fn(new Proxy(tx,{get(target,key){
    if(key==='referenciaVencimentoFiscalEvento')return new Proxy(target[key],{get(model,method){if(method==='create')return ()=>{throw Error('audit-failed');};const value=model[method];return typeof value==='function'?value.bind(model):value;}});
    const value=target[key];return typeof value==='function'?value.bind(target):value;
  }})),options)};
  const revoke={identidade:identity,acao:'REVOGAR',expectedRevision:1,requestId:randomUUID(),motivo:'Isolated revocation'};
  await expect(salvarReferenciaVencimento(broken,companyId,userId,revoke)).rejects.toThrow('audit-failed');
  expect((await lerReferenciaVencimento(db,companyId,userId,identity)).reference.status).toBe('ATIVA');
  expect((await salvarReferenciaVencimento(db,companyId,userId,revoke)).reference.status).toBe('REVOGADA');
  await expect(salvarReferenciaVencimento(db,companyId,userId,command)).rejects.toMatchObject({code:'REFERENCE_CHANGED'});
  await db.user.update({where:{id:userId},data:{status:'inactive'}});
  await expect(salvarReferenciaVencimento(db,companyId,userId,revoke)).rejects.toMatchObject({status:403});
},30000);

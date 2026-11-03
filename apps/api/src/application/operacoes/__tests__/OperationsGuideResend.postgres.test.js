import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:new Proxy({}, {get:(_target,p)=>{const v=mockPg[p];return typeof v==='function'?v.bind(mockPg):v;}})}));
jest.mock('../../guides/GuideService.js',()=>({getGuidePdfBuffer:async g=>mockLoadPdf(g)}));
jest.mock('../../../infrastructure/mail/EmailService.js',()=>({EmailService:jest.fn().mockImplementation(()=>({send:(...args)=>mockSend(...args)}))}));
jest.mock('../../guides/GuideLockService.js',()=>({tryAcquireGuideLock:async()=>true,releaseGuideLock:async()=>{}}));
jest.mock('../../fiscal/automacaoCicloFiscalContext.js',()=>({conferirContextoCicloFiscal:async()=>null,comAutomacaoEmpresa:async(_id,fn)=>fn(),comAutomacaoCicloFiscal:async(_p,fn)=>fn()}));
import { createOperationsGuideEvidence } from '../OperationsGuideEvidence.js';
import { runGuideEmailWorkerSelected } from '../../../workers/guideEmailWorker.js';
const raw=process.env.TEST_OPERATIONS_PG_URL;
let mockPg;const mockTransport=jest.fn(async()=>({id:'synthetic-only'}));
const mockSend=jest.fn(async payload=>{await payload.beforeDispatch?.();return mockTransport();});let mockLoadPdf;
(raw?test:test.skip).each(['after-auth','concurrency','timeout','legacy-sending','legacy-indeterminate'])('PG %s: real selected consumer, persisted claim and fake transport',async mode=>{
 if(raw!=='postgresql://altan_test@127.0.0.1:54661/altan_rotinas_governance_test'||process.env.NODE_ENV!=='test')throw Error('Somente PostgreSQL descartável autorizado.');
 const pg=new PrismaClient({datasources:{db:{url:raw}}});mockPg=pg;
 mockSend.mockReset().mockImplementation(async payload=>{await payload.beforeDispatch?.();return mockTransport();});mockTransport.mockReset().mockResolvedValue({id:'synthetic-only'});
 const userId=randomUUID(),clientId=randomUUID(),companyId=randomUUID(),portalId=randomUUID(),guideId=randomUUID(),contactId=randomUUID();
 const prefix='operations_guide_preview:';const tokens=[];
 const input={userId,companyId:portalId,competencia:'2026-10',items:[{guideId,reenviarConfirmado:true}],whatsappRequested:false};
 try{
  await pg.user.create({data:{id:userId,email:`${userId}@example.test`,passwordHash:'fake-only',role:'contador',status:'active',accountType:'FIRM'}});
  await pg.client.create({data:{id:clientId,name:'DESIGN SINTETICO',email:`${clientId}@example.test`,login:clientId,passwordHash:'fake-only'}});
  const cnpj=(BigInt(`0x${randomUUID().replace(/-/g,'')}`)%100000000000000n).toString().padStart(14,'0');
  await pg.company.create({data:{id:companyId,clientId,cnpj,razaoSocial:'DESIGN SINTETICO',atividades:[],regimeTributario:'SIMPLES'}});
  await pg.portalClient.create({data:{id:portalId,companyId,cnpj,razao:'DESIGN SINTETICO',status:'ATIVA'}});
  await pg.companyFirmAccess.create({data:{companyId:portalId,userId,role:'ACCOUNTANT',status:'ACTIVE'}});
  await pg.contatoWhatsapp.create({data:{id:contactId,portalClientId:portalId,nome:'Teste',email:'synthetic@example.test',ativo:true}});
  const guide=await pg.guide.create({data:{id:guideId,portalClientId:portalId,competencia:'2026-10',tipo:'SIMPLES',status:'PROCESSED',paymentStatus:'OPEN',source:'LOCAL',valor:100,hash:randomUUID(),pdfBytes:Buffer.from('%PDF-synthetic'),vencimento:new Date('2026-11-20')}});
  const service=createOperationsGuideEvidence({db:pg});
  const p=await service.preview(input);tokens.push(p.token);expect(p.items[0].destinatarios.emails).toEqual(['synthetic@example.test']);
  const reservations=await Promise.allSettled([service.reserve({...input,token:p.token}),service.reserve({...input,token:p.token})]);
  if(!reservations.some(r=>r.status==='fulfilled'))throw new Error(reservations.map(r=>`${r.reason?.code}: ${r.reason?.message}`).join('\n'));
  expect(reservations.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const guard=reservations.find(r=>r.status==='fulfilled').value;
  mockLoadPdf=async()=>guide.pdfBytes;
  const sent=await runGuideEmailWorkerSelected({guideIds:[guideId],operationsGuard:guard});
  expect(sent.sent).toBe(1);expect(mockSend).toHaveBeenCalledTimes(1);
  await expect(service.reserve({...input,token:p.token})).rejects.toBeDefined();
  for(const mutation of ['pdf','permission','payload']){
   const next=await service.preview(input);tokens.push(next.token);expect(next.token).toBeTruthy();
   const capability=await service.reserve({...input,token:next.token});
   mockLoadPdf=async()=>{
    if(mutation==='pdf')await pg.guide.update({where:{id:guideId},data:{pdfBytes:Buffer.from('%PDF-new')}});
    if(mutation==='permission')await pg.companyFirmAccess.update({where:{companyId_userId:{companyId:portalId,userId}},data:{status:'REMOVED'}});
    return mutation==='payload'?Buffer.from('%PDF-wrong-loaded-bytes'):guide.pdfBytes;
   };
   const result=await runGuideEmailWorkerSelected({guideIds:[guideId],operationsGuard:capability});
   expect(result.sent).toBe(0);expect(result.results[0].code).toBe('OPERATIONS_PREVIEW_CHANGED');expect(mockSend).toHaveBeenCalledTimes(1);
   await pg.companyFirmAccess.update({where:{companyId_userId:{companyId:portalId,userId}},data:{status:'ACTIVE'}});
   await pg.guide.update({where:{id:guideId},data:{pdfBytes:guide.pdfBytes}});
  }
  // The existing EmailService invokes this callback after authentication/MIME preparation.
  mockLoadPdf=async()=>guide.pdfBytes;
  if(mode==='after-auth'){
  const afterAuth=await service.preview(input);tokens.push(afterAuth.token);
  const afterAuthGuard=await service.reserve({...input,token:afterAuth.token});mockLoadPdf=async()=>guide.pdfBytes;
  mockSend.mockImplementationOnce(async payload=>{
   await pg.companyFirmAccess.update({where:{companyId_userId:{companyId:portalId,userId}},data:{status:'REMOVED'}});
   await payload.beforeDispatch?.();return mockTransport();
  });
  const revoked=await runGuideEmailWorkerSelected({guideIds:[guideId],operationsGuard:afterAuthGuard});
  expect(revoked.sent).toBe(0);expect(mockTransport).toHaveBeenCalledTimes(1);
  const revokedClaim=(await pg.appSetting.findUnique({where:{key:prefix+afterAuth.token}})).value;
  expect(revokedClaim.dispatches).toBeUndefined();
  await pg.companyFirmAccess.update({where:{companyId_userId:{companyId:portalId,userId}},data:{status:'ACTIVE'}});
  return;
  }
  if(mode.startsWith('legacy-')){
   const prepared=await service.preview(input);tokens.push(prepared.token);
   const guard=await service.reserve({...input,token:prepared.token});
   if(mode==='legacy-sending')await pg.guide.update({where:{id:guideId},data:{emailStatus:'SENDING'}});
   else await pg.envioGuia.create({data:{guideId,canal:'EMAIL',destino:'synthetic@example.test',status:'indeterminado'}});
   const before=await pg.guide.findUnique({where:{id:guideId}});
   const refused=await runGuideEmailWorkerSelected({guideIds:[guideId],operationsGuard:guard});
   expect(refused.sent).toBe(0);expect(refused.results[0].code).toBe('OPERATIONS_PREVIEW_CHANGED');
   expect(mockTransport).toHaveBeenCalledTimes(1);
   expect((await pg.guide.findUnique({where:{id:guideId}})).emailAttempts).toBe(before.emailAttempts);
   expect((await pg.appSetting.findUnique({where:{key:prefix+prepared.token}})).value.emailReservations).toBeUndefined();
   return;
  }
  // Distinct tokens compete for the same existing guide row lock and revision.
  if(mode==='concurrency'){
  const raceService=createOperationsGuideEvidence({db:pg});
  const races=await Promise.all([raceService.preview(input),raceService.preview(input)]);tokens.push(...races.map(p=>p.token));
  const raceGuards=[];
  for (const preview of races) raceGuards.push(await raceService.reserve({...input,token:preview.token}));
  const concurrentTransport=jest.fn(async()=>({id:'synthetic-race'}));
  const current=await pg.guide.findUnique({where:{id:guideId}});
  const raceArgs={guide:current,canal:'EMAIL',destino:'synthetic@example.test',pdfBytes:guide.pdfBytes};
  const results=await Promise.allSettled(raceGuards.map(async guard=>{
   const source=await guard.reserveEmail(raceArgs,tx=>tx.guide.update({where:{id:guideId},data:{emailStatus:'SENDING',emailAttempts:current.emailAttempts+1}}));
   await guard.beginDispatch({...raceArgs,guide:source});const receipt=await concurrentTransport();
   await pg.guide.update({where:{id:guideId},data:{emailStatus:'SENT'}});await guard.completeDispatch({guideId,receipt});
  }));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(concurrentTransport).toHaveBeenCalledTimes(1);
  return;
  }
  const firstPreview=await service.preview(input),secondPreview=await service.preview(input);tokens.push(firstPreview.token,secondPreview.token);
  const firstGuard=await service.reserve({...input,token:firstPreview.token}),secondGuard=await service.reserve({...input,token:secondPreview.token});
  mockTransport.mockRejectedValueOnce(Object.assign(new Error('synthetic timeout after provider may have accepted'),{code:'ETIMEDOUT'}));
  const uncertain=await runGuideEmailWorkerSelected({guideIds:[guideId],operationsGuard:firstGuard});
  expect(uncertain.sent).toBe(0);expect(uncertain.results[0]).toMatchObject({code:'OPERATIONS_EMAIL_INDETERMINADO',willRetry:false});
  const row=(await pg.appSetting.findUnique({where:{key:prefix+firstPreview.token}})).value;
  expect(row.dispatches[guideId].EMAIL.status).toBe('INICIADO');
  expect((await pg.guide.findUnique({where:{id:guideId}})).emailNextRetryAt).toBeNull();
  expect((await service.preview(input)).token).toBeNull();
  const blocked=await runGuideEmailWorkerSelected({guideIds:[guideId],operationsGuard:secondGuard});
  expect(blocked.sent).toBe(0);expect(mockTransport).toHaveBeenCalledTimes(2);
 }finally{
  await pg.appSetting.deleteMany({where:{key:{in:tokens.filter(Boolean).map(t=>prefix+t)}}});
  await pg.envioGuiaTentativa.deleteMany({where:{envioGuia:{guideId}}});await pg.envioGuia.deleteMany({where:{guideId}});
  await pg.guide.deleteMany({where:{id:guideId,portalClientId:portalId}});await pg.contatoWhatsapp.deleteMany({where:{id:contactId,portalClientId:portalId}});
  await pg.companyFirmAccess.deleteMany({where:{companyId:portalId,userId}});await pg.portalClient.deleteMany({where:{id:portalId,razao:'DESIGN SINTETICO'}});
  await pg.company.deleteMany({where:{id:companyId,clientId}});await pg.client.deleteMany({where:{id:clientId,name:'DESIGN SINTETICO'}});await pg.user.deleteMany({where:{id:userId}});await pg.$disconnect();
 }
},30000);

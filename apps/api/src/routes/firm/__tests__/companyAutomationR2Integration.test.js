jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import express from 'express';
import request from 'supertest';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { createFirmPortalRouter } from '../index.js';

// Real firm mounting, middleware and services; transactional storage is synthetic.
// PostgreSQL suites separately exercise real CAS and rollback.
const cloneSetting = value => JSON.parse(JSON.stringify(value));
let settings, references, events, actor, access;
function mount(user={id:'u',role:'contador',accountType:'FIRM'}) {
  const app=express();app.use(express.json());
  app.locals.ensureAuthorized=async req=>{if(!user)return false;req.auth={user};return true;};
  app.use('/firm',createFirmPortalRouter({ensureAuthorized:app.locals.ensureAuthorized,log:{info(){},warn(){},error(){},debug(){}}}));
  return app;
}
beforeEach(()=>{
  settings=new Map();references=new Map();events=new Map();actor={id:'u',role:'contador',status:'active',accountType:'FIRM'};access={role:'ACCOUNTANT',status:'ACTIVE',scopes:[]};
  Object.assign(prisma,{
    user:{findUnique:jest.fn(async()=>actor)},
    portalClient:{findUnique:jest.fn(async({where})=>['a','b'].includes(where.id)?{id:where.id,razao:`Empresa fictícia ${where.id}`,companyId:null}:null)},
    companyFirmAccess:{findUnique:jest.fn(async({where})=>where.companyId_userId.companyId==='a'?access:null)},
    companyRotina:{findMany:jest.fn(async()=>[]),upsert:jest.fn()},$queryRaw:jest.fn(async()=>[]),
    appSetting:{findUnique:jest.fn(async({where})=>cloneSetting(settings.get(where.key)||null)),
      create:jest.fn(async({data})=>{if(settings.has(data.key))throw Object.assign(Error('duplicate'),{code:'P2002'});settings.set(data.key,cloneSetting(data));return data;}),
      updateMany:jest.fn(async({where,data})=>{if(JSON.stringify(settings.get(where.key)?.value)!==JSON.stringify(where.value.equals))return {count:0};settings.set(where.key,{key:where.key,...cloneSetting(data)});return {count:1};})},
    referenciaVencimentoFiscal:{
      findUnique:jest.fn(async({where})=>references.get(JSON.stringify(where.portalClientId_tributo_tipoPeriodo_competencia_targetKey))||null),
      create:jest.fn(async({data})=>{references.set(JSON.stringify({portalClientId:data.portalClientId,tributo:data.tributo,tipoPeriodo:data.tipoPeriodo,competencia:data.competencia,targetKey:data.targetKey}),{...data,parcelamentoId:null,numeroParcela:null});return data;}),
      updateMany:jest.fn(async({where,data})=>{for(const [key,row] of references)if(row.id===where.id&&row.revision===where.revision){references.set(key,{...row,...data});return {count:1};}return {count:0};})},
    referenciaVencimentoFiscalEvento:{findUnique:jest.fn(async({where})=>events.get(JSON.stringify(where.actorId_requestId))||null),create:jest.fn(async({data})=>{events.set(JSON.stringify({actorId:data.actorId,requestId:data.requestId}),data);return data;})},
  });
  prisma.$transaction=jest.fn(async fn=>{const backup=[new Map([...settings].map(([k,v])=>[k,cloneSetting(v)])),structuredClone(references),structuredClone(events)];try{return await fn(prisma);}catch(e){[settings,references,events]=backup;throw e;}});
});
const base='/firm/companies/a/automacao';
const identity={tributo:'DAS',tipoPeriodo:'MENSAL',competencia:'2026-10'};
test('montagem composta: GET sem escrita, adoção CAS, replay e nome autoritativo',async()=>{
  const app=mount(),before=await request(app).get(base);expect(before.status).toBe(200);expect(before.body.companyName).toBe('Empresa fictícia a');expect(settings.size).toBe(0);
  const command={expectedRevision:before.body.revision,requestId:'http-adoption-001',agendaEventos:{executionMode:'RELATIVO_V1'}};
  const saved=await request(app).put(base).send(command);expect(saved.status).toBe(200);expect(saved.body.agendaEventos.executionMode).toBe('RELATIVO_V1');expect(saved.body.agendaEventos.capabilities.capture).toBe(false);
  for(const key of ['rotinas','lembretes','automationPolicy','globalAutomationPolicy','serproPolicy'])expect(saved.body[key]).toEqual(before.body[key]);
  expect(prisma.companyRotina.upsert).not.toHaveBeenCalled();expect((await request(app).put(base).send(command)).body).toEqual(saved.body);
  expect((await request(app).put(base).send({...command,requestId:'http-stale-001'})).status).toBe(409);
  actor.status='inactive';expect((await request(app).put(base).send(command)).status).toBe(403);
});
test('referência e modo mantêm revisões independentes; replay não cria evento',async()=>{
  const app=mount(),before=(await request(app).get(base)).body;
  const read=await request(app).get(`${base}/referencia-vencimento`).query(identity);expect(read.status).toBe(200);expect(read.body).toMatchObject({reference:null,revision:0,captureCapabilityGranted:false});expect(events.size).toBe(0);
  const command={identidade:identity,acao:'CONFIRMAR',expectedRevision:0,requestId:'http-reference-001',dataCivil:'2026-11-20',origem:'CONFIRMADA_CONTADOR',descricaoFonte:'Fonte fictícia',confirmacao:true,motivo:'Ensaio'};
  const saved=await request(app).put(`${base}/referencia-vencimento`).send(command);expect(saved.status).toBe(200);expect(saved.body.reference).toMatchObject({companyId:'a',confirmedBy:'u',competencia:'2026-10'});
  expect((await request(app).put(`${base}/referencia-vencimento`).send(command)).body).toEqual(saved.body);expect(events.size).toBe(1);
  expect((await request(app).get(base)).body.revision).toBe(before.revision);
  access=null;expect((await request(app).put(`${base}/referencia-vencimento`).send(command)).status).toBe(403);
});
test('ACL real, identidade da rota e payload misto global recusam sem escrita',async()=>{
  const app=mount();expect((await request(app).get('/firm/companies/b/automacao')).status).toBe(403);
  access={role:'STAFF',status:'ACTIVE'};expect((await request(app).put(base).send({})).status).toBe(403);expect((await request(app).put(`${base}/referencia-vencimento`).send({})).status).toBe(403);
  expect((await request(app).put('/firm/rotinas').send({requestId:'mixed-http-request',agenda:{},agendaEventos:{expectedRevision:'a'.repeat(64),patch:{defaults:{captura:{hour:8}}}}})).status).toBe(422);
  expect(settings.size).toBe(0);expect(events.size).toBe(0);
});
test('falha de auditoria retorna erro e rollback sem modo parcialmente adotado',async()=>{
  const app=mount(),before=(await request(app).get(base)).body,create=prisma.appSetting.create.getMockImplementation();
  prisma.appSetting.create.mockImplementation(args=>{if(args.data.key.startsWith('company_automation_request:'))throw Error('audit');return create(args);});
  expect((await request(app).put(base).send({expectedRevision:before.revision,requestId:'http-audit-failure',agendaEventos:{executionMode:'RELATIVO_V1'}})).status).toBe(503);
  expect((await request(app).get(base)).body).toEqual(before);expect(settings.size).toBe(0);
});

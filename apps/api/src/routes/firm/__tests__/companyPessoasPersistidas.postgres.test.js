import request from "supertest";
import express from "express";

jest.mock("../../../infrastructure/db/prisma.js", () => {
  let current;
  const proxy = new Proxy({}, { get(_t, key) { const v=current?.[key]; return typeof v === 'function' ? v.bind(current) : v; } });
  return { prisma: proxy, setIsolatedClient: value => { current=value; } };
});
jest.mock("../../../application/guides/guideCompliance.js", () => {
  const real = jest.requireActual("../../../application/guides/guideCompliance.js");
  return {
    ...real,
    computeGuideComplianceMap: jest.fn(async () => new Map()),
  };
});

import { createFirmPortalRouter } from "../index.js";
import { setIsolatedClient } from "../../../infrastructure/db/prisma.js";

let PORTAL_ID;
let COMPANY_LEGACY_ID;
let CNPJ;

const USUARIO_LOGADO = { id: "user-firm-1", role: "admin", accountType: "FIRM", email: "admin@escritorio.com" };

function montarApp() {
  const app = express();
  app.use(express.json());
  app.locals.ensureAuthorized = async (req) => {
    req.auth = { user: { ...USUARIO_LOGADO } };
    return true;
  };
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  app.use("/firm", createFirmPortalRouter({ ensureAuthorized: app.locals.ensureAuthorized, log }));
  app.use("/client", createClientPortalRouter({ ensureAuthorized: app.locals.ensureAuthorized, log }));
  return app;
}

function payload(companyExtra = {}) {
  return {
    company: {
      razaoSocial: "EMPRESA TESTE LTDA",
      cnpj: CNPJ,
      regimeTributario: "SIMPLES",
      cnaePrincipal: "6201501",
      endereco: {
        rua: "Rua das Flores",
        numero: "100",
        bairro: "Centro",
        cidade: "Rio de Janeiro",
        uf: "RJ",
        cep: "20000-000",
      },
      ...companyExtra,
    },
  };
}


import { createClientPortalRouter } from "../../client/index.js";
import { PrismaClient } from "@prisma/client";
import { randomUUID, randomInt } from "node:crypto";
function connection() {
  const raw=process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
  if(process.env.NODE_ENV!=='test'||!raw)throw Error('Explicit disposable test database required');
  const u=new URL(raw);
  if(!['postgres:','postgresql:'].includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||!/^\/[a-zA-Z0-9_]+_governance_test$/.test(u.pathname)||u.search||u.hash)throw Error('Database refused');
  return {raw,database:u.pathname.slice(1)};
}
function cnpjFicticio(){const d=Array.from({length:8},()=>randomInt(10)).concat([0,0,0,1]);for(const w of [[5,4,3,2,9,8,7,6,5,4,3,2],[6,5,4,3,2,9,8,7,6,5,4,3,2]]){const r=d.reduce((a,n,i)=>a+n*w[i],0)%11;d.push(r<2?0:11-r);}return d.join('');}
test('rotas reais: duas recusas firm, client POST, omissões e resolução explícita; SQL rollback sem resíduos',async()=>{
  const target=connection(),db=new PrismaClient({datasources:{db:{url:target.raw}}});
  const ids={client:randomUUID(),company:randomUUID(),portal:randomUUID(),partner:randomUUID()};
  const stop=Error('MANDATORY_SYNTHETIC_ROLLBACK'),titular={nome:'Ana Fictícia',cpf:'52998224725'};
  let passed=false;
  try {
    const [actual]=await db.$queryRaw`SELECT current_database() AS database,host(inet_server_addr()) AS address`;
    expect(actual.database).toBe(target.database);expect(['127.0.0.1','::1','::ffff:127.0.0.1']).toContain(actual.address);
    await expect(db.$transaction(async tx=>{
      PORTAL_ID=ids.portal;COMPANY_LEGACY_ID=ids.company;CNPJ=cnpjFicticio();
      await tx.client.create({data:{id:ids.client,name:'Fixture pessoas',login:ids.client,email:`${ids.client}@example.invalid`,passwordHash:'SYNTHETIC_NOT_USABLE'}});
      await tx.company.create({data:{id:ids.company,clientId:ids.client,cnpj:CNPJ,razaoSocial:'Antes',atividades:[]}});
      await tx.portalClient.create({data:{id:ids.portal,companyId:ids.company,cnpj:CNPJ,razao:'Antes'}});
      await tx.partner.create({data:{id:ids.partner,companyId:ids.company,name:'Bia Fictícia'}});
      // Transação externa garante rollback de TODAS fixtures. Savepoint real reproduz
      // rollback da transação da rota; não é prova de duas conexões concorrentes.
      const routeDb=new Proxy(tx,{get(t,k){if(k==='$transaction')return async fn=>{await tx.$executeRawUnsafe('SAVEPOINT route_pessoas');try{const r=await fn(tx);await tx.$executeRawUnsafe('RELEASE SAVEPOINT route_pessoas');return r;}catch(e){await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT route_pessoas');await tx.$executeRawUnsafe('RELEASE SAVEPOINT route_pessoas');throw e;}};const v=t[k];return typeof v==='function'?v.bind(t):v;}});
      setIsolatedClient(routeDb);const app=montarApp();
      const snapshot=async()=>({portal:await tx.portalClient.findUnique({where:{id:ids.portal}}),company:await tx.company.findUnique({where:{id:ids.company},include:{partners:true}})});
      let before=await snapshot();
      let r=await request(app).patch(`/firm/companies/${ids.portal}`).send(payload({titular}));
      expect(r.status).toBe(400);expect(r.body.error).toBe('company_titular_invalid');expect(await snapshot()).toEqual(before);
      r=await request(app).patch(`/firm/companies/${ids.portal}`).send(payload());expect(r.status).toBe(200);
      expect((await snapshot()).company.partners).toEqual(before.company.partners);
      r=await request(app).patch(`/firm/companies/${ids.portal}`).send(payload({titular,socios:[]}));expect(r.status).toBe(200);
      before=await snapshot();expect(before.company.titular).toEqual(titular);expect(before.company.partners).toEqual([]);
      r=await request(app).patch(`/firm/companies/${ids.portal}`).send(payload({socios:[{nome:'Outra Fictícia'}]}));
      expect(r.status).toBe(400);expect(r.body.error).toBe('company_titular_invalid');expect(await snapshot()).toEqual(before);
      r=await request(app).post(`/client/companies/${ids.portal}/partners`).send({name:'Pessoa incompatível'});
      expect(r.status).toBe(400);expect(r.body.error).toBe('company_titular_invalid');expect(await snapshot()).toEqual(before);
      r=await request(app).patch(`/firm/companies/${ids.portal}`).send(payload());expect(r.status).toBe(200);expect((await snapshot()).company.titular).toEqual(titular);
      passed=true;throw stop;
    },{timeout:30000})).rejects.toBe(stop);
    expect(passed).toBe(true);expect(await db.company.count({where:{id:ids.company}})).toBe(0);expect(await db.portalClient.count({where:{id:ids.portal}})).toBe(0);expect(await db.client.count({where:{id:ids.client}})).toBe(0);expect(await db.partner.count({where:{companyId:ids.company}})).toBe(0);
  }finally{setIsolatedClient(null);await db.$disconnect();}
},45000);
test.each(['firm','client','patch','delete'])('concorrência real: %s primeiro, lock comum e recusa da segunda intenção incompatível',async primeiro=>{
 const target=connection(),db=new PrismaClient({datasources:{db:{url:target.raw}}});
 const ids={client:randomUUID(),company:randomUUID(),portal:randomUUID(),partner:randomUUID()};const substituicao=['patch','delete'].includes(primeiro);const titular={nome:'Ana Sintética',cpf:'52998224725'};
 let releaseFirst,firstLockedResolve,secondEnteredResolve;
 const hold=new Promise(r=>releaseFirst=r),firstLocked=new Promise(r=>firstLockedResolve=r),secondEntered=new Promise(r=>secondEnteredResolve=r);
 const pids=[],requests=[];let transactionCount=0;
 try {
  const [actual]=await db.$queryRaw`SELECT current_database() AS database,host(inet_server_addr()) AS address`;
  expect(actual.database).toBe(target.database);expect(['127.0.0.1','::1','::ffff:127.0.0.1']).toContain(actual.address);
  PORTAL_ID=ids.portal;COMPANY_LEGACY_ID=ids.company;CNPJ=cnpjFicticio();
  await db.$transaction(async tx=>{
   await tx.client.create({data:{id:ids.client,name:'Fixture concorrência',login:ids.client,email:`${ids.client}@example.invalid`,passwordHash:'SYNTHETIC_NOT_USABLE'}});
   await tx.company.create({data:{id:ids.company,clientId:ids.client,cnpj:CNPJ,razaoSocial:'Fixture concorrência',atividades:[]}});
   await tx.portalClient.create({data:{id:ids.portal,companyId:ids.company,cnpj:CNPJ,razao:'Fixture concorrência'}});
   if(substituicao)await tx.partner.create({data:{id:ids.partner,companyId:ids.company,name:'Pessoa anterior'}});
  });
  const routeDb=new Proxy(db,{get(t,k){if(k==='$transaction')return async fn=>{const slot=transactionCount++;return db.$transaction(async tx=>{
   const [identity]=await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;pids[slot]=identity.pid;
   const wrapped=new Proxy(tx,{get(inner,key){if(key==='$queryRaw')return async(...args)=>{
    if(slot===1)secondEnteredResolve();const result=await tx.$queryRaw(...args);
    if(slot===0){firstLockedResolve();await hold;}return result;
   };const v=inner[key];return typeof v==='function'?v.bind(inner):v;}});
   return fn(wrapped);
  },{timeout:20000,maxWait:5000});};const v=t[k];return typeof v==='function'?v.bind(t):v;}});
  setIsolatedClient(routeDb);const app=montarApp();
  const send=kind=>substituicao?(kind==='firm'?request(app).patch(`/firm/companies/${ids.portal}`).send(payload({socios:[{nome:'Pessoa substituta'}]})):request(app)[primeiro](`/client/companies/${ids.portal}/partners/${ids.partner}`).send({name:'Edição antiga'})):kind==='firm'?request(app).patch(`/firm/companies/${ids.portal}`).send(payload({titular})):request(app).post(`/client/companies/${ids.portal}/partners`).send({name:'Bia Sintética'});
  const first=send(substituicao?'firm':primeiro).then(r=>r);requests.push(first);await firstLocked;
  const second=send(substituicao?'client':primeiro==='firm'?'client':'firm').then(r=>r);requests.push(second);await secondEntered;
  let blocked=[];
  for(let i=0;i<30;i++){const [row]=await db.$queryRaw`SELECT pg_blocking_pids(${pids[1]}::int) AS blockers`;blocked=row.blockers;if(blocked.includes(pids[0]))break;await new Promise(r=>setTimeout(r,10));}
  expect(blocked).toContain(pids[0]);expect(pids[0]).not.toBe(pids[1]);releaseFirst();
  const [a,b]=await Promise.all([first,second]);expect(a.status).toBe(substituicao||primeiro==='firm'?200:201);expect(b.status).toBe(substituicao?404:400);expect(b.body.error).toBe(substituicao?'not_found':'company_titular_invalid');
  const saved=await db.company.findUnique({where:{id:ids.company},include:{partners:true}});
  if(substituicao){expect(saved.titular).toBeNull();expect(saved.partners).toHaveLength(1);expect(saved.partners[0].name).toBe('Pessoa substituta');expect(saved.partners[0].id).not.toBe(ids.partner);}else if(primeiro==='firm'){expect(saved.titular).toEqual(titular);expect(saved.partners).toEqual([]);}else{expect(saved.titular).toBeNull();expect(saved.partners).toHaveLength(1);expect(saved.partners[0].name).toBe('Bia Sintética');}
 }finally{
  releaseFirst();await Promise.allSettled(requests);setIsolatedClient(null);
  await db.$transaction(async tx=>{await tx.partner.deleteMany({where:{companyId:ids.company}});await tx.portalClient.deleteMany({where:{id:ids.portal}});await tx.company.deleteMany({where:{id:ids.company}});await tx.client.deleteMany({where:{id:ids.client}});});
  expect(await db.partner.count({where:{companyId:ids.company}})).toBe(0);expect(await db.portalClient.count({where:{id:ids.portal}})).toBe(0);expect(await db.company.count({where:{id:ids.company}})).toBe(0);expect(await db.client.count({where:{id:ids.client}})).toBe(0);
  console.info(JSON.stringify({scenario:primeiro,fixtureIds:ids,cleanupVerified:true,residualFixtures:0}));await db.$disconnect();
 }
},45000);

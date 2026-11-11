// Node 20: node --experimental-vm-modules --test apps/api/scripts/piloto-correcao.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as crypto from 'node:crypto';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const requireRepo = createRequire(import.meta.url);
const express = requireRepo('express');
const request = requireRepo('supertest');
const context = vm.createContext({ Buffer, Date });
const cache = new Map();
let state;
const fakeDb = {
  companyFirmAccess: {
    findUnique: async ({where}) => {
      const {companyId, userId} = where.companyId_userId;
      state.accessChecks.push({companyId, userId});
      return userId === 'u' && state.linkedCompanies.includes(companyId) ? state.link : null;
    }
  },
  guide: {
    findFirst: async ({ where }) => where.id === 'g' && where.portalClientId === 'A' ? structuredClone(state.guide) : null,
    updateMany: async ({ where, data }) => {
      assert.equal(where.portalClientId, 'A');
      assert.equal(where.id, 'g');
      assert.equal(String(where.updatedAt), String(state.guide.updatedAt));
      if (state.count === 0) return {count: 0};
      state.writes.push('guia');
      state.data = data;
      return { count: state.count };
    }
  },
  companyMonthlyCircular: { findMany: async () => state.closed ? [{ competencia: '2026-08', fechadoContabilEm: new Date() }] : [] },
  accountingEntryLine: { updateMany: async ({data}) => { assert.equal(data.valor, 125.25); state.writes.push('linhas'); } },
  accountingEntry: { update: async () => state.writes.push('provisão') },
  appSetting: { create: async ({data}) => { assert.equal(data.value.userId, 'u'); state.writes.push('auditoria'); } },
  $transaction: async (fn, options) => {
    assert.equal(options.isolationLevel, 'Serializable');
    if (state.closeAtTransactionStart) state.closed = true;
    if (state.conflict) throw Object.assign(new Error(), { code: 'P2034' });
    return fn(fakeDb);
  }
};
function synthetic(id, exports) {
  return new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
  }, { context, identifier: id });
}
const real = new Set([
  'routes/firm/corrigirValorGuia.js',
  'middlewares/requireFirmCompanyAccess.js',
  'application/guides/CorrigirValorGuiaService.js',
  'application/accounting/fechamentoContabil.js',
  'modules/guides/domain/correcaoDeValor.js',
  'modules/accounting/public.js',
  'modules/accounting/domain/correcaoDeProvisao.js'
]);
const doubles = new Map([
  ['express',{Router:express.Router}], ['node:crypto',crypto],
  ['infrastructure/db/prisma.js',{prisma:fakeDb}],
  ['application/guides/GuideService.js',{getGuidePdfBuffer:async () => {
    if (state.pdfFailure) throw new Error('detalhe interno do armazenamento');
    return Buffer.from('fixture');
  }}],
  ['application/guides/lerLinhaDigitavelDoPdf.js',{lerLinhaDigitavelDoPdf:async () => state.pdf ? {linhaDigitavel:'fixture',linhaDigitavelMotivo:null} : {linhaDigitavel:null}}]
]);
async function load(id) {
  if (cache.has(id)) return cache.get(id);
  let mod;
  if (doubles.has(id)) mod = synthetic(id, doubles.get(id));
  else {
    assert.ok(real.has(id), 'Atualize a composição isolada da especificação para importar ' + id);
    mod = new vm.SourceTextModule(await readFile(path.join(src,id),'utf8'), {context,identifier:id});
  }
  cache.set(id,mod);
  return mod;
}
const router = await load('routes/firm/corrigirValorGuia.js');
await router.link((id, parent) => load(id.startsWith('.') ? path.posix.join(path.posix.dirname(parent.identifier),id) : id));
await router.evaluate();
const app = express();
app.use(express.json());
app.use((req,res,next) => { if (req.headers['x-fixture-user']) req.auth = {user:{id:'u',role:state.role}}; next(); });
app.use('/firm',router.namespace.createCorrigirValorGuiaRouter());
const url = '/firm/companies/A/guides/g/corrigir-valor';
const preview = (endpoint=url) => request(app).get(endpoint).set('x-fixture-user','u').query({valor:'125.25'});
const confirm = (revisao, fields = {}) => request(app).post(url).set('x-fixture-user','u').send({valor:'125.25',revisao, ...fields});
test.beforeEach(() => {
  state = { role:'user', accessChecks:[], linkedCompanies:['A'], link:{role:'ACCOUNTANT',status:'ACTIVE',scopes:[]}, writes:[], count:1, pdf:true,
    guide:{id:'g',portalClientId:'A',valor:100,competencia:'2026-08',tipo:'OUTRA',status:'PROCESSED',
      updatedAt:new Date('2026-09-01Z'),tributosParcela:[],accountingEntries:[{id:'e',portalClientId:'A',tipo:'PROVISAO',
      competencia:'2026-08',status:'RASCUNHO',baixas:[],lines:[{tipo:'D',valor:100},{tipo:'C',valor:100}]}]} };
});
test('prévia pública e confirmação com provisão balanceada', async () => {
  const {body} = await preview().expect(200);
  assert.deepEqual(Object.keys(body).sort(), ['companyId','guideId','lancamentosAfetados','linhaConfirmada','novoValor','pdfPreservado','revisao','valorAtual'].sort());
  assert.equal(body.valorAtual,100);
  assert.equal(body.novoValor,125.25);
  assert.equal(body.revisao, '451386241a90425a7c6947178823ece34d093c701d9159f7c3089b2868494ab1');
  assert.deepEqual(state.accessChecks, [{companyId:'A', userId:'u'}]);
  assert.deepEqual(state.writes,[]);
  await confirm(body.revisao,{userId:'ator-forjado'}).expect(200,{ok:true,guideId:'g',valor:125.25,lancamentosAfetados:1});
  assert.deepEqual(state.writes,['guia','linhas','provisão','auditoria']);
  for (const key of ['pdfBytes','hash','paymentStatus','valorOriginal','liberadaCliente']) assert.equal(key in state.data,false);
});
test('guia sem provisão também exige competência aberta',async () => {
  state.guide.accountingEntries=[];
  const {body} = await preview().expect(200);
  await confirm(body.revisao).expect(200,{ok:true,guideId:'g',valor:125.25,lancamentosAfetados:0});
  assert.deepEqual(state.writes,['guia','auditoria']);
});
test('autorização e isolamento por empresa',async () => {
  await request(app).get(url).expect(401);
  state.link.role='STAFF'; await preview().expect(403);
  state.link=null; await preview().expect(403);
  state.link={role:'ACCOUNTANT',status:'ACTIVE'};
  await preview(url.replace('/A/','/B/')).expect(403, {error:'forbidden'});
  state.linkedCompanies.push('B');
  await preview(url.replace('/A/','/B/')).expect(404);
  assert.deepEqual(state.writes,[]);
});
for (const [name,change,expected] of [
  ['pagamento',()=>{state.guide.paymentStatus='PAID'},'guia_com_pagamento'],
  ['fechamento',()=>{state.closed=true},'competencia_fechada'],
  ['provisão divergente',()=>{state.guide.accountingEntries[0].lines[0].valor=20},'provisao_divergente'],
  ['PDF inconclusivo',()=>{state.pdf=false},'pdf_nao_confirma_valor']
]) test(name,async () => {
  change(); const {body}=await preview().expect(409);
  assert.equal(body.error,expected); assert.deepEqual(state.writes,[]);
});
test('revisão obrigatória, revisão vencida e conflito serializável',async () => {
  let result=await confirm('').expect(400); assert.equal(result.body.error,'revisao_obrigatoria');
  result=await confirm('anterior').expect(409); assert.equal(result.body.error,'guia_alterada');
  const {body}=await preview().expect(200); state.conflict=true;
  result=await confirm(body.revisao).expect(409); assert.equal(result.body.error,'guia_alterada');
  assert.deepEqual(state.writes,[]);
});

test('administrador global dispensa vínculo e continua sujeito à empresa da guia', async () => {
  state.role = 'admin';
  state.link = null;
  await preview().expect(200);
  await preview(url.replace('/A/', '/B/')).expect(404, {error:'guia_nao_encontrada', message:'Guia não encontrada.'});
  assert.deepEqual(state.accessChecks, []);
});

test('autorização HTTP precede a validação de valor em GET e POST', async () => {
  for (const method of ['get', 'post']) {
    await request(app)[method](url).expect(401, {error:'unauthorized'});
    state.link = {role:'ACCOUNTANT',status:'INACTIVE'};
    await request(app)[method](url).set('x-fixture-user','u').expect(403, {error:'forbidden'});
    state.link = {role:'STAFF',status:'ACTIVE'};
    await request(app)[method](url).set('x-fixture-user','u').expect(403, {error:'insufficient_role'});
  }
  assert.deepEqual(state.writes, []);
});

test('vínculo FIRM_ADMIN ativo permite a confirmação e preserva o autor da sessão', async () => {
  state.link.role = 'FIRM_ADMIN';
  const {body} = await preview().expect(200);
  await confirm(body.revisao,{userId:'outro'}).expect(200);
  assert.equal(state.data.reviewedByUserId, 'u');
});

test('o formato e a precedência das recusas fazem parte do contrato HTTP', async () => {
  await confirm('',{valor:0}).expect(400,{
    error:'revisao_obrigatoria', message:'Confira a prévia antes de corrigir a guia.'
  });
  await confirm('revisao',{valor:0}).expect(400,{
    error:'valor_invalido', message:'Informe o valor positivo da guia, com até duas casas decimais.'
  });
  state.guide.tipo='SIMPLES';
  state.guide.paymentStatus='PAID';
  await preview().expect(409,{
    error:'correcao_exige_revisao', message:'Esta guia exige revisão da composição antes de alterar o valor.'
  });
  state.guide.tipo='OUTRA';
  state.guide.accountingEntries.push(structuredClone(state.guide.accountingEntries[0]));
  await preview().expect(409,{
    error:'guia_com_pagamento', message:'A guia tem registro de pagamento e exige revisão contábil.'
  });
  state.guide.paymentStatus='OPEN';
  await preview().expect(409,{
    error:'provisao_composta', message:'Há mais de um lançamento vinculado. Revise a composição antes de corrigir.'
  });
  state.guide.accountingEntries.pop();
  state.guide.accountingEntries[0].status='EXPORTADO';
  state.guide.accountingEntries[0].lines=[];
  await preview().expect(409,{
    error:'provisao_nao_editavel', message:'O lançamento vinculado exige revisão contábil antes da correção.'
  });
  assert.deepEqual(state.writes, []);
});

test('releitura transacional observa fechamento ocorrido após a prévia, mesmo sem provisão', async () => {
  state.guide.accountingEntries = [];
  const {body} = await preview().expect(200);
  state.closeAtTransactionStart = true;
  await confirm(body.revisao).expect(409, {
    error:'competencia_fechada', message:'A competência está fechada e não permite esta correção.'
  });
  assert.deepEqual(state.writes, []);
});

test('a atualização condicional pode perder a corrida sem alterar a provisão', async () => {
  const {body} = await preview().expect(200);
  state.count = 0;
  await confirm(body.revisao).expect(409, {
    error:'guia_alterada', message:'A guia mudou. Abra uma nova prévia.'
  });
  assert.deepEqual(state.writes, []);
});

test('falha inesperada durante a leitura do PDF tem resposta pública estável', async () => {
  state.pdfFailure = true;
  await preview().expect(500, {error:'erro_interno', message:'Não foi possível corrigir a guia.'});
  assert.deepEqual(state.writes, []);
});

// Job separado. A base é criada, migrada e descartada pelo job de CI.
if (process.env.ALTAN_TESTE_POSTGRES === '1') {
  test('PostgreSQL: rollback integral e apenas uma confirmação por revisão', async () => {
    const uri = new URL(process.env.DATABASE_URL);
    assert.ok(['postgres:', 'postgresql:'].includes(uri.protocol));
    assert.ok(['127.0.0.1','localhost'].includes(uri.hostname));
    assert.equal(uri.pathname,'/altan_piloto_governance_test');
    // Prisma accepts datasource overrides via query parameters; restrict the fixture to loopback.
    for (const key of uri.searchParams.keys()) {
      assert.ok(['schema','connection_limit','pool_timeout'].includes(key), 'Parâmetro de conexão não permitido: '+key);
    }
    const {PrismaClient} = requireRepo('@prisma/client');
    const db = new PrismaClient({datasources:{db:{url:uri.href}}});
    const service = cache.get('application/guides/CorrigirValorGuiaService.js').namespace;
    try {
      const company = await db.portalClient.create({data:{razao:'Fixture piloto',cnpj:crypto.randomInt(10000000,99999999)+'000100'}});
      const guide = await db.guide.create({data:{portalClientId:company.id,tipo:'OUTRA',status:'PROCESSED',competencia:'2026-08',valor:100,valorOriginal:100}});
      const entry = await db.accountingEntry.create({data:{portalClientId:company.id,sourceGuideId:guide.id,data:new Date('2026-08-01Z'),competencia:'2026-08',historico:'Fixture',tipo:'PROVISAO',status:'RASCUNHO',lines:{create:['D','C'].map(tipo=>({conta:'fixture',tipo,valor:100}))}}});
      const args={companyId:company.id,guideId:guide.id,valor:125.25,userId:'fixture'};
      const deps={db,carregarPdf:async()=>Buffer.from('fixture'),ler:async()=>({linhaDigitavel:'8'.repeat(48),linhaDigitavelMotivo:null,linhaDigitavelLidaEm:new Date()})};
      const {revisao}=await service.preverCorrecaoValorGuia(args,deps);
      const command={...args,revisao};
      const auditCount=()=>db.appSetting.count({where:{key:{startsWith:'guide_value_correction:'},value:{path:['guideId'],equals:guide.id}}});
      const failedDb={
        guide:db.guide,companyMonthlyCircular:db.companyMonthlyCircular,
        $transaction:(fn,opts)=>db.$transaction(tx=>fn({
          guide:tx.guide,companyMonthlyCircular:tx.companyMonthlyCircular,accountingEntryLine:tx.accountingEntryLine,
          accountingEntry:tx.accountingEntry,appSetting:{create:async()=>{throw new Error('falha de auditoria injetada')}}
        }),opts)
      };
      await assert.rejects(service.corrigirValorGuia(command,{...deps,db:failedDb}),/falha de auditoria injetada/);
      async function checkStored(value,audits) {
        const stored=await db.guide.findUniqueOrThrow({where:{id:guide.id}});
        const posting=await db.accountingEntry.findUniqueOrThrow({where:{id:entry.id},include:{lines:true}});
        assert.equal(Number(stored.valor),value); assert.equal(Number(stored.valorOriginal),100);
        assert.equal(stored.reviewedByUserId,audits ? 'fixture':null);
        assert.equal(posting.recalculatedToValor===null ? null:Number(posting.recalculatedToValor),audits ? value:null);
        assert.deepEqual(posting.lines.map(x=>Number(x.valor)),[value,value]);
        assert.equal(await auditCount(),audits);
      }
      await checkStored(100,0);
      const closedPeriod = await db.companyMonthlyCircular.create({data:{
        portalClientId:company.id, competencia:'2026-08', fechadoContabilEm:new Date()
      }});
      await assert.rejects(service.corrigirValorGuia(command,deps),{code:'competencia_fechada'});
      await checkStored(100,0);
      await db.companyMonthlyCircular.delete({where:{id:closedPeriod.id}});
      const results=await Promise.allSettled([service.corrigirValorGuia(command,deps),service.corrigirValorGuia(command,deps)]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      assert.equal(results.find(r=>r.status==='rejected')?.reason.code,'guia_alterada');
      await checkStored(125.25,1);
    } finally {await db.$disconnect();}
  });
}

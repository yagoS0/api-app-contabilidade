import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';

const periodo = '2026-08';
const enabled = process.env.ALTAN_TESTE_POSTGRES === '1';
let prisma, createAccountingEntriesRouter, preverCorrecaoValorGuia, corrigirValorGuia, estadoCorrecaoTx, CHECKLIST_FECHAMENTO;
test.before(async () => {
  if (!enabled) return;
  const uri = new URL(process.env.DATABASE_URL);
  assert.ok(['postgres:', 'postgresql:'].includes(uri.protocol));
  assert.ok(['localhost', '127.0.0.1'].includes(uri.hostname));
  assert.equal(uri.pathname, '/altan_piloto_governance_test');
  for (const key of uri.searchParams.keys()) assert.ok(['schema','connection_limit','pool_timeout'].includes(key));
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'fatal';
  ({ prisma } = await import('../src/infrastructure/db/prisma.js'));
  ({ createAccountingEntriesRouter } = await import('../src/routes/firm/accountingEntries.js'));
  ({ preverCorrecaoValorGuia, corrigirValorGuia } = await import('../src/application/guides/CorrigirValorGuiaService.js'));
  ({ estadoCorrecaoTx } = await import('../src/application/accounting/CorrecaoMesContabilService.js'));
  ({ CHECKLIST_FECHAMENTO } = await import('../src/application/accounting/fechamentoBlockers.js'));
});

function signal() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { resolve, promise };
}
function bounded(promise) {
  const timer = new AbortController();
  return Promise.race([promise, delay(8000, null, { signal: timer.signal }).then(() => {
    throw new Error('Transações não atingiram a barreira do teste');
  })]).finally(() => timer.abort());
}

test.after(() => prisma?.$disconnect());
for (const first of ['correcao', 'fechamento']) {
  for (const {provision, sendVersion} of [
    {provision:true,sendVersion:true}, {provision:false,sendVersion:true},
    {provision:true,sendVersion:false}, {provision:false,sendVersion:false}
  ]) {
    test(first + ' primeiro; provisão=' + provision + '; versão informada=' + sendVersion, {skip:!enabled}, async t => {
      const client = new PrismaClient();
      t.after(() => client.$disconnect());
      const company = await client.portalClient.create({data:{cnpj:randomUUID(),razao:'Teste local de fechamento'}});
      const companyId = company.id;
      const user = {id:randomUUID(), role:'admin'};
      await client.companyMonthlyCircular.create({data:{portalClientId:companyId,competencia:periodo,
        ...Object.fromEntries(Object.values(CHECKLIST_FECHAMENTO).map(item=>[item.campo,true]))}});
      const guide = await client.guide.create({data:{portalClientId:companyId,competencia:periodo,tipo:'OUTRA',
        status:'PROCESSED',valor:100,valorOriginal:100}});
      if (provision) {
        await client.accountingEntry.create({data:{portalClientId:companyId,competencia:periodo,sourceGuideId:guide.id,
          data:new Date('2026-08-01Z'),historico:'Teste',tipo:'PROVISAO',status:'RASCUNHO',
          lines:{create:['D','C'].map(tipo=>({conta:'teste',tipo,valor:100}))}}});
      }
      const app = express();
      app.use(express.json(), (req,res,next) => {req.auth={user}; next();});
      app.use('/empresas/:companyId', createAccountingEntriesRouter({log:{warn(){},error(){}}}));
      const args = {companyId,guideId:guide.id,valor:125.25,userId:user.id};
      const deps = {db:client,carregarPdf:async()=>Buffer.from('teste'),ler:async()=>({
        linhaDigitavel:'8'.repeat(48),linhaDigitavelLidaEm:new Date(),linhaDigitavelMotivo:null
      })};
      const {revisao} = await preverCorrecaoValorGuia(args,deps);
      const versao = (await estadoCorrecaoTx(client,companyId,periodo)).versao;
      const firstReady = signal(), secondEntered = signal();
      const pids = new Map();
      function observe(name,transaction) {
        return (operation,options) => transaction(async tx => {
          const [session] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid, current_setting('transaction_isolation') AS isolamento`;
          assert.equal(session.isolamento,'serializable');
          pids.set(name,session.pid);
          if (name !== first) secondEntered.resolve();
          const result = await operation(tx);
          if (name === first) {
            firstReady.resolve();
            await bounded(secondEntered.promise);
          }
          return result;
        },{...options,timeout:15000});
      }
      t.mock.method(prisma,'$transaction',observe('fechamento',prisma.$transaction.bind(prisma)));
      const correctionDb = {guide:client.guide,companyMonthlyCircular:client.companyMonthlyCircular,
        $transaction:observe('correcao',client.$transaction.bind(client))};
      const operations = {
        fechamento:async()=>{const res=await request(app).post('/empresas/'+companyId+'/fechamento-contabil/'+periodo+'/fechar').send(sendVersion ? {versao} : {});
          return {ok:res.status===200,code:res.body.error,status:res.status,versao:res.body.versao};},
        correcao:async()=>{try {await corrigirValorGuia({...args,revisao},{...deps,db:correctionDb}); return {ok:true};}
          catch(e){return {ok:false,code:e.code,status:e.status};}}
      };
      const other = first==='correcao' ? 'fechamento' : 'correcao';
      const pending = operations[first]();
      // A primeira operação completou a lógica real. A transação segue aberta até a outra obter seu snapshot.
      try {
        await bounded(Promise.race([firstReady.promise,pending.then(result=>{throw Error('Primeira operação terminou antes da barreira: '+JSON.stringify(result));})]));
      } catch (error) {secondEntered.resolve(); await pending; throw error;}
      const [secondResult,firstResult] = await Promise.all([operations[other](),pending]);
      const outcomes = {[first]:firstResult,[other]:secondResult};
      assert.equal(new Set(pids.values()).size,2);
      const close = outcomes.fechamento, correction = outcomes.correcao;
      assert.ok(close.ok || correction.ok, JSON.stringify(outcomes));
      if (!close.ok) {assert.equal(close.status,409); assert.ok(['VERSAO_ALTERADA','P2034'].includes(close.code),String(close.code));}
      if (!correction.ok) {assert.equal(correction.status,409); assert.ok(['guia_alterada','competencia_fechada'].includes(correction.code));}
      const value = correction.ok ? 125.25 : 100;
      const stored = await client.guide.findUniqueOrThrow({where:{id:guide.id}});
      const entries = await client.accountingEntry.findMany({where:{portalClientId:companyId,competencia:periodo},include:{lines:true}});
      assert.equal(Number(stored.valor),value); assert.equal(Number(stored.valorOriginal),100);
      assert.equal(stored.reviewedByUserId,correction.ok ? user.id : null);
      assert.equal(entries.length,provision ? 1 : 0);
      for (const entry of entries) {
        assert.deepEqual(entry.lines.map(line=>line.tipo).sort(),['C','D']);
        assert.deepEqual(entry.lines.map(line=>Number(line.valor)),[value,value]);
        assert.equal(entry.recalculatedAt!==null,correction.ok);
      }
      const audit = await client.appSetting.count({where:{key:{startsWith:'guide_value_correction:'},value:{path:['guideId'],equals:guide.id}}});
      assert.equal(audit,correction.ok ? 1 : 0);
      const final = await estadoCorrecaoTx(client,companyId,periodo);
      assert.equal(Boolean(final.atual.circular.fechadoContabilEm),close.ok);
      if (close.ok) assert.equal(close.versao,final.versao,'A versão fechada precisa corresponder aos lançamentos finais');
      t.diagnostic(JSON.stringify({first,provision,sendVersion,correcao:correction.code||'ok',fechamento:close.code||'ok',value,audit}));
    });
  }
}

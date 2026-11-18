import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { connect, fixture, uid, hashA, hashB, hashC, insert, calculation, command, commandData, reserve, reservationData, marker, responseData, associationData, chain, rejectsSql, opaque } from './helpers.mjs';
const original = new URL('../../../../docs/modules/fixtures/fs12-b33b1-ddl/original.sql', import.meta.url);
const corrected = new URL('../../../../docs/modules/fixtures/fs12-b33b1-ddl/candidato-corrigido.sql', import.meta.url);

test('B33b1 candidate SQL on complete existing PostgreSQL16 schema', async t => {
  const db=await connect();
  try {
    for (const version of ['original','corrected']) {
      await db.query('BEGIN');
      const schema='fs12_ddl_'+uid().replaceAll('-','');
      try {
        await db.query(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema},public`);
        assert.equal((await db.query('SELECT to_regclass($1) AS relation',[schema+'.fs12_comandos'])).rows[0].relation,null);
        // Existing B32 remains public. Rename only its extra unique index for concurrent
        // disposable harnesses; identical columns/semantics, rolled back with this scenario.
        const originalSql=(await readFile(original,'utf8')).replace('CREATE UNIQUE INDEX fs12_calculo_escopo_vinculo_key ',`CREATE UNIQUE INDEX ${schema}_b32_key `);
        await db.query(originalSql);
        if(version==='corrected') await db.query(await readFile(corrected,'utf8'));
        const run = (name,fn) => t.test(version+': '+name, async()=>{
          await db.query('SAVEPOINT scenario');
          try { await fn(); } finally { await db.query('ROLLBACK TO SAVEPOINT scenario'); await db.query('RELEASE SAVEPOINT scenario'); }
        });
        await run('all four relations, exact joins and ledger marker',async()=>{
          const f=await fixture(db); const q=await chain(db,f);
          await insert(db,'fs12_comando_calculos',associationData(f,q.c,q.response,q.calc));
          const rows=await db.query('SELECT c.id,r."reservaId",s.id AS response,k."vinculoId" FROM fs12_comandos c JOIN fs12_comando_reservas r ON r."comandoId"=c.id JOIN fs12_comando_respostas s ON s."comandoId"=c.id JOIN fs12_comando_calculos k ON k."respostaId"=s.id WHERE c.id=$1',[q.c.id]);
          assert.deepEqual(rows.rows,[{id:q.c.id,reservaId:q.r.id,response:q.response.id,vinculoId:q.calc.id}]);
        });
        await run('NULL origin permitted only for simulation; declaratory origin required',async()=>{
          const f=await fixture(db); await command(db,f);
          for(const intencao of ['TRANSMITIR','RETIFICAR']) await rejectsSql(db,()=>command(db,f,{intencao}),'23514');
          const calc=await calculation(db,f);
          await rejectsSql(db,()=>command(db,f,{vinculoOrigemId:calc.id}),'23514');
          for(const intencao of ['TRANSMITIR','RETIFICAR']) await command(db,f,{intencao,vinculoOrigemId:calc.id});
        });
        await run('composite FKs reject missing, other company, period and revision',async()=>{
          const f=await fixture(db),g=await fixture(db); const foreign=await calculation(db,g);
          await rejectsSql(db,()=>command(db,f,{intencao:'TRANSMITIR',vinculoOrigemId:foreign.id}),'23503');
          await rejectsSql(db,()=>command(db,f,{intencao:'TRANSMITIR',vinculoOrigemId:uid()}),'23503');
          for(const patch of [{companyId:g.companyId},{competencia:'2026-12'},{revisaoFs12:2},{serieHash:hashC},{contextoHash:hashB},{cnpj:g.cnpj}]) await rejectsSql(db,()=>command(db,f,patch),'23514');
          for(const key of ['portalClientId','companyId','competencia','revisaoFs12']) await rejectsSql(db,()=>command(db,f,{[key]:null}),['23502','23514']);
        });
        await run('input calculation cannot be swapped for same revision',async()=>{
          const f=await fixture(db); const q=await chain(db,f,{intencao:'TRANSMITIR'});const second=await calculation(db,f);
          await rejectsSql(db,()=>insert(db,'fs12_comando_calculos',associationData(f,q.c,q.response,second)),'23514');
          await insert(db,'fs12_comando_calculos',associationData(f,q.c,q.response,q.calc));
        });
        await run('idempotency key and attempt identity are unique',async()=>{
          const f=await fixture(db);const c=await command(db,f);
          await rejectsSql(db,()=>command(db,f,{chaveIdempotencia:c.chaveIdempotencia,comandoHash:hashB}),'23505');
          await rejectsSql(db,()=>command(db,f,{tentativaId:c.tentativaId}),'23505');
          await rejectsSql(db,()=>command(db,f,{id:c.id}),'23505');
        });
        await run('reservations validate status, scope, action and signature',async()=>{
          const f=await fixture(db),c=await command(db,f);
          for(const patch of [{status:'incerta'},{portalClientId:uid()},{cnpj:'99999999999999'},{competencia:'2026-12'},{acaoId:uid()},{rota:'/Emitir'},{idSistema:'OTHER'},{idServico:'GERARDAS12'}]) {
            const r=await reserve(db,c,patch); await rejectsSql(db,()=>insert(db,'fs12_comando_reservas',reservationData(c,r)),'23514');
          }
          const r=await reserve(db,c); await rejectsSql(db,()=>insert(db,'fs12_comando_reservas',reservationData(c,r,{assinatura:hashB})),'23514');
          await insert(db,'fs12_comando_reservas',reservationData(c,r));
          await rejectsSql(db,()=>insert(db,'fs12_comando_reservas',reservationData(c,r)),'23505');
        });
        await run('response requires the exact command reservation and marker key',async()=>{
          const f=await fixture(db), q=await chain(db,f), g=await fixture(db),other=await chain(db,g);
          await rejectsSql(db,()=>insert(db,'fs12_comando_respostas',responseData(q.c,other.r,other.m,{corpoHash:hashA})),['23503','23514']);
          await rejectsSql(db,()=>insert(db,'fs12_comando_respostas',responseData(q.c,q.r,q.m,{marcadorKey:other.m.key,corpoHash:hashA})),['23503','23514']);
        });
        await run('identical response replay is unique; divergent observation preserved',async()=>{
          const f=await fixture(db),q=await chain(db,f);
          await rejectsSql(db,()=>insert(db,'fs12_comando_respostas',responseData(q.c,q.r,q.m)),'23505');
          await insert(db,'fs12_comando_respostas',responseData(q.c,q.r,q.m,{corpoHash:hashA}));
          await insert(db,'fs12_comando_respostas',responseData(q.c,q.r,q.m,{httpStatus:500}));
          assert.equal((await db.query('SELECT count(*)::int AS n FROM fs12_comando_respostas WHERE "comandoId"=$1',[q.c.id])).rows[0].n,3);
        });
        await run('simulation calculation has only one origin; response cannot be cross-associated',async()=>{
          const f=await fixture(db),q=await chain(db,f),r=await chain(db,f);
          await rejectsSql(db,()=>insert(db,'fs12_comando_calculos',associationData(f,q.c,r.response,q.calc)),['23503','23514']);
          await insert(db,'fs12_comando_calculos',associationData(f,q.c,q.response,q.calc));
          await rejectsSql(db,()=>insert(db,'fs12_comando_calculos',associationData(f,r.c,r.response,q.calc)),'23505');
        });
        await run('all four tables refuse UPDATE and DELETE; parent FK is restrictive',async()=>{
          const f=await fixture(db),q=await chain(db,f);await insert(db,'fs12_comando_calculos',associationData(f,q.c,q.response,q.calc));
          for(const [table,key,id] of [['fs12_comandos','id',q.c.id],['fs12_comando_reservas','comandoId',q.c.id],['fs12_comando_respostas','id',q.response.id],['fs12_comando_calculos','comandoId',q.c.id]]) {
            await rejectsSql(db,()=>db.query(`UPDATE ${table} SET "${key}"="${key}" WHERE "${key}"=$1`,[id]),'23514');
            await rejectsSql(db,()=>db.query(`DELETE FROM ${table} WHERE "${key}"=$1`,[id]),'23514');
          }
          await rejectsSql(db,()=>db.query('DELETE FROM serpro_chamadas WHERE id=$1',[q.r.id]),'23503');
          await rejectsSql(db,()=>db.query('DELETE FROM "AppSetting" WHERE key=$1',[q.m.key]),'23503');
        });
        await run('promotion rollback preserves response from earlier transaction scope',async()=>{
          const f=await fixture(db),q=await chain(db,f);
          await db.query('SAVEPOINT before_promotion');
          await insert(db,'fs12_comando_calculos',associationData(f,q.c,q.response,q.calc));
          await db.query('ROLLBACK TO SAVEPOINT before_promotion'); await db.query('RELEASE SAVEPOINT before_promotion');
          assert.equal((await db.query('SELECT count(*)::int AS n FROM fs12_comando_calculos WHERE "comandoId"=$1',[q.c.id])).rows[0].n,0);
          assert.equal((await db.query('SELECT count(*)::int AS n FROM fs12_comando_respostas WHERE id=$1',[q.response.id])).rows[0].n,1);
        });
        await run('marker snapshot mismatch: original gap and proposed constraint',async()=>{
          const f=await fixture(db),q=await chain(db,f); const op=()=>insert(db,'fs12_comando_respostas',responseData(q.c,q.r,q.m,{corpoHash:hashA,marcadorObservado:{}}));
          if(version==='original') await op(); else await rejectsSql(db,op,'23514');
        });
        await run('ledger identity mutation: original gap and proposed response check',async()=>{
          const f=await fixture(db),q=await chain(db,f); await db.query('UPDATE serpro_chamadas SET assinatura=$1 WHERE id=$2',[hashB,q.r.id]);
          const op=()=>insert(db,'fs12_comando_respostas',responseData(q.c,q.r,q.m,{corpoHash:hashA}));
          if(version==='original') await op(); else await rejectsSql(db,op,'23514');
        });
        await run('mutable marker cannot transfer custody to another PortalClient',async()=>{
          const f=await fixture(db),q=await chain(db,f);
          const forged={...q.m.value,companyId:uid()};
          await db.query('UPDATE "AppSetting" SET value=$1 WHERE key=$2',[forged,q.m.key]);
          const op=()=>insert(db,'fs12_comando_respostas',responseData(q.c,q.r,{...q.m,value:forged},{corpoHash:hashA}));
          if(version==='original') await op(); else await rejectsSql(db,op,'23514');
        });
        await run('auth-aborted reservation cannot assert a received response',async()=>{
          const f=await fixture(db),q=await chain(db,f);
          await db.query('UPDATE serpro_chamadas SET status=$1 WHERE id=$2',['abortada_auth',q.r.id]);
          const op=()=>insert(db,'fs12_comando_respostas',responseData(q.c,q.r,q.m,{corpoHash:hashA}));
          if(version==='original') await op(); else await rejectsSql(db,op,'23514');
        });
        await run('late response after human revocation stays custodial, not authorization',async()=>{
          const f=await fixture(db),q=await chain(db,f);
          await db.query('UPDATE "User" SET status=$1 WHERE id=$2',['inactive',f.autorId]);
          await db.query('UPDATE serpro_chamadas SET status=$1 WHERE id=$2',['incerta',q.r.id]);
          await insert(db,'fs12_comando_respostas',responseData(q.c,q.r,q.m,{corpoHash:hashA}));
          assert.equal((await db.query('SELECT count(*)::int AS n FROM fs12_comando_calculos WHERE "comandoId"=$1',[q.c.id])).rows[0].n,0);
        });
        await run('ciphertext empty object: original gap and proposed bound',async()=>{
          const f=await fixture(db),q=await chain(db,f);const op=()=>insert(db,'fs12_comando_respostas',responseData(q.c,q.r,q.m,{corpoHash:hashA,corpoCifrado:{}}));
          if(version==='original') await op();else await rejectsSql(db,op,'23514');
        });
        await run('ciphertext fields, algorithm, nonce/tag length and canonical base64',async()=>{
          const f=await fixture(db),q=await chain(db,f);
          for(const patch of [{v:2},{alg:'AES-128-GCM'},{keyId:''},{nonce:'!invalid!'},{tag:'AA=='},{ciphertext:'YQ==\n'},{aadVersion:'1'},{extra:'not-allowed'}]) {
            const op=()=>insert(db,'fs12_comando_respostas',responseData(q.c,q.r,q.m,{corpoHash:hashA,corpoCifrado:{...opaque(),...patch}}));
            if(version==='original') {
              await db.query('SAVEPOINT opaque_shape'); await op(); await db.query('ROLLBACK TO SAVEPOINT opaque_shape');await db.query('RELEASE SAVEPOINT opaque_shape');
            } else await rejectsSql(db,op,'23514');
          }
        });
        await run('16 MiB is inclusive, one byte more is refused by corrected DDL',async()=>{
          const f=await fixture(db),q=await chain(db,f);
          const large={...opaque(),ciphertext:Buffer.alloc(16777216,1).toString('base64')};
          await insert(db,'fs12_comando_respostas',responseData(q.c,q.r,q.m,{corpoHash:hashA,corpoCifrado:large}));
          const op=()=>insert(db,'fs12_comando_respostas',responseData(q.c,q.r,q.m,{corpoHash:hashB,corpoCifrado:{...large,ciphertext:Buffer.alloc(16777217,1).toString('base64')}}));
          if(version==='original') await op();else await rejectsSql(db,op,'23514');
        });
        await run('least privilege role has metadata access but no body or TRUNCATE',async()=>{
          const role='fs12_ddl_'+uid().replaceAll('-',''); const f=await fixture(db),q=await chain(db,f);
          await db.query(`CREATE ROLE ${role} NOLOGIN`);
          await db.query(`GRANT USAGE ON SCHEMA public,${schema} TO ${role}; GRANT SELECT(id,"comandoId","httpStatus") ON fs12_comando_respostas TO ${role}`);
          await db.query(`SET LOCAL ROLE ${role}`);
          const visible=await db.query('SELECT id FROM fs12_comando_respostas WHERE id=$1',[q.response.id]);assert.equal(visible.rowCount,1);
          await rejectsSql(db,()=>db.query('SELECT "corpoCifrado" FROM fs12_comando_respostas'),'42501');
          await rejectsSql(db,()=>db.query('TRUNCATE fs12_comando_respostas CASCADE'),'42501');
          await db.query('RESET ROLE');
        });
        await run('constraints and indexes remain validated',async()=>{
          const invalid=await db.query("SELECT conname FROM pg_constraint WHERE conrelid IN ('fs12_comandos'::regclass,'fs12_comando_reservas'::regclass,'fs12_comando_respostas'::regclass,'fs12_comando_calculos'::regclass) AND NOT convalidated");assert.equal(invalid.rowCount,0);
          const index=await db.query("SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND indexname='fs12_calculo_unica_origem_simulacao'",[schema]);assert.match(index.rows[0].indexdef,/WHERE.*SIMULAR/);
        });
      } finally { await db.query('ROLLBACK'); }
    }
  } finally { await db.end(); }
});

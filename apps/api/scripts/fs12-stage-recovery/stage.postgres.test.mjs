import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { clients, seed } from '../fs12-custody-prisma/fixture.mjs';

function child(t,input) {
 const proc=fork(new URL('./worker.mjs',import.meta.url),[],{execArgv:[],windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
 const messages=[];let exited=false,stderr='';
 proc.on('message',m=>messages.push(m));proc.stderr.on('data',b=>{stderr+=b;});
 const done=new Promise((resolve,reject)=>{proc.once('error',reject);proc.once('exit',(code,signal)=>{exited=true;resolve({code,signal,messages,stderr});});});
 t.after(async()=>{if(!exited)proc.kill();await done;});
 proc.send(input);return done;
}
// Component integration only: actual FS, PG16 and process exit/recovery. It does
// not start the API/browser or demonstrate physical power-loss durability.
test('stage survives real PG rollback and terminated producer; second process imports exactly once',{timeout:60000},async t=>{
 const c=await clients();t.after(()=>c.close());const f=await seed(c.sql,c.db);t.after(()=>f.key.fill(0));
 const root=await mkdtemp(path.join(tmpdir(),'altan-fs12-stage-pg-'));
 // Preserve encrypted stage directory and immutable DB evidence; no destructive cleanup.
 t.diagnostic('Synthetic encrypted evidence directory: '+root);
 const input={root,id:f.hints.stageId,keyBase64:f.key.toString('base64'),corpoBase64:f.input.corpo.toString('base64'),contexto:f.input.contexto};
 const failed=await child(t,{...input,mode:'stage-and-fail'});
 assert.equal(failed.code,24,JSON.stringify(failed));
 const preserved=failed.messages.find(m=>m.type==='preserved-after-rollback');assert.ok(preserved);assert.equal(preserved.httpCalls,0);assert.equal(preserved.sqlState,'22012');
 assert.equal(await c.db.fs12ComandoResposta.count({where:{comandoId:f.c.id}}),0);
 const record=path.join(root,f.hints.stageId,'record.json');const before=await readFile(record);
 assert.ok(before.length>0);assert.equal(JSON.parse(before.toString()).contexto.respostaId,f.input.contexto.respostaId);
 const recovered=await child(t,{...input,mode:'recover'});
 assert.equal(recovered.code,0,JSON.stringify(recovered));
 const success=recovered.messages.find(m=>m.type==='recovered');assert.ok(success);assert.equal(success.httpCalls,0);assert.notEqual(success.pid,preserved.pid);
 assert.equal(await c.db.fs12ComandoResposta.count({where:{comandoId:f.c.id}}),1);
 assert.equal(await c.db.fs12ComandoCalculo.count({where:{comandoId:f.c.id}}),0);
 assert.equal(await c.db.apuracaoSnapshot.count({where:{portalClientId:f.f.portalClientId}}),0);
 assert.deepEqual(await readdir(path.dirname(record)),[]);
 const stored=await c.db.fs12ComandoResposta.findUnique({where:{id:f.input.contexto.respostaId}});
 assert.equal(stored.corpoHash,f.input.contexto.corpoHash);assert.equal(stored.id,success.receipt.custodiaId);
});

import { origem } from './fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fork } from 'node:child_process';
const worker = new URL('./process.worker.mjs', import.meta.url);
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(),'altan-fs12-process-'));
  const root = path.join(base,'stage'), sink = path.join(base,'sink');
  await fs.mkdir(root); await fs.mkdir(sink);
  const originFile=path.join(base,'origin.json'); await fs.writeFile(originFile,JSON.stringify(origem()));
  t.after(()=>fs.rm(base,{ recursive:true,force:true }));
  return { root,sink,originFile,keyBase64:randomBytes(32).toString('base64') };
}
function child(t, options) {
  const proc = fork(worker, [], { stdio:['ignore','pipe','pipe','ipc'], execArgv:[] });
  const messages = [], waiters = [];
  let stderr = '';
  proc.stderr.on('data',chunk=>{ stderr += String(chunk); });
  proc.stdout.resume();
  const done = new Promise((resolve,reject)=>{
    proc.once('error',reject);
    proc.once('exit',(code,signal)=>{
      for (const waiter of waiters.splice(0)) waiter.reject(new Error('Child exited before '+waiter.type));
      resolve({ code,signal,stderr,messages });
    });
  });
  proc.on('message',value=>{
    messages.push(value);
    for (let i=waiters.length-1;i>=0;i--) {
      if (waiters[i].type===value.type) { waiters.splice(i,1)[0].resolve(value); }
    }
  });
  t.after(()=>{ if (proc.exitCode===null) proc.kill(); });
  proc.send({ type:'start', ...options });
  return { proc, done, wait:type=>{
    const present=messages.find(m=>m.type===type);
    return present ? Promise.resolve(present) : new Promise((resolve,reject)=>waiters.push({type,resolve,reject}));
  } };
}
function succeeded(result) {
  assert.equal(result.code,0,JSON.stringify(result));
  assert.equal(result.messages.find(x=>x.type==='result')?.httpCalls,0);
}
test('reinicio REAL: stage em processo encerrado, recuperacao em novo processo sem HTTP', { timeout:30000 }, async t=>{
  const f=await fixture(t), first=child(t,{ ...f,role:'write' });
  const written=await first.done; succeeded(written);
  const id=written.messages.find(x=>x.type==='result').id;
  const recovery=child(t,{ ...f,role:'recover',id });
  assert.notEqual(first.proc.pid,recovery.proc.pid);
  succeeded(await recovery.done);
  assert.equal((await fs.readdir(f.sink)).filter(n=>n.endsWith('.json')).length,1);
  await assert.rejects(fs.stat(path.join(f.root,id,'record.json')),{code:'ENOENT'});
});
test('commit sintetico antes de queda: replay recupera e remove sem segunda custodia sintetica', { timeout:30000 }, async t=>{
  const f=await fixture(t), w=await child(t,{...f,role:'write'}).done; succeeded(w);
  const id=w.messages.find(x=>x.type==='result').id;
  const crashed=await child(t,{...f,role:'commitExit',id}).done;
  assert.equal(crashed.code,23,JSON.stringify(crashed));
  assert.equal(crashed.messages.find(x=>x.type==='committedBeforeExit').httpCalls,0);
  await fs.stat(path.join(f.root,id,'record.json'));
  const before=await fs.readFile(path.join(f.sink,id+'.json'));
  succeeded(await child(t,{...f,role:'recover',id}).done);
  assert.deepEqual(await fs.readFile(path.join(f.sink,id+'.json')),before);
});
test('dois recuperadores REAIS: ambos leem antes da barreira; sink sintetico atomico idempotente, zero HTTP', { timeout:30000 }, async t=>{
  const f=await fixture(t), w=await child(t,{...f,role:'write'}).done; succeeded(w);
  const id=w.messages.find(x=>x.type==='result').id;
  const a=child(t,{...f,role:'recover',id,pause:true}), b=child(t,{...f,role:'recover',id,pause:true});
  const ready=await Promise.all([a.wait('ready'),b.wait('ready')]);
  assert.notEqual(ready[0].pid,ready[1].pid);
  a.proc.send({type:'go'}); b.proc.send({type:'go'});
  for (const result of await Promise.all([a.done,b.done])) succeeded(result);
  assert.equal((await fs.readdir(f.sink)).filter(n=>n.endsWith('.json')).length,1);
  assert.deepEqual(await fs.readdir(path.join(f.root,id)),[]);
});
test('queda REAL depois de fsync antesrename: dois processos recuperam tmp autenticado sem resposta previa no sink', { timeout:30000 }, async t=>{
  const f=await fixture(t);
  const interrupted=await child(t,{...f,role:'writeTemp'}).done;
  assert.equal(interrupted.code,24,JSON.stringify(interrupted));
  assert.equal(interrupted.messages.find(x=>x.type==='tempFlushed').httpCalls,0);
  const [id]=await fs.readdir(f.root);
  assert.deepEqual(await fs.readdir(f.sink),[]);
  const persisted=JSON.parse(await fs.readFile(f.originFile,'utf8'));
  for (const field of ['corpoHash','httpStatus','recebidoEm']) assert.equal(Object.hasOwn(persisted,field),false);
  assert.deepEqual(await fs.readdir(path.join(f.root,id)),['record.tmp']);
  const a=child(t,{...f,role:'recover',id,pause:true}),b=child(t,{...f,role:'recover',id,pause:true});
  await Promise.all([a.wait('ready'),b.wait('ready')]);
  a.proc.send({type:'go'});b.proc.send({type:'go'});
  for (const result of await Promise.all([a.done,b.done])) succeeded(result);
  assert.equal((await fs.readdir(f.sink)).filter(n=>n.endsWith('.json')).length,1);
  assert.deepEqual(await fs.readdir(path.join(f.root,id)),[]);
});

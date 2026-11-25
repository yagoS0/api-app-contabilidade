import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { criarCifraFs12, hashBytes, LIMITE_CORPO_FS12 } from '../../src/modules/fiscal/infrastructure/custody/cifraRespostaFs12.js';
import { criarStageRespostaFs12 } from '../../src/modules/fiscal/infrastructure/custody/stageRespostaFs12.js';
import { corpo, contexto, origem, resolverOrigemPersistida, receipt, syncProcessOnly } from './fixture.mjs';

function cipher(keys = { old: randomBytes(32), new: randomBytes(32) }) {
  return criarCifraFs12({ resolveKey: async id => keys[id] });
}
async function stage(t, options = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'altan-fs12-unit-'));
  const root=path.join(base,'stage'); await fs.mkdir(root);
  const originFile=path.join(base,'origin.json'); await fs.writeFile(originFile,JSON.stringify(origem()));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  return { root, resolveOrigin:resolverOrigemPersistida(originFile), adapter: criarStageRespostaFs12({ root, cifra: cipher(), syncDirectory: syncProcessOnly, ...options }) };
}
test('envelope DDL exato; bytes binarios e chave historica apos rotacao', async () => {
  const keys = { old: randomBytes(32), new: randomBytes(32) };
  const original = await cipher(keys).cifrar({ corpo, contexto: contexto(), keyId: 'old' });
  assert.deepEqual(Object.keys(original).sort(), ['aadVersion','alg','ciphertext','keyId','nonce','tag','v']);
  assert.equal(original.alg, 'AES-256-GCM');
  assert.equal(Buffer.from(original.nonce, 'base64').length, 12);
  assert.equal(Buffer.from(original.tag, 'base64').length, 16);
  assert.deepEqual(await cipher(keys).decifrar({ envelope: original, contexto: contexto() }), corpo);
  await assert.rejects(cipher({ new: keys.new }).decifrar({ envelope: original, contexto: contexto() }), { code: 'FS12_CHAVE_INDISPONIVEL' });
});
test('AAD autentica keyId inclusive alias com mesma chave, identidade, status e revisao', async () => {
  const key = randomBytes(32), c = cipher({ old: key, alias: key });
  const envelope = await c.cifrar({ corpo, contexto: contexto(), keyId: 'old' });
  await assert.rejects(c.decifrar({ envelope: { ...envelope, keyId: 'alias' }, contexto: contexto() }), { code: 'FS12_AUTENTICACAO_INVALIDA' });
  for (const patch of [{ companyId:'outra' }, { portalClientId:'outro' }, { competencia:'2026-12' },
    { revisaoFs12:2 }, { reservaId:'outra' }, { tentativaId:'outra' }, { intencao:'RETIFICAR' },
    { httpStatus:200 }, { corpoHash:'c'.repeat(64) }, { marcadorHash:'c'.repeat(64) }]) {
    await assert.rejects(c.decifrar({ envelope, contexto: { ...contexto(), ...patch } }), { code: 'FS12_AUTENTICACAO_INVALIDA' });
  }
  for (const field of ['nonce','tag','ciphertext']) {
    const bytes = Buffer.from(envelope[field], 'base64'); bytes[0] ^= 1;
    await assert.rejects(c.decifrar({ envelope: { ...envelope, [field]:bytes.toString('base64') }, contexto: contexto() }));
  }
  await assert.rejects(c.decifrar({ envelope: { ...envelope, extra:'secret' }, contexto: contexto() }), { code:'FS12_CIFRA_INVALIDA' });
  await assert.rejects(c.decifrar({ envelope:'plaintext', contexto: contexto() }), { code:'FS12_CIFRA_INVALIDA' });
});
test('limite inclusivo 16MiB; sem truncamento nem base64 tolerante', async () => {
  const c = cipher(), body = Buffer.alloc(LIMITE_CORPO_FS12, 7), ctx = { ...contexto(), corpoHash:hashBytes(body) };
  const envelope = await c.cifrar({ corpo:body, contexto:ctx, keyId:'old' });
  assert.deepEqual(await c.decifrar({ envelope, contexto:ctx }), body);
  await assert.rejects(c.cifrar({ corpo:Buffer.alloc(LIMITE_CORPO_FS12+1), contexto:ctx, keyId:'old' }), { code:'FS12_CORPO_INVALIDO' });
  await assert.rejects(c.decifrar({ envelope:{ ...envelope, nonce:envelope.nonce+' ' }, contexto:ctx }), { code:'FS12_CIFRA_INVALIDA' });
});
test('stage replay, rollback simulado, receipt incompleto e consumo confirmado', async t => {
  const { root, adapter, resolveOrigin } = await stage(t);
  const input = { corpo, contexto:contexto(), keyId:'old' };
  const first = await adapter.guardar(input);
  assert.equal(first.directorySynced, false);
  assert.equal((await adapter.guardar(input)).replay, true);
  const recover = callback => adapter.recuperar({ id:first.id, resolveOrigin, importDurably:callback });
  await assert.rejects(recover(async()=>{ throw new Error('rollback sintetico'); }));
  await assert.rejects(recover(async()=>({ durable:true })), { code:'FS12_IMPORTACAO_NAO_CONFIRMADA' });
  assert.equal((await adapter.inspecionar())[0].situacao, 'A_VALIDAR');
  let observed;
  await recover(async input => { observed = Buffer.from(input.corpo); return receipt(input); });
  assert.deepEqual(observed, corpo);
  await assert.rejects(fs.stat(path.join(root, first.id, 'record.json')), { code:'ENOENT' });
  assert.equal((await adapter.inspecionar())[0].situacao, 'SEM_REGISTRO_PENDENTE');
  await assert.rejects(adapter.guardar(input), { code:'FS12_STAGE_PENDENTE' });
});
test('conflito nao sobrescreve, contexto confiavel divergente nao importa', async t => {
  const { adapter, resolveOrigin } = await stage(t);
  const { id } = await adapter.guardar({ corpo, contexto:contexto(), keyId:'old' });
  const changed = Buffer.from('diferente');
  await assert.rejects(adapter.guardar({ corpo:changed, contexto:{ ...contexto(), corpoHash:hashBytes(changed) }, keyId:'old' }));
  let imports = 0;
  await assert.rejects(adapter.recuperar({ id, resolveOrigin:async hints=>({ ...await resolveOrigin(hints), companyId:'outra' }), importDurably:async()=>{ imports++; } }));
  assert.equal(imports, 0);
});
test('corrompido, temporario, traversal e disco cheio ficam explicitos', async t => {
  const { root, adapter, resolveOrigin } = await stage(t);
  await assert.rejects(adapter.recuperar({ id:'../escape', resolveOrigin, importDurably:receipt }), { code:'FS12_STAGE_ID_INVALIDO' });
  const { id } = await adapter.guardar({ corpo, contexto:contexto(), keyId:'old' });
  await fs.writeFile(path.join(root,id,'record.json'), '{"truncado":');
  await assert.rejects(adapter.recuperar({ id, resolveOrigin, importDurably:receipt }), { code:'FS12_STAGE_CORROMPIDO' });
  const fault = await stage(t, { io:{ ...fs, open:async()=>{ throw Object.assign(new Error('synthetic'), { code:'ENOSPC' }); } } });
  await assert.rejects(fault.adapter.guardar({ corpo, contexto:contexto(), keyId:'old' }), { code:'FS12_STAGE_ESCRITA_FALHOU' });
  assert.equal((await fault.adapter.inspecionar())[0].situacao, 'SEM_REGISTRO_PENDENTE');
  const tempId = 'd'.repeat(64);
  await fs.mkdir(path.join(root,tempId)); await fs.writeFile(path.join(root,tempId,'record.tmp'), 'incompleto');
  assert.ok((await adapter.inspecionar()).some(x=>x.id===tempId && x.situacao==='TEMPORARIO_PENDENTE'));
});
test('commit confirmado mas unlink falha: replay exige receipt duravel novamente', async t => {
  let fail = true;
  const { adapter, resolveOrigin } = await stage(t,{ io:{ ...fs, unlink:async p=>{
    if (fail) throw Object.assign(new Error('synthetic removal failure'),{code:'EACCES'});
    return fs.unlink(p);
  } } });
  const { id } = await adapter.guardar({ corpo,contexto:contexto(),keyId:'old' });
  const committed = new Map(); let calls = 0;
  const importDurably = async input => {
    calls++;
    const fingerprint = input.contextHash;
    if (committed.has(input.id)) assert.equal(committed.get(input.id),fingerprint);
    else committed.set(input.id,fingerprint);
    return receipt(input);
  };
  const args={ id,resolveOrigin,importDurably };
  await assert.rejects(adapter.recuperar(args),{code:'EACCES'});
  assert.equal((await adapter.inspecionar())[0].situacao,'A_VALIDAR');
  fail=false;
  await adapter.recuperar(args);
  assert.equal(calls,2);
  assert.equal(committed.size,1); // Unit double only; process/PG guarantees are separate.
});
test('falha apos escrita parcial conserva temporario e nao importa', async t=>{
  const io={ ...fs, open:async(p,...args)=>{
    const h=await fs.open(p,...args);
    if (!p.endsWith('record.tmp') || args[0] !== 'wx') return h;
    return { close:()=>h.close(), sync:()=>h.sync(), writeFile:async bytes=>{
      await h.writeFile(bytes.subarray(0,20));
      throw Object.assign(new Error('synthetic disk full'),{code:'ENOSPC'});
    } };
  } };
  const {adapter,resolveOrigin}=await stage(t,{io});
  await assert.rejects(adapter.guardar({corpo,contexto:contexto(),keyId:'old'}),{code:'FS12_STAGE_ESCRITA_FALHOU'});
  const [entry]=await adapter.inspecionar();
  assert.equal(entry.situacao,'TEMPORARIO_PENDENTE');
  let called=false;
  await assert.rejects(adapter.recuperar({id:entry.id,resolveOrigin,importDurably:async()=>{called=true;}}),{code:'FS12_STAGE_CORROMPIDO'});
  assert.equal(called,false);
});
test('resposta observada nao precisa existir na origem predisparo', async t=>{
  const {adapter,resolveOrigin}=await stage(t);
  const observed=Buffer.from('resposta nova nao prealocada');
  const ctx={...contexto(),corpoHash:hashBytes(observed),httpStatus:503,recebidoEm:'2026-11-25T13:14:15.123Z'};
  const {id}=await adapter.guardar({corpo:observed,contexto:ctx,keyId:'old'});
  await adapter.recuperar({id,resolveOrigin,importDurably:async input=>{
    assert.deepEqual(input.corpo,observed);
    assert.equal(input.contexto.httpStatus,503);
    assert.equal(input.contexto.recebidoEm,ctx.recebidoEm);
    return receipt(input);
  }});
});
test('replay apos rename com fsync falho resincroniza pai e filho; false do pai nao vira true', async t=>{
  let rootDir,fail=true;
  const calls=[];
  const syncDirectory=async dir=>{
    calls.push(dir);
    if (dir!==rootDir && fail) throw new Error('synthetic directory fsync failure');
    return dir!==rootDir;
  };
  const {root,adapter}=await stage(t,{syncDirectory});rootDir=root;
  const args={corpo,contexto:contexto(),keyId:'old'};
  await assert.rejects(adapter.guardar(args),{code:'FS12_STAGE_ESCRITA_FALHOU'});
  fail=false;calls.length=0;
  const replay=await adapter.guardar(args);
  assert.equal(replay.replay,true);
  assert.equal(replay.directorySynced,false);
  assert.deepEqual(calls,[root,path.join(root,replay.id)]);
});
test('ciphertext vazio e keyId de 200 caracteres permanecem compatíveis com DDL integrado',async()=>{
  const key=randomBytes(32),keyId='k'.repeat(200);
  const c=cipher({[keyId]:key}),bytes=Buffer.alloc(0),ctx={...contexto(),corpoHash:hashBytes(bytes)};
  const envelope=await c.cifrar({corpo:bytes,contexto:ctx,keyId});
  assert.equal(envelope.ciphertext,'');
  assert.deepEqual(await c.decifrar({envelope,contexto:ctx}),bytes);
  await assert.rejects(c.cifrar({corpo:bytes,contexto:ctx,keyId:'k'.repeat(201)}));
});

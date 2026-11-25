import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepararChavesCustodiaFs12, criarSincronizacaoDiretorioFs12, conferirDiretorioCustodiaFs12 } from '../../src/modules/fiscal/infrastructure/custody/configuracaoCustodiaFs12.js';

const entry = (id, byte) => ({ id, keyBase64: Buffer.alloc(32, byte).toString('base64') });
test('active rotation retains exact historical key and refuses unknown id', () => {
  const ring = prepararChavesCustodiaFs12({ keyIdAtivo:'new', keyringJson:JSON.stringify([entry('old',1),entry('new',2)]) });
  assert.deepEqual(ring.resolveKey('old'),Buffer.alloc(32,1));
  assert.deepEqual(ring.resolveKey('new'),Buffer.alloc(32,2));
  assert.throws(()=>ring.resolveKey('missing'),{code:'FS12_CHAVE_HISTORICA_INDISPONIVEL'});
  const borrowed = ring.resolveKey('old');
  ring.destruir();
  assert.deepEqual(borrowed,Buffer.alloc(32));
  assert.throws(()=>ring.resolveKey('old'),{code:'FS12_CHAVE_HISTORICA_INDISPONIVEL'});
});
test('invalid ring cannot silently select a key or replace duplicate id', () => {
  for (const entries of [[],[entry('x',1),entry('x',2)],[{...entry('x',1),keyBase64:'short'}],[{...entry('x',1),extra:true}],[entry(' x',1)]]) {
    assert.throws(()=>prepararChavesCustodiaFs12({keyIdAtivo:'x',keyringJson:JSON.stringify(entries)}),{code:'FS12_CHAVEIRO_INVALIDO'});
  }
  assert.throws(()=>prepararChavesCustodiaFs12({keyIdAtivo:'absent',keyringJson:JSON.stringify([entry('x',1)])}),{code:'FS12_CHAVE_ATIVA_AUSENTE'});
});
test('DDL-compatible 200-character id retained without normalization', () => {
  const id='a'.repeat(200);
  const ring=prepararChavesCustodiaFs12({keyIdAtivo:id,keyringJson:JSON.stringify([entry(id,1)])});
  assert.equal(ring.keyIdAtivo,id);ring.destruir();
});
test('process-only mode is unavailable outside explicitly test environment', () => {
  for (const ambiente of ['production','development','',undefined]) {
    assert.throws(()=>criarSincronizacaoDiretorioFs12({modo:'PROCESS_RESTART_ONLY',ambiente}),{code:'FS12_DURABILIDADE_CONFIG_INVALIDA'});
  }
  assert.throws(()=>criarSincronizacaoDiretorioFs12({modo:'bogus',ambiente:'test'}),{code:'FS12_DURABILIDADE_CONFIG_INVALIDA'});
});
test('real platform directory probe exposes its guarantee without inventing sync', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'altan-fs12-bootstrap-'));
  try {
    const syncDirectory=criarSincronizacaoDiretorioFs12({modo:'PROCESS_RESTART_ONLY',ambiente:'test'});
    const probe=await conferirDiretorioCustodiaFs12({root,syncDirectory});
    assert.equal(probe.root,path.resolve(root));
    assert.equal(typeof probe.directorySynced,'boolean');
    if(process.platform!=='win32') assert.equal(probe.directorySynced,true);
    await assert.rejects(conferirDiretorioCustodiaFs12({root:'relative',syncDirectory}),{code:'FS12_DIRETORIO_NAO_CONFIGURADO'});
  } finally {
    const resolved=path.resolve(root);
    assert.equal(path.dirname(resolved),path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith('altan-fs12-bootstrap-'));
    await rm(resolved,{recursive:true,force:true});
  }
});

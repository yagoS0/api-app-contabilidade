import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inicializarCustodiaFiscalFs12 } from '../../src/composition/inicializarCustodiaFiscalFs12.js';
import { exigirRuntimeFs12 } from '../../src/composition/execucaoFs12.js';

// Lifecycle unit: DB is an inert capability here; this is not a PG integration.
// node:test runs this file in its own process, avoiding shared registry reset hooks.
test('logger failure after registration does not reject bootstrap or clear runtime', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'altan-fs12-bootstrap-'));
  try {
    const result=await inicializarCustodiaFiscalFs12({db:{ $transaction(){throw Error('UNEXPECTED_DB_ACCESS');} },identificarEnvelope:()=>{},
      config:{root,keyIdAtivo:'synthetic',keyringJson:JSON.stringify([{id:'synthetic',keyBase64:Buffer.alloc(32,1).toString('base64')}]),
        custodianteId:'synthetic',capacidadeId:'synthetic',modo:'PROCESS_RESTART_ONLY',ambiente:'test'},
      log:{info(){throw Error('LOGGER_FAILED');},warn(){throw Error('LOGGER_FAILED');}}});
    assert.equal(result.disponivel,true);
    assert.equal(typeof exigirRuntimeFs12().recuperar,'function');
  } finally {
    const resolved=path.resolve(root);
    assert.equal(path.dirname(resolved),path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith('altan-fs12-bootstrap-'));
    await rm(resolved,{recursive:true,force:true});
  }
});

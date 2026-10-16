import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('./data-gate.mjs',import.meta.url));
for (const [label,url] of [['missing',''],['external','postgresql://fixture:fixture@example.invalid/demo_governance_test'],['non-disposable','postgresql://fixture:fixture@127.0.0.1/production']]) {
  test(`data gate refuses ${label} before any database command`,()=>{
    const result=spawnSync(process.execPath,[script],{env:{...process.env,ALTAN_GOVERNANCE_TEST_DATABASE_URL:url},encoding:'utf8',timeout:10000});
    assert.equal(result.status,1);
    assert.match(result.stderr,/Gate de dados|Gate de dados|Gate|gate/);
    assert.equal(result.stdout,'');
  });
}

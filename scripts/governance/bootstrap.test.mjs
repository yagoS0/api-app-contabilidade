import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installBlock} from './bootstrap.mjs';
test('bootstrap preserves original instructions and is idempotent',()=>{
  const dir=mkdtempSync(join(tmpdir(),'altan-bootstrap-'));
  try {
    const file=join(dir,'AGENTS.md'); writeFileSync(file,'Existing user rules.\n');
    const result=installBlock(file,dir,join(dir,'backups'));
    assert.equal(readFileSync(result.backup,'utf8'),'Existing user rules.\n');
    assert.ok(readFileSync(file,'utf8').startsWith('Existing user rules.'));
    assert.equal(installBlock(file,dir,join(dir,'backups')).changed,false);
    assert.equal(readFileSync(file,'utf8').split('ALTAN-PRINCIPAL-ORCHESTRATOR:START').length,2);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { plan, validateMap, validateRecord, checkStructure, changedPaths } from './check.mjs';
const map = JSON.parse(readFileSync(new URL('../../docs/governance/domains.json', import.meta.url),'utf8'));
test('accounting UI reaches downstream domains and independent reviewers', () => {
  const result = plan(['apps/web/src/features/accounting/entries/view.jsx'],map);
  for (const id of ['web','accounting','guides','operations','communication','portal']) assert.ok(result.domains.includes(id),id);
  for (const id of ['altan_ui_reviewer','altan_ux_reviewer','altan_backend_reviewer','altan_system_reviewer']) assert.ok(result.reviewers.includes(id),id);
  assert.equal(result.risk,'high');
});
test('cycles terminate without duplicating domains', () => {
  const result = plan(['apps/api/src/application/guides/test.js'],map);
  assert.equal(result.domains.length,new Set(result.domains).size);
  assert.ok(result.domains.length <= Object.keys(map.domains).length);
});
test('unknown paths are explicit and high risk', () => {
  const result = plan(['new-app/file.js'],map);
  assert.deepEqual(result.unknown,['new-app/file.js']);
  assert.equal(result.risk,'high');
});
test('nested instructions cannot be classified as ordinary UI or documentation', () => {
  for (const path of ['apps/web/AGENTS.md','docs/CLAUDE.md','new/AGENTS.override.md']) {
    const result = plan([path],map);
    assert.ok(result.direct.includes('governance'));
    assert.equal(result.risk,'high');
  }
});
test('Windows separators, duplicate paths and traversal', () => {
  assert.ok(plan(['apps\\api\\prisma\\schema.prisma'],map).direct.includes('data'));
  assert.equal(plan(['README.md','README.md'],map).files.length,1);
  for(const path of ['../secret','apps/../secret','C:/secret','/secret']) assert.throws(()=>plan([path],map),/Unsafe/);
});
test('map rejects missing consumers and invalid risk', () => {
  const bad = structuredClone(map); bad.domains.web.consumers.push('missing');
  assert.throws(()=>validateMap(bad),/Invalid domain/);
  bad.domains.web.consumers=[]; bad.domains.web.risk='safe';
  assert.throws(()=>validateMap(bad),/Invalid domain/);
});
test('change record rejects omitted impact, underestimated risk and missing evidence', () => {
  const impact=plan(['apps/api/prisma/schema.prisma'],map);
  const record={summary:'Add optional column',risk:'high',domains:impact.domains,operationalImpact:'No new policy',tests:['Disposable PostgreSQL run recorded separately'],rollback:'Keep column; revert readers',humanDecisions:[]};
  assert.deepEqual(validateRecord(record,impact),[]);
  assert.ok(validateRecord({...record,risk:'low'},impact).length);
  assert.ok(validateRecord({...record,domains:['data']},impact).length);
  assert.ok(validateRecord({...record,tests:[]},impact).length);
  assert.ok(validateRecord({...record,summary:' '},impact).length);
});
test('invalid references fail rather than producing an empty approved plan', () => {
  assert.throws(()=>changedPaths('main; command'));
  assert.throws(()=>changedPaths(undefined,'abcdef0'));
  assert.throws(()=>changedPaths('0000000000000000000000000000000000000000'));
});
test('required files and referenced agent profiles exist',()=>checkStructure(map));
test('exact file prefixes do not misclassify similarly named executable files', () => {
  assert.deepEqual(plan(['README.md.exe'],map).unknown,['README.md.exe']);
  assert.ok(plan(['apps/web/src/features/apuracao-v2/file.jsx'],map).direct.includes('fiscal'));
});
test('impact evidence does not raise documentation-only risk', () => {
  const result=plan(['README.md','docs/governance/changes/readme.json'],map);
  assert.equal(result.risk,'low');
  assert.deepEqual(result.domains,['documentation']);
  assert.equal(result.files.length,2);
});
test('authentication routes, access middleware and key vault require security review', () => {
  for(const path of ['apps/api/src/middlewares/requireAuth.js','apps/api/src/routes/middlewares/auth.js','apps/api/src/routes/auth.js','apps/api/src/infrastructure/security/KmsCertVault.js']) {
    const result=plan([path],map);
    assert.ok(result.direct.includes('security'),path);
    assert.equal(result.risk,'high');
  }
});
test('Git diff includes rename source, destination, deletions and local new files', () => {
  const cwd=mkdtempSync(join(tmpdir(),'altan-governance-test-'));
  const git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  try {
    git('init'); git('config','user.email','fixture@example.invalid'); git('config','user.name','Fixture');
    writeFileSync(join(cwd,'before.txt'),'original'); writeFileSync(join(cwd,'deleted.txt'),'deleted');
    git('add','.'); git('commit','-m','base'); const base=git('rev-parse','HEAD');
    renameSync(join(cwd,'before.txt'),join(cwd,'after.txt')); rmSync(join(cwd,'deleted.txt'));
    git('add','.'); git('commit','-m','rename and delete'); const head=git('rev-parse','HEAD');
    assert.deepEqual(changedPaths(base,head,cwd).sort(),['after.txt','before.txt','deleted.txt']);
    assert.deepEqual(changedPaths(head,base,cwd,'trees').sort(),['after.txt','before.txt','deleted.txt']);
    assert.throws(()=>changedPaths('0'.repeat(40),head,cwd,'trees'),/explicit reviewed baseline/);
    writeFileSync(join(cwd,'new file.txt'),'new');
    assert.deepEqual(changedPaths(undefined,undefined,cwd),['new file.txt']);
    writeFileSync(join(cwd,'after.txt'),'modified'); git('add','after.txt');
    assert.deepEqual(changedPaths(undefined,undefined,cwd).sort(),['after.txt','new file.txt']);
  } finally { rmSync(cwd,{recursive:true,force:true}); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runOrchestration, runCommand } from './orchestrate.mjs';
import { resolveOperationalReference } from './operational.mjs';
import { createHash } from 'node:crypto';

function fixture(t, gateCode = "process.exit(require('node:fs').readFileSync('src/value.txt','utf8') === 'fixed' ? 0 : 1)") {
  const root = mkdtempSync(resolve(tmpdir(),'altan-orchestration-'));
  t.after(() => rmSync(root,{recursive:true,force:true}));
  mkdirSync(resolve(root,'docs/governance'),{recursive:true}); mkdirSync(resolve(root,'src'));
  writeFileSync(resolve(root,'REGRAS_OPERACIONAIS.md'),'Synthetic operational rules');
  writeFileSync(resolve(root,'docs/governance/operational-reference.json'),JSON.stringify({canonical:'missing-canonical.md',repositoryFallback:'REGRAS_OPERACIONAIS.md',snapshotSha256:createHash('sha256').update('Synthetic operational rules').digest('hex')}));
  writeFileSync(resolve(root,'src/value.txt'),'initial');
  writeFileSync(resolve(root,'src/preexisting.txt'),'preserve');
  writeFileSync(resolve(root,'docs/governance/domains.json'),JSON.stringify({version:1,domains:{core:{prefixes:['src/'],risk:'medium',reviewers:['altan_backend_reviewer'],consumers:['consumer']},consumer:{prefixes:['consumer/'],risk:'medium',reviewers:['altan_ui_reviewer'],consumers:[]}}}));
  writeFileSync(resolve(root,'docs/governance/gates.json'),JSON.stringify({version:1,gates:[{id:'real-test',domains:['*'],command:[process.execPath,'-e',gateCode],cwd:'.',timeoutMs:10000}]}));
  execFileSync('git',['init','-q'],{cwd:root});
  execFileSync('git',['add','.'],{cwd:root});
  execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','fixture'],{cwd:root});
  writeFileSync(resolve(root,'src/preexisting.txt'),'preexisting user edit');
  return root;
}
function adapterFor(root, hooks = {}) {
  let executions = 0;
  return async context => {
    if (context.kind === 'planner') return hooks.planner?.(context) || {summary:'Fix value',paths:['src/value.txt'],risks:[]};
    if (context.kind === 'executor') {
      executions++;
      writeFileSync(resolve(root,'src/value.txt'),hooks.value?.(executions) || 'fixed');
      await hooks.executor?.(context,executions);
      return {summary:'Updated value'};
    }
    return await hooks.reviewer?.(context,executions) || {summary:'Inspected current implementation',verdict:'approved',findings:[],reviewedDomains:context.domains};
  };
}
test('real gate and separate cross-domain reviews certify only current fingerprint',async t => {
  const root = fixture(t), result = await runOrchestration({root,request:'Fix value',adapter:adapterFor(root)});
  assert.equal(result.status,'ready_for_human');
  assert.deepEqual(result.changedPaths,['src/value.txt']);
  assert.equal(readFileSync(resolve(root,'src/preexisting.txt'),'utf8'),'preexisting user edit');
  const reviews = result.rounds[0].reviews;
  assert.equal(reviews.at(-1).role,'altan_system_reviewer');
  assert.deepEqual(reviews.filter(r => r.role === 'altan_domain_reviewer').flatMap(r => r.domains),['consumer','core']);
  assert.ok(reviews.every(r => r.fingerprint === result.sourceFingerprint));
  assert.ok(result.record.path.startsWith('docs/governance/changes/runtime-'));
  assert.notEqual(result.sourceFingerprint,result.fingerprint);
});
test('rejection and failing real gate return findings to executor then renew all reviews',async t => {
  const root = fixture(t);
  let receivedFailure = false;
  const result = await runOrchestration({root,request:'Fix value',adapter:adapterFor(root,{
    value:n => n === 1 ? 'broken' : 'fixed',
    executor:(ctx,n) => { if (n === 2) receivedFailure = ctx.prompt.includes('Gate real-test failed') && ctx.prompt.includes('Value still broken'); },
    reviewer:(ctx,n) => ({verdict:n === 1 ? 'rejected' : 'approved',summary:n === 1 ? 'Value still broken' : 'Corrected',findings:n === 1 ? ['Value still broken'] : [],reviewedDomains:ctx.domains}),
  })});
  assert.equal(result.status,'ready_for_human'); assert.equal(result.rounds.length,2); assert.ok(receivedFailure);
  assert.equal(result.rounds[0].gates[0].passed,false);
  assert.ok(result.rounds[0].reviews.every(r => r.role !== 'altan_system_reviewer'));
  assert.notEqual(result.rounds[0].fingerprint,result.fingerprint);
});
test('gate failure cannot be overruled by unanimous approval',async t => {
  const root = fixture(t,'process.exit(1)');
  const result = await runOrchestration({root,request:'Fix',adapter:adapterFor(root),maxCorrections:0});
  assert.equal(result.status,'escalated'); assert.match(result.error,/Correction limit/);
  assert.equal(result.rounds[0].reviews.length,4);
});
test('reviewer mutation invalidates all evidence',async t => {
  const root = fixture(t);
  const result = await runOrchestration({root,request:'Fix',adapter:adapterFor(root,{reviewer:() => { writeFileSync(resolve(root,'src/value.txt'),'tampered'); }})});
  assert.equal(result.status,'escalated'); assert.match(result.error,/mutated repository/);
});
test('unknown paths and exhausted budgets stop before unauthorized execution',async t => {
  const root = fixture(t);
  const unknown = await runOrchestration({root,request:'Fix',adapter:adapterFor(root,{planner:() => ({summary:'Unknown',paths:['unknown.txt'],risks:[]})})});
  assert.equal(unknown.status,'escalated'); assert.match(unknown.error,/Unmapped paths/);
  const budget = await runOrchestration({root,request:'Fix',adapter:adapterFor(root),maxCalls:1});
  assert.equal(budget.status,'escalated'); assert.match(budget.error,/budget/);
  assert.equal(readFileSync(resolve(root,'src/value.txt'),'utf8'),'initial');
});
test('out-of-plan changes escalate without deleting user work',async t => {
  const root = fixture(t);
  const result = await runOrchestration({root,request:'Fix',adapter:adapterFor(root,{executor:() => writeFileSync(resolve(root,'src/extra.txt'),'unexpected')})});
  assert.equal(result.status,'escalated'); assert.match(result.error,/out-of-plan/);
  assert.equal(readFileSync(resolve(root,'src/preexisting.txt'),'utf8'),'preexisting user edit');
});
test('incomplete domain review cannot approve',async t => {
  const root = fixture(t);
  const result = await runOrchestration({root,request:'Fix',adapter:adapterFor(root,{reviewer:() => ({verdict:'approved',summary:'Missing coverage',findings:[],reviewedDomains:[]})})});
  assert.equal(result.status,'escalated'); assert.match(result.error,/incomplete reviewer/);
});
test('test-induced mutation invalidates evidence before any reviewer',async t => {
  const root = fixture(t,"require('node:fs').writeFileSync('src/value.txt','mutation')");
  const result = await runOrchestration({root,request:'Fix',adapter:adapterFor(root)});
  assert.equal(result.status,'escalated'); assert.match(result.error,/Test execution changed/);
  assert.equal(result.rounds[0].reviews.length,0);
});
test('exclusive lock rejects a simultaneous orchestrator',async t => {
  const root = fixture(t);
  mkdirSync(resolve(root,'.altan-governance'));
  writeFileSync(resolve(root,'.altan-governance/orchestrator.lock'),'existing owner');
  await assert.rejects(runOrchestration({root,request:'Fix',adapter:adapterFor(root)}),/lock exists/);
});
test('missing executables and timed-out gates fail closed',async t => {
  const root = fixture(t);
  await assert.rejects(runCommand('altan-nonexistent-executable-123',[],{cwd:root,timeoutMs:100,logPrefix:resolve(root,'missing')}));
  const result = await runCommand(process.execPath,['-e','setInterval(() => {},1000)'],{cwd:root,timeoutMs:100,logPrefix:resolve(root,'timeout')});
  assert.equal(result.timedOut,true);
  assert.notEqual(result.code,0);
});
test('dirty planned tracked target blocks before executor',async t => {
  const root = fixture(t);
  writeFileSync(resolve(root,'src/value.txt'),'user edit');
  const result = await runOrchestration({root,request:'Fix',adapter:adapterFor(root)});
  assert.equal(result.status,'escalated'); assert.match(result.error,/preexisting changes/);
  assert.equal(result.calls.filter(c => c.kind === 'executor').length,0);
  assert.equal(readFileSync(resolve(root,'src/value.txt'),'utf8'),'user edit');
});
test('preexisting untracked planned target blocks before executor',async t => {
  const root = fixture(t);
  writeFileSync(resolve(root,'src/new.txt'),'user file');
  const result = await runOrchestration({root,request:'Fix',adapter:adapterFor(root,{planner:() => ({summary:'New',paths:['src/new.txt'],risks:[]})})});
  assert.equal(result.status,'escalated'); assert.match(result.error,/preexisting changes/);
  assert.equal(result.calls.filter(c => c.kind === 'executor').length,0);
});
test('staged change hidden by a restored working file still blocks',async t => {
  const root = fixture(t);
  writeFileSync(resolve(root,'src/value.txt'),'staged user edit');
  execFileSync('git',['add','src/value.txt'],{cwd:root});
  writeFileSync(resolve(root,'src/value.txt'),'initial');
  const result = await runOrchestration({root,request:'Fix',adapter:adapterFor(root)});
  assert.equal(result.status,'escalated'); assert.match(result.error,/preexisting changes/);
  assert.equal(result.calls.filter(c => c.kind === 'executor').length,0);
});
test('new runtime-created source is preserved in review evidence and valid record',async t => {
  const root = fixture(t,'process.exit(0)');
  const result = await runOrchestration({root,request:'Add source',adapter:async ctx => {
    if (ctx.kind === 'planner') return {summary:'Add new source',paths:['src/new.txt'],risks:[]};
    if (ctx.kind === 'executor') { writeFileSync(resolve(root,'src/new.txt'),'new source'); return {summary:'Added'}; }
    return {verdict:'approved',summary:'Reviewed',findings:[],reviewedDomains:ctx.domains};
  }});
  assert.equal(result.status,'ready_for_human');
  assert.equal(result.baselineSources['src/new.txt'].exists,false);
  assert.equal(readFileSync(result.rounds[0].sources['src/new.txt'].evidence,'utf8'),'new source');
  const record = JSON.parse(readFileSync(resolve(root,result.record.path),'utf8'));
  assert.equal(record.sourceFingerprint,result.sourceFingerprint);
  assert.deepEqual(record.sourcePaths,['src/new.txt']);
});

test('missing operational reference or document stops before planner', async t => {
  for (const path of ['docs/governance/operational-reference.json','REGRAS_OPERACIONAIS.md']) {
    const root = fixture(t); rmSync(resolve(root,path));
    const result = await runOrchestration({root,request:'Fix',adapter:adapterFor(root)});
    assert.equal(result.status,'escalated'); assert.match(result.error,/Operational .*missing/);
    assert.equal(result.calls.length,0);
  }
});
test('tampered operational snapshot stops before planner', async t => {
  const root = fixture(t); writeFileSync(resolve(root,'REGRAS_OPERACIONAIS.md'),'unauthorized change');
  const result = await runOrchestration({root,request:'Fix',adapter:adapterFor(root)});
  assert.equal(result.status,'escalated'); assert.match(result.error,/snapshot hash mismatch/);
  assert.equal(result.calls.length,0);
});
test('clone fallback is verified and included in every delegated prompt', async t => {
  const root = fixture(t); let calls = 0;
  const underlying = adapterFor(root);
  const result = await runOrchestration({root,request:'Fix',adapter:async ctx => {
    calls++; assert.ok(ctx.prompt.includes('Synthetic operational rules'));
    assert.ok(ctx.prompt.includes(resolve(root,'REGRAS_OPERACIONAIS.md')));
    return underlying(ctx);
  }});
  assert.equal(result.status,'ready_for_human'); assert.ok(calls > 2);
  assert.equal(result.operationalReference.source,'repositoryFallback');
});
test('canonical authority is relative to governance root; CI checks fallback independently', t => {
  const root = fixture(t);
  writeFileSync(resolve(root,'missing-canonical.md'),'Synthetic operational rules');
  assert.equal(resolveOperationalReference(root).source,'canonical');
  writeFileSync(resolve(root,'missing-canonical.md'),'drift');
  assert.throws(() => resolveOperationalReference(root),/hash mismatch/);
  assert.equal(resolveOperationalReference(root,{fallbackOnly:true}).source,'repositoryFallback');
  writeFileSync(resolve(root,'REGRAS_OPERACIONAIS.md'),'drift');
  assert.throws(() => resolveOperationalReference(root,{fallbackOnly:true}),/hash mismatch/);
  rmSync(resolve(root,'REGRAS_OPERACIONAIS.md'));
  assert.throws(() => resolveOperationalReference(root,{fallbackOnly:true}),/document missing/);
});
test('executor cannot modify operational rules even outside its planned source', async t => {
  const root = fixture(t);
  const result = await runOrchestration({root,request:'Fix',adapter:adapterFor(root,{executor:() => writeFileSync(resolve(root,'REGRAS_OPERACIONAIS.md'),'changed')})});
  assert.equal(result.status,'escalated'); assert.match(result.error,/protected or out-of-plan/);
  assert.equal(result.rounds[0].gates.length,0);
});
test('planned operational changes are protected even when domain mapped', async t => {
  const root = fixture(t), mapPath = resolve(root,'docs/governance/domains.json');
  const map = JSON.parse(readFileSync(mapPath,'utf8')); map.domains.core.prefixes.push('REGRAS_OPERACIONAIS.md');
  writeFileSync(mapPath,JSON.stringify(map));
  const result = await runOrchestration({root,request:'Change rules',adapter:adapterFor(root,{planner:() => ({summary:'Change rules',paths:['REGRAS_OPERACIONAIS.md'],risks:[]})})});
  assert.equal(result.status,'escalated'); assert.match(result.error,/Governance\/configuration/);
  assert.equal(result.calls.filter(c => c.kind === 'executor').length,0);
});

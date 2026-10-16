import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCodexAdapter, runOrchestration } from './orchestrate.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const contract = `import test from 'node:test';
import assert from 'node:assert/strict';
import { projectBalance } from '../ledger/projectBalance.mjs';
import { balanceLabel } from '../presentation/balanceLabel.mjs';
test('R02: missing and invalid amounts remain unknown across domains', () => {
  for (const value of [null, undefined, NaN, Infinity, -1, 1.5, '0', false, {}, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(projectBalance(value), {status:'unknown', cents:null});
    assert.equal(balanceLabel(value), 'A verificar');
  }
});
test('explicit zero remains known and is displayed as zero', () => {
  assert.deepEqual(projectBalance(0), {status:'known', cents:0});
  assert.equal(balanceLabel(0), '0,00');
});
test('known nonnegative safe integer cents preserve value and presentation', () => {
  for (const [value, label] of [[1,'0,01'], [105,'1,05'], [123456,'1234,56']]) {
    assert.deepEqual(projectBalance(value), {status:'known', cents:value});
    assert.equal(balanceLabel(value), label);
  }
  assert.deepEqual(projectBalance(Number.MAX_SAFE_INTEGER), {status:'known', cents:Number.MAX_SAFE_INTEGER});
});
`;

/** Real Codex sessions; the sole simulated element is a documented source fault in a disposable fixture. */
export async function runAcceptance({fixtureRoot, command = 'codex', timeoutMs = 600000} = {}) {
  const root = resolve(fixtureRoot || resolve(process.cwd(), 'work', `acceptance-${randomUUID()}`));
  if (existsSync(root) && readdirSync(root).length) throw Error('Acceptance fixture must be a new or empty directory; existing content is never overwritten');
  mkdirSync(root, {recursive:true});
  for (const dir of ['ledger', 'presentation', 'tests', 'docs/governance', '.altan-governance/acceptance']) mkdirSync(resolve(root, dir), {recursive:true});
  const evidence = resolve(root, '.altan-governance/acceptance');
  const put = (path, body) => writeFileSync(resolve(root, path), body);
  put('.gitignore', '.altan-governance/\n');
  put('AGENTS.md', `# Isolated governance acceptance fixture\nThis is a synthetic test repository, not the Altan application. Read docs/governance/POLICY.md and REGRAS_OPERACIONAIS.md. Do not delegate. Preserve the contract tests exactly; implement the missing behavior in existing sources. No production data, services, publication or commits. Reviewers only inspect.\n`);
  put('docs/governance/POLICY.md', 'The principal orchestrator dispatches implementation and independent domain reviews. Failed gates or rejected reviews require correction. Technical approval never authorizes publication. This isolated fixture has no pending business decisions. The acceptance harness may inject a deliberate source fault after the first executor to exercise rejection and repair; reviewers must judge actual source and evidence.\n');
  put('REGRAS_OPERACIONAIS.md', `# Synthetic acceptance contract derived from Altan R02\nMissing information or read error never means zero. projectBalance(value) returns {status:'known', cents:value} only for a nonnegative safe integer number (including 0). Every other input returns {status:'unknown', cents:null}. balanceLabel(value) consumes projectBalance, displays unknown as 'A verificar', and known cents as decimal reais with two fractional digits, comma separator and no grouping/currency prefix: 0 => '0,00', 105 => '1,05'. No real operational rule changes are made by this fixture.\n`);
  save(resolve(root, 'docs/governance/operational-reference.json'), {canonical:'REGRAS_OPERACIONAIS.md', repositoryFallback:'REGRAS_OPERACIONAIS.md', status:'synthetic-acceptance-fixture'});
  save(resolve(root, 'docs/governance/domains.json'), {version:1, domains:{
    ledger:{prefixes:['ledger/', 'tests/'], reviewers:['altan_domain_reviewer'], risk:'high', consumers:['presentation']},
    presentation:{prefixes:['presentation/'], reviewers:['altan_domain_reviewer'], risk:'medium', consumers:[]},
  }});
  save(resolve(root, 'docs/governance/gates.json'), {version:1, gates:[{id:'acceptance', domains:['*'], command:['node', '--test', 'tests/contract.test.mjs'], cwd:'.', timeoutMs:60000}]});
  put('ledger/projectBalance.mjs', "export function projectBalance(value) { throw new Error('Not implemented'); }\n");
  put('presentation/balanceLabel.mjs', "import { projectBalance } from '../ledger/projectBalance.mjs';\nexport function balanceLabel(value) { projectBalance(value); throw new Error('Not implemented'); }\n");
  put('tests/contract.test.mjs', contract);
  const git = args => execFileSync('git', args, {cwd:root, encoding:'utf8', windowsHide:true});
  git(['init']);
  git(['add', '.']);
  // Identity applies only to this disposable baseline commit, never global/local Git configuration.
  git(['-c', 'user.name=Altan acceptance fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Synthetic acceptance baseline']);
  const request = 'Implemente a exibição do saldo respeitando o contrato deste projeto: informação ausente ou inválida deve aparecer como A verificar, enquanto zero confirmado deve aparecer como 0,00. Faça a implementação completa e preserve os testes de contrato existentes.';
  const realAdapter = createCodexAdapter({command});
  let injected = false;
  const adapter = async args => {
    const response = await realAdapter(args);
    if (args.kind === 'executor' && !injected) {
      const target = resolve(root, 'ledger/projectBalance.mjs');
      const before = readFileSync(target);
      writeFileSync(resolve(evidence, 'before-injection-projectBalance.mjs'), before);
      const faulty = "export function projectBalance(value){return {status:'known',cents:Number(value)||0};}\n";
      writeFileSync(target, faulty);
      writeFileSync(resolve(evidence, 'injected-projectBalance.mjs'), faulty);
      save(resolve(evidence, 'fault-injection.json'), {at:new Date().toISOString(), callId:args.callId, target:'ledger/projectBalance.mjs', beforeSha256:hash(before), afterSha256:hash(faulty), reason:'Deliberate adversarial fault injected by acceptance harness only in isolated fixture; not a production bug or agent-generated defect. No review/result is fabricated.'});
      injected = true;
    }
    return response;
  };
  const state = await runOrchestration({root, request, adapter, timeoutMs});
  const sessions = state.calls.map(call => {
    const path = resolve(state.runDir, call.callId + '.stdout.log');
    const events = existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }) : [];
    return {callId:call.callId, role:call.role, kind:call.kind, domains:call.domains, threadId:events.find(event => event.type === 'thread.started')?.thread_id || null};
  });
  const summary = {version:1, fixtureRoot:root, evidence, runDir:state.runDir, status:'failed', runtimeStatus:state.status, runtimeError:state.error || null, rounds:state.rounds.length, calls:state.calls.length, injectedFault:injected, sessions, limitations:['Synthetic isolated fixture; no productive Altan code changed.', 'Deliberate source fault; real Codex execution, verdicts and correction.', 'Technical readiness leaves human integration approval pending.']};
  try {
    assert.equal(state.status, 'ready_for_human', state.error);
    assert.ok(injected, 'Fault was actually injected');
    assert.ok(state.rounds.length >= 2, 'Rejection must force another execution round');
    assert.ok(state.rounds[0].gates.some(gate => !gate.passed), 'Injected failure must fail the first gate');
    assert.ok(state.rounds[0].reviews.some(review => review.verdict === 'rejected'), 'A real independent reviewer must reject');
    const last = state.rounds.at(-1);
    assert.ok(last.gates.length && last.gates.every(gate => gate.passed), 'Final gates must pass');
    assert.ok(last.reviews.some(review => review.role === 'altan_system_reviewer' && review.verdict === 'approved'), 'System review must approve the corrected cross-domain implementation');
    for (const domain of ['ledger', 'presentation']) assert.ok(last.reviews.some(review => review.domains.includes(domain) && review.verdict === 'approved'), `Missing approved ${domain} review`);
    assert.equal(readFileSync(resolve(root, 'tests/contract.test.mjs'), 'utf8'), contract, 'The contract tests must not be weakened or changed');
    assert.ok(sessions.every(session => session.threadId), 'Every real call must retain its session identity');
    assert.equal(new Set(sessions.map(session => session.threadId)).size, sessions.length, 'Each call must use an independent real session');
    summary.status = 'passed';
  } catch (error) { summary.failure = error.message; }
  save(resolve(evidence, 'summary.json'), summary);
  return summary;
}

async function main() {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = {'--fixture-root':'fixtureRoot', '--command':'command', '--timeout-ms':'timeoutMs'}[args[i]];
    if (!name || !args[i + 1] || options[name] !== undefined) throw Error('Usage: acceptance.mjs [--fixture-root EMPTY_DIR] [--command CODEX_EXECUTABLE] [--timeout-ms INTEGER]');
    options[name] = name === 'timeoutMs' ? Number(args[i + 1]) : args[i + 1];
  }
  const result = await runAcceptance(options);
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'passed') process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });

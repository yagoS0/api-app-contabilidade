import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runJestBatches, saveManifestAtomically } from './run-jest-batches.mjs';

function manifestFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'altan-manifest-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const destination = path.join(directory, 'manifest.json');
  fs.writeFileSync(destination, JSON.stringify({ status: 'running' }));
  return { directory, destination };
}

for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
  test(`rename Windows ${code} transitório preserva destino e publica resultado completo`, async t => {
    const { directory, destination } = manifestFixture(t);
    const manifest = { status: 'failed', error: 'Teste reprovado', batches: [1, 2] };
    let attempts = 0, elapsed = 0;
    await saveManifestAtomically(directory, manifest, 1000, {
      platform: 'win32', now: () => elapsed,
      wait: async ms => { elapsed += ms; assert.equal(JSON.parse(fs.readFileSync(destination)).status, 'running'); },
      rename: (source, target) => {
        if (++attempts < 3) throw Object.assign(new Error('locked'), { code });
        fs.renameSync(source, target);
      },
    });
    assert.equal(attempts, 3);
    assert.equal(elapsed, 150);
    assert.deepEqual(JSON.parse(fs.readFileSync(destination)), manifest);
    assert.equal(fs.existsSync(path.join(directory, 'manifest.tmp')), false);
  });
}

test('lock persistente falha após seis tentativas sem remover a evidência anterior', async t => {
  const { directory, destination } = manifestFixture(t);
  const error = Object.assign(new Error('locked'), { code: 'EPERM' });
  let attempts = 0, elapsed = 0;
  await assert.rejects(saveManifestAtomically(directory, { status: 'passed' }, 10000, {
    platform: 'win32', now: () => elapsed, wait: async ms => { elapsed += ms; },
    rename: () => { attempts++; throw error; },
  }), candidate => candidate === error);
  assert.equal(attempts, 6);
  assert.equal(elapsed, 750);
  assert.deepEqual(JSON.parse(fs.readFileSync(destination)), { status: 'running' });
  assert.equal(fs.existsSync(path.join(directory, 'manifest.tmp')), true);
});

for (const [platform, code] of [['win32', 'ENOENT'], ['linux', 'EPERM']]) {
  test(`não repete erro ${code} em ${platform}`, async t => {
    const { directory } = manifestFixture(t);
    let attempts = 0;
    await assert.rejects(saveManifestAtomically(directory, {}, 1000, {
      platform, now: () => 0,
      wait: async () => assert.fail('Não deveria esperar'),
      rename: () => { attempts++; throw Object.assign(new Error('fatal'), { code }); },
    }), { code });
    assert.equal(attempts, 1);
  });
}

for (const delayedTimer of [false, true]) {
  test(`prazo global limita retry, timer atrasado=${delayedTimer}`, async t => {
    const { directory } = manifestFixture(t);
    let attempts = 0, elapsed = 0, waits = 0;
    await assert.rejects(saveManifestAtomically(directory, {}, delayedTimer ? 100 : 50, {
      platform: 'win32', now: () => elapsed,
      wait: async () => { waits++; elapsed = 101; },
      rename: () => { attempts++; throw Object.assign(new Error('locked'), { code: 'EBUSY' }); },
    }), { code: 'EBUSY' });
    assert.equal(attempts, 1);
    assert.equal(waits, delayedTimer ? 1 : 0);
  });
}

test('resultado passed não é retornado quando a gravação final falha', async t => {
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (source, destination) => {
    if (JSON.parse(fs.readFileSync(source)).status === 'passed') {
      throw Object.assign(new Error('final manifest unavailable'), { code: 'EPERM' });
    }
    return rename(source, destination);
  });
  await assert.rejects(fixture(t, 'pass', 1), /final manifest unavailable/);
});

async function fixture(t, mode, count = 26) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'altan-jest-batches-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'app with spaces');
  fs.mkdirSync(cwd);
  const files = Array.from({ length: count }, (_, i) => path.join(cwd, `${i === 0 ? '-' : ''}suíte ${i}.test.js`));
  files.forEach(file => fs.writeFileSync(file, '// fixture'));
  const jestPath = path.join(root, 'jest-fixture.cjs');
  fs.writeFileSync(jestPath, `
const fs = require('node:fs'), path = require('node:path');
const mode = ${JSON.stringify(mode)}, files = ${JSON.stringify(files)};
const args = process.argv.slice(2);
if (args.includes('--showConfig')) { console.log(JSON.stringify({configs: mode === 'projects' ? [{}, {}] : [mode === 'global-setup' ? {globalSetup: 'setup.js'} : {}], globalConfig: mode === 'coverage' ? {collectCoverage: true} : {}})); process.exit(0); }
if (args.includes('--listTests')) {
  if (mode === 'invalid') { console.log('invalid'); process.exit(0); }
  if (mode === 'discovery-crash') process.exit(3);
  const list = mode === 'empty' ? [] : mode === 'duplicate' ? [files[0], files[0]] : mode === 'outside' ? [__filename] : mode === 'relative' ? ['a.test.js'] : mode === 'not-found' ? [files[0] + '.absent'] : files;
  if (mode === 'unicode') { const bytes = Buffer.from(JSON.stringify(list)); const cut = bytes.indexOf(0xc3) + 1; process.stdout.write(bytes.subarray(0, cut)); setTimeout(() => { process.stdout.write(bytes.subarray(cut)); }, 20); return; }
  console.log(JSON.stringify(list)); process.exit(0);
}
if (mode === 'crash') process.exit(2);
if (mode === 'timeout') { setInterval(() => {}, 1000); return; }
if (mode === 'missing') process.exit(0);
const paths = args.slice(args.indexOf('--runTestsByPath') + 1);
if (paths.some(f => !f.startsWith('.' + path.sep))) process.exit(5);
let selected = paths.map(f => path.resolve(f));
if (mode === 'omitted') selected.pop();
if (mode === 'extra') selected.push(__filename);
if (mode === 'duplicate-result') selected[1] = selected[0];
const skipped = mode === 'skipped' ? selected.length : 0;
const report = { success: mode !== 'failure', numFailedTests: mode === 'failure' ? 1 : 0, numFailedTestSuites: mode === 'failure' ? 1 : 0,
 numTotalTestSuites: selected.length, numPassedTestSuites: selected.length - skipped, numPendingTestSuites: skipped,
 numTotalTests: selected.length, numPassedTests: selected.length - skipped, numPendingTests: skipped, numTodoTests: 0,
 testResults: selected.map(name => ({ name, status: mode === 'skipped' ? 'pending' : 'passed', assertionResults: [{status: mode === 'skipped' ? 'pending' : 'passed'}] })) };
if (mode === 'focused') {
 report.numTotalTests = selected.length * 3; report.numPendingTests = selected.length; report.numTodoTests = selected.length;
 report.testResults.forEach(result => {result.status = 'focused'; result.assertionResults = [{status:'passed'}, {status:'pending'}, {status:'todo'}];});
}
if (mode === 'assertion-failed') report.testResults[0].assertionResults[0].status = 'failed';
if (mode === 'assertion-omitted') report.testResults[0].assertionResults = [];
if (mode === 'counts') report.numTotalTests++;
if (mode === 'zero-tests') { report.numTotalTests = 0; report.numPassedTests = 0; }
fs.writeFileSync(args[args.indexOf('--outputFile') + 1], mode === 'invalid-result' ? 'bad' : JSON.stringify(report));
`);
  const result = await runJestBatches({ cwd, jestPath, evidenceRoot: path.join(root, 'evidence'), timeoutMs: mode === 'timeout' ? 800 : 10000 });
  const evidence = path.join(root, 'evidence', fs.readdirSync(path.join(root, 'evidence'))[0]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(evidence, 'manifest.json'))), result);
  return result;
}

test('executa toda discovery em lotes 25 + 1 e contabiliza exatamente uma vez', async t => {
  const result = await fixture(t, 'pass');
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.batches.map(batch => batch.files.length), [25, 1]);
  assert.equal(result.totals.numTotalTestSuites, 26);
  assert.equal(result.totals.numPassedTests, 26);
});

test('conserva e informa suites/testes skipped preexistentes', async t => {
  const result = await fixture(t, 'skipped', 1);
  assert.equal(result.status, 'passed');
  assert.equal(result.totals.numPendingTestSuites, 1);
  assert.equal(result.totals.numPendingTests, 1);
  assert.equal(result.totals.numPassedTests, 0);
});

test('preserva UTF-8 dividido entre chunks de saída', async t => {
  assert.equal((await fixture(t, 'unicode', 1)).status, 'passed');
});

test('focused do Jest com skip parcial preserva passed/pending/todo', async t => {
  const result = await fixture(t, 'focused', 1);
  assert.equal(result.status, 'passed');
  assert.equal(result.totals.numTotalTests, 3);
  assert.equal(result.totals.numPendingTests, 1);
  assert.equal(result.totals.numTodoTests, 1);
});

for (const mode of ['global-setup', 'projects', 'coverage', 'empty', 'invalid', 'duplicate', 'outside', 'relative', 'not-found', 'discovery-crash', 'crash', 'missing', 'omitted', 'extra', 'duplicate-result', 'failure', 'assertion-failed', 'assertion-omitted', 'counts', 'zero-tests', 'invalid-result', 'timeout']) {
  test(`falha fechada: ${mode}`, async t => {
    const result = await fixture(t, mode);
    assert.equal(result.status, 'failed');
    assert.ok(result.error);
    assert.equal(result.totals, undefined);
  });
}

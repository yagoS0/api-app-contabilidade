import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BATCH_SIZE = 25;
// Leave ten seconds for child-tree termination before the unchanged outer gate.
const TIMEOUT_MS = 1190000;

// Windows readers (including virus scanners) can briefly lock the destination.
// Never unlink it: readers must see either the previous or the complete new file.
export async function saveManifestAtomically(directory, manifest, deadline, {
  platform = process.platform, rename = fs.renameSync, now = Date.now,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  const temporary = path.join(directory, 'manifest.tmp');
  const destination = path.join(directory, 'manifest.json');
  fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2));
  const delays = [50, 100, 200, 200, 200];
  for (let attempt = 0; ; attempt++) {
    try {
      rename(temporary, destination);
      return;
    } catch (error) {
      const delay = delays[attempt];
      if (platform !== 'win32' || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code) ||
          delay === undefined || now() + delay >= deadline) throw error;
      await wait(delay);
      // A delayed timer must not start another attempt after the global deadline.
      if (now() >= deadline) throw error;
    }
  }
}

function command(args, cwd, deadline) {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new Error('Tempo total esgotado'));
    const child = spawn(process.execPath, args, { cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32' });
    let stdout = '', stderr = '', failure;
    const killTree = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ }
      }
      child.kill('SIGKILL');
    };
    const stop = () => { failure = new Error('Execução interrompida'); killTree(); };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    const timer = setTimeout(() => { failure = new Error('Tempo total esgotado'); killTree(); }, remaining);
    const collect = (name, chunk) => {
      if (name === 'stdout') stdout += chunk; else stderr += chunk;
      if (stdout.length + stderr.length > 32 * 1024 * 1024) {
        failure = new Error('Saída excedeu limite de captura'); killTree();
      }
    };
    child.stdout.setEncoding('utf8').on('data', chunk => collect('stdout', chunk));
    child.stderr.setEncoding('utf8').on('data', chunk => collect('stderr', chunk));
    child.on('error', error => { failure = error; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      process.removeListener('SIGTERM', stop);
      process.removeListener('SIGINT', stop);
      resolve({ code, signal, stdout, stderr, error: failure?.message });
    });
  });
}

function suitePath(value, cwd) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('Caminho de suíte inválido');
  const absolute = fs.realpathSync(value);
  const relative = path.relative(cwd, absolute);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Suíte fora do diretório do gate');
  }
  if (!fs.statSync(absolute).isFile()) throw new Error('Suíte não é arquivo');
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

export async function runJestBatches({ cwd = process.cwd(), jestPath, evidenceRoot, timeoutMs = TIMEOUT_MS } = {}) {
  cwd = fs.realpathSync(cwd);
  jestPath ??= path.resolve(cwd, '../../node_modules/jest/bin/jest.js');
  evidenceRoot ??= path.resolve(cwd, '../../.altan-governance/test-batches');
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(evidenceRoot, `${path.basename(cwd)}-`));
  const manifest = { cwd, jestPath, batchSize: BATCH_SIZE, startedAt: new Date().toISOString(), status: 'running', discovered: [], batches: [] };
  const deadline = Date.now() + timeoutMs;
  const save = () => saveManifestAtomically(directory, manifest, deadline);
  async function execute(args, label) {
    const result = await command([jestPath, ...args], cwd, deadline);
    fs.writeFileSync(path.join(directory, `${label}.stdout.log`), result.stdout);
    fs.writeFileSync(path.join(directory, `${label}.stderr.log`), result.stderr);
    if (result.error || result.code !== 0 || result.signal) throw new Error(`${label}: ${result.error || `exit=${result.code}, signal=${result.signal}`}`);
    return result.stdout;
  }
  await save();
  try {
    const configuration = JSON.parse(await execute(['--showConfig'], 'configuration'));
    if (!Array.isArray(configuration.configs) || configuration.configs.length !== 1 || !configuration.globalConfig ||
      configuration.globalConfig.collectCoverage || configuration.globalConfig.coverageThreshold ||
      configuration.configs.some(config => config.globalSetup || config.globalTeardown || config.coverageThreshold)) {
      throw new Error('Configuração exige revisão: projetos múltiplos, hooks globais ou coverage não suportados por lotes');
    }
    const discovered = JSON.parse(await execute(['--runInBand', '--listTests', '--json'], 'discovery'));
    if (!Array.isArray(discovered) || !discovered.length) throw new Error('Discovery vazia ou inválida');
    const keys = discovered.map(name => suitePath(name, cwd));
    if (new Set(keys).size !== keys.length) throw new Error('Discovery duplicada');
    manifest.discovered = discovered;
    await save();
    const covered = [];
    const totals = { numTotalTestSuites: 0, numPassedTestSuites: 0, numPendingTestSuites: 0, numTotalTests: 0, numPassedTests: 0, numPendingTests: 0, numTodoTests: 0 };
    for (let offset = 0; offset < discovered.length; offset += BATCH_SIZE) {
      const files = discovered.slice(offset, offset + BATCH_SIZE);
      const label = `batch-${manifest.batches.length + 1}`;
      const outputFile = path.join(directory, `${label}.json`);
      const batch = { files, status: 'running' };
      manifest.batches.push(batch);
      await save();
      // Relative argv keeps Windows command length bounded without changing the selected files.
      await execute(['--runInBand', '--silent', '--json', '--outputFile', outputFile, '--runTestsByPath', ...files.map(file => `.${path.sep}${path.relative(cwd, file)}`)], label);
      const report = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
      if (report.success !== true || report.wasInterrupted === true || report.numFailedTests !== 0 || report.numFailedTestSuites !== 0 || !Array.isArray(report.testResults)) throw new Error(`${label}: testes reprovados ou resultado inválido`);
      const assertions = { passed: 0, pending: 0, todo: 0 };
      const actual = report.testResults.map(result => {
        // Jest calls a passing suite with pending assertions "focused", even without test.only.
        if (!['passed', 'focused', 'pending', 'skipped', 'todo'].includes(result.status) || !Array.isArray(result.assertionResults)) throw new Error(`${label}: suíte reprovada`);
        for (const assertion of result.assertionResults) {
          if (!Object.hasOwn(assertions, assertion.status)) throw new Error(`${label}: assertion reprovada ou inválida`);
          assertions[assertion.status]++;
        }
        return suitePath(result.name, cwd);
      });
      const expected = keys.slice(offset, offset + BATCH_SIZE);
      if (actual.length !== expected.length || new Set(actual).size !== actual.length || actual.some(key => !expected.includes(key)) || report.numTotalTestSuites !== files.length) throw new Error(`${label}: cobertura de suítes divergente`);
      for (const key of Object.keys(totals)) {
        if (!Number.isSafeInteger(report[key]) || report[key] < 0) throw new Error(`${label}: contagem inválida ${key}`);
        totals[key] += report[key];
      }
      if (report.numPassedTestSuites + report.numPendingTestSuites !== report.numTotalTestSuites ||
        report.numPassedTests + report.numPendingTests + report.numTodoTests !== report.numTotalTests ||
        assertions.passed !== report.numPassedTests || assertions.pending !== report.numPendingTests || assertions.todo !== report.numTodoTests) throw new Error(`${label}: contagens divergentes`);
      covered.push(...actual);
      batch.status = 'passed';
      await save();
      console.log(`${label}: ${files.length} suítes; ${covered.length}/${discovered.length}`);
    }
    if (covered.length !== keys.length || new Set(covered).size !== keys.length || totals.numTotalTests === 0) throw new Error('Cobertura final divergente ou nenhum teste contabilizado');
    manifest.status = 'passed';
    manifest.totals = totals;
  } catch (error) {
    manifest.status = 'failed';
    manifest.error = error.message;
  }
  manifest.finishedAt = new Date().toISOString();
  await save();
  console.log(JSON.stringify({ ...manifest.totals, status: manifest.status, evidence: directory, error: manifest.error }));
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) { console.error('Este gate não aceita filtros ou argumentos'); process.exitCode = 1; }
  else runJestBatches().then(result => { process.exitCode = result.status === 'passed' ? 0 : 1; }).catch(error => { console.error(error); process.exitCode = 1; });
}

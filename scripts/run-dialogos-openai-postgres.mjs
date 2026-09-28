import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [pgBin, ...args] = process.argv.slice(2);
if (!pgBin || !fs.existsSync(path.join(pgBin, 'initdb.exe'))) throw Error('Informe os binários PostgreSQL locais.');
const server = net.createServer();
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(55444, '127.0.0.1', resolve); });
await new Promise(resolve => server.close(resolve));
const run = path.join(repo, 'test-evidence', `dialogos-${Date.now()}`); fs.mkdirSync(run, { recursive: true });
const data = path.join(run, 'data'), url = 'postgresql://lead_test@127.0.0.1:55444/dialogos_ia_check';
const env = { ...process.env, DATABASE_URL: url, NODE_ENV: 'test', LOG_LEVEL: 'fatal' };
function cmd(exe, parametros, label, timeout = 180000, aceitarFalha = false) {
  const fd = fs.openSync(path.join(run, `${label}.log`), 'w'); let result;
  try { result = spawnSync(exe, parametros, { cwd: repo, env, windowsHide: true, timeout, stdio: ['ignore', fd, fd] }); }
  finally { fs.closeSync(fd); }
  if (result.error || !aceitarFalha && result.status !== 0) throw Error(`${label} falhou. Evidência em ${run}`);
  return result.status;
}
let started = false;
console.log(`Evidência: ${run}`);
try {
  cmd(path.join(pgBin, 'initdb.exe'), ['-D', data, '-U', 'lead_test', '-A', 'trust', '--encoding=UTF8', '--no-locale'], 'initdb');
  cmd(path.join(pgBin, 'pg_ctl.exe'), ['-D', data, '-l', path.join(run, 'postgres.log'), '-o', '-h 127.0.0.1 -p 55444', '-w', 'start'], 'start'); started = true;
  cmd(path.join(pgBin, 'createdb.exe'), ['-h', '127.0.0.1', '-p', '55444', '-U', 'lead_test', 'dialogos_ia_check'], 'createdb');
  cmd(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'], 'migrations');
  process.exitCode = cmd(process.execPath, ['apps/api/scripts/eval-dialogos-leads-postgres.mjs', `--db=${url}`, `--saida=${run}`, ...args], 'avaliacao', 1800000, true);
  console.log(fs.readFileSync(path.join(run, 'avaliacao.log'), 'utf8'));
} finally { if (started) cmd(path.join(pgBin, 'pg_ctl.exe'), ['-D', data, '-m', 'fast', '-w', 'stop'], 'stop'); }

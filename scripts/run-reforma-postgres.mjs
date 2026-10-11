import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pgBin = process.argv[2];
if (!pgBin || !fs.existsSync(path.join(pgBin, 'initdb.exe'))) throw Error('Informe o diretório de binários PostgreSQL de teste.');
const run = path.join(repo, 'test-evidence', `reforma-postgres-${Date.now()}`);
fs.mkdirSync(run, { recursive: true });
const data = path.join(run, 'data');
const server = net.createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port; await new Promise(r => server.close(r));
function cmd(exe, args, label, options = {}) {
  const log = path.join(run, `${label}.log`);
  const fd = fs.openSync(log, 'w');
  let out;
  try { out = spawnSync(exe, args, { windowsHide: true, encoding: 'utf8', cwd: repo, timeout: 60000, ...options, stdio: ['ignore', fd, fd] }); }
  finally { fs.closeSync(fd); }
  const output = fs.readFileSync(log, 'utf8');
  if (out.status !== 0) throw Error(`${label} falhou: ${output} ${out.error || ''}`);
  return output;
}
let started = false;
try {
  cmd(path.join(pgBin, 'initdb.exe'), ['-D', data, '-U', 'reforma_test', '-A', 'trust', '--encoding=UTF8', '--no-locale'], 'initdb');
  started = true;
  cmd(path.join(pgBin, 'pg_ctl.exe'), ['-D', data, '-l', path.join(run, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'], 'start');
  cmd(path.join(pgBin, 'createdb.exe'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'reforma_test', 'reforma_check'], 'createdb');
  const url = `postgresql://reforma_test@127.0.0.1:${port}/reforma_check`;
  const env = { ...process.env, DATABASE_URL: url, NODE_ENV: 'test' };
  cmd(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'], 'migrations', { env });
  // Cliente de teste isolado: não troca o Prisma usado por outros checkouts/processos.
  const schema = fs.readFileSync(path.join(repo, 'apps/api/prisma/schema.prisma'), 'utf8').replace('provider = "prisma-client-js"', 'provider = "prisma-client-js"\n  output = "./client"');
  fs.writeFileSync(path.join(run, 'schema.prisma'), schema);
  cmd(process.execPath, ['node_modules/prisma/build/index.js', 'generate', '--schema', path.join(run, 'schema.prisma')], 'generate', { env });
  const result = cmd(process.execPath, ['apps/api/scripts/verify-reforma-postgres.mjs', url, path.join(run, 'client')], 'checks', { env });
  fs.writeFileSync(path.join(run, 'summary.json'), JSON.stringify({ passed: true, result }, null, 2));
  console.log(result + '\nEvidência: ' + run);
} finally { if (started) cmd(path.join(pgBin, 'pg_ctl.exe'), ['-D', data, '-m', 'fast', '-w', 'stop'], 'stop'); }

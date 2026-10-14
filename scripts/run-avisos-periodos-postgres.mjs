import { PrismaClient } from "@prisma/client";
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pgBin = process.argv[2];
if (!pgBin || !fs.existsSync(path.join(pgBin, 'initdb.exe'))) throw Error('Informe o diretório de binários PostgreSQL de teste.');
const run = path.join(repo, 'test-evidence', `avisos-periodos-postgres-${Date.now()}`);
fs.mkdirSync(run, { recursive: true });
const data = path.join(run, 'data');
const server = net.createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port; await new Promise(r => server.close(r));
function cmd(exe, args, label, options = {}) {
  // PostgreSQL herda handles no Windows; pipes mantêm spawnSync aberto após pg_ctl sair.
  const logfile = path.join(run, `${label}.log`);
  const fd = fs.openSync(logfile, 'w');
  let out;
  try { out = spawnSync(exe, args, { windowsHide: true, cwd: repo, timeout: 60000, ...options, stdio: ['ignore', fd, fd] }); }
  finally { fs.closeSync(fd); }
  const result = fs.readFileSync(logfile, 'utf8');
  if (out.status !== 0) throw Error(`${label} falhou (exit=${out.status}, signal=${out.signal || '-'}): ${result} ${out.error?.message || ''}`);
  return result;
}
let started = false;
let failure = null;
let result = null;
try {
  cmd(path.join(pgBin, 'pg_ctl.exe'), ['--version'], 'preflight');
  cmd(path.join(pgBin, 'initdb.exe'), ['-D', data, '-U', 'avisos_test', '-A', 'trust', '--encoding=UTF8', '--no-locale'], 'initdb');
  cmd(path.join(pgBin, 'pg_ctl.exe'), ['-D', data, '-l', path.join(run, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'], 'start'); started = true;
  const admin = new PrismaClient({ datasources: { db: { url: `postgresql://avisos_test@127.0.0.1:${port}/postgres` } } });
  try { await admin.$executeRawUnsafe('CREATE DATABASE avisos_check'); } finally { await admin.$disconnect(); }
  const url = `postgresql://avisos_test@127.0.0.1:${port}/avisos_check`;
  const env = { ...process.env, DATABASE_URL: url, NODE_ENV: 'test' };
  cmd(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'], 'migrations', { env });
  // Cliente de teste isolado: não troca o Prisma usado por outros checkouts/processos.
  const schema = fs.readFileSync(path.join(repo, 'apps/api/prisma/schema.prisma'), 'utf8').replace('provider = "prisma-client-js"', 'provider = "prisma-client-js"\n  output = "./client"');
  fs.writeFileSync(path.join(run, 'schema.prisma'), schema);
  cmd(process.execPath, ['node_modules/prisma/build/index.js', 'generate', '--schema', path.join(run, 'schema.prisma')], 'generate', { env });
  result = cmd(process.execPath, ['apps/api/scripts/verify-avisos-periodos-postgres.mjs', url, path.join(run, 'client')], 'checks', { env });
} catch (err) {
  failure = err;
} finally {
  if (started) {
    try { cmd(path.join(pgBin, 'pg_ctl.exe'), ['-D', data, '-m', 'fast', '-w', 'stop'], 'stop'); }
    catch (err) { failure = failure ? new AggregateError([failure, err], 'O ensaio e o encerramento falharam; consulte os dois erros.') : err; }
  }
  fs.writeFileSync(path.join(run, 'summary.json'), JSON.stringify({
    passed: !failure, result, encerramentoConfirmado: started && !failure,
    erros: failure ? (failure.errors || [failure]).map(e => e.message) : [],
  }, null, 2));
}
if (failure) throw failure;
console.log(result + '\nEvidência: ' + run);

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pgBin = process.argv[2];
if (!pgBin || !fs.existsSync(path.join(pgBin, 'initdb.exe'))) throw Error('Informe os binários PostgreSQL locais.');
const pasta = path.join(repo, '.local', `guias-whatsapp-dev-${Date.now()}`);
fs.mkdirSync(pasta, { recursive: true });
const data = path.join(pasta, 'data');
const socket = net.createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r)); const port = socket.address().port; await new Promise(r => socket.close(r));
function run(exe, args, nome, env = {}) {
  const arquivo = path.join(pasta, `${nome}.log`);
  const fd = fs.openSync(arquivo, 'w');
  let r;
  try { r = spawnSync(exe, args, { cwd: repo, windowsHide: true, stdio: ['ignore', fd, fd], timeout: 180000, env: { ...process.env, ...env } }); }
  finally { fs.closeSync(fd); }
  if (r.error) fs.appendFileSync(arquivo, r.error.message);
  if (r.status !== 0) throw Error(`${nome} falhou; consulte ${path.join(pasta, `${nome}.log`)}`);
  return fs.readFileSync(arquivo, 'utf8');
}
let iniciou = false;
try {
  run(path.join(pgBin, 'initdb.exe'), ['-D', data, '-U', 'dev_check', '-A', 'trust', '--encoding=UTF8', '--no-locale'], 'initdb');
  run(path.join(pgBin, 'pg_ctl.exe'), ['-D', data, '-l', path.join(pasta, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'], 'start'); iniciou = true;
  run(path.join(pgBin, 'createdb.exe'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'dev_check', 'guias_whatsapp_check'], 'createdb');
  const env = { DATABASE_URL: `postgresql://dev_check@127.0.0.1:${port}/guias_whatsapp_check`, NODE_ENV: 'test', INTEGRACAO_WHATSAPP: '0', LOG_LEVEL: 'fatal' };
  run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'], 'migrations', env);
  const resultado = run(process.execPath, ['apps/api/scripts/verify-fluxo-guias-whatsapp-dev.mjs'], 'checks', env);
  console.log(resultado); console.log(`Evidência: ${pasta}`);
} finally { if (iniciou) run(path.join(pgBin, 'pg_ctl.exe'), ['-D', data, '-m', 'fast', '-w', 'stop'], 'stop'); }

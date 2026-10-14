import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pg = process.argv[2];
if (!pg || !fs.existsSync(path.join(pg, 'initdb.exe'))) throw Error('Informe os binários PostgreSQL locais.');
const run = path.join(repo, '.local', `cnpj-postgres-${Date.now()}`);
fs.mkdirSync(run, { recursive: true });
const data = path.join(run, 'data');
const socket = net.createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r));
const port = socket.address().port; await new Promise(r => socket.close(r));
function cmd(exe, args, label, extra = {}) {
  const log = path.join(run, `${label}.log`), fd = fs.openSync(log, 'w');
  let out;
  try { out = spawnSync(exe, args, { cwd: repo, windowsHide: true, timeout: 60000, ...extra, stdio: ['ignore', fd, fd] }); }
  finally { fs.closeSync(fd); }
  if (out.status !== 0) throw Error(`${label}: ${fs.readFileSync(log, 'utf8')}`);
  return fs.readFileSync(log, 'utf8');
}
let started = false;
try {
  cmd(path.join(pg, 'initdb.exe'), ['-D', data, '-U', 'cnpj_test', '-A', 'trust', '--encoding=UTF8', '--no-locale'], 'init');
  started = true;
  cmd(path.join(pg, 'pg_ctl.exe'), ['-D', data, '-l', path.join(run, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'], 'start');
  const conexao = ['-h','127.0.0.1','-p',String(port),'-U','cnpj_test'];
  cmd(path.join(pg, 'createdb.exe'), [...conexao,'cnpj_check'], 'createdb');
  cmd(path.join(pg, 'psql.exe'), [...conexao,'-d','cnpj_check','-v','ON_ERROR_STOP=1','-f','apps/api/prisma/migrations/20261013210000_consulta_cnpj_cache_orcamento/migration.sql'], 'migration');
  const url = `postgresql://cnpj_test@127.0.0.1:${port}/cnpj_check`;
  const result = cmd(process.execPath, ['apps/api/scripts/verify-cnpj-postgres.mjs',url], 'checks', { env: { ...process.env, DATABASE_URL: url, NODE_ENV: 'test' } });
  console.log(result + '\nEvidência: ' + run);
} finally { if (started) cmd(path.join(pg,'pg_ctl.exe'),['-D',data,'-m','fast','-w','stop'],'stop'); }

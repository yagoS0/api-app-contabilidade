import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pgBin = process.argv[2];
if (!pgBin || !fs.existsSync(path.join(pgBin, 'initdb.exe'))) throw Error('Informe os binários PostgreSQL locais de teste.');
const run = path.join(repo, 'test-evidence', 'implantacao-pg-' + Date.now());
fs.mkdirSync(run, { recursive: true });
const data = path.join(run, 'data');
const socket = net.createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r)); const port = socket.address().port; await new Promise(r => socket.close(r));
const url = `postgresql://implantacao_test@127.0.0.1:${port}/implantacao_check`;
const env = { ...process.env, DATABASE_URL: url, NODE_ENV: 'test' };
function cmd(exe, args, nome, timeout = 60000) {
  console.log(nome);
  const arquivo = path.join(run, nome + '.log');
  const fd = fs.openSync(arquivo, 'w');
  let r;
  try { r = spawnSync(exe, args, { cwd: repo, env, windowsHide: true, stdio: ['ignore', fd, fd], timeout }); }
  finally { fs.closeSync(fd); }
  if (r.status !== 0 || r.error) throw Error(`${nome} falhou. Confira ${run}: ${r.error?.message || ''}`);
  return fs.readFileSync(arquivo, 'utf8');
}
let started = false;
try {
  cmd(path.join(pgBin, 'initdb.exe'), ['-D', data, '-U', 'implantacao_test', '-A', 'trust', '--encoding=UTF8', '--no-locale'], 'initdb');
  cmd(path.join(pgBin, 'pg_ctl.exe'), ['-D', data, '-l', path.join(run, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'], 'start'); started = true;
  cmd(process.execPath, ['--input-type=module', '-e', "import { PrismaClient } from '@prisma/client'; const d = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL.replace('/implantacao_check', '/postgres') } } }); try { await d.$executeRawUnsafe('CREATE DATABASE implantacao_check'); } finally { await d.$disconnect(); }"], 'createdb');
  cmd(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'], 'migrations', 180000);
  // Cliente gerado exclusivamente para este teste: não altera o node_modules compartilhado.
  const clientPath = path.join(run, 'client');
  const schema = fs.readFileSync(path.join(repo, 'apps/api/prisma/schema.prisma'), 'utf8').replace('generator client {', `generator client {\n  output = ${JSON.stringify(clientPath.replaceAll('\\', '/'))}`);
  const schemaPath = path.join(run, 'schema.prisma'); fs.writeFileSync(schemaPath, schema);
  cmd(process.execPath, ['node_modules/prisma/build/index.js', 'generate', '--schema', schemaPath], 'generate', 120000);
  const checks = cmd(process.execPath, ['apps/api/scripts/verify-implantacao-postgres.mjs', url, path.join(clientPath, 'index.js')], 'checks');
  fs.writeFileSync(path.join(run, 'summary.json'), JSON.stringify({ passed: true, checks }, null, 2));
  console.log(checks + '\nEvidência: ' + run);
} finally {
  if (started) cmd(path.join(pgBin, 'pg_ctl.exe'), ['-D', data, '-m', 'fast', '-w', 'stop'], 'stop');
}

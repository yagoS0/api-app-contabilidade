// Ensaio local isolado; não utiliza banco, credenciais ou transportes de produção.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pgBin = process.argv[2];
if (!pgBin || !fs.existsSync(path.join(pgBin, 'initdb.exe'))) throw Error('Informe os binários PostgreSQL locais.');
const run = path.join(repo, 'test-evidence', `revisao-produto-pg-${Date.now()}`);
fs.mkdirSync(run, { recursive: true });
const data = path.join(run, 'data');
const socket = net.createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const url = `postgresql://revisao_test@127.0.0.1:${port}/revisao_produto_check`;
const env = { ...process.env, DATABASE_URL: url, NODE_ENV: 'test', LOG_LEVEL: 'fatal',
  DOTENV_CONFIG_PATH: path.join(run, 'sem-env'), INTEGRACAO_WHATSAPP: '0', INTEGRACAO_IA_COMERCIAL: '0' };
function cmd(exe, args, name, timeout = 60000) {
  console.log(name);
  const output = path.join(run, `${name}.log`), fd = fs.openSync(output, 'w');
  let result;
  try { result = spawnSync(exe, args, { cwd: repo, env, windowsHide: true, stdio: ['ignore', fd, fd], timeout }); }
  finally { fs.closeSync(fd); }
  if (result.status !== 0 || result.error) throw Error(`${name} falhou. Evidência: ${output}`);
  return fs.readFileSync(output, 'utf8');
}
let started = false;
try {
  cmd(path.join(pgBin, 'initdb.exe'), ['-D', data, '-U', 'revisao_test', '-A', 'trust', '--encoding=UTF8', '--no-locale'], 'initdb', 180000);
  cmd(path.join(pgBin, 'pg_ctl.exe'), ['-D', data, '-l', path.join(run, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'], 'start');
  started = true;
  cmd(path.join(pgBin, 'createdb.exe'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'revisao_test', 'revisao_produto_check'], 'createdb');
  cmd(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'], 'migrations', 180000);
  const checks = cmd(process.execPath, ['apps/api/scripts/verify-fluxo-guias-whatsapp-dev.mjs'], 'fluxo-guias', 180000);
  fs.writeFileSync(path.join(run, 'summary.json'), JSON.stringify({ passed: true, database: 'local descartável', checks, externalTransport: 'simulado' }, null, 2));
  console.log(checks + '\nEvidências: ' + run);
} finally {
  if (started) cmd(path.join(pgBin, 'pg_ctl.exe'), ['-D', data, '-m', 'fast', '-w', 'stop'], 'stop');
}

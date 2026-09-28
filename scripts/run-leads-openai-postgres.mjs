import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pgBin = process.argv[2];
if (!pgBin || !fs.existsSync(path.join(pgBin, 'initdb.exe'))) throw Error('Informe os binários locais do PostgreSQL.');
const port = 55443;
// Se a porta estiver em uso, aborta. Nunca conectar nem parar um banco já existente.
const server = net.createServer(); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); await new Promise(resolve => server.close(resolve));
const run = path.join(repo, 'test-evidence', `leads-postgres-${Date.now()}`); fs.mkdirSync(run, { recursive: true });
const data = path.join(run, 'data');
const url = `postgresql://lead_test@127.0.0.1:${port}/comunicacao_v2_check`;
const env = { ...process.env, DATABASE_URL: url, NODE_ENV: 'test', IA_LEADS_OPENAI: '0', INTEGRACAO_IA_COMERCIAL: '0', INTEGRACAO_WHATSAPP: '0', INTEGRACAO_FISCAL_LEADS: '0', LOG_LEVEL: 'fatal' };
function cmd(exe, args, label) {
  const logPath = path.join(run, `${label}.log`), fd = fs.openSync(logPath, 'w');
  let out;
  // Arquivo em vez de pipe: o servidor iniciado pelo pg_ctl não pode manter
  // stdout herdado aberto e prender o runner depois de ficar pronto.
  try { out = spawnSync(exe, args, { windowsHide: true, cwd: repo, env, timeout: 180000, stdio: ['ignore', fd, fd] }); }
  finally { fs.closeSync(fd); }
  if (out.error) fs.appendFileSync(logPath, out.error.message);
  if (out.status !== 0 || out.error) throw Error(`${label} falhou. Confira ${logPath}`);
  return fs.readFileSync(logPath, 'utf8');
}
let started = false;
try {
  cmd(path.join(pgBin, 'initdb.exe'), ['-D', data, '-U', 'lead_test', '-A', 'trust', '--encoding=UTF8', '--no-locale'], 'initdb');
  cmd(path.join(pgBin, 'pg_ctl.exe'), ['-D', data, '-l', path.join(run, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'], 'start'); started = true;
  cmd(path.join(pgBin, 'createdb.exe'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'lead_test', 'comunicacao_v2_check'], 'createdb');
  cmd(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'], 'migrations');
  for (const [script, args, label] of [
    ['verify-lead-entry-postgres.js', [], 'principal'],
    ['verify-lead-entry-postgres.js', ['--commercial'], 'comercial'],
    ['verify-leads-openai-postgres.mjs', [], 'openai-simulada'],
  ]) console.log(cmd(process.execPath, [`apps/api/scripts/${script}`, url, ...args], label));
  fs.writeFileSync(path.join(run, 'summary.json'), JSON.stringify({ passou: true, suites: ['principal', 'comercial', 'openai-simulada'], redeExterna: false }, null, 2));
  console.log(`Evidência: ${run}`);
} finally {
  if (started) cmd(path.join(pgBin, 'pg_ctl.exe'), ['-D', data, '-m', 'fast', '-w', 'stop'], 'stop');
}

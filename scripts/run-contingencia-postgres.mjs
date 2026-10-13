import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pgBin = process.argv[2];
if (!pgBin || !fs.existsSync(path.join(pgBin, "initdb.exe"))) throw Error("Informe o diretório de binários PostgreSQL de teste.");
const run = path.join(repo, "test-evidence", "contingencia-" + Date.now()); fs.mkdirSync(run, { recursive: true });
const data = path.join(run, "data");
const server = net.createServer(); await new Promise(r => server.listen(0, "127.0.0.1", r)); const port = server.address().port; await new Promise(r => server.close(r));
function cmd(exe, args, label, options = {}) {
  const file = path.join(run, label + '.log'), fd = fs.openSync(file, 'w');
  let out;
  try { out = spawnSync(exe, args, { windowsHide: true, cwd: repo, timeout: 180000, ...options, stdio: ['ignore', fd, fd] }); }
  finally { fs.closeSync(fd); }
  const output = fs.readFileSync(file, 'utf8');
  if (out.status !== 0 || out.error) throw Error(`${label} falhou: ${output} ${out.error || ''}`);
  return output;
}
let started = false;
try {
  cmd(path.join(pgBin, "initdb.exe"), ["-D", data, "-U", "lead_test", "-A", "trust", "--encoding=UTF8", "--no-locale"], "initdb");
  cmd(path.join(pgBin, "pg_ctl.exe"), ["-D", data, "-l", path.join(run, "postgres.log"), "-o", `-h 127.0.0.1 -p ${port}`, "-w", "start"], "start"); started = true;
  cmd(path.join(pgBin, "createdb.exe"), ["-h", "127.0.0.1", "-p", String(port), "-U", "lead_test", "contingencia_check"], "createdb");
  const migrations = path.join(repo, "apps/api/prisma/migrations");
  const files = fs.readdirSync(migrations).sort().map(n => path.join(migrations, n, "migration.sql")).filter(f => fs.existsSync(f));
  fs.writeFileSync(path.join(run, "migrations.sql"), files.map(f => fs.readFileSync(f, "utf8")).join("\n"));
  const url = `postgresql://lead_test@127.0.0.1:${port}/contingencia_check`;
  cmd(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "apps/api/prisma/schema.prisma"], "migrations", { env: { ...process.env, DATABASE_URL: url } });
  const verificador = 'apps/api/scripts/verify-contingencia-postgres.js';
  const result = cmd(process.execPath, [verificador, url], "checks", { timeout: 60000, env: { ...process.env, DATABASE_URL: url, NODE_ENV: "test", INTEGRACAO_IA_COMERCIAL: "0", INTEGRACAO_FISCAL_LEADS: "0", INTEGRACAO_WHATSAPP: "0" } });
  fs.writeFileSync(path.join(run, "summary.json"), JSON.stringify({ passed: true, migrations: files.length, checks: result, run }, null, 2));
  process.stdout.write(result + "\nEvidência: " + run + "\n");
} finally {
  if (started) cmd(path.join(pgBin, "pg_ctl.exe"), ["-D", data, "-m", "fast", "-w", "stop"], "stop");
}



import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(root, 'apps/api/package.json'), 'utf8'));
const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8');
const railway = readFileSync(resolve(root, 'railway.toml'), 'utf8');
const server = readFileSync(resolve(root, 'apps/api/src/server.js'), 'utf8');

test('boot não importa nem executa o backfill de provisões históricas', () => {
  assert.doesNotMatch(server, /GuideToProvisionBackfill|backfillProvisionsFromExistingGuides/);
});

test('boot e lifecycle não executam migrações; comando explícito preservado', () => {
  assert.equal(pkg.scripts['start:prod'], 'npm run prisma:generate && node --openssl-legacy-provider src/server.js');
  assert.equal(pkg.scripts['prisma:generate'], 'prisma generate');
  for (const name of ['prestart:prod', 'poststart:prod', 'preprisma:generate', 'postprisma:generate']) {
    assert.equal(pkg.scripts[name], undefined, `Revisar efeito adicional em ${name}`);
  }
  assert.equal(pkg.scripts['prisma:migrate:deploy'], 'prisma migrate deploy --schema prisma/schema.prisma');
  assert.equal(pkg.scripts['prisma:migrate:status'], 'prisma migrate status --schema prisma/schema.prisma');
});

test('boot e restart com PostgreSQL 16 mantêm guia elegível sem provisão automática', {
  skip: process.env.ALTAN_TEST_DOCKER !== '1', timeout: 300000,
}, async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const network = `altan-boot-isolated-${suffix}`;
  const db = `altan-boot-db-${suffix}`;
  const api = `altan-boot-api-${suffix}`;
  const setup = `altan-boot-setup-${suffix}`;
  const image = 'altan-boot-test:ci';
  const url = 'postgresql://synthetic:synthetic@boot-postgres:5432/boot_governance_test';
  const docker = args => spawnSync('docker', args, { encoding: 'utf8', timeout: 150000 });
  const ok = args => {
    const r = docker(args);
    assert.equal(r.status, 0, `${args[0]}: ${r.error?.message || r.stderr || r.stdout}`);
    return r.stdout.trim();
  };
  const env = [
    '-e', `DATABASE_URL=${url}`, '-e', 'NODE_ENV=production', '-e', 'PORT=3000',
    '-e', 'ALTAN_BOOT_FIXTURE=1',
    '-e', 'CERT_SECRET_KEY=synthetic-only-boot-test-key-0000000000000000',
    '-e', 'JWT_SECRET=synthetic-only-boot-test-jwt-0000000000000000',
    ...['INTEGRACAO_WHATSAPP', 'SERPRO_PGDASD_WORKER_ENABLED', 'SERPRO_DCTFWEB_WORKER_ENABLED',
      'SERPRO_PAYMENT_CONFIRMATION_WORKER_ENABLED', 'CONFERENCIA_ADN_WORKER_ENABLED',
      'SIMPLES_COLETA_CALCULO_WORKER_ENABLED', 'SIMPLES_ENVIO_GUIAS_WORKER_ENABLED'].flatMap(k => ['-e', `${k}=0`]),
  ];
  const verify = () => ok(['exec', '-w', '/app/apps/api', api, 'node', 'scripts/boot-provisoes-fixture.mjs', 'verify']);
  const health = async () => {
    for (let i = 0; i < 50; i++) {
      const r = docker(['exec', api, 'node', '-e',
        "fetch('http://127.0.0.1:3000/healthz').then(async r=>{if(r.status!==200||(await r.text())!=='ok')process.exit(1)}).catch(()=>process.exit(1))"]);
      if (r.status === 0) return;
      await delay(1000);
    }
    assert.fail(`Healthcheck indisponível: ${docker(['logs', '--tail', '30', api]).stdout}`);
  };
  try {
    // Sem portas publicadas e sem rota externa; nenhum recurso ou dado existente é usado.
    ok(['network', 'create', '--internal', network]);
    assert.equal(ok(['network', 'inspect', '--format', '{{.Internal}}', network]), 'true');
    ok(['run', '-d', '--name', db, '--network', network, '--network-alias', 'boot-postgres',
      '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_USER=synthetic',
      '-e', 'POSTGRES_PASSWORD=synthetic', '-e', 'POSTGRES_DB=boot_governance_test', 'postgres:16']);
    let ready = false;
    for (let i = 0; i < 30; i++) {
      if (docker(['exec', db, 'pg_isready', '-U', 'synthetic', '-d', 'boot_governance_test']).status === 0) { ready = true; break; }
      await delay(1000);
    }
    assert.equal(ready, true, 'PostgreSQL descartável não iniciou');
    ok(['run', '--name', setup, '--network', network, ...env, '-w', '/app/apps/api', image, 'sh', '-c',
      'npm run prisma:generate && npm run prisma:migrate:deploy && node scripts/boot-provisoes-fixture.mjs prepare']);
    ok(['run', '-d', '--name', api, '--network', network, ...env, image]);
    await health();
    await delay(3000);
    verify();
    ok(['restart', '--time', '2', api]);
    await health();
    await delay(3000);
    verify();
    const logs = docker(['logs', api]);
    assert.doesNotMatch(`${logs.stdout}\n${logs.stderr}`, /Backfill GuideToProvision/);
  } finally {
    // Somente containers/rede sintéticos criados por este teste; nunca worktrees ou bancos existentes.
    for (const name of [api, setup, db]) docker(['rm', '-f', name]);
    docker(['network', 'rm', network]);
  }
});

test('imagem e Railway continuam usando o boot separado e /healthz', () => {
  assert.match(dockerfile, /CMD \["npm", "run", "start:prod", "-w", "@contabilidade\/api"\]/);
  assert.doesNotMatch(dockerfile, /prisma\s+(?:migrate|db\s+push)/);
  assert.match(railway, /healthcheckPath\s*=\s*"\/healthz"/);
  assert.doesNotMatch(railway, /(?:preDeployCommand|startCommand)\s*=/);
});

// O job CI constrói o Dockerfile real. Não utiliza Docker/DB do ambiente produtivo.
test('imagem real inicia e reinicia sem banco, sem migração e sem rede externa', {
  skip: process.env.ALTAN_TEST_DOCKER !== '1', timeout: 240000,
}, async () => {
  const name = `altan-boot-test-${process.pid}`;
  const image = 'altan-boot-test:ci';
  const docker = args => spawnSync('docker', args, { encoding: 'utf8', timeout: 30000 });
  const ok = args => {
    const result = docker(args);
    assert.equal(result.status, 0, `${args[0]}: ${result.error?.message || result.stderr}`);
    return result.stdout.trim();
  };
  const health = async () => {
    for (let i = 0; i < 50; i++) {
      const result = docker(['exec', name, 'node', '-e',
        "fetch('http://127.0.0.1:3000/healthz').then(async r=>{if(r.status!==200||(await r.text())!=='ok')process.exit(1)}).catch(()=>process.exit(1))"]);
      if (result.status === 0) return;
      await delay(1000);
    }
    assert.fail(`API não respondeu /healthz. Logs sintéticos: ${docker(['logs', '--tail', '40', name]).stdout}`);
  };
  try {
    ok(['run', '-d', '--name', name, '--network', 'none',
      '-e', 'NODE_ENV=production', '-e', 'PORT=3000',
      '-e', 'DATABASE_URL=postgresql://synthetic:synthetic@127.0.0.1:1/absent?connect_timeout=1',
      '-e', 'CERT_SECRET_KEY=synthetic-only-boot-test-key-0000000000000000',
      '-e', 'JWT_SECRET=synthetic-only-boot-test-jwt-0000000000000000',
      '-e', 'INTEGRACAO_WHATSAPP=0', '-e', 'SERPRO_PGDASD_WORKER_ENABLED=0',
      '-e', 'SERPRO_DCTFWEB_WORKER_ENABLED=0', '-e', 'SERPRO_PAYMENT_CONFIRMATION_WORKER_ENABLED=0',
      '-e', 'CONFERENCIA_ADN_WORKER_ENABLED=0', '-e', 'SIMPLES_COLETA_CALCULO_WORKER_ENABLED=0',
      '-e', 'SIMPLES_ENVIO_GUIAS_WORKER_ENABLED=0', image]);
    assert.equal(ok(['inspect', '--format', '{{.HostConfig.NetworkMode}}', name]), 'none');
    await health();
    ok(['restart', '--time', '2', name]);
    await health();
    // Nenhum banco existe: migrate deploy impediria o servidor de alcançar o healthcheck.
    assert.equal(ok(['inspect', '--format', '{{.State.Running}}', name]), 'true');
  } finally {
    docker(['rm', '-f', name]); // Exclusivamente o container sintético criado neste teste.
  }
});

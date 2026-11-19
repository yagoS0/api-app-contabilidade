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

test('boot e lifecycle não executam migrações; comando explícito preservado', () => {
  assert.equal(pkg.scripts['start:prod'], 'npm run prisma:generate && node --openssl-legacy-provider src/server.js');
  assert.equal(pkg.scripts['prisma:generate'], 'prisma generate');
  for (const name of ['prestart:prod', 'poststart:prod', 'preprisma:generate', 'postprisma:generate']) {
    assert.equal(pkg.scripts[name], undefined, `Revisar efeito adicional em ${name}`);
  }
  assert.equal(pkg.scripts['prisma:migrate:deploy'], 'prisma migrate deploy --schema prisma/schema.prisma');
  assert.equal(pkg.scripts['prisma:migrate:status'], 'prisma migrate status --schema prisma/schema.prisma');
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

import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import { bloquearFechamentoContabil } from '../src/application/accounting/fechamentoContabil.js';

function disposableDatabase() {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.equal(url.pathname, '/altan_piloto_governance_test');
  for (const key of url.searchParams.keys()) {
    assert.ok(['schema', 'connection_limit', 'pool_timeout'].includes(key), 'Parâmetro não permitido: ' + key);
  }
  url.searchParams.set('connection_limit', '1');
  return url.href;
}

function signal() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function pid(tx) {
  const [row] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
  return row.pid;
}

async function waitForBlock(observer, ownerPid, waiterPid) {
  const deadline = Date.now() + 10000;
  do {
    const [row] = await observer.$queryRaw`
      SELECT pg_backend_pid() AS observer, ${ownerPid}::int = ANY(pg_blocking_pids(${waiterPid}::int)) AS blocked
    `;
    assert.equal(new Set([ownerPid, waiterPid, row.observer]).size, 3);
    if (row.blocked) return;
    await delay(15);
  } while (Date.now() < deadline);
  assert.fail('O PostgreSQL não confirmou o bloqueio entre as sessões esperadas.');
}

const options = { isolationLevel: 'Serializable', timeout: 25000 };
for (const outcome of ['commit', 'rollback']) {
  test('proteção do fechamento: duas sessões e ' + outcome + ' da primeira', {
    skip: process.env.ALTAN_TESTE_POSTGRES !== '1',
    timeout: 40000
  }, async () => {
    const url = disposableDatabase();
    const [owner, waiter, observer] = Array.from({ length: 3 }, () => new PrismaClient({datasources: {db: {url}}}));
    const acquired = signal();
    const started = signal();
    const release = signal();
    const rollback = new Error('rollback de teste');
    let company;
    let first;
    let second;
    try {
      company = await observer.portalClient.create({ data: {
        razao: 'Empresa sintética da coordenação de fechamento',
        cnpj: randomInt(10000000000000, 99999999999999).toString()
      } });
      first = owner.$transaction(async tx => {
        const ownerPid = await pid(tx);
        await bloquearFechamentoContabil(tx, company.id);
        acquired.resolve(ownerPid);
        await release.promise;
        if (outcome === 'rollback') throw rollback;
      }, options);
      const ownerPid = await Promise.race([acquired.promise, first]);
      second = waiter.$transaction(async tx => {
        started.resolve(await pid(tx));
        await bloquearFechamentoContabil(tx, company.id);
      }, options);
      const waiterPid = await Promise.race([started.promise, second]);
      await waitForBlock(observer, ownerPid, waiterPid);
      release.resolve();
      const [a, b] = await Promise.allSettled([first, second]);
      if (outcome === 'commit') {
        assert.equal(a.status, 'fulfilled', a.reason?.message);
        assert.equal(b.status, 'rejected');
        assert.equal(b.reason.code, 'P2034');
      } else {
        assert.equal(a.status, 'rejected');
        assert.equal(a.reason, rollback);
        assert.equal(b.status, 'fulfilled', b.reason?.message);
      }
      assert.deepEqual(await observer.portalClient.findUniqueOrThrow({ where: { id: company.id } }), company);
    } finally {
      release.resolve();
      await Promise.allSettled([first, second]);
      try {
        if (company) await observer.portalClient.delete({ where: { id: company.id } });
      } finally {
        await Promise.all([owner.$disconnect(), waiter.$disconnect(), observer.$disconnect()]);
      }
    }
  });
}

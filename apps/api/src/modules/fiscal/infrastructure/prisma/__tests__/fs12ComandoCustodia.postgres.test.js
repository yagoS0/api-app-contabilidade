import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';

// Normal Jest catalogue entry; reuse PR302 scenarios and fixtures.
// No migration, provider call or application worker is started here.
const suite = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL ? describe : describe.skip;
const apiRoot = resolve(__dirname, '../../../../../..');
const migration = '20261118000000_add_fs12_comando_custodia';
const execute = promisify(execFile);
let sql;
let raw;

suite('E2 integrated FS12 custody persistence (PostgreSQL16, synthetic only)', () => {
  beforeAll(async () => {
    raw = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
    const url = new URL(raw);
    if (process.env.NODE_ENV !== 'test' || raw !== process.env.DATABASE_URL
      || !['postgres:', 'postgresql:'].includes(url.protocol)
      || url.hostname !== '127.0.0.1' || url.port !== '54661'
      || url.pathname !== '/altan_rotinas_governance_test' || url.username !== 'altan_test'
      || url.search || url.hash) throw Error('Explicit dedicated E2 disposable database required');
    sql = new pg.Client({ connectionString: raw });
    await sql.connect();
    const { rows: [server] } = await sql.query("SELECT current_setting('server_version_num')::int AS version");
    expect(server.version).toBeGreaterThanOrEqual(160000);
    expect(server.version).toBeLessThan(170000);
  });
  afterAll(async () => { await sql?.end(); });

  test('installed migration ledger matches the versioned SQL and validated constraints', async () => {
    const { rows } = await sql.query(
      'SELECT checksum FROM _prisma_migrations WHERE migration_name=$1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL',
      [migration],
    );
    expect(rows).toHaveLength(1);
    const bytes = readFileSync(resolve(apiRoot, 'prisma/migrations', migration, 'migration.sql'));
    expect(rows[0].checksum).toBe(createHash('sha256').update(bytes).digest('hex'));
    for (const table of ['fs12_comandos', 'fs12_comando_reservas', 'fs12_comando_respostas', 'fs12_comando_calculos']) {
      const result = await sql.query('SELECT to_regclass($1)::text AS name', [`public.${table}`]);
      expect(result.rows[0].name).toBe(table);
    }
    const invalid = await sql.query("SELECT conname FROM pg_constraint WHERE conrelid IN ('fs12_comandos'::regclass,'fs12_comando_reservas'::regclass,'fs12_comando_respostas'::regclass,'fs12_comando_calculos'::regclass) AND NOT convalidated");
    expect(invalid.rows).toEqual([]);
  });

  test('generated Prisma preserves scoped chain, replay, immutability, rollback and isolation', async () => {
    const { stdout } = await execute(process.execPath, [
      '--test', resolve(apiRoot, 'scripts/fs12-b33b1-ddl/prisma-migracao.postgres.test.mjs'),
    ], {
      cwd: apiRoot,
      env: { ...process.env, ALTAN_FS12_DDL_DATABASE_URL: raw },
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 4 * 1024 * 1024,
    });
    expect(stdout).toMatch(/# tests 5\b/);
    expect(stdout).toMatch(/# pass 5\b/);
    expect(stdout).toMatch(/# fail 0\b/);
    expect(stdout).toMatch(/# skipped 0\b/);
  }, 130000);
});

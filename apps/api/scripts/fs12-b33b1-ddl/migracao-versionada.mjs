// Destructive/reset commands are deliberately absent. Requires a new, disposable PG16 database.
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { connect, fixture, calculation } from './helpers.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const schema=resolve(root,'apps/api/prisma/schema.prisma');
const migrations=resolve(root,'apps/api/prisma/migrations');
const target='20261118000000_add_fs12_comando_custodia';
const temp=resolve(root,'.altan-governance','migration-upgrade-'+randomUUID());
const db=await connect(); // Guard validates destination and server version before any migration.
const env={...process.env,DATABASE_URL:process.env.ALTAN_FS12_DDL_DATABASE_URL};
function prisma(args) {
  const result=spawnSync(process.execPath,[resolve(root,'node_modules/prisma/build/index.js'),...args],{cwd:root,env,encoding:'utf8',maxBuffer:16*1024*1024});
  process.stdout.write(result.stdout||''); process.stderr.write(result.stderr||'');
  assert.equal(result.status,0,'Prisma command failed: '+args[0]);
}
const ledger=async()=> (await db.query('SELECT id,checksum,finished_at,migration_name,rolled_back_at,started_at,applied_steps_count FROM _prisma_migrations ORDER BY migration_name,id')).rows;
try {
  const existing=await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
  assert.equal(existing.rowCount,0,'Refusing a nonempty database; create another disposable database, never reset existing data');
  const entries=await readdir(migrations,{withFileTypes:true});
  const historical=entries.filter(e=>e.isDirectory()&&e.name!==target).map(e=>e.name).sort();
  assert.ok(entries.some(e=>e.isDirectory()&&e.name===target),'Versioned migration missing');
  assert.equal(historical.length,215,'Review historical upgrade baseline explicitly when migrations change');
  await mkdir(resolve(temp,'migrations'),{recursive:true});
  await cp(schema,resolve(temp,'schema.prisma'));
  await cp(resolve(migrations,'migration_lock.toml'),resolve(temp,'migrations/migration_lock.toml'));
  for(const name of historical) await cp(resolve(migrations,name),resolve(temp,'migrations',name),{recursive:true});
  prisma(['validate','--schema',schema]);
  prisma(['generate','--schema',schema]);
  prisma(['migrate','deploy','--schema',resolve(temp,'schema.prisma')]);
  assert.equal((await ledger()).length,historical.length);
  assert.equal((await db.query("SELECT to_regclass('public.fs12_comandos') AS t")).rows[0].t,null);
  const f=await fixture(db), c=await calculation(db,f);
  const readEvidence=async()=>({
    revision:(await db.query('SELECT * FROM apuracao_fs12_revisoes WHERE id=$1',[f.revisaoId])).rows[0],
    calculation:(await db.query('SELECT * FROM apuracao_fs12_calculos WHERE id=$1',[c.id])).rows[0],
  });
  const before=await readEvidence();
  prisma(['migrate','deploy','--schema',schema]);
  const applied=await ledger();
  assert.equal(applied.length,historical.length+1);
  assert.equal(applied.filter(r=>r.migration_name===target&&r.finished_at&&!r.rolled_back_at).length,1);
  assert.deepEqual(await readEvidence(),before,'Upgrade changed prior B31/B32 evidence');
  for(const name of ['fs12_comandos','fs12_comando_reservas','fs12_comando_respostas','fs12_comando_calculos']) {
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${name}`)).rows[0].n,0,'Migration must not backfill synthetic facts');
  }
  prisma(['migrate','deploy','--schema',schema]);
  assert.deepEqual(await ledger(),applied,'Repeat deploy reapplied or changed migration history');
  assert.deepEqual(await readEvidence(),before,'Repeat deploy changed historical evidence');
  const report={baseline:historical.length,final:applied.length,migration:target,
    sha256:createHash('sha256').update(await readFile(resolve(migrations,target,'migration.sql'))).digest('hex'),
    historicalEvidencePreserved:true,noBackfill:true,repeatDeployUnchanged:true,postgresMajor:16};
  await writeFile(resolve(temp,'result.json'),JSON.stringify(report,null,2)+'\n');
  console.log('Versioned migration evidence:',JSON.stringify(report));
} finally { await db.end(); }

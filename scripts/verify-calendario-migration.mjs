// Isolated PostgreSQL migration check. Creates its own temporary cluster, never reads DATABASE_URL.
// Usage: node scripts/verify-calendario-migration.mjs [path/to/postgres/bin]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const bin=process.argv[2] || 'C:/Users/yagoa/code/.tools/postgresql16/pgsql/bin';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'altan-calendar-migration-'));
const exe=name=>path.join(bin,name+(process.platform==='win32'?'.exe':''));
const run=(file,args)=>execFileSync(file,args,{encoding:'utf8',stdio:file.includes('pg_ctl')?'ignore':'pipe',windowsHide:true,cwd:root,env:{...process.env,DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused'}});
const listener=net.createServer(); await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve)); const port=listener.address().port; await new Promise(resolve=>listener.close(resolve));
const cluster=path.join(dir,'cluster');
const schema=fs.readFileSync(path.join(root,'apps/api/prisma/schema.prisma'),'utf8').replace(/model (TarefaCalendario|CalendarioLegadoSnapshot) \{[\s\S]*?\n\}/g,'');
const oldSchema=path.join(dir,'prior.prisma'); fs.writeFileSync(oldSchema,schema);
const ddl=run(process.execPath,['node_modules/prisma/build/index.js','migrate','diff','--from-empty','--to-schema-datamodel',oldSchema,'--script']);
fs.writeFileSync(path.join(dir,'prior.sql'),ddl);
const migration=fs.readFileSync(path.join(root,'apps/api/prisma/migrations/20261015120000_calendario_unificado/migration.sql'),'utf8');
const migrationBody=migration.replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
// Refuse generation into shared/symlinked dependencies of a different checkout.
for (const location of ['node_modules','node_modules/@prisma/client']) {
  assert.equal(fs.lstatSync(path.join(root,location)).isSymbolicLink(),false,'Prisma generation requires isolated worktree dependencies');
}
run(process.execPath,['node_modules/prisma/build/index.js','generate','--schema','apps/api/prisma/schema.prisma']);
const seed=`
INSERT INTO "PortalClient" (id,razao,cnpj,"updatedAt") VALUES ('empresa','Empresa sintética','00000000000000',now());
INSERT INTO regras_obrigacao (id,nome,periodicidade,"diaVencimento",escopo,"updatedAt") VALUES ('regra','Fiscal','MENSAL',20,'TODAS',now());
INSERT INTO obrigacoes (id,"portalClientId",nome,tipo,periodicidade,"diaVencimento","regraId","updatedAt") VALUES ('fiscal','empresa','Fiscal','OBRIGACAO','MENSAL',20,'regra',now()),('manual','empresa','Manual','TAREFA','MENSAL',15,NULL,now());
INSERT INTO ocorrencias_obrigacao (id,"obrigacaoId","dataVencimento",status,"concluidaEm","updatedAt") VALUES ('oc-fiscal','fiscal','2026-01-20','CONCLUIDA','2026-01-19',now());
INSERT INTO "Guide" (id,"portalClientId",tipo,valor,"pdfBytes","paymentStatus","updatedAt") VALUES ('guia','empresa','PIS',120.55,decode('aabbcc','hex'),'PAID',now());
INSERT INTO tarefas_agenda (id,"userId",titulo,config,estados,"updatedAt") VALUES
('safe','u','Simples','{"dataInicio":"2026-01-15","dataFim":"2026-01-15","recorrencia":"MENSAL"}','{"2026-01":{"concluidaEm":"2026-01-15"}}',now()),
('complex','u','Por dia','{"dataInicio":"2026-01-15","recorrencia":"MENSAL"}','{"2026-01@2026-01-15":{"concluidaEm":"2026-01-15"}}',now());
CREATE TABLE evidence_guides AS SELECT * FROM "Guide";
CREATE TABLE evidence_occurrences AS SELECT * FROM ocorrencias_obrigacao;
CREATE TABLE evidence_personal AS SELECT * FROM tarefas_agenda;
`;
const checks=`DO $$ BEGIN
IF (SELECT ativa FROM obrigacoes WHERE id='fiscal') OR (SELECT ativa OR "aplicarANovas" FROM regras_obrigacao WHERE id='regra') THEN RAISE EXCEPTION 'fiscal generation still enabled'; END IF;
IF NOT (SELECT ativa FROM obrigacoes WHERE id='manual') THEN RAISE EXCEPTION 'manual task deactivated'; END IF;
IF (SELECT count(*) FROM calendario_legado_snapshots) <> 2 THEN RAISE EXCEPTION 'missing immutable backups'; END IF;
IF (SELECT count(*) FROM tarefas_calendario) <> 1 OR NOT EXISTS (SELECT 1 FROM tarefas_calendario WHERE id='legado:safe' AND estados->'2026-01'->>'concluidaEm'='2026-01-15') THEN RAISE EXCEPTION 'personal migration mismatch'; END IF;
IF EXISTS (SELECT * FROM "Guide" EXCEPT SELECT * FROM evidence_guides) OR EXISTS (SELECT * FROM evidence_guides EXCEPT SELECT * FROM "Guide") THEN RAISE EXCEPTION 'guide changed'; END IF;
IF EXISTS (SELECT * FROM ocorrencias_obrigacao EXCEPT SELECT * FROM evidence_occurrences) OR EXISTS (SELECT * FROM evidence_occurrences EXCEPT SELECT * FROM ocorrencias_obrigacao) THEN RAISE EXCEPTION 'occurrence changed'; END IF;
IF EXISTS (SELECT * FROM tarefas_agenda EXCEPT SELECT * FROM evidence_personal) OR EXISTS (SELECT * FROM evidence_personal EXCEPT SELECT * FROM tarefas_agenda) THEN RAISE EXCEPTION 'original personal task changed'; END IF;
END $$;`;
const restore=`
UPDATE obrigacoes o SET ativa=(s.dados->>'ativa')::boolean FROM calendario_legado_snapshots s WHERE s.id='obrigacao:'||o.id;
UPDATE regras_obrigacao r SET ativa=(s.dados->>'ativa')::boolean,"aplicarANovas"=(s.dados->>'aplicarANovas')::boolean FROM calendario_legado_snapshots s WHERE s.id='regra:'||r.id;
DO $$ BEGIN IF NOT (SELECT ativa FROM obrigacoes WHERE id='fiscal') OR NOT (SELECT ativa AND "aplicarANovas" FROM regras_obrigacao WHERE id='regra') THEN RAISE EXCEPTION 'restore failed'; END IF; END $$;
`;
let started=false, db;
try {
  run(exe('initdb'),['-D',cluster,'-U','calendar_test','-A','trust','--encoding=UTF8','--no-locale']);
  run(exe('pg_ctl'),['-D',cluster,'-l',path.join(dir,'postgres.log'),'-o',`-p ${port} -h 127.0.0.1`,'-w','start']); started=true;
  const sql=file=>run(exe('psql'),['-X','-h','127.0.0.1','-p',String(port),'-U','calendar_test','-d','postgres','-v','ON_ERROR_STOP=1','-f',file]);
  sql(path.join(dir,'prior.sql'));
  fs.writeFileSync(path.join(dir,'seed.sql'),seed); sql(path.join(dir,'seed.sql'));
  // Exercise the migration's OWN transaction, including a failure after all mutations.
  fs.writeFileSync(path.join(dir,'injected-failure.sql'),migration.replace(/^COMMIT;/m,'SELECT 1/0;\nCOMMIT;'));
  assert.throws(()=>sql(path.join(dir,'injected-failure.sql')),/division by zero/);
  const rollbackCheck="DO $$ BEGIN IF to_regclass('tarefas_calendario') IS NOT NULL OR NOT (SELECT ativa FROM obrigacoes WHERE id='fiscal') THEN RAISE EXCEPTION 'migration own transaction rollback failed'; END IF; END $$;";
  const script=rollbackCheck+'\nBEGIN;\n'+migrationBody+'\n'+checks+'\nROLLBACK;\n'+rollbackCheck+'\n'+migration+'\n'+checks+'\nBEGIN;\n'+restore+'\nROLLBACK;\n';
  fs.writeFileSync(path.join(dir,'verify.sql'),script);
  const sqlResult=sql(path.join(dir,'verify.sql'));
  // No dotenv, existing application URL or remote database is consulted.
  process.env.DATABASE_URL=`postgresql://calendar_test@127.0.0.1:${port}/postgres?schema=public`;
  const { prisma }=await import('../apps/api/src/infrastructure/db/prisma.js'); db=prisma;
  const { criarTarefaUnificada, acaoTarefaUnificada, listarTarefasUnificadas }=await import('../apps/api/src/application/calendario/TarefasUnificadasService.js');
  await db.portalClient.create({data:{id:'empresa2',razao:'Segunda sintética',cnpj:'00000000000001'}});
  const ctx={userId:'service-test-owner',portalIds:['empresa','empresa2']};
  const task=await criarTarefaUnificada({...ctx,dados:{titulo:'Teste concorrente',empresasIds:ctx.portalIds,subtarefas:[{id:'mit',titulo:'MIT'},{id:'efd',titulo:'EFD'}],config:{dataInicio:'2026-01-15',recorrencia:'MENSAL',diaVencimento:31}}},db);
  await Promise.all(ctx.portalIds.flatMap(companyId=>['mit','efd'].map(subtarefaId=>acaoTarefaUnificada({...ctx,id:task.id,dados:{acao:'SUBTAREFA',cicloChave:'2026-01',companyId,subtarefaId,concluida:true}},db))));
  const persisted=await db.tarefaCalendario.findUnique({where:{id:task.id}});
  for (const companyId of ctx.portalIds) assert.deepEqual(persisted.estados['2026-01'].empresas[companyId].subtarefas,{mit:true,efd:true});
  const listed=await listarTarefasUnificadas({...ctx,inicio:'2026-01-01',fim:'2026-03-31'},db);
  const items=listed.itens.filter(i=>i.tarefaId===task.id);
  assert.deepEqual(items.map(i=>i.dataVencimento),['2026-01-31','2026-02-28','2026-03-31']);
  assert.equal(items[0].resolvido,true); assert.equal(items[1].resolvido,false);
  await acaoTarefaUnificada({...ctx,id:task.id,dados:{acao:'REABRIR',cicloChave:'2026-01',companyId:'empresa2'}},db);
  const reopened=(await listarTarefasUnificadas({...ctx,inicio:'2026-01-30',fim:'2026-01-31'},db)).itens.find(i=>i.tarefaId===task.id);
  assert.equal(reopened.resolvido,false); assert.deepEqual(reopened.diasAlerta,['2026-01-30','2026-01-31']);
  assert.deepEqual(reopened.empresas.map(e=>e.concluida),[true,false]);
  const cleanup=fs.readFileSync(path.join(root,'apps/api/prisma/migrations/20261015220000_remove_legacy_calendar/migration.sql'),'utf8');
  const beforeCleanup=await db.tarefaCalendario.findUnique({where:{id:task.id}});
  fs.writeFileSync(path.join(dir,'cleanup-failure.sql'),cleanup.replace(/^COMMIT;/m,'SELECT 1/0;\nCOMMIT;'));
  assert.throws(()=>sql(path.join(dir,'cleanup-failure.sql')),/division by zero/);
  assert.equal(await db.obrigacao.count(),2,'failed removal rolls back deleted obligations');
  assert.equal(await db.tarefaAgenda.count(),2,'failed removal rolls back deleted personal tasks');
  fs.writeFileSync(path.join(dir,'cleanup.sql'),cleanup); sql(path.join(dir,'cleanup.sql'));
  for (const table of ['obrigacao','ocorrenciaObrigacao','regraObrigacao','regraObrigacaoExcecao','tarefaAgenda','agendaOcultacao','calendarioLegadoSnapshot']) assert.equal(await db[table].count(),0,table+' must be empty');
  assert.equal(await db.tarefaCalendario.count({where:{id:{startsWith:'legado:'}}}),0);
  assert.deepEqual(await db.tarefaCalendario.findUnique({where:{id:task.id}}),beforeCleanup,'new task and company checklist unchanged');
  await assert.rejects(db.tarefaAgenda.create({data:{userId:'old-client',titulo:'Old client',config:{}}}),/CALENDARIO_LEGADO_REMOVIDO/);
  await assert.rejects(db.obrigacao.create({data:{portalClientId:'empresa',nome:'Old worker',periodicidade:'MENSAL',diaVencimento:20}}),/CALENDARIO_LEGADO_REMOVIDO/);
  fs.writeFileSync(path.join(dir,'fiscal-preservation.sql'),`DO $$ BEGIN IF EXISTS (SELECT * FROM "Guide" EXCEPT SELECT * FROM evidence_guides) OR EXISTS (SELECT * FROM evidence_guides EXCEPT SELECT * FROM "Guide") THEN RAISE EXCEPTION 'cleanup changed guide/PDF/payment'; END IF; END $$;`); sql(path.join(dir,'fiscal-preservation.sql'));
  const summary={ok:true,postgres:'isolated temporary cluster',checks:['legacy removal committed','legacy removal own transaction rollback','seven legacy tables empty','imported legacy tasks deleted','new task and company checklist preserved','stale client and worker recreation blocked','financial guide/PDF/payment preserved after deletion','exact prior Prisma schema','migration SQL','migration own transaction rollback after injected failure','transactional DDL rollback','committed migration','immutable backup','fiscal deactivation','manual task preservation','safe personal import','complex personal preservation','guide/PDF/payment unchanged','completed occurrence unchanged','backup restore rehearsal','real Prisma service persistence','four concurrent checklist writes without loss','monthly deadline clamping through service','independent next-cycle state','company reopen preserves other company and restores alerts'],evidence:dir};
  const evidence=sqlResult+'\n'+JSON.stringify(summary,null,2)+'\n';
  fs.writeFileSync(path.join(dir,'results.log'),evidence);
  const repoEvidence=path.join(root,'test-evidence/calendario-unificado'); fs.mkdirSync(repoEvidence,{recursive:true}); fs.writeFileSync(path.join(repoEvidence,'migration-results.log'),evidence);
  console.log(JSON.stringify(summary,null,2));
} finally { if(db)await db.$disconnect(); if(started)run(exe('pg_ctl'),['-D',cluster,'-m','fast','-w','stop']); }

// Prepared acceptance: real authenticated API / PostgreSQL / runtime / HTTP
// client. Only fiscal provider replies and the explicitly synthetic seed are fake.
// Does not start/stop processes, migrate databases, retry a failed fiscal command,
// run browser actions or claim external fiscal homologation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {configuration,request,json,loopback} from './common.mjs';
const configHash=createHash('sha256').update(await fs.readFile(path.resolve(process.argv[2]))).digest('hex');
const cfg=await configuration(process.argv[2]);
const competencia=process.argv[3];
assert.ok(['2026-11','2026-12'].includes(competencia),'Explicit supported PA required');
const seed=JSON.parse(await fs.readFile(path.join(cfg.output,'seed.json'),'utf8'));
assert.equal(seed.runId,cfg.runId);
const company=seed.companies.find(c=>c.caseId==='T156.6');
assert.ok(company,'Dedicated explicit-zero synthetic case required');
const provider=JSON.parse(await fs.readFile(path.join(cfg.output,'provider.json'),'utf8'));
loopback(provider.origin);
const selfcheck=JSON.parse(await fs.readFile(path.join(cfg.output,'transport-selfcheck.json'),'utf8'));
assert.equal(selfcheck.ok,true,'Transport isolation must be verified before acceptance actions');
assert.equal(selfcheck.runId,cfg.runId);assert.equal(selfcheck.configHash,configHash);
assert.equal(selfcheck.providerOrigin,provider.origin,'Selfcheck must match this provider instance');
const {PrismaClient}=await import('@prisma/client');
const db=new PrismaClient();
const output=path.join(cfg.output,`accept-calculation-http-${competencia}-${randomUUID()}.json`);
const report={status:'RUNNING',competencia,caseId:company.caseId,portalClientId:company.id,
 limitation:'Real HTTP/API/PG chain with synthetic identity/data/provider. No browser, restart, transmission, retification or production homologation.'};
const controlHeaders={'content-type':'application/json','x-test-control':cfg.providerControlSecret};
try {
 const marker=await db.appSetting.findUnique({where:{key:'fs12_test_fixture'}});
 assert.equal(marker?.value.runId,cfg.runId);assert.equal(marker?.value.userId,seed.userId);
 // The selfcheck proves its own process only. The dedicated API must have been
 // started through reviewed run.mjs with fiscal-http-preload.mjs. Check persisted
 // transport settings independently before any confirmation/calculation action.
 const settings=await db.appSetting.findUnique({where:{key:'serpro_runtime_settings'}});
 assert.equal(settings?.value.baseUrl,provider.origin,'API settings must target this synthetic provider');
 assert.equal(settings?.value.authUrl,provider.origin+'/token');
 assert.match(settings?.value.certOriginalName||'',/^synthetic-/,'Synthetic certificate required');
 const scoped={portalClientId:company.id,competencia};
 assert.equal(await db.fs12Comando.count({where:scoped}),0,'Use a fresh case/PA; do not reuse prior effects');
 assert.equal(await db.apuracaoSnapshot.count({where:scoped}),0);
 const files=['history','simulation'].map(phase=>path.join(cfg.output,`${company.caseId}-${competencia}-${phase}-rules.json`));
 const ruleSets=await Promise.all(files.map(async file=>JSON.parse(await fs.readFile(file,'utf8'))));
 const rules=ruleSets.flatMap(r=>r.rules);
 const dispatchRules=rules.filter(r=>r.service==='TRANSDECLARACAO11');
 assert.equal(dispatchRules.length,1);assert.equal(dispatchRules[0].cnpj,company.cnpj);
 assert.equal(dispatchRules[0].indicadorTransmissao,false);
 assert.equal(String(dispatchRules[0].periodoApuracao),competencia.replace('-',''));
 assert.equal(dispatchRules[0].status,200);assert.ok(!dispatchRules[0].hold&&!dispatchRules[0].drop);
 // Control changes only the loopback synthetic provider, never application policy.
 await request(provider.origin+'/control/rules',{method:'POST',headers:controlHeaders,body:JSON.stringify({rules})});
 const callsBefore=(await request(provider.origin+'/control/calls',{headers:controlHeaders})).calls;
 const login=await request(cfg.apiUrl+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:seed.email,password:cfg.syntheticPassword})});
 assert.equal(login.user?.id,seed.userId);assert.equal(login.user?.accountType,'FIRM');assert.ok(login.accessToken);
 const headers={'content-type':'application/json',authorization:`Bearer ${login.accessToken}`};
 const base=cfg.apiUrl+`/firm/companies/${encodeURIComponent(company.id)}/fechamento/${competencia}`;
 const reading=await request(base+'/fs12/confirmacoes',{headers});
 assert.equal(reading.fs12.revisaoVigente,0,'Fresh revision required');
 const serie=reading.fs12.politica.janela.competencias.map(mes=>({mes,valorCentavos:0}));
 assert.ok(serie.length>0);
 const confirmation=await request(base+'/fs12/confirmacoes',{method:'POST',headers,body:JSON.stringify({serie,revisaoEsperada:0,contextoRevisao:reading.fs12.contextoRevisao,chaveIdempotencia:randomUUID()})});
 assert.equal(confirmation.confirmacao.totalCentavos,0);
 const body={atividades:[],folhaMensal12:[],regimeApuracao:'COMPETENCIA',semMovimento:true,
   fs12RevisaoEsperada:confirmation.confirmacao.revisao,fs12ContextoRevisao:confirmation.confirmacao.contextoRevisao,chaveIdempotencia:randomUUID()};
 const first=await request(base+'/calcular',{method:'POST',headers,body:JSON.stringify(body)});
 assert.equal(first.ok,true);assert.equal(first.result?.ok,true);assert.equal(first.result.dasValor,0);
 assert.ok(first.result.calculoId);
 const commands=await db.fs12Comando.findMany({where:scoped});assert.equal(commands.length,1);
 const command=commands[0];assert.equal(command.intencao,'SIMULAR');assert.equal(command.autorId,seed.userId);
 assert.equal(command.chaveIdempotencia,body.chaveIdempotencia);assert.equal(command.revisaoFs12,confirmation.confirmacao.revisao);
 const reservation=await db.fs12ComandoReserva.findUnique({where:{comandoId:command.id}});assert.ok(reservation);
 const response=await db.fs12ComandoResposta.findUnique({where:{id:command.esperado.custodia.respostaId}});assert.ok(response);
 assert.equal(response.comandoId,command.id);assert.equal(response.reservaId,reservation.reservaId);assert.equal(response.httpStatus,200);
 assert.equal(response.corpoCifrado.alg,'AES-256-GCM');
 const association=await db.fs12ComandoCalculo.findUnique({where:{comandoId:command.id}});assert.ok(association);
 assert.equal(association.respostaId,response.id);assert.equal(association.portalClientId,company.id);
 const link=await db.apuracaoFs12Calculo.findUnique({where:{id:association.vinculoId}});
 assert.equal(link.calculoId,first.result.calculoId);assert.equal(link.revisaoFs12,command.revisaoFs12);
 const snapshot=await db.apuracaoSnapshot.findUnique({where:{portalClientId_competencia:scoped}});
 assert.equal(snapshot.estado,'calculada');assert.equal(snapshot.idempotencyKey,link.calculoId);
 const history=await request(base+'/fs12/calculos/'+encodeURIComponent(link.calculoId),{headers});
 assert.equal(history.situacao,'VINCULADO');assert.equal(history.vinculo.id,link.id);
 // Explicit repeat only AFTER a proven committed success, never after timeout/error.
 const replay=await request(base+'/calcular',{method:'POST',headers,body:JSON.stringify(body)});
 assert.equal(replay.result.calculoId,first.result.calculoId);assert.equal(replay.result.dasValor,first.result.dasValor);
 assert.equal(await db.fs12Comando.count({where:scoped}),1);
 assert.equal(await db.fs12ComandoResposta.count({where:{comandoId:command.id}}),1);
 const callsAfter=(await request(provider.origin+'/control/calls',{headers:controlHeaders})).calls;
 const priorIds=new Set(callsBefore.map(c=>c.id));
 const dispatched=callsAfter.filter(c=>!priorIds.has(c.id)&&c.cnpj===company.cnpj&&c.service==='TRANSDECLARACAO11');
 assert.equal(dispatched.length,1,'Commit replay cannot dispatch twice');
 const payload=JSON.parse(dispatched[0].payload.pedidoDados.dados);
 assert.equal(payload.indicadorTransmissao,false);assert.equal(String(payload.pa),competencia.replace('-',''));
 assert.ok(Array.isArray(payload.declaracao?.folhasSalario));
 assert.deepEqual(payload.declaracao.folhasSalario,serie.map(x=>({pa:Number(x.mes.replace('-','')),valor:0})));
 Object.assign(report,{status:'PASS',commandId:command.id,reservaId:reservation.reservaId,respostaId:response.id,
   calculoId:link.calculoId,vinculoId:link.id,snapshotId:snapshot.id,providerCallId:dispatched[0].id,
   fs12Revision:command.revisaoFs12,bodyHash:response.corpoHash,replaySameCalculation:true});
} catch(error) {
 report.status='FAIL';report.error={code:error.code||null,message:error.message,status:error.status||null};
 process.exitCode=1;
} finally {await json(output,report);await db.$disconnect();}

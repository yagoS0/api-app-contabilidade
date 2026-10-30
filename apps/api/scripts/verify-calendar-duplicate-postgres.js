// Executar somente em PostgreSQL local descartável, já migrado.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const url=new URL(process.env.DATABASE_URL||'invalid:');
if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost'].includes(url.hostname)||!/^\/[a-zA-Z0-9_]+_governance_test$/.test(url.pathname))throw Error('Banco local descartável _governance_test obrigatório.');
globalThis.fetch=async()=>{throw Error('Rede externa proibida neste ensaio.');};
const {prisma}=await import('../src/infrastructure/db/prisma.js');
const {criarTarefaUnificada,acaoTarefaUnificada,listarTarefasUnificadas}=await import('../src/application/calendario/TarefasUnificadasService.js');
const prefix=`cal-duplicate-${randomUUID()}`,userId=prefix,portalIds=[`${prefix}-a`,`${prefix}-b`];
let checks=0;const ok=name=>console.log(`PASS ${++checks}: ${name}`);
try {
 await prisma.portalClient.createMany({data:portalIds.map(id=>({id,razao:'Empresa fictícia calendário',cnpj:id}))});
  // Current calendar commands reload an active internal actor and persisted scope.
  // Staff fixtures exercise membership; no admin/accountant bypass is used.
  const fixtureUserIds = [userId, `${prefix}-outro`];
  await prisma.user.createMany({ data: fixtureUserIds.map(id => ({
    id, email: `${id}@example.invalid`, passwordHash: 'disabled-local-fixture',
    role: 'user', status: 'active', accountType: 'FIRM',
  })) });
  await prisma.companyFirmAccess.createMany({ data: [
    ...portalIds.map(companyId => ({ companyId, userId, role: 'STAFF', status: 'ACTIVE' })),
    { companyId: portalIds[0], userId: `${prefix}-outro`, role: 'STAFF', status: 'ACTIVE' },
  ] });
 const source=await criarTarefaUnificada({userId,portalIds,dados:{titulo:'Tarefa recorrente QA',empresasIds:portalIds,subtarefas:[{id:'modelo',titulo:'Conferir'}],config:{dataInicio:'2026-10-15',dataFim:'2026-10-16',recorrencia:'MENSAL',diaVencimento:31,horarioModo:'FIXO',horaInicio:'10:00',horaFim:'11:00'}}});
 const action=(dados,id=source.id,overrides={})=>acaoTarefaUnificada({userId,portalIds,id,dados,...overrides});
 await Promise.all(portalIds.map(companyId=>action({acao:'CONCLUIR',companyId,cicloChave:'2026-10'})));
 const before=await prisma.tarefaCalendario.findUnique({where:{id:source.id}});
 assert.equal(Object.keys(before.estados['2026-10'].empresas).length,2);ok('conclusões concorrentes preservadas pelo lock');
 const dados={acao:'DUPLICAR',cicloChave:'2026-10',intencaoId:randomUUID()};
 const copies=await Promise.all(Array.from({length:4},()=>action(dados)));
 assert.equal(new Set(copies.map(c=>c.id)).size,1);assert.equal(await prisma.tarefaCalendario.count({where:{userId}}),2);ok('quatro duplicações concorrentes com mesma intenção criam uma cópia');
 const copy=copies[0];assert.equal(copy.config.recorrencia,'AVULSA');assert.deepEqual(copy.estados,{});assert.deepEqual(copy.versoes,[]);assert.notEqual(copy.subtarefas[0].id,'modelo');assert.equal(copy.config.dataVencimento,'2026-10-31');assert.deepEqual(copy.empresasIds,portalIds);ok('cópia avulsa preserva conteúdo e prazo, sem conclusão nem identidade de subtarefa');
 assert.deepEqual(await prisma.tarefaCalendario.findUnique({where:{id:source.id}}),before);ok('origem e histórico imutáveis durante duplicação');
 await action({acao:'EDITAR',cicloChave:'2026-10-15',alteracoes:{titulo:'Cópia editada'}},copy.id);
 assert.equal((await action(dados)).estados['2026-10-15'].alteracoes.titulo,'Cópia editada');ok('resposta perdida recupera cópia mesmo após edição');
 await assert.rejects(action(dados,source.id,{portalIds:[portalIds[0]]}),e=>e.status===404);
 const foreign=await criarTarefaUnificada({userId:`${prefix}-outro`,portalIds:[],dados:{titulo:'Privada',config:{dataInicio:'2026-10-15'}}});
 await assert.rejects(action({...dados,cicloChave:'2026-10-15'},foreign.id),e=>e.status===404);ok('escopo parcial e tarefa privada alheia recusados');
 await action({acao:'EXCLUIR',cicloChave:'2026-10'});
 const nov=await listarTarefasUnificadas({userId,portalIds,inicio:'2026-11-01',fim:'2026-11-30'});
 assert.equal(nov.itens.filter(i=>i.tarefaId===source.id).length,1);
 assert.ok((await prisma.tarefaCalendario.findUnique({where:{id:source.id}})).estados['2026-10'].canceladaEm);ok('excluir ocorrência preserva série e tombstone');
 await action({acao:'EXCLUIR',cicloChave:'2026-10-15'},copy.id);
 await assert.rejects(action(dados),e=>e.status===409&&e.code==='CALENDAR_COPY_DELETED');ok('retry da ocorrência copiada excluída é recusado sem recriar');
 await action({acao:'EXCLUIR_SERIE'},copy.id);
 await assert.rejects(action(dados),e=>e.status===409);assert.equal(await prisma.tarefaCalendario.count({where:{id:copy.id}}),1);ok('retry de cópia excluída não recria registros');
 const nova=await action({...dados,intencaoId:randomUUID(),cicloChave:'2026-11'});assert.notEqual(nova.id,copy.id);ok('nova intenção explícita cria outra cópia sem restaurar a anterior');
 await assert.rejects(action({acao:'DUPLICAR',cicloChave:'2026-11'}),e=>e.status===400);ok('intenção ausente rejeitada');
 console.log(JSON.stringify({ok:true,checks}));
} finally {
 await prisma.tarefaCalendario.deleteMany({where:{userId:{startsWith:prefix}}});
 await prisma.portalClient.deleteMany({where:{id:{in:portalIds}}});
 await prisma.user.deleteMany({where:{id:{in:[userId,`${prefix}-outro`]}}});
 assert.equal(await prisma.tarefaCalendario.count({where:{userId:{startsWith:prefix}}}),0);
 await prisma.$disconnect();
}

// Ensaio descartável: cria e remove somente seus próprios registros no PostgreSQL local.
import assert from 'node:assert/strict';
import { prisma } from '../apps/api/src/infrastructure/db/prisma.js';
import { lerFluxoEmpresa, salvarFluxoTarefa, listarAgendaCarteira } from '../apps/api/src/application/company/FluxoCarteiraService.js';
const url=new URL(process.env.DATABASE_URL);
if(url.hostname!=='127.0.0.1'||url.port!=='5433'||url.pathname!=='/contabilidade_dev')throw new Error('Este ensaio exige o banco local contabilidade_dev.');
const competencia='2026-09', ids=[];
try {
  const p=await prisma.portalClient.create({data:{razao:'TESTE DESCARTÁVEL FLUXO CARTEIRA',cnpj:String(Date.now()).padStart(14,'0')}});ids.push(p.id);
  let d=await lerFluxoEmpresa(p.id,competencia);
  assert.equal(d.fluxo.status.chave,'apuracao');
  await salvarFluxoTarefa(p.id,competencia,'apurar',{versao:0,acao:'planejar',responsavel:'Equipe teste',dataInicio:'2026-10-06',dataFim:'2026-10-07'},'teste-local');
  await assert.rejects(()=>salvarFluxoTarefa(p.id,competencia,'apurar',{versao:0,acao:'planejar'},'teste-local'),/mudou/);
  d=await lerFluxoEmpresa(p.id,competencia);let t=d.fluxo.tarefas.find(t=>t.chave==='apurar');
  await salvarFluxoTarefa(p.id,competencia,'apurar',{versao:t.versao,acao:'concluir',hash:t.hash,evidencia:'Conferência sintética local'},'teste-local');
  d=await lerFluxoEmpresa(p.id,competencia);assert.equal(d.fluxo.apuracao.rotulo,'Apurado');
  const agenda=await listarAgendaCarteira([p.id],'2026-10-01','2026-10-31');assert.equal(agenda.length,1);assert.equal(agenda[0].resolvido,true);
  assert.equal((await listarAgendaCarteira([],'2026-10-01','2026-10-31')).length,0);
  await prisma.companyMonthlyCircular.create({data:{portalClientId:p.id,competencia,fechadoContabilEm:new Date()}});
  const es=[];
  for(let i=0;i<2;i++)es.push(await prisma.accountingEntry.create({data:{portalClientId:p.id,competencia,data:new Date('2026-09-10'),historico:`Teste ${i}`,status:'EXPORTADO',lines:{create:[{conta:'1',tipo:'D',valor:10},{conta:'2',tipo:'C',valor:10}]}}}));
  d=await lerFluxoEmpresa(p.id,competencia);t=d.fluxo.tarefas.find(t=>t.chave==='importar');
  await assert.rejects(()=>salvarFluxoTarefa(p.id,competencia,'importar',{versao:t.versao,acao:'concluir',hash:t.hash,entryIds:['id-fora-do-escopo'],evidencia:'ERP teste lote 1'},'teste-local'),/outra competência/);
  await salvarFluxoTarefa(p.id,competencia,'importar',{versao:t.versao,acao:'concluir',hash:t.hash,entryIds:[es[0].id],evidencia:'ERP teste lote 1'},'teste-local');
  d=await lerFluxoEmpresa(p.id,competencia);assert.equal(d.fluxo.contabilizacao.importados,1);assert.equal(d.fluxo.contabilizacao.rotulo,'Fechado');t=d.fluxo.tarefas.find(t=>t.chave==='importar');
  await salvarFluxoTarefa(p.id,competencia,'importar',{versao:t.versao,acao:'concluir',hash:t.hash,entryIds:[es[1].id],evidencia:'ERP teste lote 2'},'teste-local');
  d=await lerFluxoEmpresa(p.id,competencia);assert.equal(d.fluxo.contabilizacao.rotulo,'Importado');
  await prisma.accountingEntry.update({where:{id:es[0].id},data:{historico:'Lançamento alterado depois da importação'}});
  d=await lerFluxoEmpresa(p.id,competencia);assert.equal(d.fluxo.contabilizacao.importados,1);assert.equal(d.fluxo.contabilizacao.rotulo,'Fechado');
  await prisma.companyMonthlyCircular.update({where:{portalClientId_competencia:{portalClientId:p.id,competencia}},data:{fechadoContabilEm:null}});
  d=await lerFluxoEmpresa(p.id,competencia);assert.equal(d.fluxo.contabilizacao.rotulo,'Aberto');
  const pair=await Promise.allSettled([1,2].map(()=>salvarFluxoTarefa(p.id,competencia,'extra:concorrencia',{versao:0,acao:'planejar',titulo:'Importar notas',etapa:'apuracao'},'teste-local')));
  assert.equal(pair.filter(r=>r.status==='fulfilled').length,1);
  console.log('PASS: persistência, conflito de versão, calendário, isolamento, evidência, importação parcial/completa, alteração posterior, reabertura e concorrência.');
} finally {
  if(ids.length)await prisma.portalClient.deleteMany({where:{id:{in:ids},razao:'TESTE DESCARTÁVEL FLUXO CARTEIRA'}});
  await prisma.$disconnect();
}

jest.mock('../../fiscal/serpro/SerproRuntimeSettings.js', () => ({ getResolvedSerproCredentials: jest.fn(async () => ({ certificate: { hasCertificate: true, document: '11111111000191' } })) }));
const mockSimular = jest.fn(async () => ({ dasValor: 6, raw: { synthetic: true } }));
jest.mock('../../fiscal/serpro/PgdasSimulacaoService.js', () => ({ ...jest.requireActual('../../fiscal/serpro/PgdasSimulacaoService.js'), PgdasSimulacaoService: jest.fn().mockImplementation(() => ({ simular: args => mockSimular(args), transmitir: () => { throw Error('Transmissão proibida neste teste'); } })) }));
jest.mock('axios', () => ({ __esModule: true, default: { request: () => { throw Error('Rede fiscal proibida neste teste'); } } }));
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: new Proxy({}, {get:(_t,k)=>typeof mockPg[k]==='function'?mockPg[k].bind(mockPg):mockPg[k]}) }));
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { prepararCalculoOperacoes, executarCalculoOperacoes, lerResultadoCalculoOperacoes } from '../OperationsCalculationService.js';
import { getDadosFechamento } from '../../notas/apuracao/v2/FechamentoService.js';
import { auditarCompetencia } from '../../notas/auditoria/AuditoriaNotasService.js';
import { getRbt12 } from '../../notas/apuracao/v2/RbtExtratoService.js';
import { executarOperacao } from '../OperationsExecution.js';
import { lerOperacao, salvarOperacao } from '../OperationsService.js';
import { listarEvidenciasOperacoes } from '../OperationsConsultas.js';
import { lerOperacaoExterna, salvarOperacaoExterna } from '../OperationsExternalService.js';
const raw=process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL; if(!raw) throw Error('Banco descartável obrigatório.');
const url=new URL(raw); if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.endsWith('_governance_test')||url.searchParams.has('host')) throw Error('Banco não autorizado.');
const mockPg=new PrismaClient({datasources:{db:{url:raw}}});const pg=mockPg;afterAll(()=>pg.$disconnect());
async function fixture(regime,run){const id=randomUUID(),companyId=randomUUID(),clientId=randomUUID(),userId=randomUUID();
try{
 await pg.user.create({data:{id:userId,email:`${userId}@example.test`,passwordHash:'synthetic',role:'admin',accountType:'FIRM',status:'active'}});
 await pg.client.create({data:{id:clientId,name:'TEST',email:`${clientId}@example.test`,login:clientId,passwordHash:'synthetic'}});
 await pg.company.create({data:{id:companyId,clientId,cnpj:id.replace(/\D/g,'').padEnd(14,'0').slice(0,14),razaoSocial:'TEST',atividades:[],regimeTributario:regime}});
 await pg.portalClient.create({data:{id,companyId,cnpj:'12345678000199',razao:'TEST',status:'ATIVA'}});
 await pg.regimeHistorico.create({data:{companyId,regime,vigenciaInicio:new Date('2020-01-01T00:00:00Z')}});
 await pg.cadastroFiscal.create({data:{portalClientId:id,regime:'SIMPLES_NACIONAL',regimeApuracao:'COMPETENCIA',cnaePrincipal:'6201501',usaFatorR:false}});
 await pg.appSetting.create({data:{key:`ciclo_simples_config:${id}`,value:{enabled:false,fontes:['NFSE']}}});
 await run({id,userId,companyId});
}finally{await pg.appSetting.deleteMany({where:{OR:[{key:{contains:id}},{key:{startsWith:`operations_request:${userId}:`}}]}});await pg.portalClient.deleteMany({where:{id}});await pg.company.deleteMany({where:{id:companyId}});await pg.client.deleteMany({where:{id:clientId}});await pg.user.deleteMany({where:{id:userId}});}}
test('PostgreSQL reserva, persiste cálculo, recupera pedido exato e não repete transporte',async()=>fixture('SIMPLES',async({id,userId})=>{
 const deps={audit:async()=>({empresa:{portalClientId:id},competencia:'2026-10',totalAchados:0,foraDaConferencia:{total:0},manutencao:{notasNaoLidas:0},perguntas:[1,2,3].map(id=>({id:String(id),situacao:'CONFERIDA',achados:[],naoAvaliadas:[]}))}),context:async()=>({hash:'stable'}),collect:jest.fn(async()=>({ok:true,complete:true,partial:false,cnpj:'12345678000199'})),getDados:async()=>({atividades:[{idAtividade:'1',valorInterno:100,valorExterno:0,sujeitoFatorR:false}],faturamento:{total:100},rbt12:1000,rbt12Origem:'EXTRATO_PGDAS'}),calculate:jest.fn(async a=>{await a.manualOperation.beforeDispatch();await a.manualOperation.verify();return{ok:true,calculoId:'synthetic',dasValor:6};})};
 const preview=await prepararCalculoOperacoes(pg,id,'2026-10',deps);expect(preview.canCalculate).toBe(true);
 const args={companyId:id,competencia:'2026-10',userId,requestId:randomUUID(),confirmCompetencia:'2026-10',expectedRevision:preview.revision};
 expect((await executarCalculoOperacoes(pg,args,deps)).status).toBe('CALCULATED');expect((await executarCalculoOperacoes(pg,args,deps)).status).toBe('CALCULATED');expect(deps.calculate).toHaveBeenCalledTimes(1);expect((await lerResultadoCalculoOperacoes(pg,id,'2026-10',args.requestId)).attempt.calculation.imposto).toBe(6);
}));
test('Presumido conclui apurar e transmitir externamente, com versão e histórico carteira',async()=>fixture('LUCRO_PRESUMIDO',async({id,userId})=>{
 let view=await lerOperacaoExterna(pg,id,'2026-10');expect(view.apurar.concluida).toBe(false);
 view=await salvarOperacaoExterna(pg,{companyId:id,competencia:'2026-10',userId,chave:'apurar',versao:view.apurar.versao,hash:view.apurar.hash,confirmCompetencia:'2026-10'});expect(view.apurar.concluida).toBe(true);
 view=await salvarOperacaoExterna(pg,{companyId:id,competencia:'2026-10',userId,chave:'transmitir',versao:view.transmitir.versao,hash:view.transmitir.hash,confirmCompetencia:'2026-10'});expect(view.transmitir.concluida).toBe(true);
 const summary=await listarEvidenciasOperacoes(pg,[id],'2026-10');expect(summary.items[0]).toMatchObject({regime:'PRESUMIDO',externalSummary:{apurar:{concluida:true},transmitir:{concluida:true}}});
 expect(await pg.apuracaoSnapshot.count({where:{portalClientId:id}})).toBe(0);const rows=await pg.carteiraTarefa.findMany({where:{portalClientId:id}});expect(rows).toHaveLength(2);expect(rows.every(r=>r.historico.length===1&&r.historico[0].por===userId)).toBe(true);
}));


test('Presumido concorrente: uma conclusão e um evento; versão obsoleta é recusada',async()=>fixture('LUCRO_PRESUMIDO',async({id,userId})=>{
 const second=new PrismaClient({datasources:{db:{url:raw}}});
 try {const before=await lerOperacaoExterna(pg,id,'2026-10');const args={companyId:id,competencia:'2026-10',userId,chave:'apurar',versao:before.apurar.versao,hash:before.apurar.hash,confirmCompetencia:'2026-10'};
 const outcomes=await Promise.allSettled([salvarOperacaoExterna(pg,args),salvarOperacaoExterna(second,args)]);
 expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(outcomes.filter(r=>r.status==='rejected')).toHaveLength(1);
 const stored=await pg.carteiraTarefa.findMany({where:{portalClientId:id}});expect(stored).toHaveLength(1);expect(stored[0].historico).toHaveLength(1);expect(stored[0].historico[0]).toMatchObject({por:userId,acao:'concluir'});
 await expect(salvarOperacaoExterna(pg,args)).rejects.toThrow();expect(await pg.carteiraTarefa.findMany({where:{portalClientId:id}})).toEqual(stored);
 }finally{await second.$disconnect();}
}));
test('Presumido recusa hash anterior após mudança da base sem registrar conclusão',async()=>fixture('LUCRO_PRESUMIDO',async({id,userId})=>{
 const before=await lerOperacaoExterna(pg,id,'2026-10');const invoice=await pg.portalInvoice.create({data:{clientId:id,type:'NFSE',papel:'EMIT',statusEfetivo:'autorizada',competencia:new Date('2026-10-01'),total:100}});
 try{await expect(salvarOperacaoExterna(pg,{companyId:id,competencia:'2026-10',userId,chave:'apurar',versao:before.apurar.versao,hash:before.apurar.hash,confirmCompetencia:'2026-10'})).rejects.toThrow('mudaram');expect(await pg.carteiraTarefa.count({where:{portalClientId:id}})).toBe(0);expect((await lerOperacaoExterna(pg,id,'2026-10')).apurar.concluida).toBe(false);expect(await pg.portalInvoice.findUnique({where:{id:invoice.id}})).toMatchObject({total:expect.anything()});}finally{await pg.portalInvoice.delete({where:{id:invoice.id}});}
}));
test('Presumido rollback após escrita de tarefa preserva histórico anterior integral',async()=>fixture('LUCRO_PRESUMIDO',async({id,userId})=>{
 const initial=await lerOperacaoExterna(pg,id,'2026-10');await salvarOperacaoExterna(pg,{companyId:id,competencia:'2026-10',userId,chave:'apurar',versao:initial.apurar.versao,hash:initial.apurar.hash,confirmCompetencia:'2026-10'});
 const before=await pg.carteiraTarefa.findMany({where:{portalClientId:id}});const view=await lerOperacaoExterna(pg,id,'2026-10');
 let reached=false;
 const faulty=new Proxy(pg,{get(target,key){if(key==='$transaction')return(run,options)=>pg.$transaction(tx=>run(new Proxy(tx,{get(t,k){if(k==='carteiraTarefa')return new Proxy(t[k],{get(model,method){if(method==='create')return async args=>{const row=await model.create(args);reached=true;expect(row.historico).toHaveLength(1);throw Error('Falha sintética após INSERT antes do COMMIT');};return typeof model[method]==='function'?model[method].bind(model):model[method];}});return typeof t[k]==='function'?t[k].bind(t):t[k];}})),options);return typeof target[key]==='function'?target[key].bind(target):target[key];}});
 await expect(salvarOperacaoExterna(faulty,{companyId:id,competencia:'2026-10',userId,chave:'transmitir',versao:view.transmitir.versao,hash:view.transmitir.hash,confirmCompetencia:'2026-10'})).rejects.toThrow('Falha sintética');expect(reached).toBe(true);
 expect(await pg.carteiraTarefa.findMany({where:{portalClientId:id}})).toEqual(before);expect((await lerOperacaoExterna(pg,id,'2026-10')).transmitir.concluida).toBe(false);expect(await pg.apuracaoSnapshot.count({where:{portalClientId:id}})).toBe(0);
}));


async function seedRealBase({id,companyId}) {
 const activityId=randomUUID(), numericId=900000+Math.floor(Math.random()*900000);
 await pg.company.update({where:{id:companyId},data:{codigosServicoNacional:['010101']}});
 await pg.atividadePgdasd.create({data:{id:activityId,idAtividade:numericId,descricao:'SINTÉTICO sem validade fiscal',anexoImplicito:'III',mercado:'INTERNO',sujeitoFatorR:false,tipoReceita:'SERVICO_ANEXO_III',vigenciaInicio:new Date('2026-10-01')}});
 const months=Array.from({length:12},(_,i)=>new Date(Date.UTC(2025,9+i,1)).toISOString().slice(0,7));
 const rows=months.map(pa=>`${pa.slice(5)}/${pa.slice(0,4)}`);
 await pg.companyMonthlyCircular.create({data:{portalClientId:id,competencia:'2026-10',pgdasDeclaracaoFileId:'synthetic-no-document',metadata:{parsedPgdas:{rawText:'2.2.1) Mercado Interno '+rows.map(m=>m+' 100,00').join(' ')+' 2.2.2) Mercado Externo '+rows.map(m=>m+' 0,00').join(' ')+' 2.3)'}}}});
 const collect=jest.fn(async()=>{await pg.portalInvoice.create({data:{clientId:id,type:'NFSE',papel:'EMIT',statusEfetivo:'autorizada',competencia:new Date('2026-10-01'),issueDate:new Date('2026-10-15'),total:100,cTribNac:'010101',issqnBaseCalculo:100,issqnAliquota:2,issqnValor:2,camposFiscaisExtraidosEm:new Date(),itens:{create:{valor:100,tipoReceita:'SERVICO_ANEXO_III',flagExportacao:false}}}});return{ok:true,complete:true,partial:false,cnpj:'12345678000199'};});
 return {activityId,collect};
}
test.each([true,false])('novo fluxo real: cache RBT anterior=%s, auditoria, snapshot e conferência',async cacheAnterior=>fixture('SIMPLES',async({id,userId,companyId})=>{
 const seed=await seedRealBase({id,companyId});mockSimular.mockClear();
 try {
  // Cache previamente consultado é evidência local real, não substituição do getDados.
  if(cacheAnterior) await getRbt12({portalClientId:id,competencia:'2026-10',db:pg});
  const deps={collect:seed.collect};const preview=await prepararCalculoOperacoes(pg,id,'2026-10',deps);expect(preview.canCalculate).toBe(true);
  const args={companyId:id,competencia:'2026-10',userId,requestId:randomUUID(),confirmCompetencia:'2026-10',expectedRevision:preview.revision};
  const result=await executarCalculoOperacoes(pg,args,deps);expect(result.reason).toBeNull();expect(result).toMatchObject({status:'CALCULATED',calculation:{receita:100,imposto:6},audit:{status:'COMPLETE',totalAchados:0}});
  const snapshot=await pg.apuracaoSnapshot.findUnique({where:{portalClientId_competencia:{portalClientId:id,competencia:'2026-10'}}});expect(snapshot).toMatchObject({estado:'calculada',idempotencyKey:result.calculation.calculoId});expect(Number(snapshot.receitaInterna)).toBe(100);expect(Number(snapshot.dasSimuladoSerpro)).toBe(6);
  const recovered=await getDadosFechamento({portalClientId:id,competencia:'2026-10'});expect(recovered.calculoRecuperavel.calculoId).toBe(snapshot.idempotencyKey);
  const audit=await auditarCompetencia({portalClientId:id,competencia:'2026-10'},{db:pg});expect(audit.perguntasConferidas).toBe(3);
  const operation=await lerOperacao(pg,id,'2026-10');expect(operation.blocked).toBeNull();const confirmed=await salvarOperacao(pg,id,'2026-10',userId,{action:'confirm',expectedRevision:operation.revision,requestId:randomUUID()},{isAdmin:true});expect(confirmed.status).toBe('CONFIRMED');
  expect(mockSimular).toHaveBeenCalledTimes(1);expect(seed.collect).toHaveBeenCalledTimes(1);expect((await executarCalculoOperacoes(pg,args,deps)).status).toBe('CALCULATED');expect(mockSimular).toHaveBeenCalledTimes(1);
  expect((await pg.apuracaoSnapshot.findUnique({where:{id:snapshot.id}})).estado).toBe('calculada');
  // Compatibilidade legado: o vínculo fiscal é real, mas a confirmação não pode depender da existência da tentativa do novo atalho.
  await pg.appSetting.delete({where:{key:`operations_calculation:${id}:2026-10`}});
  await pg.regimeHistorico.updateMany({where:{companyId},data:{regime:'LUCRO_PRESUMIDO'}});
  await expect(salvarOperacao(pg,id,'2026-10',userId,{action:'release',expectedRevision:confirmed.revision,requestId:randomUUID()},{isAdmin:true})).rejects.toThrow('Simples não comprovado');
  expect((await lerOperacao(pg,id,'2026-10')).status).toBe('CONFIRMED');
  await pg.regimeHistorico.updateMany({where:{companyId},data:{regime:'SIMPLES'}});
  const released=await salvarOperacao(pg,id,'2026-10',userId,{action:'release',expectedRevision:confirmed.revision,requestId:randomUUID()},{isAdmin:true});
  await pg.regimeHistorico.updateMany({where:{companyId},data:{regime:'LUCRO_PRESUMIDO'}});
  const transport=jest.fn();await expect(executarOperacao(pg,{companyId:id,competencia:'2026-10',userId,isAdmin:true,revision:released.revision},{credentials:async()=>({certificate:{document:'11111111000191'}}),transmit:transport})).rejects.toThrow('Simples não comprovado');expect(transport).not.toHaveBeenCalled();
  expect((await pg.apuracaoSnapshot.findUnique({where:{id:snapshot.id}})).estado).toBe('calculada');

 } finally {await pg.portalInvoice.deleteMany({where:{clientId:id}});await pg.guideIngestionLock.deleteMany({where:{id:{contains:id}}});await pg.atividadePgdasd.delete({where:{id:seed.activityId}});}
}));


test('base RBT sem extrato completo permanece revisão sem simular nem inventar zero',async()=>fixture('SIMPLES',async({id,userId,companyId})=>{
 const seed=await seedRealBase({id,companyId});mockSimular.mockClear();
 try{
  await pg.companyMonthlyCircular.deleteMany({where:{portalClientId:id}});
  const deps={collect:seed.collect};const preview=await prepararCalculoOperacoes(pg,id,'2026-10',deps);
  const result=await executarCalculoOperacoes(pg,{companyId:id,competencia:'2026-10',userId,requestId:randomUUID(),confirmCompetencia:'2026-10',expectedRevision:preview.revision},deps);
  expect(result.status).toBe('REVIEW');expect(result.reason).toContain('RBT12');expect(mockSimular).not.toHaveBeenCalled();expect(await pg.apuracaoSnapshot.count({where:{portalClientId:id}})).toBe(0);
  expect((await pg.rbtExtratoCache.findUnique({where:{portalClientId_competencia:{portalClientId:id,competencia:'2026-10'}}})).origem).toBe('PARCIAL_LOCAL');
 }finally{await pg.portalInvoice.deleteMany({where:{clientId:id}});await pg.atividadePgdasd.delete({where:{id:seed.activityId}});}
}));

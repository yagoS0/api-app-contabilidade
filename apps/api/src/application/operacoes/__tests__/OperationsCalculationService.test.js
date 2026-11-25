import express from 'express';
import request from 'supertest';
import { createOperationsRouter } from '../../../routes/firm/operacoes.js';
import { validarIdentidadeFs12 } from '../../../modules/fiscal/domain/serieManualFs12.js';
import { determinarPoliticaDeclaratoriaFs12 } from '../../../modules/fiscal/domain/politicaDeclaratoriaFs12.js';
import { prepararCalculoOperacoes, executarCalculoOperacoes, lerResultadoCalculoOperacoes, conferirCalculoManualOperacoes, reconciliarCalculoOperacoes } from '../OperationsCalculationService.js';
function fixture() {
 const settings = new Map([['ciclo_simples_config:a',{enabled:false,fontes:['NFSE']}]]); let snapshot = null;
 const audit = {empresa:{portalClientId:'a'},competencia:'2026-10',totalAchados:0,foraDaConferencia:{total:0},manutencao:{notasNaoLidas:0},perguntas:[1,2,3].map(id=>({id:String(id),situacao:'CONFERIDA',achados:[],naoAvaliadas:[]}))};
 const db = {
  user:{findUnique:jest.fn(async()=>({id:'user',role:'admin',status:'active'}))},
  portalClient:{findUnique:jest.fn(async()=>({id:'a',companyId:'legacy',cnpj:'12345678000199',status:'ATIVA'}))},
  company:{findUnique:jest.fn(async()=>({regimeTributario:'SIMPLES'}))},
  regimeHistorico:{findMany:jest.fn(async()=>[{regime:'SIMPLES',vigenciaInicio:'2020-01-01'}])},
  cadastroFiscal:{findUnique:jest.fn(async()=>({regime:'SIMPLES_NACIONAL',regimeApuracao:'COMPETENCIA'}))},
  apuracaoSnapshot:{findUnique:jest.fn(async()=>snapshot)},
  portalInvoice:{count:jest.fn(async()=>0)},
  appSetting:{findUnique:jest.fn(async({where})=>settings.has(where.key)?{value:settings.get(where.key)}:null),upsert:jest.fn(async({create,update})=>settings.set(create.key,update.value))},
  $queryRaw:jest.fn(async()=>[])
 }; db.$transaction=async fn=>fn(db);
 const deps={prepareRbt:jest.fn(async()=>({})),audit:jest.fn(async()=>audit),context:jest.fn(async()=>({hash:'source'})),collect:jest.fn(async()=>({ok:true,complete:true,partial:false,cnpj:'12345678000199'})), getDados:jest.fn(async()=>({atividades:[{idAtividade:'1',valorInterno:100,valorExterno:0,sujeitoFatorR:false}],faturamento:{total:100},rbt12Origem:'EXTRATO_PGDAS',rbt12:1000})),calculate:jest.fn(async args=>{await args.manualOperation.beforeDispatch();await args.manualOperation.verify();snapshot={idempotencyKey:'calc-1',estado:'calculada'};return {ok:true,calculoId:'calc-1',dasValor:6};})};
 return {db,deps,settings,audit,setSnapshot:v=>snapshot=v};
}
async function command(f) {return {companyId:'a',competencia:'2026-10',userId:'user',requestId:'request-123',confirmCompetencia:'2026-10',expectedRevision:(await prepararCalculoOperacoes(f.db,'a','2026-10',f.deps)).revision};}

test('P2a: pausa empresarial aparece separada da aptidão preliminar e não dispara efeitos', async () => {
 const f = fixture();
 f.settings.set('company_automation_policy:a', { paused: true, version: 1, reason: 'Fixture de pausa', updatedBy: 'user', updatedAt: '2026-10-01T10:00:00Z', resumedAt: null });
 const result = await prepararCalculoOperacoes(f.db, 'a', '2026-10', f.deps);
 expect(result.routine.status).toBe('PAUSED');
 expect(result.canCalculate).toBe(true);
 expect(f.deps.collect).not.toHaveBeenCalled(); expect(f.deps.calculate).not.toHaveBeenCalled();
 expect(f.db.appSetting.upsert).not.toHaveBeenCalled();
});

test.each(['INATIVA', 'SUSPENSA'])('P2a: cadastro %s bloqueia o atalho sem decidir dispensa fiscal', async status => {
 const f = fixture();
 f.db.portalClient.findUnique.mockResolvedValue({ id: 'a', companyId: 'legacy', cnpj: '12345678000199', status });
 const result = await prepararCalculoOperacoes(f.db, 'a', '2026-10', f.deps);
 expect(result.canCalculate).toBe(false);
 expect(result.blockers).toContain('Empresa não está ativa.');
 expect(f.deps.collect).not.toHaveBeenCalled(); expect(f.db.appSetting.upsert).not.toHaveBeenCalled();
});

test('P2a: prévia sem procuração e com cadastro atual divergente preserva decisão pelo histórico', async () => {
 const f = fixture();
 f.db.company.findUnique.mockResolvedValue({ regimeTributario: 'LUCRO_PRESUMIDO' });
 const result = await prepararCalculoOperacoes(f.db, 'a', '2026-10', f.deps);
 expect(result.regime).toBe('SIMPLES');
 expect(result.canCalculate).toBe(true);
 expect(f.db.appSetting.findUnique.mock.calls.map(([args]) => args.where.key)).not.toContain('serpro_procuration_status:a');
 expect(f.deps.collect).not.toHaveBeenCalled(); expect(f.deps.calculate).not.toHaveBeenCalled();
});

test('sem movimento pode passar na prévia, mas exige revisão antes de simular', async () => {
 const f = fixture();
 f.deps.getDados.mockResolvedValue({ atividades: [{ idAtividade: '1', valorInterno: 0, valorExterno: 0, sujeitoFatorR: false }], faturamento: { total: 0 }, rbt12Origem: 'EXTRATO_PGDAS', rbt12: 1000 });
 expect((await prepararCalculoOperacoes(f.db, 'a', '2026-10', f.deps)).canCalculate).toBe(true);
 const result = await executarCalculoOperacoes(f.db, await command(f), f.deps);
 expect(result.status).toBe('REVIEW');
 expect(result.reason).toContain('sem movimento');
 expect(f.deps.collect).toHaveBeenCalledTimes(1);
 expect(f.deps.calculate).not.toHaveBeenCalled();
});

test.each([null, undefined, ''])('E1 receita ausente (%p) não é convertida em zero nem enviada ao cálculo', async total => {
 const f = fixture();
 f.deps.getDados.mockResolvedValue({
  atividades:[{ idAtividade:'1', valorInterno:100, valorExterno:0, sujeitoFatorR:false }],
  faturamento:{ total }, rbt12Origem:'EXTRATO_PGDAS', rbt12:1000,
 });
 const result = await executarCalculoOperacoes(f.db, await command(f), f.deps);
 expect(result.status).toBe('REVIEW');
 expect(result.calculation).toBeNull();
 expect(result.reason).toContain('Receita incompleta');
 expect(f.deps.calculate).not.toHaveBeenCalled();
});
test('coleta NFS-e, audita e simula uma vez; replay não coleta nem calcula',async()=>{const f=fixture(),c=await command(f); const out=await executarCalculoOperacoes(f.db,c,f.deps);expect(out.status).toBe('CALCULATED');expect(out.calculation).toMatchObject({receita:100,imposto:6});expect(await executarCalculoOperacoes(f.db,c,f.deps)).toEqual(out);expect(f.deps.collect).toHaveBeenCalledTimes(1);expect(f.deps.calculate).toHaveBeenCalledTimes(1);expect((await lerResultadoCalculoOperacoes(f.db,'a','2026-10','request-123')).attempt.requestId).toBe('request-123');await conferirCalculoManualOperacoes(f.db,'a','2026-10',f.deps);});
test.each([{complete:false},{partial:true},{cnpj:'999'},{ok:false}])('coleta incompleta/identidade inválida impede simulação %j',async patch=>{const f=fixture(),c=await command(f);f.deps.collect.mockResolvedValue({ok:true,complete:true,partial:false,cnpj:'12345678000199',...patch});expect((await executarCalculoOperacoes(f.db,c,f.deps)).status).toBe('REVIEW');expect(f.deps.calculate).not.toHaveBeenCalled();});
test('NF-e efetiva bloqueia mesmo sem fonte configurada',async()=>{const f=fixture();f.db.portalInvoice.count.mockResolvedValue(1);expect((await prepararCalculoOperacoes(f.db,'a','2026-10',f.deps)).canCalculate).toBe(false);});
test('mudança entre prévia e reserva impede coleta',async()=>{const f=fixture(),c=await command(f);f.db.portalInvoice.count.mockResolvedValue(1);await expect(executarCalculoOperacoes(f.db,c,f.deps)).rejects.toThrow();expect(f.deps.collect).not.toHaveBeenCalled();});
test('mudança durante preparo impede despacho',async()=>{const f=fixture(),c=await command(f);f.deps.calculate.mockImplementation(async args=>{f.deps.context.mockResolvedValue({hash:'changed'});await args.manualOperation.beforeDispatch();throw Error('não alcançar');});expect((await executarCalculoOperacoes(f.db,c,f.deps)).status).toBe('REVIEW');});
test('resultado incerto não repete e impede conferência',async()=>{const f=fixture(),c=await command(f);f.deps.calculate.mockImplementation(async args=>{await args.manualOperation.beforeDispatch();throw Error('timeout');});expect((await executarCalculoOperacoes(f.db,c,f.deps)).status).toBe('UNCERTAIN');await executarCalculoOperacoes(f.db,c,f.deps);expect(f.deps.calculate).toHaveBeenCalledTimes(1);await expect(conferirCalculoManualOperacoes(f.db,'a','2026-10',f.deps)).rejects.toThrow('incerto');});
test('achados auditáveis são avisos, não veto fiscal',async()=>{const f=fixture();f.audit.totalAchados=1;f.audit.perguntas[0].achados=[{id:'finding'}];const c=await command(f);const out=await executarCalculoOperacoes(f.db,c,f.deps);expect(out.status).toBe('CALCULATED');expect(out.audit.status).toBe('REVIEW');});
test('folha não é inventada e formulário posterior recupera conferência',async()=>{const f=fixture();f.deps.getDados.mockResolvedValue({atividades:[{idAtividade:'1',valorInterno:100,valorExterno:0,sujeitoFatorR:true}],faturamento:{total:100},rbt12Origem:'EXTRATO_PGDAS',rbt12:1000});const c=await command(f);const out=await executarCalculoOperacoes(f.db,c,f.deps);expect(out.status).toBe('REVIEW');expect(out.reason).toContain('folha');expect(f.deps.calculate).not.toHaveBeenCalled();f.setSnapshot({idempotencyKey:'individual-new',estado:'calculada'});await expect(conferirCalculoManualOperacoes(f.db,'a','2026-10',f.deps)).resolves.toBeUndefined();});
test('auditoria alterada após cálculo recusa conferência',async()=>{const f=fixture(),c=await command(f);await executarCalculoOperacoes(f.db,c,f.deps);f.audit.totalAchados=1;await expect(conferirCalculoManualOperacoes(f.db,'a','2026-10',f.deps)).rejects.toThrow('auditoria');});


test('cálculo legado preserva fallback comprovado sem exigir fontes NFS-e do novo atalho',async()=>{
 const f=fixture();f.db.regimeHistorico.findMany.mockResolvedValue([]);f.db.cadastroFiscal.findUnique.mockResolvedValue({regime:'SIMPLES_NACIONAL',regimeApuracao:'COMPETENCIA',dataOpcaoSN:new Date('2020-01-01')});f.db.portalInvoice.count.mockResolvedValue(1);
 await expect(conferirCalculoManualOperacoes(f.db,'a','2026-10',f.deps)).resolves.toBeUndefined();expect(f.db.portalInvoice.count).not.toHaveBeenCalled();
 f.db.cadastroFiscal.findUnique.mockResolvedValue({regime:'SIMPLES_NACIONAL',regimeApuracao:'COMPETENCIA'});await expect(conferirCalculoManualOperacoes(f.db,'a','2026-10',f.deps)).rejects.toThrow('Simples não comprovado');
});

// Consumer contract: E2 replaced the blanket E1 embargo only for proven 2026 capabilities.
// Fiscal projection is a boundary double here; the real B1 policy preserves the 2027 horizon.
test.each(['2026-11','2026-12','2027-01'])('FS12 pendente %s impede coleta/reserva com ator identificado',async competencia=>{
 const f=fixture();f.audit.competencia=competencia;f.deps.autorId='user';
 const policy=determinarPoliticaDeclaratoriaFs12({empresaId:'legacy',competenciaApuracao:competencia,inicioAtividade:'2020-01',regimeDoPeriodo:{empresaId:'legacy',competencia,tipo:'SIMPLES_NACIONAL',referencia:'history'}});
 if(competencia==='2027-01')expect(policy.regra).toBe('HOMOLOGACAO_2027_PENDENTE');
 const message=competencia==='2027-01'?'2027: homologação pendente.':'Confirme a folha atual antes de calcular.';
 f.deps.fiscal=jest.fn(async entrada=>{validarIdentidadeFs12(entrada);return {capacidades:{calcular:false},impedimentos:[{code:competencia==='2027-01'?'FS12_POLITICA_NAO_HOMOLOGADA':'FS12_CONFIRMACAO_AUSENTE',mensagem:message}]};});
 const preview=await prepararCalculoOperacoes(f.db,'a',competencia,f.deps);
 expect(preview.canCalculate).toBe(false);expect(preview.blockers).toContain(message);
 expect(f.deps.fiscal).toHaveBeenCalledWith({portalClientId:'a',competencia,autorId:'user'},{db:f.db});
 await expect(executarCalculoOperacoes(f.db,{companyId:'a',competencia,userId:'user',requestId:'fs12-guard-request',confirmCompetencia:competencia,expectedRevision:preview.revision},f.deps)).rejects.toThrow(message);
 expect(f.deps.collect).not.toHaveBeenCalled();expect(f.deps.calculate).not.toHaveBeenCalled();expect(f.db.appSetting.upsert).not.toHaveBeenCalled();
});
test('composição fiscal real recusa ausência de ator, sem criar identidade implícita',async()=>{
 const f=fixture();f.audit.competencia='2026-11';
 await expect(prepararCalculoOperacoes(f.db,'a','2026-11',f.deps)).rejects.toMatchObject({code:'FS12_SEM_AUTENTICACAO',status:401});
 expect(f.deps.collect).not.toHaveBeenCalled();expect(f.db.appSetting.upsert).not.toHaveBeenCalled();
});
test('rota real propaga somente ator da sessão até avaliação fiscal; query/body/dependências não o substituem',async()=>{
 const f=fixture();f.audit.competencia='2026-11';
 const fiscal=jest.fn(async entrada=>{validarIdentidadeFs12(entrada);return {capacidades:{calcular:false},impedimentos:['Folha pendente']};});
 // Session/ACL middleware are explicit doubles; router, preview and fiscal identity validation are real.
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.auth={user:{id:'session-user'}};next();});
 const access=jest.fn(()=> (req,res,next)=>next());
 app.use(createOperationsRouter({prisma:f.db,requireFirmCompanyAccess:access,calculationDependencies:{...f.deps,autorId:'dependency-forged',fiscal}}));
 const response=await request(app).get('/companies/a/operacoes/2026-11/calculo/previa').query({autorId:'query-forged',userId:'query-forged'}).send({autorId:'body-forged',userId:'body-forged'});
 expect(response.status).toBe(200);expect(response.body.canCalculate).toBe(false);
 expect(fiscal).toHaveBeenCalledWith({portalClientId:'a',competencia:'2026-11',autorId:'session-user'},{db:f.db});
 expect(access).toHaveBeenCalledWith({minRole:'ACCOUNTANT'});
 expect(f.db.appSetting.upsert).not.toHaveBeenCalled();
});
describe('E2 FS12 confirmada na central', () => {
 function november() {
  const f = fixture(); f.audit.competencia = '2026-11';
  f.deps.autorId = 'user';
  f.deps.fiscal = jest.fn(async () => ({ portalClientId:'a', competencia:'2026-11',
   fs12:{ exigida:true, situacao:'CONFIRMADA', revisao:2, contextoRevisao:'context-current', serie:[{mes:'2026-10',valorCentavos:12345}] },
   capacidades:{calcular:true}, impedimentos:[] }));
  return f;
 }
 async function novemberCommand(f, extra = {}) {
  return {companyId:'a',competencia:'2026-11',userId:'user',requestId:'november-123',confirmCompetencia:'2026-11',
   expectedRevision:(await prepararCalculoOperacoes(f.db,'a','2026-11',f.deps)).revision,...extra};
 }
 test('simulação recebe revisão/contexto confirmados; Fator R não inventa folha', async () => {
  const f=november(); f.deps.getDados.mockResolvedValue({atividades:[{idAtividade:'1',valorInterno:100,valorExterno:0,sujeitoFatorR:true}],faturamento:{total:100},rbt12Origem:'EXTRATO_PGDAS',rbt12:1000});
  const out=await executarCalculoOperacoes(f.db,await novemberCommand(f),f.deps);
  expect(out.status).toBe('CALCULATED');
  expect(f.deps.calculate).toHaveBeenCalledWith(expect.objectContaining({fs12RevisaoEsperada:2,fs12ContextoRevisao:'context-current',folhaMensal12:[{pa:'2026-10',valor:123.45}]}));
  expect(f.deps.fiscal).toHaveBeenCalledWith(expect.objectContaining({autorId:'user'}),expect.objectContaining({db:f.db}));
 });
 test('revisão alterada depois da prévia impede coletar e simular', async () => {
  const f=november(), c=await novemberCommand(f);
  f.deps.fiscal.mockResolvedValue({fs12:{revisao:3,contextoRevisao:'new',serie:[]},capacidades:{calcular:true},impedimentos:[]});
  await expect(executarCalculoOperacoes(f.db,c,f.deps)).rejects.toThrow();
  expect(f.deps.collect).not.toHaveBeenCalled(); expect(f.deps.calculate).not.toHaveBeenCalled();
 });
 test('impedimento tipado permanece legível e impede comando', async () => {
  const f=november(); f.deps.fiscal.mockResolvedValue({fs12:{revisao:0},capacidades:{calcular:false},impedimentos:[{code:'FS12_CONFIRMACAO_AUSENTE',mensagem:'Confirme os meses e valores.'}]});
  const preview=await prepararCalculoOperacoes(f.db,'a','2026-11',f.deps);
  expect(preview.canCalculate).toBe(false); expect(preview.blockers).toContain('Confirme os meses e valores.');
  expect(f.deps.calculate).not.toHaveBeenCalled();
 });
 test.each([false,true])('zero depende de base completa e confirmação explícita %s', async confirmed => {
  const f=november(); f.deps.getDados.mockResolvedValue({atividades:[],semMovimentoDisponivel:true,faturamento:{total:0},rbt12Origem:'EXTRATO_PGDAS',rbt12:1000});
  const out=await executarCalculoOperacoes(f.db,await novemberCommand(f,{confirmSemMovimento:confirmed}),f.deps);
  expect(out.status).toBe(confirmed?'CALCULATED':'REVIEW');
  expect(f.deps.calculate).toHaveBeenCalledTimes(confirmed?1:0);
 });
 test('confirmação humana não transforma receita ausente em zero', async () => {
  const f=november(); f.deps.getDados.mockResolvedValue({atividades:[],semMovimentoDisponivel:true,faturamento:{total:null},rbt12Origem:'EXTRATO_PGDAS',rbt12:1000});
  expect((await executarCalculoOperacoes(f.db,await novemberCommand(f,{confirmSemMovimento:true}),f.deps)).status).toBe('REVIEW');
  expect(f.deps.calculate).not.toHaveBeenCalled();
 });
});

// Integration of both Operations entry points; fiscal I/O and DB are local doubles.
test.each(['CALCULATED','REVIEW'])('executor suspenso não rebaixa resultado causal %s após erro tardio',async terminal=>{
 const f=fixture(),pa='2026-11',requestId='late-request-123';f.audit.competencia=pa;
 const fs12={revisao:2,contextoRevisao:'ctx',serie:[{mes:'2026-10',valorCentavos:100}]};
 f.deps.fiscal=jest.fn(async()=>({fs12,capacidades:{calcular:true},impedimentos:[]}));
 const command={id:'cmd',tentativaId:'try',portalClientId:'a',companyId:'legacy',competencia:pa,autorId:'user',intencao:'SIMULAR',revisaoFs12:2,contextoHash:'ctx',esperado:{preparacao:{operationsRequestId:requestId},custodia:{respostaId:'response'}}};
 f.db.fs12Comando={findUnique:jest.fn(async()=>command)};
 f.db.fs12ComandoCalculo={findMany:jest.fn(async()=>[{comandoId:'cmd'}])};
 f.db.fs12ComandoReserva={findUnique:jest.fn(async()=>({reservaId:'reservation'}))};
 f.db.fs12ComandoResposta={findUnique:jest.fn(async()=>({id:'response',comandoId:'cmd',reservaId:'reservation',marcadorKey:'serpro_dispatch:reservation',marcadorObservado:{started:true}}))};
 let reached,release;const started=new Promise(r=>{reached=r;}),pending=new Promise((_,reject)=>{release=reject;});
 f.deps.calculate.mockImplementation(async args=>{await args.manualOperation.beforeDispatch();reached();return pending;});
 const c={companyId:'a',competencia:pa,userId:'user',requestId,confirmCompetencia:pa,expectedRevision:(await prepararCalculoOperacoes(f.db,'a',pa,f.deps)).revision};
 const execution=executarCalculoOperacoes(f.db,c,f.deps);await started;
 f.settings.set('serpro_dispatch:reservation',{started:true});
 f.setSnapshot({idempotencyKey:'recovered',estado:'calculada'});
 const recover=jest.fn(async()=>terminal==='CALCULATED'?{ok:true,comandoId:'cmd',tentativaId:'try',operationsRequestId:requestId,calculoId:'recovered',dasValor:6,snapshot:{idempotencyKey:'recovered'}}:{ok:false,estado:'REJEITADA',comandoId:'cmd',tentativaId:'try',operationsRequestId:requestId,respostaId:'response',revisaoFs12:2,portalClientId:'a',competencia:pa,motivo:'Recusa causal preservada',mensagens:[]});
 const recovered=await reconciliarCalculoOperacoes(f.db,c,{recover});
 const key=`operations_calculation:a:${pa}`,persisted=JSON.parse(JSON.stringify(f.settings.get(key))),writes=f.db.appSetting.upsert.mock.calls.length;
 expect(recovered.attempt.status).toBe(terminal);
 release(Error('Falha tardia da conexão original'));
 expect(await execution).toEqual(recovered.attempt);
 expect(f.settings.get(key)).toEqual(persisted);
 expect(f.settings.get(`${key}:request:${requestId}`)).toEqual(persisted);
 expect(f.db.appSetting.upsert).toHaveBeenCalledTimes(writes);
 expect(f.deps.calculate).toHaveBeenCalledTimes(1);
});
test('rota sem identidade de sessão recusa autorId forjado em query/body',async()=>{
 const f=fixture();f.audit.competencia='2026-11';const app=express();app.use(express.json());
 app.use((req,res,next)=>{req.auth={user:{}};next();});
 app.use(createOperationsRouter({prisma:f.db,requireFirmCompanyAccess:()=> (req,res,next)=>next(),calculationDependencies:f.deps}));
 const response=await request(app).get('/companies/a/operacoes/2026-11/calculo/previa').query({autorId:'forged'}).send({autorId:'forged'});
 expect(response.status).toBe(401);expect(response.body.message).toBe('Autenticação necessária.');
 expect(f.deps.collect).not.toHaveBeenCalled();expect(f.db.appSetting.upsert).not.toHaveBeenCalled();
});
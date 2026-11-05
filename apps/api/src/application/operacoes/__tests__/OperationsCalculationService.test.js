import { prepararCalculoOperacoes, executarCalculoOperacoes, lerResultadoCalculoOperacoes, conferirCalculoManualOperacoes } from '../OperationsCalculationService.js';
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

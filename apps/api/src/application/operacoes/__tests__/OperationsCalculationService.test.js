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

test.each([['2026-11', /integração fiscal da FS12/], ['2026-12', /integração fiscal da FS12/], ['2027-01', /2027.*homologação/]])('FS12 Operações: %s recusa cálculo antes de coleta ou reserva', async (competencia, message) => {
 const f = fixture(); f.audit.competencia = competencia;
 const preview = await prepararCalculoOperacoes(f.db, 'a', competencia, f.deps);
 expect(preview.canCalculate).toBe(false);
 expect(preview.blockers.join(' ')).toMatch(message);
 await expect(executarCalculoOperacoes(f.db, { companyId:'a', competencia, userId:'user', requestId:'fs12-guard-request', confirmCompetencia:competencia, expectedRevision:preview.revision }, f.deps)).rejects.toThrow(message);
 expect(f.deps.collect).not.toHaveBeenCalled(); expect(f.deps.calculate).not.toHaveBeenCalled();
 expect(f.db.appSetting.upsert).not.toHaveBeenCalled();
});

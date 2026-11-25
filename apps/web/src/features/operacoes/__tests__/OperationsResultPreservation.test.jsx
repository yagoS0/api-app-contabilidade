// Results remain visible while parent data refreshes; command authority is revalidated.
import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OperationsPage } from '../OperationsPage';
jest.mock('../OperationsDailyCalendar', () => ({ OperationsDailyCalendar: () => null }));
jest.mock('../OperationsRoutineCompanies', () => ({ OperationsRoutineCompanies: () => null }));
jest.mock('../OperationsAlerts', () => ({ OperationsAlerts: () => null }));
const pa='2026-10', reason='Coleta parcial: confira as notas antes de calcular.';
const companies=[{companyId:'a',razao:'Empresa sintética',myRole:'ACCOUNTANT',apuracao:{competencia:pa}}];
beforeAll(()=>{if(!crypto.randomUUID)crypto.randomUUID=()=> 'diagnostic-request';});
function fixture({resultStatus='REVIEW',initial='PENDING',calculated=false}={}) {
 let control, lastAttempt=null, batches=[];
 let operation={companyId:'a',competencia:pa,revision:'r1',regime:'SIMPLES',status:initial,pending:[],calculation:calculated?{calculoId:'calc-1',dasValor:120}:null};
 const api={
  getOperationEvidence:jest.fn(async competencia=>({ok:true,competencia,total:1,items:[{...operation,competencia}]})),
  getCompanyOperation:jest.fn(async()=>operation),
  previewOperationsCalculation:jest.fn(async()=>({companyId:'a',competencia:pa,revision:'preview-r1',canCalculate:true,blockers:[]})),
  executeOperationsCalculation:jest.fn(async(id,competencia,input)=>{lastAttempt={companyId:id,competencia,requestId:input.requestId,status:resultStatus,reason:resultStatus==='REVIEW'?reason:null,calculation:resultStatus==='CALCULATED'?{receita:1000,imposto:120}:null};return lastAttempt;}),
  getOperationsCalculationResult:jest.fn(async()=>({companyId:'a',competencia:pa,attempt:{...lastAttempt,reason:'Tentativa consultada sem repetir cálculo.'}})),
  getApuracaoSnapshot:jest.fn(async(id,competencia)=>({snapshot:{portalClientId:id,competencia,estado:'calculada',idempotencyKey:'calc-1',dasSimuladoSerpro:120,atividadesEscolhidas:[]}})),
  getAuditoriaNotas:jest.fn(async(id,competencia)=>({auditoria:{competencia,totalAchados:0,perguntas:[]}})),
  getPgdasHistorico:jest.fn(async(id,competencia)=>({competencia,versoes:[]})),
  saveCompanyOperation:jest.fn(async(id,competencia,input)=>{operation={...operation,revision:'r2',status:input.action==='release'?'RELEASED':'CONFIRMED'};return operation;}),
  executeCompanyOperation:jest.fn(async()=>{operation={...operation,status:'EXECUTED',execution:{status:'DONE'}};return {ok:true};}),
  listOperationsBatches:jest.fn(async()=>({ok:true,items:batches})),
  previewOperationsBatch:jest.fn(async()=>({ok:true,preview:{id:'batch-preview',competencia:pa,items:[{companyId:'a',name:'Empresa sintética'}],blocked:[]}})),
  acceptOperationsBatch:jest.fn(async()=>{const batch={id:'batch-1',competencia:pa,items:[{companyId:'a',name:'Empresa sintética',state:'WAITING',message:'Resultado de rotina persistido.'}]};batches=[batch];return {ok:true,batch};}),
 };
 const refresh=jest.fn(()=>control(old=>({...old,loading:true})));
 function Parent(){const[state,setState]=useState({loading:false,error:'',competencia:pa,companies});control=setState;return <OperationsPage api={api} {...state} onRefresh={refresh}/>;}
 render(<Parent/>);
 return {api,refresh,set:patch=>act(async()=>control(old=>({...old,...patch}))),finish:()=>act(async()=>control(old=>({...old,loading:false})))};
}
async function openStage(name='Calculado') {
 await waitFor(()=>expect(screen.getByRole('button',{name:new RegExp('^'+name+' ')})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:new RegExp('^'+name+' ')}));
 await waitFor(()=>expect(screen.getByRole('checkbox',{name:'Selecionar Empresa sintética'})).toBeEnabled());
}
async function prepare(mode='individual') {
 await openStage();
 if(mode==='individual')fireEvent.click(screen.getByRole('button',{name:'Calcular',exact:true}));
 else {fireEvent.click(screen.getByRole('checkbox',{name:'Selecionar Empresa sintética'}));fireEvent.click(screen.getByRole('button',{name:'Calcular selecionadas'}));}
 await waitFor(()=>expect(screen.getByRole('button',{name:'Confirmar cálculo (1)'})).toBeEnabled());
}
async function calculate(flow,mode='individual'){
 await prepare(mode);fireEvent.click(screen.getByRole('button',{name:'Confirmar cálculo (1)'}));
 await waitFor(()=>expect(flow.refresh).toHaveBeenCalledTimes(1));
}

test.each([['individual','REVIEW'],['selecionadas','REVIEW'],['individual','CALCULATED'],['selecionadas','CALCULATED']])('%s preserva %s durante/depois da recarga',async(mode,resultStatus)=>{
 const flow=fixture({resultStatus});await calculate(flow,mode);
 const result=screen.getByRole('region',{name:'Cálculo de NFS-e selecionadas'});
 expect(result).toBeVisible();
 if(resultStatus==='REVIEW')expect(within(result).getByText(reason)).toBeVisible();else expect(within(result).getByText('R$ 120,00',{exact:false})).toBeVisible();
 await flow.finish();expect(result).toBeVisible();expect(flow.api.executeOperationsCalculation).toHaveBeenCalledTimes(1);
});
test('consulta do resultado sobrevive à segunda recarga sem novo POST',async()=>{
 const flow=fixture();await calculate(flow);await flow.finish();
 fireEvent.click(screen.getByRole('button',{name:'Conferir resultado'}));
 await waitFor(()=>expect(flow.refresh).toHaveBeenCalledTimes(2));
 expect(screen.getByText('Tentativa consultada sem repetir cálculo.')).toBeVisible();
 await flow.finish();expect(screen.getByText('Tentativa consultada sem repetir cálculo.')).toBeVisible();
 expect(flow.api.executeOperationsCalculation).toHaveBeenCalledTimes(1);expect(flow.api.getOperationsCalculationResult).toHaveBeenCalledTimes(1);
});
test('erro da recarga preserva resultado sem reautorizar comandos',async()=>{
 const flow=fixture();await calculate(flow);await flow.set({loading:false,error:'Carteira indisponível'});
 expect(screen.getByText(reason)).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Voltar',exact:true}));
 expect(screen.getByRole('button',{name:'Calcular',exact:true})).toBeDisabled();
 expect(screen.getByRole('button',{name:'Calcular selecionadas'})).toBeDisabled();expect(flow.api.executeOperationsCalculation).toHaveBeenCalledTimes(1);
});
test('recarga durante prévia bloqueia confirmação no rodapé',async()=>{
 const flow=fixture();await prepare();await flow.set({loading:true});
 const confirm=screen.getByRole('button',{name:'Confirmar cálculo (1)'});expect(confirm).toBeDisabled();fireEvent.click(confirm);
 expect(flow.api.executeOperationsCalculation).not.toHaveBeenCalled();await flow.set({loading:false,error:'Erro na carteira'});expect(confirm).toBeDisabled();
});
test.each(['competencia','companies'])('troca de %s não conserva resultado fora do contexto',async field=>{
 const flow=fixture();await calculate(flow);await flow.finish();await flow.set(field==='competencia'?{competencia:'2026-09'}:{companies:[]});
 await waitFor(()=>expect(screen.queryByText(reason)).not.toBeInTheDocument());expect(flow.api.executeOperationsCalculation).toHaveBeenCalledTimes(1);
});
test('confirmação preserva sucesso enquanto recarrega e não transmite',async()=>{
 const flow=fixture({calculated:true});await openStage();fireEvent.click(screen.getByRole('checkbox',{name:'Selecionar Empresa sintética'}));fireEvent.click(screen.getByRole('button',{name:'Conferir selecionadas'}));
 fireEvent.click(await screen.findByRole('button',{name:'Confirmar cálculos selecionados'}));await waitFor(()=>expect(flow.refresh).toHaveBeenCalledTimes(1));
 expect(screen.getByText('Alteração salva.')).toBeVisible();await flow.finish();expect(screen.getByText('Alteração salva.')).toBeVisible();expect(flow.api.executeCompanyOperation).not.toHaveBeenCalled();
});
test('transmissão preserva resultado após recarga sem repetir execução',async()=>{
 const flow=fixture({initial:'CONFIRMED',calculated:true});await openStage('Confirmado');fireEvent.click(screen.getByRole('checkbox',{name:'Selecionar Empresa sintética'}));fireEvent.click(screen.getByRole('button',{name:'Transmitir selecionadas'}));
 await screen.findByRole('region',{name:'Conferir transmissão'});fireEvent.change(screen.getByLabelText('Digite a competência 2026-10 para executar'),{target:{value:pa}});fireEvent.click(screen.getByRole('button',{name:'Liberar e executar'}));await waitFor(()=>expect(flow.refresh).toHaveBeenCalledTimes(1));
 expect(screen.getByText(/1 liberação\(ões\) processada/)).toBeVisible();await flow.finish();expect(screen.getByText(/1 liberação\(ões\) processada/)).toBeVisible();expect(flow.api.executeCompanyOperation).toHaveBeenCalledTimes(1);
});
test('aceite de rotina mantém resultado e bloqueia nova liberação durante recarga',async()=>{
 const flow=fixture({initial:'CONFIRMED',calculated:true});await openStage('Confirmado');fireEvent.click(screen.getByRole('button',{name:'Liberar rotina',exact:true}));await screen.findByRole('region',{name:'Liberar rotina de transmissão'});
 fireEvent.change(screen.getByLabelText('Digite a competência 2026-10'),{target:{value:pa}});fireEvent.click(screen.getByRole('button',{name:'Liberar rotina',exact:true}));await waitFor(()=>expect(flow.refresh).toHaveBeenCalledTimes(1));
 expect(screen.getByText('Resultado de rotina persistido.')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Liberar rotina',exact:true})).toBeDisabled();await flow.finish();expect(screen.getByText('Resultado de rotina persistido.')).toBeInTheDocument();expect(flow.api.acceptOperationsBatch).toHaveBeenCalledTimes(1);
});
test('falha da leitura permite retry e recupera comandos só após nova evidência',async()=>{
 const flow=fixture();await openStage();
 flow.api.getOperationEvidence.mockRejectedValueOnce(new Error('Leitura de conferências indisponível'));
 const retry=screen.getByRole('button',{name:'Atualizar conferências'});
 fireEvent.click(retry);
 await waitFor(()=>expect(screen.getAllByText('Leitura de conferências indisponível').length).toBeGreaterThan(0));
 await waitFor(()=>expect(retry).toBeEnabled());
 expect(screen.queryByText('Lendo cálculos e evidências…')).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Calcular',exact:true})).toBeDisabled();
 fireEvent.click(retry);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Calcular',exact:true})).toBeEnabled());
 expect(screen.queryByText('Leitura de conferências indisponível')).not.toBeInTheDocument();
 expect(flow.api.executeOperationsCalculation).not.toHaveBeenCalled();
});

test('resposta tardia após troca de API não publica resultado nem atualiza contexto novo',async()=>{
 const flow=fixture();let resolveCalculation;
 flow.api.executeOperationsCalculation.mockImplementationOnce((id,competencia,input)=>new Promise(resolve=>{resolveCalculation=()=>resolve({companyId:id,competencia,requestId:input.requestId,status:'REVIEW',reason:'Retorno antigo da API'});}));
 await prepare();fireEvent.click(screen.getByRole('button',{name:'Confirmar cálculo (1)'}));
 await waitFor(()=>expect(flow.api.executeOperationsCalculation).toHaveBeenCalledTimes(1));
 const replacement={...flow.api,executeOperationsCalculation:jest.fn()};
 await flow.set({api:replacement});
 await act(async()=>resolveCalculation());
 expect(screen.queryByText('Retorno antigo da API')).not.toBeInTheDocument();
 expect(flow.refresh).not.toHaveBeenCalled();expect(replacement.executeOperationsCalculation).not.toHaveBeenCalled();
});

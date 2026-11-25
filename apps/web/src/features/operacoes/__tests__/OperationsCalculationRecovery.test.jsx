import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {OperationsCalculationBatch} from '../OperationsCalculationBatch';
const item={companyId:'a',name:'Empresa A'},pa='2026-11',requestId='11111111-1111-4111-8111-111111111111';
function fixture(){
 const attempt={companyId:'a',competencia:pa,requestId,status:'UNCERTAIN',reason:'Conferir resposta'};
 const api={previewOperationsCalculation:jest.fn(async()=>({companyId:'a',competencia:pa,revision:'r',regime:'SIMPLES',canCalculate:false,blockers:['Tentativa incerta'],lastAttempt:attempt})),getOperationsCalculationResult:jest.fn(async()=>({companyId:'a',competencia:pa,attempt})),reconcileOperationsCalculation:jest.fn(async()=>({companyId:'a',competencia:pa,attempt})),executeOperationsCalculation:jest.fn()};
 render(<OperationsCalculationBatch api={api} items={[item]} competencia={pa}/>);return api;
}
async function read(){fireEvent.click(await screen.findByRole('button',{name:'Conferir resultado'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Reconciliar cálculo sem reenviar'})).toBeEnabled());}
test('recuperar resposta nunca pede encerramento nem repete cálculo',async()=>{
 const api=fixture();await read();fireEvent.click(screen.getByRole('button',{name:'Reconciliar cálculo sem reenviar'}));
 await waitFor(()=>expect(api.reconcileOperationsCalculation).toHaveBeenCalledWith('a',pa,requestId,false));expect(api.executeOperationsCalculation).not.toHaveBeenCalled();
});
test('encerramento exige ação nominal e confirmação separada',async()=>{
 const api=fixture();await read();fireEvent.click(screen.getByRole('button',{name:'Encerrar tentativa não enviada'}));
 expect(api.reconcileOperationsCalculation).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Confirmar encerramento sem despacho'}));
 await waitFor(()=>expect(api.reconcileOperationsCalculation).toHaveBeenCalledWith('a',pa,requestId,true));expect(api.executeOperationsCalculation).not.toHaveBeenCalled();
});

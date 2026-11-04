import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {OperationsProcurationTable} from '../OperationsProcurationTable';
test('leitura sem vínculo não autoriza e consulta exige seleção e confirmação',async()=>{
 const result={companyId:'a',status:'ATIVA',validUntil:'2099-12-31',checkedAt:new Date().toISOString(),systems:['PGDASD'],vinculoConfirmado:false};
 const api={getSerproCompanyProcuration:jest.fn(async()=>({ok:true,result})),checkSerproCompanyProcuration:jest.fn(async()=>({ok:true,result}))};
 render(<OperationsProcurationTable api={api} rows={[{company:{companyId:'a',razao:'Alfa',myRole:'ACCOUNTANT'}}]} competencia="2026-10" onClose={()=>{}}/>);
 await screen.findByText('Não verificada');expect(api.checkSerproCompanyProcuration).not.toHaveBeenCalled();fireEvent.click(screen.getByLabelText('Selecionar Alfa'));fireEvent.click(screen.getByText('Buscar procurações · SERPRO'));expect(api.checkSerproCompanyProcuration).not.toHaveBeenCalled();fireEvent.click(screen.getByText('Confirmar consulta'));await waitFor(()=>expect(api.checkSerproCompanyProcuration).toHaveBeenCalledWith('a'));
});

test('cancelar consulta de procuração retorna foco ao gatilho real',async()=>{
 const api={getSerproCompanyProcuration:jest.fn(async()=>({ok:true,result:{companyId:'a',status:'DESCONHECIDA'}})),checkSerproCompanyProcuration:jest.fn()};render(<OperationsProcurationTable api={api} rows={[{company:{companyId:'a',razao:'Alfa',myRole:'ACCOUNTANT'}}]} competencia="2026-10" onClose={()=>{}}/>);await screen.findByText('Não verificada');fireEvent.click(screen.getByLabelText('Selecionar Alfa'));const trigger=screen.getByText('Buscar procurações · SERPRO');trigger.focus();fireEvent.click(trigger);expect(screen.getByRole('heading',{name:'Conferir consulta de procurações'})).toHaveFocus();const cancel=screen.getByText('Cancelar');cancel.focus();fireEvent.click(cancel);expect(trigger).toHaveFocus();expect(api.checkSerproCompanyProcuration).not.toHaveBeenCalled();
});

test.each([undefined, 'outra'])('recusa procuração sem identidade correspondente: %s', async companyId => {
 const api={getSerproCompanyProcuration:jest.fn(async()=>({ok:true,result:{companyId,status:'ATIVA',vinculoConfirmado:true,validUntil:'2099-12-31',systems:['PGDASD']}})),checkSerproCompanyProcuration:jest.fn()};
 render(<OperationsProcurationTable api={api} rows={[{company:{companyId:'a',razao:'Alfa'}}]} competencia="2026-10" onClose={()=>{}}/>);
 await screen.findByText('Leitura indisponível');expect(screen.queryByText('Vigente')).not.toBeInTheDocument();expect(api.checkSerproCompanyProcuration).not.toHaveBeenCalled();
});

test('vínculo validado pelo servidor mantém detalhe ativo sem consulta fiscal',async()=>{
 const result={companyId:'a',status:'ATIVA',procurationStatus:'ATIVA',vinculoConfirmado:true,checkedAt:new Date().toISOString(),validUntil:'2099-12-31',systems:['PGDASD']};
 const api={getSerproCompanyProcuration:jest.fn(async()=>({ok:true,result})),checkSerproCompanyProcuration:jest.fn()};
 render(<OperationsProcurationTable api={api} rows={[{company:{companyId:'a',razao:'Alfa'}}]} competencia="2026-10" onClose={()=>{}}/>);
 await screen.findByText('Ativa até 31/12/2099');expect(screen.queryByText('Revalidar')).not.toBeInTheDocument();expect(api.checkSerproCompanyProcuration).not.toHaveBeenCalled();
});

test('12 ativas documentais mantêm filtro 12 e Todas inclui universo completo', async () => {
 const result={status:'ATIVA',validUntil:'2099-12-31',checkedAt:new Date(Date.now()-4*86400000).toISOString(),vinculoConfirmado:true};
 const rows=Array.from({length:13},(_,i)=>({company:{companyId:String(i),razao:'Empresa '+i,serproStatus:i<12?result:{status:'DESCONHECIDA'}}}));
 const api={getSerproCompanyProcuration:jest.fn(async id=>({ok:true,result:{companyId:id,...(id==='12'?{status:'DESCONHECIDA'}:result)}})),checkSerproCompanyProcuration:jest.fn()};
 render(<OperationsProcurationTable api={api} rows={rows} initialFilter="positive" competencia="2026-10" onClose={()=>{}}/>);
 await waitFor(()=>expect(screen.getAllByText('Ativa até 31/12/2099')).toHaveLength(12));
 expect(screen.queryByText('Empresa 12')).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Situação'),{target:{value:'all'}});
 expect(screen.getByText('Empresa 12')).toBeInTheDocument();expect(api.checkSerproCompanyProcuration).not.toHaveBeenCalled();
});

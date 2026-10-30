import { render, screen, fireEvent, within, act, waitFor } from '@testing-library/react';
import { OperationsRoutineCompanies } from '../OperationsRoutineCompanies';
const companies = [{companyId:'a',razao:'Empresa Alfa',cnpj:'111'},{companyId:'b',razao:'Empresa Beta',cnpj:'222'}];
const response = {items:[{companyId:'a',enabledKeys:['das','inss'],applicableKeys:['das','inss']},{companyId:'b',enabledKeys:['das'],applicableKeys:['das','inss']}],routines:[{key:'das',label:'DAS'},{key:'inss',label:'INSS'}]};
const apiFor = extra => ({getOperationRoutines:jest.fn(async()=>response),getOperationConsultas:jest.fn(async competencia=>({items:[],total:0,competencia})),...extra});
async function open() { await screen.findByText('1 / 1'); fireEvent.click(screen.getByRole('button',{name:/Rotinas.*Habilitadas \/ desabilitadas/})); }
test('sem competência preserva seleção local e não consulta período indefinido',async()=>{
 const api=apiFor();render(<OperationsRoutineCompanies api={api} companies={companies}/>);await open();
 expect(screen.getByRole('tab',{name:'Habilitadas · 1'})).toBeInTheDocument();expect(screen.getByRole('tab',{name:'Erros · —'})).toHaveAttribute('aria-selected','true');expect(api.getOperationConsultas).not.toHaveBeenCalled();
});
test('um quadro, abas ordenadas, teclado e empresas habilitadas sem efeitos fiscais',async()=>{
 const api=apiFor({executeCompanyOperation:jest.fn(),getCompanyAutomation:jest.fn()});render(<OperationsRoutineCompanies api={api} companies={companies} competencia="2026-10"/>);await open();
 const tabs=screen.getAllByRole('tab');expect(tabs.map(t=>t.textContent)).toEqual(['Erros · 0','Desabilitadas · 1','Habilitadas · 1']);
 fireEvent.keyDown(tabs[0],{key:'ArrowRight'});expect(tabs[1]).toHaveFocus();expect(tabs[1]).toHaveAttribute('aria-selected','true');
 fireEvent.click(tabs[2]);expect(within(screen.getByRole('tabpanel')).getByText('Empresa Alfa')).toBeInTheDocument();expect(within(screen.getByRole('tabpanel')).queryByText('Empresa Beta')).not.toBeInTheDocument();
 expect(screen.getByRole('link',{name:'Abrir configurações'})).toHaveAttribute('href','/companies/a/automacao');expect(api.getCompanyAutomation).not.toHaveBeenCalled();expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});
test('qualquer flag não habilita: exige todas as aplicáveis e busca desabilitadas',async()=>{
 render(<OperationsRoutineCompanies api={apiFor()} companies={companies} competencia="2026-10"/>);await open();fireEvent.click(screen.getByRole('tab',{name:'Desabilitadas · 1'}));
 fireEvent.change(screen.getByRole('searchbox'),{target:{value:'222'}});expect(screen.getByText('Empresa Beta')).toBeInTheDocument();expect(screen.queryByText('Empresa Alfa')).not.toBeInTheDocument();
});
test('falha de leitura não transforma ausência em desabilitadas',async()=>{
 render(<OperationsRoutineCompanies api={apiFor({getOperationRoutines:async()=>{throw Error('Sem conexão');}})} companies={companies} competencia="2026-10"/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão');expect(screen.getByText('— / —')).toBeInTheDocument();
});
test('empresa ausente do retorno fica a verificar fora dos denominadores conhecidos',async()=>{
 const api=apiFor({getOperationRoutines:async()=>({...response,items:response.items.slice(0,1)})});render(<OperationsRoutineCompanies api={api} companies={companies} competencia="2026-10"/>);
 await screen.findByText('1 / 0');expect(screen.getByText('1 a verificar')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:/Rotinas.*Habilitadas \/ desabilitadas/}));expect(screen.getByRole('tab',{name:'Desabilitadas · 0'})).toBeInTheDocument();
});
test('resposta de sessão antiga não substitui seleção atual',async()=>{
 let resolve;const old=apiFor({getOperationRoutines:()=>new Promise(r=>{resolve=r;})});const view=render(<OperationsRoutineCompanies api={old} companies={companies} competencia="2026-10"/>);
 const next=apiFor({getOperationRoutines:async()=>({...response,items:response.items.map(c=>({...c,enabledKeys:[]}))})});view.rerender(<OperationsRoutineCompanies api={next} companies={companies} competencia="2026-10"/>);await screen.findByText('0 / 2');await act(async()=>resolve(response));expect(screen.getByText('0 / 2')).toBeInTheDocument();
});
test('regime desconhecido e rotina não aplicável não contam como desabilitados',async()=>{
 const api=apiFor({getOperationRoutines:async()=>({...response,items:[{companyId:'a',enabledKeys:['presumido'],applicableKeys:['presumido']},{companyId:'b',enabledKeys:[],applicableKeys:[],unavailableReason:'Regime não confirmado'}]})});render(<OperationsRoutineCompanies api={api} companies={companies} competencia="2026-10"/>);await screen.findByText('1 / 0');expect(screen.getByText('1 a verificar')).toBeInTheDocument();
});
test('erro da carteira pode ser recuperado sem executar rotina',async()=>{
 const api=apiFor({executeCompanyOperation:jest.fn()}),refresh=jest.fn();const view=render(<OperationsRoutineCompanies api={api} companies={companies} competencia="2026-10"/>);await open();
 view.rerender(<OperationsRoutineCompanies api={api} companies={companies} competencia="2026-10" error="Falha na carteira" onRefreshCompanies={refresh}/>);
 expect(screen.getByRole('alert')).toHaveTextContent('Falha na carteira');fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));await waitFor(()=>expect(refresh).toHaveBeenCalledTimes(1));expect(api.executeCompanyOperation).not.toHaveBeenCalled();
 view.rerender(<OperationsRoutineCompanies api={api} companies={companies} competencia="2026-10"/>);await screen.findByText('1 / 1');fireEvent.click(screen.getByRole('tab',{name:'Habilitadas · 1'}));expect(screen.getByText('Empresa Alfa')).toBeInTheDocument();
});
test('erro é independente da habilitação e usa destino tipado, sem interpretar mensagem',async()=>{
 const api=apiFor({getOperationConsultas:async competencia=>({competencia,total:1,items:[{id:'e',companyId:'b',action:'CONS',errorMessage:'Texto menciona contabilidade',correctionTab:'certificado'}]})});render(<OperationsRoutineCompanies api={api} companies={companies} competencia="2026-10"/>);await open();
 expect(screen.getByRole('tab',{name:'Erros · 1'})).toBeInTheDocument();expect(screen.getByRole('link',{name:'Corrigir erro'})).toHaveAttribute('href','/companies/b/certificado?competencia=2026-10');fireEvent.click(screen.getByRole('tab',{name:'Desabilitadas · 1'}));expect(screen.getByText('Empresa Beta')).toBeInTheDocument();
});
test('erros antigos não contaminam nova competência; busca conserva conjunto',async()=>{
 let old;const api=apiFor({getOperationConsultas:jest.fn(comp=>comp==='2026-09'?new Promise(r=>{old=r;}):Promise.resolve({items:[{id:'e',companyId:'b',action:'CONS',errorMessage:'Consulta recusada'}],total:1,competencia:comp}))});
 const view=render(<OperationsRoutineCompanies api={api} companies={companies} competencia="2026-09"/>);await screen.findByText('1 / 1');view.rerender(<OperationsRoutineCompanies api={api} companies={companies} competencia="2026-10"/>);await act(async()=>{});await open();expect(screen.getByRole('tab',{name:'Erros · 1'})).toBeInTheDocument();
 await act(async()=>old({items:[],total:0,competencia:'2026-09'}));expect(screen.getByText('Consulta recusada')).toBeInTheDocument();fireEvent.change(screen.getByRole('searchbox'),{target:{value:'Alfa'}});expect(screen.queryByText('Empresa Beta')).not.toBeInTheDocument();
});

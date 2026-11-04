import { render, screen, fireEvent } from '@testing-library/react';
import { CompanyAutomation } from '../CompanyAutomation';
jest.mock('../OperationsManualInss',()=>({CompanyManualInss:()=>null}));
jest.mock('../CompanyGuideDelivery',()=>({CompanyGuideDelivery:()=>null}));
const data={companyId:'a',revision:'r1',agendaEventos:{schemaVersion:1,revision:'agenda-r1',version:0,executionMode:'LEGADO',relativeConsumerReady:false,overrides:{},effective:{},origins:{}},rotinas:[],envioGuias:{enabled:false,applicableCurrentRegime:true},automationPolicy:{paused:false},globalAutomationPolicy:{paused:false}};
beforeEach(()=>Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=> 'envio-request'}));
test('seleção nasce desligada e precisa prévia; só salva envio sem ligar outra rotina',async()=>{
 const api={getCompanyAutomation:jest.fn(async()=>data),saveCompanyAutomation:jest.fn(async(_,input)=>({...data,revision:'r2',envioGuias:{...data.envioGuias,...input.envioGuias}}))};
 render(<CompanyAutomation api={api} companyId="a" canEdit/>);
 const checkbox=await screen.findByLabelText('Selecionar empresa para envio automático de guias');expect(checkbox).not.toBeChecked();fireEvent.click(checkbox);
 fireEvent.click(screen.getByRole('button',{name:'Conferir alterações'}));expect(api.saveCompanyAutomation).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Salvar configuração'}));await screen.findByText(/Configuração salva/);
 expect(api.saveCompanyAutomation).toHaveBeenCalledWith('a',{expectedRevision:'r1',requestId:'envio-request',envioGuias:{enabled:true}});
});
test('acesso somente leitura não altera seleção',async()=>{
 render(<CompanyAutomation api={{getCompanyAutomation:async()=>data}} companyId="a" canEdit={false}/>);
 expect(await screen.findByLabelText('Selecionar empresa para envio automático de guias')).toBeDisabled();
});
test('resposta de salvamento incoerente não informa sucesso e preserva seleção pendente',async()=>{
 const api={getCompanyAutomation:async()=>data,saveCompanyAutomation:jest.fn(async()=>data)};
 render(<CompanyAutomation api={api} companyId="a" canEdit/>);fireEvent.click(await screen.findByLabelText('Selecionar empresa para envio automático de guias'));
 fireEvent.click(screen.getByRole('button',{name:'Conferir alterações'}));fireEvent.click(screen.getByRole('button',{name:'Salvar configuração'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível confirmar o envio automático');expect(screen.queryByText(/Configuração salva/)).not.toBeInTheDocument();
});

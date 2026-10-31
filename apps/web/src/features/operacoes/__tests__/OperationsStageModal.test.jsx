import { render, screen, fireEvent, within } from '@testing-library/react';
import { OperationsPage } from '../OperationsPage';
jest.mock('../OperationsAlerts',()=>({OperationsAlerts:()=>null}));
jest.mock('../OperationsRoutineCompanies',()=>({OperationsRoutineCompanies:()=>null}));
test('calculadas e não calculadas pertencem ao mesmo universo da barra; filtrar não grava',()=>{
  const companies=[true,false,null].map((apurada,index)=>({companyId:String(index),razao:`Empresa ${index}`,fluxoCarteira:{competencia:'2026-10',apuracao:{apurada},contabilizacao:{},status:{chave:'apuracao'}}}));
  const api={saveCompanyOperation:jest.fn(),executeCompanyOperation:jest.fn()};
  render(<OperationsPage api={api} companies={companies} competencia="2026-10" />);
  fireEvent.click(screen.getByRole('button',{name:'Calculado 1/3 empresas'}));
  const dialog=within(screen.getByRole('dialog'));
  for(const [value,name] of [['done','Empresa 0'],['pending','Empresa 1'],['unknown','Empresa 2']]) {
    fireEvent.change(screen.getByLabelText('Situação da etapa'),{target:{value}});
    expect(dialog.getByText(name)).toBeInTheDocument();
    expect(dialog.getByRole('region', {name:'Empresas da etapa'}).querySelector('table').tBodies[0].children).toHaveLength(1);
  }
  expect(api.saveCompanyOperation).not.toHaveBeenCalled(); expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});

test('evidências ficam fora das células e voltar preserva filtro e foco sem mutação',async()=>{
 const api={saveCompanyOperation:jest.fn(),executeCompanyOperation:jest.fn()};
 const companies=[{companyId:'a',razao:'Alfa',fluxoCarteira:{competencia:'2026-10',apuracao:{apurada:true},contabilizacao:{},status:{chave:'apuracao'}}}];
 render(<OperationsPage api={api} companies={companies} competencia="2026-10"/>);
 fireEvent.click(screen.getByRole('button',{name:'Calculado 1/1 empresas'}));
 fireEvent.change(screen.getByLabelText('Situação da etapa'),{target:{value:'done'}});
 const table=screen.getByRole('region',{name:'Empresas da etapa'});
 expect(table.querySelectorAll('table')).toHaveLength(1);
 const trigger=screen.getByRole('button',{name:'Ver evidências de Alfa'});fireEvent.click(trigger);
 expect(screen.getByRole('heading',{name:'Cálculo e auditoria de Alfa'})).toHaveFocus();
 expect(screen.queryByRole('region',{name:'Empresas da etapa'})).not.toBeInTheDocument();
 await screen.findByText(/Leitura de cálculo salvo:/);
 fireEvent.click(screen.getByRole('button',{name:'Voltar à tabela de empresas'}));
 expect(trigger).toHaveFocus();expect(screen.getByLabelText('Situação da etapa')).toHaveValue('done');
 expect(api.saveCompanyOperation).not.toHaveBeenCalled();expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});

test('revisão técnica vai ao detalhe, preservando bloqueio e mensagem visíveis na linha',async()=>{
 const revision='a'.repeat(64);const api={getOperationEvidence:jest.fn(async()=>({ok:true,competencia:'2026-10',total:1,items:[{companyId:'a',competencia:'2026-10',revision,status:'INVALIDATED',blocked:'Notas alteradas: confira a revisão.',execution:{status:'ERROR',message:'Transmissão com resultado incerto.'}}]})),saveCompanyOperation:jest.fn(),executeCompanyOperation:jest.fn()};
 const companies=[{companyId:'a',razao:'Alfa',myRole:'VIEWER',fluxoCarteira:{competencia:'2026-10',apuracao:{apurada:true},contabilizacao:{},status:{chave:'apuracao'}}}];render(<OperationsPage api={api} companies={companies} competencia="2026-10"/>);fireEvent.click(screen.getByRole('button',{name:'Calculado 1/1 empresas'}));
 expect(await screen.findByText('Notas alteradas: confira a revisão.')).toHaveAttribute('role','alert');expect(screen.getByText('Transmissão com resultado incerto.')).toBeInTheDocument();expect(screen.queryByText(`Revisão: ${revision}`)).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Ver evidências de Alfa'}));await screen.findByText(/Leitura de cálculo salvo:/);expect(screen.getByText(`Revisão: ${revision}`)).toBeInTheDocument();expect(within(screen.getByRole('dialog',{name:'Evidências de Alfa'})).getByText('Notas alteradas: confira a revisão.')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Conferir e continuar rotina'})).not.toBeInTheDocument();expect(api.saveCompanyOperation).not.toHaveBeenCalled();expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});
test('detalhe mantém guarda de operação e invalida o contexto ao trocar competência',async()=>{
 const companies=[{companyId:'a',razao:'Alfa',myRole:'ACCOUNTANT',fluxoCarteira:{competencia:'2026-10',apuracao:{apurada:true},contabilizacao:{},status:{chave:'apuracao'}}}];const api={saveCompanyOperation:jest.fn(),executeCompanyOperation:jest.fn()};const view=render(<OperationsPage api={api} companies={companies} competencia="2026-10"/>);fireEvent.click(screen.getByRole('button',{name:'Calculado 1/1 empresas'}));fireEvent.click(screen.getByRole('button',{name:'Ver evidências de Alfa'}));await screen.findByText(/Leitura de cálculo salvo:/);expect(screen.getByRole('button',{name:'Conferir e continuar rotina'})).toBeDisabled();view.rerender(<OperationsPage api={api} companies={companies} competencia="2026-09"/>);expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(api.saveCompanyOperation).not.toHaveBeenCalled();expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});
import { waitFor } from '@testing-library/react';

test('continuar pelo detalhe abre aprovação da mesma empresa sem comando operacional',async()=>{
 const companies=['a','b'].map(companyId=>({companyId,razao:companyId==='a'?'Alfa':'Beta',myRole:'ACCOUNTANT',fluxoCarteira:{competencia:'2026-10',apuracao:{apurada:true},contabilizacao:{},status:{chave:'apuracao'}}}));const api={getOperationEvidence:jest.fn(async()=>({ok:true,competencia:'2026-10',total:2,items:companies.map(c=>({companyId:c.companyId,competencia:'2026-10',revision:'revisao-'+c.companyId,status:'PENDING'}))})),getCompanyOperation:jest.fn(async(companyId,competencia)=>({ok:true,companyId,competencia,revision:'revisao-'+companyId,status:'PENDING',pending:[]})),saveCompanyOperation:jest.fn(),executeCompanyOperation:jest.fn()};render(<OperationsPage api={api} companies={companies} competencia="2026-10"/>);fireEvent.click(screen.getByRole('button',{name:'Calculado 2/2 empresas'}));await waitFor(()=>expect(screen.getByRole('button',{name:/^Confirmado /})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Ver evidências de Alfa'}));await screen.findByText('Revisão: revisao-a');fireEvent.click(screen.getByRole('button',{name:'Conferir e continuar rotina'}));
 const dialog=screen.getByRole('dialog',{name:'Conferir e liberar apurações'});expect(dialog).toBeInTheDocument();expect(screen.queryByRole('heading',{name:'Cálculo e auditoria de Alfa'})).not.toBeInTheDocument();expect(dialog).toContainElement(document.activeElement);await within(dialog).findByText('Alfa');expect(within(dialog).queryByText('Beta')).not.toBeInTheDocument();expect(api.saveCompanyOperation).not.toHaveBeenCalled();expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});

import { WorkspaceNavigation } from '../../../app/navigation/WorkspaceNavigation.shared';
const guideFilterCompanies = ['a','b'].map(companyId=>({companyId,razao:companyId==='a'?'Alfa':'Beta',guideCompliance:{competencia:'2026-10',das:{required:true,state:companyId==='a'?'falhou':'enviada',paymentStatus:'PAID'}},fluxoCarteira:{competencia:'2026-10',apuracao:{apurada:true},contabilizacao:{},status:{chave:'guias'}}}));
const guideFilterApi = () => ({
 getOperationEvidence:jest.fn(async()=>({ok:true,competencia:'2026-10',total:2,items:guideFilterCompanies.map(c=>({companyId:c.companyId,competencia:'2026-10',revision:'rev-'+c.companyId,status:c.companyId==='b'?'ATTENTION':'PENDING',blocked:c.companyId==='b'?'Bloqueio exclusivo da apuração':null,execution:c.companyId==='b'?{status:'RUNNING',message:'Execução fiscal em andamento'}:null}))})),
 getCompanyGuides:jest.fn(async companyId=>[{companyId,guideId:'guia-'+companyId,competencia:'2026-10',tipo:'DAS',status:'PROCESSED',paymentStatus:'PAID',paymentStatusSource:'MANUAL',envio:{canais:companyId==='a'?[{canal:'EMAIL',status:'enviado'},{canal:'WHATSAPP',status:'falhou',erroMensagem:'Falha real do canal'}]:[{canal:'WHATSAPP',status:'indeterminado'}]}}]),
 saveCompanyOperation:jest.fn(),executeCompanyOperation:jest.fn(),send:jest.fn(),
});
test.each(['Disponível','Enviado','Pago'])('%s não oferece filtro de apuração e preserva falha parcial, incerteza e pagamento',async stage=>{
 const api=guideFilterApi();render(<OperationsPage api={api} companies={guideFilterCompanies} competencia="2026-10"/>);fireEvent.click(screen.getByRole('button',{name:new RegExp(`^${stage} `)}));
 const filter=screen.getByLabelText('Situação da etapa');expect(within(filter).queryByRole('option',{name:/Erro|Atenção|bloqueio/i})).not.toBeInTheDocument();expect(within(filter).getAllByRole('option').map(option=>option.value)).toEqual(['all','done','pending','unknown']);
 await screen.findByText('Documento guia-a');await screen.findByText('Documento guia-b');expect(screen.getByText(/Falha: Falha real do canal/)).toBeInTheDocument();expect(screen.getByText(/Resultado incerto ou em processamento/)).toBeInTheDocument();expect(screen.getByRole('heading',{name:'Alfa'})).toBeInTheDocument();expect(screen.getByRole('heading',{name:'Beta'})).toBeInTheDocument();expect(screen.queryByText('Bloqueio exclusivo da apuração')).not.toBeInTheDocument();expect(screen.getAllByText(/Confirmada pelo contador/)).toHaveLength(2);expect(api.saveCompanyOperation).not.toHaveBeenCalled();expect(api.executeCompanyOperation).not.toHaveBeenCalled();expect(api.send).not.toHaveBeenCalled();
});
test('troca por URL normaliza filtro de atenção herdado sem esconder falha de envio',async()=>{
 const api=guideFilterApi();const navigate=jest.fn();const viewFor=stage=><WorkspaceNavigation.Provider value={{location:{pathname:'/companies',search:`?operacoesEtapa=${stage}&operacoesLista=all&operacoesCompetencia=2026-10`},navigate}}><OperationsPage api={api} companies={guideFilterCompanies} competencia="2026-10"/></WorkspaceNavigation.Provider>;
 const view=render(viewFor('calculado'));await screen.findByRole('dialog',{name:'Calculado'});await waitFor(()=>expect(screen.getByRole('button',{name:/^Confirmado /})).toBeEnabled());fireEvent.change(screen.getByLabelText('Situação da etapa'),{target:{value:'error'}});expect(screen.getByLabelText('Situação da etapa')).toHaveValue('error');expect(screen.getByRole('option',{name:'Atenção ou bloqueio'})).toBeInTheDocument();expect(within(screen.getByRole('region',{name:'Empresas da etapa'})).queryByText('Alfa')).not.toBeInTheDocument();expect(screen.getByText('Execução fiscal em andamento')).toBeInTheDocument();
 view.rerender(viewFor('enviado'));await screen.findByRole('dialog',{name:'Enviado'});expect(screen.getByLabelText('Situação da etapa')).toHaveValue('all');expect(screen.queryByRole('option',{name:'Atenção ou bloqueio'})).not.toBeInTheDocument();await screen.findByText('Documento guia-a');expect(screen.getByRole('heading',{name:'Alfa'})).toBeInTheDocument();expect(screen.getByRole('heading',{name:'Beta'})).toBeInTheDocument();expect(api.saveCompanyOperation).not.toHaveBeenCalled();expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});

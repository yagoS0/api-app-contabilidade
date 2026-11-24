import { render, screen, fireEvent, within } from '@testing-library/react';
import { OperationsPage } from '../OperationsPage';
jest.mock('../OperationsAlerts',()=>({OperationsAlerts:()=>null}));
jest.mock('../OperationsRoutineCompanies',()=>({OperationsRoutineCompanies:()=>null}));
test('calculadas e não calculadas pertencem ao mesmo universo da barra; filtrar não grava',()=>{
  const companies=[true,false,null].map((apurada,index)=>({companyId:String(index),razao:`Empresa ${index}`,fluxoCarteira:{competencia:'2026-10',apuracao:{apurada},contabilizacao:{},status:{chave:'apuracao'}}}));
  const api={saveCompanyOperation:jest.fn(),executeCompanyOperation:jest.fn()};
  render(<OperationsPage api={api} companies={companies} competencia="2026-10" />);
  fireEvent.click(screen.getByRole('button',{name:'Calculado 1/3 empresas'}));
  const dialog=within(screen.getByRole('region',{name:/^Tabela contextual:/}));
  for(const [value,name] of [['done','Empresa 0'],['pending','Empresa 1'],['unknown','Empresa 2']]) {
    fireEvent.click(screen.getByRole('button',{name:/^Filtros /}));fireEvent.change(screen.getByLabelText('Situação da etapa'),{target:{value}});fireEvent.click(screen.getByRole('button',{name:'Aplicar'}));
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
 fireEvent.click(screen.getByRole('button',{name:'Filtros 0'}));fireEvent.change(screen.getByLabelText('Situação da etapa'),{target:{value:'done'}});fireEvent.click(screen.getByRole('button',{name:'Aplicar'}));
 const table=screen.getByRole('region',{name:'Empresas da etapa'});
 expect(table.querySelectorAll('table')).toHaveLength(1);
 const trigger=screen.getByRole('button',{name:'Ver evidências de Alfa'});fireEvent.click(trigger);
 expect(screen.getByRole('heading',{name:'Cálculo e auditoria de Alfa'})).toHaveFocus();
 expect(screen.queryByRole('region',{name:'Empresas da etapa'})).not.toBeInTheDocument();
 await screen.findByText(/Leitura de cálculo salvo:/);
 fireEvent.click(screen.getByRole('button',{name:'Voltar à tabela de empresas'}));
 expect(trigger).toHaveFocus();fireEvent.click(screen.getByRole('button',{name:'Filtros 1'}));expect(screen.getByLabelText('Situação da etapa')).toHaveValue('done');
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

test('Confirmado com API real abre conferência diretamente sem comando e preserva contexto',async()=>{
 const companies=['a','b'].map(companyId=>({companyId,razao:companyId==='a'?'Alfa':'Beta',myRole:'ACCOUNTANT',fluxoCarteira:{competencia:'2026-10',apuracao:{apurada:true},contabilizacao:{},status:{chave:'apuracao'}}}));
 const operation=(companyId,competencia)=>({ok:true,companyId,competencia,revision:'rev-'+companyId,status:'CONFIRMED',pending:[],calculation:{dasValor:100}});
 const api={getOperationEvidence:jest.fn(async competencia=>({ok:true,competencia,total:companies.length,items:companies.map(company=>operation(company.companyId,competencia))})),getCompanyOperation:jest.fn(async(companyId,competencia)=>operation(companyId,competencia)),saveCompanyOperation:jest.fn(),executeCompanyOperation:jest.fn()};
 const view=render(<OperationsPage api={api} companies={companies} competencia="2026-10"/>);await waitFor(()=>expect(screen.getByRole('button',{name:'Confirmado 2/2 empresas'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Confirmado 2/2 empresas'}));
 const dialog=screen.getByRole('region',{name:'Tabela contextual: Confirmado'});await waitFor(()=>expect(within(dialog).getAllByRole('button',{name:'Conferir detalhes'})[0]).toBeEnabled());expect(api.getOperationEvidence).toHaveBeenCalledTimes(1);expect(api.getOperationEvidence).toHaveBeenCalledWith('2026-10');expect(api.getCompanyOperation).not.toHaveBeenCalled();fireEvent.click(within(dialog).getAllByRole('button',{name:'Conferir detalhes'})[0]);expect(await screen.findByRole('heading',{name:'Conferir Alfa'})).toHaveFocus();expect(api.getCompanyOperation).toHaveBeenCalledTimes(1);expect(api.getCompanyOperation).toHaveBeenCalledWith('a','2026-10');expect(api.saveCompanyOperation).not.toHaveBeenCalled();expect(api.executeCompanyOperation).not.toHaveBeenCalled();view.rerender(<OperationsPage api={api} companies={companies} competencia="2026-09"/>);expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
 fireEvent.click(screen.getByRole('button',{name:'Filtros 0'}));const filter=screen.getByLabelText('Situação da etapa');expect(within(filter).queryByRole('option',{name:/Erro|Atenção|bloqueio/i})).not.toBeInTheDocument();expect(within(filter).getAllByRole('option').map(option=>option.value)).toEqual(['all','done','pending','unknown']);fireEvent.click(screen.getByRole('button',{name:'Voltar'}));
 await screen.findByRole('rowheader',{name:/^Alfa/});await screen.findByRole('rowheader',{name:/^Beta/});
 await waitFor(()=>expect(screen.queryAllByText('Lendo documentos salvos…')).toHaveLength(0));
 if(stage==='Enviado')expect(screen.getAllByText(/Falha real do canal/).some(el=>!el.closest('[hidden]'))).toBe(true);
 const beta=screen.getByRole('rowheader',{name:/^Beta/}).closest('tr');
 fireEvent.click(within(beta).getByRole('button',{name:/^DAS · .* · Beta$/}));
 if(stage==='Pago')expect(screen.getByText(/Entrega registrada:.*indeterminado/i)).toBeInTheDocument();
 else {expect(screen.getByText(/Resultado incerto ou em processamento/)).toBeInTheDocument();if(stage==='Enviado'){fireEvent.click(screen.getByText('Detalhes do documento'));expect(screen.getByText('Confirmada pelo contador')).toBeInTheDocument();}else expect(screen.getByRole('button',{name:'Pago 2/2 empresas'})).toBeInTheDocument();}
 fireEvent.click(screen.getByRole('button',{name:stage==='Pago'?'Voltar':'Voltar às empresas'}));
 expect(screen.getByRole('rowheader',{name:/^Alfa/})).toBeInTheDocument();expect(screen.getByRole('rowheader',{name:/^Beta/})).toBeInTheDocument();
 expect(screen.queryByText('Bloqueio exclusivo da apuração')).not.toBeInTheDocument();
 if(stage==='Disponível')expect(screen.getByRole('button',{name:'Pago 2/2 empresas'})).toBeInTheDocument();
 expect(api.saveCompanyOperation).not.toHaveBeenCalled();expect(api.executeCompanyOperation).not.toHaveBeenCalled();expect(api.getCompanyGuides.mock.calls).toEqual([['a'],['b']]);
 for(const [id,name] of [['a','Alfa'],['b','Beta']]){
   const line=screen.getByRole('rowheader',{name:new RegExp(`^${name}`)}).closest('tr');expect(within(line).getByRole('button',{name:new RegExp(`^DAS · .* · ${name}$`)})).toBeInTheDocument();
   if(stage==='Pago'){expect(within(line).getByText('Contador')).toBeInTheDocument();fireEvent.click(within(line).getByRole('button',{name:`DAS · Paga · ${name}`}));expect(screen.getByText('Confirmada pelo contador')).toBeInTheDocument();expect(screen.getByRole('link',{name:'Abrir Guias'})).toHaveAttribute('href',`/companies/${id}/guides?competencia=2026-10`);fireEvent.click(screen.getByRole('button',{name:'Voltar'}));}
   else expect(within(line).getByRole('link',{name:'Abrir Guias'})).toHaveAttribute('href',`/companies/${id}/guides?competencia=2026-10`);
 }
 expect(api.send).not.toHaveBeenCalled();
});
test('troca por URL normaliza filtro de atenção herdado sem esconder falha de envio',async()=>{
 const api=guideFilterApi();const navigate=jest.fn();const viewFor=stage=><WorkspaceNavigation.Provider value={{location:{pathname:'/companies',search:`?operacoesEtapa=${stage}&operacoesLista=all&operacoesCompetencia=2026-10&operacoesModal=aberto`},navigate}}><OperationsPage api={api} companies={guideFilterCompanies} competencia="2026-10"/></WorkspaceNavigation.Provider>;
 const view=render(viewFor('calculado'));await screen.findByRole('region',{name:'Tabela contextual: Calculado'});await waitFor(()=>expect(screen.getByRole('button',{name:/^Confirmado /})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Filtros 0'}));fireEvent.change(screen.getByLabelText('Situação da etapa'),{target:{value:'error'}});expect(screen.getByLabelText('Situação da etapa')).toHaveValue('error');expect(screen.getByRole('option',{name:'Atenção ou bloqueio'})).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Aplicar'}));expect(within(screen.getByRole('region',{name:'Empresas da etapa'})).queryByText('Alfa')).not.toBeInTheDocument();expect(screen.getByText('Execução fiscal em andamento')).toBeInTheDocument();
 view.rerender(viewFor('enviado'));await screen.findByRole('region',{name:'Tabela contextual: Enviado'});fireEvent.click(screen.getByRole('button',{name:'Filtros 0'}));expect(screen.getByLabelText('Situação da etapa')).toHaveValue('all');expect(screen.queryByRole('option',{name:'Atenção ou bloqueio'})).not.toBeInTheDocument();await waitFor(()=>expect(screen.queryAllByText('Lendo documentos salvos…')).toHaveLength(0));expect(screen.getAllByText(/Falha real do canal/).some(el=>!el.closest('[hidden]'))).toBe(true);expect(screen.getByRole('rowheader',{name:/^Alfa/})).toBeInTheDocument();expect(screen.getByRole('rowheader',{name:/^Beta/})).toBeInTheDocument();expect(api.saveCompanyOperation).not.toHaveBeenCalled();expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});

test.each([8, 35])('Calculadas usa as %i empresas do cartão, incluindo legado/transmitidas sem snapshot e todas as páginas', async totalCalculated => {
 const companies=Array.from({length:41},(_,i)=>({companyId:String(i),razao:`Empresa ${String(i).padStart(2,'0')}`,myRole:i===0?'VIEWER':'ACCOUNTANT',fluxoCarteira:{competencia:'2026-10',apuracao:{apurada:i<totalCalculated?true:i===40?null:false,transmitida:i===0,porFora:i===1},contabilizacao:{},status:{chave:'apuracao'}}}));
 const items=companies.map((c,i)=>({companyId:c.companyId,competencia:'2026-10',revision:`rev-${i}`,pending:[],status:i===0?'EXECUTED':'PENDING',calculation:i>=2&&i<5?{dasValor:100}:null}));
 const api={getOperationEvidence:jest.fn(async()=>({ok:true,competencia:'2026-10',total:41,items})),getCompanyOperation:jest.fn(),saveCompanyOperation:jest.fn(),executeCompanyOperation:jest.fn()};
 render(<OperationsPage api={api} companies={companies} competencia="2026-10"/>);
 fireEvent.click(screen.getByRole('button',{name:`Calculado ${totalCalculated}/41 empresas`}));
 await waitFor(()=>expect(screen.queryByText('Lendo cálculos e evidências…')).not.toBeInTheDocument());
 fireEvent.change(screen.getByLabelText('Situação da etapa'),{target:{value:'done'}});
 const table=screen.getByRole('region',{name:'Cálculos para conferência'});
 expect(within(table).getAllByRole('rowheader')).toHaveLength(Math.min(30,totalCalculated));
 expect(within(table).getByText('Empresa 00')).toBeInTheDocument();
 expect(within(table).getByText('Empresa 01')).toBeInTheDocument();
 expect(within(table).queryByText('Não calculado')).not.toBeInTheDocument();
 expect(within(table).getAllByText('Cálculo local não disponível').length).toBeGreaterThan(0);
 if(totalCalculated>30){fireEvent.click(screen.getByRole('button',{name:'Próxima'}));expect(within(table).getAllByRole('rowheader')).toHaveLength(5);expect(within(table).getByText('Empresa 34')).toBeInTheDocument();}
 fireEvent.change(screen.getByLabelText('Situação da etapa'),{target:{value:'unknown'}});
 expect(within(table).getAllByRole('rowheader')).toHaveLength(1);expect(within(table).getByText('Empresa 40')).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Situação da etapa'),{target:{value:'pending'}});
 expect(within(table).getAllByRole('rowheader')).toHaveLength(Math.min(30,40-totalCalculated));
 fireEvent.change(screen.getByLabelText('Situação da etapa'),{target:{value:'done'}});
 fireEvent.change(screen.getByRole('searchbox'),{target:{value:'Empresa 01'}});
 expect(within(table).getAllByRole('rowheader')).toHaveLength(1);
 expect(api.getCompanyOperation).not.toHaveBeenCalled();expect(api.saveCompanyOperation).not.toHaveBeenCalled();expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});

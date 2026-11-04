import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgendaVencimentoAdoption } from '../AgendaVencimentoAdoption';
import { AgendaEventosEditor } from '../AgendaEventosEditor';
import { criarCompanyAutomationMock } from '../../../api/mock/companyAutomationMock';

function snapshot() {
  return { companyId:'a', companyName:'Empresa fictícia', revision:'a'.repeat(64), rotinas:[],
    automationPolicy:{paused:false}, globalAutomationPolicy:{paused:false}, serproPolicy:{paused:false},
    lembretes:{enabled:true,agenda:{enabled:true}}, acompanhamentoGuias:{enabled:true},
    agendaEventos:{schemaVersion:1,version:0,revision:'c'.repeat(64),modeRevision:'b'.repeat(64),modeVersion:0,executionMode:'LEGADO',relativeConsumerReady:true,
      capabilities:{reminders:true,paymentD2:true,capture:false},effective:{},overrides:{},origins:{}} };
}
function setup(overrides={},data=snapshot()) {
  const result={...data,revision:'d'.repeat(64),agendaEventos:{...data.agendaEventos,modeVersion:1,modeRevision:'e'.repeat(64),executionMode:'RELATIVO_V1'}};
  const api={getCompanyAutomation:jest.fn(async()=>result),saveCompanyAutomation:jest.fn(async()=>result),...overrides},saved=jest.fn();
  const view=render(<AgendaVencimentoAdoption api={api} companyId="a" snapshot={data} tributo="SIMPLES" canEdit onSaved={saved}/>);
  return {api,saved,view,result};
}
test('empresa habilitada exige confirmação e comando isolado sem pausa inventada',async()=>{
  const {api,saved}=setup();fireEvent.click(screen.getByText('Revisar uso nesta empresa'));
  expect(screen.getByRole('heading',{name:'Usar agendamento por vencimento'})).toHaveFocus();
  expect(screen.getByText(/Rotinas já habilitadas e sem pausa/)).toBeInTheDocument();
  expect(screen.getByText(/Busca automática indisponível/)).toBeInTheDocument();expect(api.saveCompanyAutomation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Confirmar uso por vencimento'));await screen.findByText(/Uso por vencimento confirmado/);
  expect(api.saveCompanyAutomation).toHaveBeenCalledWith('a',{expectedRevision:'a'.repeat(64),requestId:expect.any(String),agendaEventos:{executionMode:'RELATIVO_V1'}});
  expect(saved).toHaveBeenCalledTimes(1);await waitFor(()=>expect(screen.getByRole('status')).toHaveFocus());
});
test('prévia mostra os outros impostos participantes antes de adotar o calendário da empresa',()=>{
  const data=snapshot();
  data.agendaEventos.effective={
    SIMPLES:{},
    INSS:{lembretes:{before:{enabled:true,businessDays:2,hour:8}}},
    IRPJ:{lembretes:{after:{enabled:true,businessDays:4,hour:9}}},
  };
  const {api}=setup({},data);
  fireEvent.click(screen.getByText('Revisar uso nesta empresa'));
  expect(screen.getByRole('rowheader',{name:'INSS · Avisar antes'})).toBeInTheDocument();
  expect(screen.getByRole('rowheader',{name:'IRPJ · Avisar depois'})).toBeInTheDocument();
  expect(screen.getByText('2 dias úteis antes · 08:00')).toBeInTheDocument();
  expect(screen.getByText('4 dias úteis depois · 09:00')).toBeInTheDocument();
  expect(api.saveCompanyAutomation).not.toHaveBeenCalled();
});
test('timeout conserva pedido; GET não confirma autoria e replay é idêntico',async()=>{
  const {api,saved}=setup();api.saveCompanyAutomation.mockRejectedValueOnce(Error('Tempo esgotado'));
  fireEvent.click(screen.getByText('Revisar uso nesta empresa'));fireEvent.click(screen.getByText('Confirmar uso por vencimento'));await screen.findByText('Tempo esgotado');
  expect(screen.getByText('Voltar')).toBeDisabled();fireEvent.click(screen.getByText('Conferir estado atual'));await screen.findByText(/Estado atual conferido/);expect(saved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Conferir com a mesma solicitação'));await screen.findByText(/Uso por vencimento confirmado/);
  expect(api.saveCompanyAutomation.mock.calls[0]).toEqual(api.saveCompanyAutomation.mock.calls[1]);
});
test('409 exige releitura e nova conferência, sem retry automático',async()=>{
  const {api}=setup();api.saveCompanyAutomation.mockRejectedValueOnce(Object.assign(Error('Alterada'),{status:409}));
  fireEvent.click(screen.getByText('Revisar uso nesta empresa'));fireEvent.click(screen.getByText('Confirmar uso por vencimento'));await screen.findByText('Alterada');
  expect(screen.getByText('Confirmar uso por vencimento')).toBeDisabled();fireEvent.click(screen.getByText('Reler e revisar configuração'));
  await waitFor(()=>expect(screen.getByText('Confirmar uso por vencimento')).toBeEnabled());expect(api.saveCompanyAutomation).toHaveBeenCalledTimes(1);
});
test('capacidade ausente não permite adoção; no-op válido não exige incremento',async()=>{
  const data=snapshot();delete data.agendaEventos.capabilities;const {view}=setup({},data);
  expect(screen.getByText('Revisar uso nesta empresa')).toBeDisabled();view.unmount();
  const current=snapshot();current.agendaEventos.executionMode='RELATIVO_V1';setup({saveCompanyAutomation:jest.fn(async()=>current)},current);
  fireEvent.click(screen.getByText('Revisar uso nesta empresa'));fireEvent.click(screen.getByText('Confirmar uso por vencimento'));await screen.findByText(/Uso por vencimento confirmado/);
});
test('resposta de outra empresa não conclui intenção',async()=>{
  setup({saveCompanyAutomation:jest.fn(async()=>({...snapshot(),companyId:'b'}))});fireEvent.click(screen.getByText('Revisar uso nesta empresa'));fireEvent.click(screen.getByText('Confirmar uso por vencimento'));
  await screen.findByText(/Resposta não confirma/);expect(screen.getByText('Voltar')).toBeDisabled();
});
test('editor preserva rascunho e exige salvar ou descartar antes da adoção',async()=>{
  const data=snapshot(),api={getCompanyAutomation:jest.fn(async()=>data)};
  render(<AgendaEventosEditor api={api} companyId="a" snapshot={data} canEdit/>);
  fireEvent.change(await screen.findByLabelText('SIMPLES Buscar guia horário'),{target:{value:'9'}});
  expect(screen.getByText('Revisar uso nesta empresa')).toBeDisabled();expect(screen.getByLabelText('SIMPLES Buscar guia horário')).toHaveValue('9');
  fireEvent.click(screen.getByText('Descartar rascunho'));expect(screen.getByText('Revisar uso nesta empresa')).toBeEnabled();
});
test('mock composto conserva OFF, recusa replay após mudança e reconfere ACL',async()=>{
  const companies=[{companyId:'adoption-fixture',razao:'Empresa fictícia',myRole:'ACCOUNTANT'}],api=criarCompanyAutomationMock(companies);
  const before=await api.getCompanyAutomation('adoption-fixture'),command={expectedRevision:before.revision,requestId:'mock-adoption-request',agendaEventos:{executionMode:'RELATIVO_V1'}};
  const saved=await api.saveCompanyAutomation('adoption-fixture',command);
  expect(saved.lembretes).toEqual(before.lembretes);expect(saved.automationPolicy).toEqual(before.automationPolicy);expect(saved.rotinas).toEqual(before.rotinas);
  expect(saved.agendaEventos.capabilities.capture).toBe(false);expect(saved.companyName).toBe('Empresa fictícia');
  expect(await api.saveCompanyAutomation('adoption-fixture',command)).toEqual(saved);
  companies[0].myRole='STAFF';await expect(api.saveCompanyAutomation('adoption-fixture',command)).rejects.toMatchObject({status:403});
});

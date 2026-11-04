import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CompanyAutomation } from '../CompanyAutomation';

const initial = { companyId: 'a', revision: 'r1', rotinas: [{ key: 'das', label: 'DAS', enabled: true }], serproPolicy: { paused: false, reason: '' }, agendaEventos: { schemaVersion:1,version:0,revision:'agenda-r1',executionMode:'LEGADO',relativeConsumerReady:true,capabilities:{reminders:true,paymentD2:true,capture:false},overrides:{schemaVersion:1,tributos:{}},effective:{},origins:{} } };

test('pausa automática separada preserva SERPRO e informa prevalência global', async () => {
  const data = { ...initial, automationPolicy: { paused: false, version: 0 }, globalAutomationPolicy: { paused: true } };
  const save = jest.fn(async (_, input) => ({ ...data, revision: 'r2', automationPolicy: { ...input.automationPolicy, version: 1, updatedBy: 'Contador', updatedAt: '2026-11-01T12:00:00Z' } }));
  setup({ getCompanyAutomation: jest.fn().mockResolvedValue(data), saveCompanyAutomation: save });
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Pausar automações desta empresa' }));
  expect(screen.getByText('Automações bloqueadas pela pausa geral.')).toBeInTheDocument();
  expect(screen.getByText('Conferir alterações')).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Motivo da alteração das automações'), { target: { value: 'Conferir ciclo' } });
  fireEvent.click(screen.getByText('Conferir alterações'));
  fireEvent.click(screen.getByText('Salvar configuração'));
  await screen.findByText(/Configuração salva/);
  expect(save).toHaveBeenCalledWith('a', { expectedRevision: 'r1', requestId: 'policy-request', automationPolicy: { paused: true, reason: 'Conferir ciclo' } });
  expect(screen.getByRole('checkbox', { name: 'Pausar operações SERPRO' })).not.toBeChecked();
  expect(screen.getByText('Automações bloqueadas pela pausa geral.')).toBeInTheDocument();
});
const setup = (overrides = {}, canEdit = true) => {
  const api = { getCompanyAutomation: jest.fn().mockResolvedValue(initial), saveCompanyAutomation: jest.fn(async (_, input) => ({ ...initial, revision: 'r2', serproPolicy: input.serproPolicy })), getDas: jest.fn(), getExtrato: jest.fn(), ...overrides };
  const view = render(<CompanyAutomation api={api} companyId="a" canEdit={canEdit} />);
  return { api, view };
};
beforeEach(() => Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => 'policy-request' }));
async function preparePause() {
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Pausar operações SERPRO' }));
  expect(screen.getByText('Conferir alterações')).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Motivo da pausa'), { target: { value: '  Conferir dados  ' } });
  fireEvent.click(screen.getByText('Conferir alterações'));
}
test('pausa exige motivo e prévia; salva só política sem buscar documentos', async () => {
  const { api } = setup();
  await preparePause();
  expect(api.saveCompanyAutomation).not.toHaveBeenCalled();
  expect(screen.getByText('Pausar novas consultas e transmissões SERPRO desta empresa.')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Salvar configuração'));
  await screen.findByText(/Configuração salva/);
  expect(api.saveCompanyAutomation).toHaveBeenCalledWith('a', { expectedRevision: 'r1', requestId: 'policy-request', serproPolicy: { paused: true, reason: 'Conferir dados' } });
  expect(api.getDas).not.toHaveBeenCalled();
  expect(api.getExtrato).not.toHaveBeenCalled();
});
test('retomada exige novo motivo e não dispara rotina', async () => {
  const { api } = setup({ getCompanyAutomation: jest.fn().mockResolvedValue({ ...initial, serproPolicy: { paused: true, reason: 'Motivo anterior' } }) });
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Pausar operações SERPRO' }));
  expect(screen.getByLabelText('Motivo da retomada')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('Motivo da retomada'), { target: { value: 'Conferência concluída' } });
  fireEvent.click(screen.getByText('Conferir alterações'));
  fireEvent.click(screen.getByText('Salvar configuração'));
  await screen.findByText(/Configuração salva/);
  expect(api.saveCompanyAutomation.mock.calls[0][1].serproPolicy.paused).toBe(false);
});
test('acesso somente leitura mantém política visível sem edição', async () => {
  const { api } = setup({}, false);
  expect(await screen.findByRole('checkbox', { name: 'Pausar operações SERPRO' })).toBeDisabled();
  expect(screen.queryByText('Conferir alterações')).not.toBeInTheDocument();
  expect(api.saveCompanyAutomation).not.toHaveBeenCalled();
});
test('resultado incerto repete mesma solicitação e impede editar motivo', async () => {
  const save = jest.fn().mockRejectedValueOnce(new Error('Resposta perdida')).mockResolvedValue({ ...initial, serproPolicy: { paused: true, reason: 'Conferir dados' } });
  setup({ saveCompanyAutomation: save });
  await preparePause();
  fireEvent.click(screen.getByText('Salvar configuração'));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Motivo da pausa')).toBeDisabled();
  expect(screen.getByRole('button',{name:'Recarregar configuração'})).toBeDisabled();
  fireEvent.click(screen.getByText('Salvar configuração'));
  await screen.findByText(/Configuração salva/);
  expect(save.mock.calls[0]).toEqual(save.mock.calls[1]);
});
test('conflito bloqueia salvar até recarregar versão atual', async () => {
  const { api } = setup({ saveCompanyAutomation: jest.fn().mockRejectedValue(Object.assign(new Error('Configuração mudou'), { status: 409 })) });
  await preparePause();
  fireEvent.click(screen.getByText('Salvar configuração'));
  await screen.findByRole('alert');
  expect(screen.getByText('Salvar configuração')).toBeDisabled();
  expect(screen.getByRole('button',{name:'Recarregar configuração'})).toBeEnabled();
  fireEvent.click(screen.getByText('Recarregar configuração'));
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Pausar operações SERPRO' })).not.toBeChecked());
  expect(api.getCompanyAutomation).toHaveBeenCalledTimes(2);
});
test('resposta antiga de outra empresa não substitui política atual', async () => {
  let resolveOld;
  const old = new Promise(resolve => { resolveOld = resolve; });
  const { api, view } = setup({ getCompanyAutomation: jest.fn().mockImplementation(id => id === 'a' ? old : Promise.resolve({ ...initial, companyId: 'b', serproPolicy: { paused: true, reason: 'Empresa B' } })) });
  view.rerender(<CompanyAutomation api={api} companyId="b" canEdit />);
  expect(await screen.findByText('Último motivo registrado: Empresa B')).toBeInTheDocument();
  resolveOld(initial);
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Pausar operações SERPRO' })).toBeChecked());
});
test('presumido exibe somente suas rotinas e preserva escolhas ocultas ao pausar', async () => {
  const data = { ...initial, regime: 'LUCRO_PRESUMIDO', rotinas: [
    { key: 'das', label: 'DAS', enabled: true, applicable: false },
    { key: 'presumido', label: 'Presumido', enabled: false, applicable: true },
  ] };
  const { api } = setup({ getCompanyAutomation: jest.fn().mockResolvedValue(data) });
  await screen.findByText('Regime: Lucro Presumido');
  expect(screen.queryByRole('checkbox', { name: /DAS/ })).not.toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: /Presumido/ })).not.toBeChecked();
  await preparePause();
  fireEvent.click(screen.getByText('Salvar configuração'));
  await screen.findByText(/Configuração salva/);
  expect(api.saveCompanyAutomation.mock.calls[0][1].rotinas).toBeUndefined();
});
test('regime desconhecido não oferece ativar rotinas mas permite pausa', async () => {
  setup({ getCompanyAutomation: jest.fn().mockResolvedValue({ ...initial, regime: null, unavailableReason: 'Regime não confirmado', rotinas: initial.rotinas.map(r => ({ ...r, applicable: false })) }) });
  await screen.findByText('Regime não confirmado');
  expect(screen.queryByRole('checkbox', { name: /DAS/ })).not.toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Pausar operações SERPRO' })).toBeEnabled();
});

test('prévia e volta à edição mantêm foco útil sem perder motivo', async()=>{
 const {api}=setup();await preparePause();
 expect(screen.getByRole('heading',{name:'Conferir alteração'})).toHaveFocus();
 fireEvent.click(screen.getByRole('button',{name:'Voltar à edição'}));
 expect(screen.getByRole('button',{name:'Conferir alterações'})).toHaveFocus();
 expect(screen.getByLabelText('Motivo da pausa')).toHaveValue('  Conferir dados  ');
 expect(api.saveCompanyAutomation).not.toHaveBeenCalled();
});
test('sucesso da empresa foca confirmação sem executar consultas', async()=>{
 const {api}=setup();await preparePause();
 const save=screen.getByRole('button',{name:'Salvar configuração'});save.focus();fireEvent.click(save);
 await waitFor(()=>expect(screen.getByText(/Configuração salva/)).toHaveFocus());
 expect(api.saveCompanyAutomation).toHaveBeenCalledTimes(1);
 expect(api.getDas).not.toHaveBeenCalled();expect(api.getExtrato).not.toHaveBeenCalled();
});
test('conflito da empresa foca erro e recarga explícita foca título com versão atual', async()=>{
 const {api}=setup({saveCompanyAutomation:jest.fn().mockRejectedValue(Object.assign(new Error('Conflito da versão'),{status:409}))});
 await preparePause();const save=screen.getByRole('button',{name:'Salvar configuração'});save.focus();fireEvent.click(save);
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveFocus());
 expect(screen.getByLabelText('Motivo da pausa')).toHaveValue('  Conferir dados  ');
 expect(screen.getByRole('button',{name:'Salvar configuração'})).toBeDisabled();
 const reload=screen.getByRole('button',{name:'Recarregar configuração'});reload.focus();fireEvent.click(reload);
 await waitFor(()=>expect(screen.getByRole('heading',{name:'Automação'})).toHaveFocus());
 expect(api.getCompanyAutomation).toHaveBeenCalledTimes(2);
 expect(screen.getByRole('checkbox',{name:'Pausar operações SERPRO'})).not.toBeChecked();
});
test('empresa não captura foco movido durante salvamento', async()=>{
 let finish;const save=jest.fn(()=>new Promise(resolve=>{finish=resolve;}));setup({saveCompanyAutomation:save});await preparePause();
 const button=screen.getByRole('button',{name:'Salvar configuração'});button.focus();fireEvent.click(button);
 const other=document.createElement('button');other.textContent='Outra ação';document.body.append(other);other.focus();
 try{
  await act(async()=>finish({...initial,revision:'r2',serproPolicy:{paused:true,reason:'Conferir dados'}}));
  expect(other).toHaveFocus();expect(screen.getByText(/Configuração salva/)).toBeInTheDocument();
 }finally{other.remove();}
});
test('resposta tardia da empresa anterior não muda dados nem foco da nova', async()=>{
 let finish;const save=jest.fn(()=>new Promise(resolve=>{finish=resolve;}));const {api,view}=setup({saveCompanyAutomation:save,getCompanyAutomation:jest.fn(async companyId=>({...initial,companyId}))});await preparePause();
 screen.getByRole('button',{name:'Salvar configuração'}).focus();fireEvent.click(screen.getByRole('button',{name:'Salvar configuração'}));
 view.rerender(<CompanyAutomation api={api} companyId="b" canEdit/>);
 const checkbox=await screen.findByRole('checkbox',{name:'Pausar operações SERPRO'});await waitFor(()=>expect(checkbox).toBeEnabled());checkbox.focus();
 await act(async()=>finish({...initial,companyId:'a',revision:'old',serproPolicy:{paused:true,reason:'Resposta antiga'}}));
 expect(checkbox).toHaveFocus();expect(checkbox).not.toBeChecked();expect(screen.queryByText(/Configuração salva/)).toBeNull();
});
test('409 permite GET explícito e novo comando usa revisão atual sem repetir pedido antigo',async()=>{
 Object.defineProperty(crypto,'randomUUID',{configurable:true,value:jest.fn().mockReturnValueOnce('policy-request-old').mockReturnValueOnce('policy-request-new')});
 const fresh={...initial,revision:'r-current'};
 const get=jest.fn().mockResolvedValueOnce(initial).mockResolvedValue(fresh);
 const save=jest.fn().mockRejectedValueOnce(Object.assign(Error('Revisão mudou'),{status:409})).mockResolvedValue({...fresh,revision:'r-saved',serproPolicy:{paused:true,reason:'Conferir dados'}});
 const {api}=setup({getCompanyAutomation:get,saveCompanyAutomation:save});
 await preparePause();fireEvent.click(screen.getByRole('button',{name:'Salvar configuração'}));
 await screen.findByRole('alert');expect(screen.getByRole('button',{name:'Salvar configuração'})).toBeDisabled();
 const reload=screen.getByRole('button',{name:'Recarregar configuração'});expect(reload).toBeEnabled();
 expect(save).toHaveBeenCalledTimes(1);fireEvent.click(reload);
 await waitFor(()=>expect(get).toHaveBeenCalledTimes(2));await waitFor(()=>expect(screen.getByRole('checkbox',{name:'Pausar operações SERPRO'})).toBeEnabled());
 expect(save).toHaveBeenCalledTimes(1);expect(screen.getByRole('checkbox',{name:'Pausar operações SERPRO'})).not.toBeChecked();
 await preparePause();fireEvent.click(screen.getByRole('button',{name:'Salvar configuração'}));await screen.findByText(/Configuração salva/);
 expect(save.mock.calls[0][1]).toEqual({expectedRevision:'r1',requestId:'policy-request-old',serproPolicy:{paused:true,reason:'Conferir dados'}});
 expect(save.mock.calls[1][1]).toEqual({expectedRevision:'r-current',requestId:'policy-request-new',serproPolicy:{paused:true,reason:'Conferir dados'}});
 expect(api.getDas).not.toHaveBeenCalled();expect(api.getExtrato).not.toHaveBeenCalled();
});
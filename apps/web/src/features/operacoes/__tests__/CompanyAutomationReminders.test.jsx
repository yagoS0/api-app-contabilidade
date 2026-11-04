import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CompanyAutomation } from '../CompanyAutomation';
jest.mock('../OperationsManualInss', () => ({ CompanyManualInss: () => null }));
const initial = { agendaEventos: { schemaVersion: 1, revision: 'policy-r1', version: 0, executionMode: 'LEGADO', relativeConsumerReady: false, overrides: {}, effective: {}, origins: {} }, companyId: 'a', revision: 'r1', rotinas: [{ key: 'pagamento', label: 'Pagamento', enabled: true }], lembretes: { enabled: false, agenda: { enabled: false, hour: null } } };
beforeEach(() => Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => 'reminder-request' }));
const checkbox = () => screen.getByRole('checkbox', { name: 'Selecionar empresa para lembretes no WhatsApp' });
async function prepare() { await screen.findByRole('rowheader', { name: 'Lembretes de guias' }); fireEvent.click(checkbox()); fireEvent.click(screen.getByText('Conferir alterações')); }

test('lembretes desligados por padrão; salva somente seleção e mantém agenda global OFF', async () => {
 const api={getCompanyAutomation:jest.fn(async()=>initial),saveCompanyAutomation:jest.fn(async()=>({...initial,revision:'r2',lembretes:{...initial.lembretes,enabled:true}}))};
 render(<CompanyAutomation api={api} companyId="a" canEdit />);
 await screen.findByRole('rowheader',{name:'Lembretes de guias'});
 expect(checkbox()).not.toBeChecked();expect(screen.getByText(/Agenda global desligada/)).toBeVisible();
 expect(api.saveCompanyAutomation).not.toHaveBeenCalled();
 await prepare();fireEvent.click(screen.getByText('Salvar configuração'));
 await screen.findByText(/Configuração salva/);
 expect(api.saveCompanyAutomation).toHaveBeenCalledWith('a',{expectedRevision:'r1',requestId:'reminder-request',lembretes:{enabled:true}});
 expect(checkbox()).toBeChecked();expect(screen.getByText(/Agenda global desligada/)).toBeVisible();
});

test('somente leitura e falha de carga não permitem alterar lembretes', async () => {
 const api={getCompanyAutomation:jest.fn(async()=>initial),saveCompanyAutomation:jest.fn()};
 const view=render(<CompanyAutomation api={api} companyId="a" canEdit={false}/>);
 await screen.findByRole('rowheader',{name:'Lembretes de guias'});expect(checkbox()).toBeDisabled();
 api.getCompanyAutomation.mockRejectedValue(new Error('Configuração indisponível'));
 view.rerender(<CompanyAutomation api={api} companyId="b" canEdit/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Configuração indisponível');
 expect(screen.queryByRole('checkbox',{name:'Selecionar empresa para lembretes no WhatsApp'})).toBeNull();expect(api.saveCompanyAutomation).not.toHaveBeenCalled();
});

test('salvamento tardio de outra empresa não contamina seleção nem sucesso', async () => {
 let finish;const api={getCompanyAutomation:jest.fn(async id=>({...initial,companyId:id})),saveCompanyAutomation:jest.fn(()=>new Promise(resolve=>{finish=resolve;}))};
 const view=render(<CompanyAutomation api={api} companyId="a" canEdit/>);
 await prepare();fireEvent.click(screen.getByText('Salvar configuração'));
 view.rerender(<CompanyAutomation api={api} companyId="b" canEdit/>);
 await waitFor(()=>expect(checkbox()).not.toBeChecked());
 await act(async()=>finish({...initial,lembretes:{...initial.lembretes,enabled:true}}));
 expect(checkbox()).not.toBeChecked();expect(screen.queryByText(/Configuração salva/)).toBeNull();
});

test('conflito preserva edição e exige recarga; retorno incerto reutiliza requestId', async () => {
 const save=jest.fn().mockRejectedValueOnce(new Error('Resposta perdida')).mockRejectedValueOnce(Object.assign(new Error('Versão alterada'),{status:409}));
 render(<CompanyAutomation api={{getCompanyAutomation:async()=>initial,saveCompanyAutomation:save}} companyId="a" canEdit/>);
 await prepare();fireEvent.click(screen.getByText('Salvar configuração'));
 await screen.findByRole('alert');expect(checkbox()).toBeDisabled();
 fireEvent.click(screen.getByText('Salvar configuração'));
 await waitFor(()=>expect(screen.getByText('Salvar configuração')).toBeDisabled());
 expect(save.mock.calls[0]).toEqual(save.mock.calls[1]);expect(checkbox()).toBeChecked();
});

test('resposta de gravação vazia ou negativa não anuncia sucesso', async () => {
 const save=jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({...initial,ok:false,lembretes:{...initial.lembretes,enabled:true}});
 render(<CompanyAutomation api={{getCompanyAutomation:async()=>initial,saveCompanyAutomation:save}} companyId="a" canEdit/>);
 await prepare();fireEvent.click(screen.getByText('Salvar configuração'));await screen.findByRole('alert');
 expect(screen.queryByText(/Configuração salva/)).toBeNull();
 fireEvent.click(screen.getByText('Salvar configuração'));
 await waitFor(()=>expect(save).toHaveBeenCalledTimes(2));
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível confirmar a configuração'));
 expect(screen.queryByText(/Configuração salva/)).toBeNull();
});

test('adesão explícita ao acompanhamento salva contrato e limite sem selecionar WhatsApp ou agenda', async () => {
 const base={...initial,acompanhamentoGuias:{enabled:false,politica:null,limiteConsultas:0}};
 const api={getCompanyAutomation:async()=>base,saveCompanyAutomation:jest.fn(async(id,input)=>({...base,revision:'r2',acompanhamentoGuias:input.acompanhamentoGuias}))};
 render(<CompanyAutomation api={api} companyId="a" canEdit/>);
 const tracking=await screen.findByRole('checkbox',{name:'Adotar acompanhamento em dois dias úteis'});expect(tracking).not.toBeChecked();
 fireEvent.click(tracking);fireEvent.click(screen.getByText('Conferir alterações'));
 expect(screen.getByText(/adotar contrato com limite de uma consulta/)).toBeVisible();
 fireEvent.click(screen.getByText('Salvar configuração'));await screen.findByText(/Configuração salva/);
 expect(api.saveCompanyAutomation).toHaveBeenCalledWith('a',{expectedRevision:'r1',requestId:'reminder-request',acompanhamentoGuias:{enabled:true,politica:'D2_D0_D2_V1',limiteConsultas:1}});
 expect(checkbox()).not.toBeChecked();expect(screen.getByText(/Agenda global desligada/)).toBeVisible();
});

test.each([
 undefined,
 {enabled:false,politica:'D2_D0_D2_V1',limiteConsultas:1},
 {enabled:true,politica:'OUTRA',limiteConsultas:1},
 {enabled:true,politica:'D2_D0_D2_V1',limiteConsultas:2},
])('resposta de acompanhamento divergente %j preserva intenção e requestId sem anunciar sucesso', async retornado=>{
 const base={...initial,acompanhamentoGuias:{enabled:false,politica:null,limiteConsultas:0}};
 const save=jest.fn().mockResolvedValueOnce({...base,revision:'r2',acompanhamentoGuias:retornado})
  .mockImplementationOnce(async(id,input)=>({...base,revision:'r2',acompanhamentoGuias:input.acompanhamentoGuias}));
 render(<CompanyAutomation api={{getCompanyAutomation:async()=>base,saveCompanyAutomation:save}} companyId="a" canEdit/>);
 const tracking=await screen.findByRole('checkbox',{name:'Adotar acompanhamento em dois dias úteis'});
 fireEvent.click(tracking);fireEvent.click(screen.getByText('Conferir alterações'));fireEvent.click(screen.getByText('Salvar configuração'));
 expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível confirmar o acompanhamento salvo');
 expect(screen.queryByText(/Configuração salva/)).toBeNull();expect(tracking).toBeChecked();expect(tracking).toBeDisabled();
 fireEvent.click(screen.getByText('Salvar configuração'));await screen.findByText(/Configuração salva/);
 expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);expect(tracking).toBeChecked();expect(checkbox()).not.toBeChecked();
});
test('retorno que mantém acompanhamento ativo não confirma desativação', async()=>{
 const base={...initial,acompanhamentoGuias:{enabled:true,politica:'D2_D0_D2_V1',limiteConsultas:1}};
 const save=jest.fn(async()=>({...base,revision:'r2'}));
 render(<CompanyAutomation api={{getCompanyAutomation:async()=>base,saveCompanyAutomation:save}} companyId="a" canEdit/>);
 const tracking=await screen.findByRole('checkbox',{name:'Adotar acompanhamento em dois dias úteis'});
 fireEvent.click(tracking);fireEvent.click(screen.getByText('Conferir alterações'));fireEvent.click(screen.getByText('Salvar configuração'));
 expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível confirmar o acompanhamento salvo');expect(tracking).not.toBeChecked();expect(screen.queryByText(/Configuração salva/)).toBeNull();
 expect(save.mock.calls[0][1].acompanhamentoGuias.enabled).toBe(false);
});

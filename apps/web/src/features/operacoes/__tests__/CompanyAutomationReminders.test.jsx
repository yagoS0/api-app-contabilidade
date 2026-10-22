import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CompanyAutomation } from '../CompanyAutomation';
jest.mock('../OperationsManualInss', () => ({ CompanyManualInss: () => null }));
const initial = { companyId: 'a', revision: 'r1', rotinas: [{ key: 'pagamento', label: 'Pagamento', enabled: true }], lembretes: { enabled: false, agenda: { enabled: false, hour: null } } };
beforeEach(() => Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => 'reminder-request' }));
const checkbox = () => screen.getByRole('checkbox', { name: 'Selecionar empresa para lembretes no WhatsApp' });
async function prepare() { await screen.findByRole('region', { name: 'Lembretes de guias' }); fireEvent.click(checkbox()); fireEvent.click(screen.getByText('Conferir alterações')); }

test('lembretes desligados por padrão; salva somente seleção e mantém agenda global OFF', async () => {
 const api={getCompanyAutomation:jest.fn(async()=>initial),saveCompanyAutomation:jest.fn(async()=>({...initial,revision:'r2',lembretes:{...initial.lembretes,enabled:true}}))};
 render(<CompanyAutomation api={api} companyId="a" canEdit />);
 await screen.findByRole('region',{name:'Lembretes de guias'});
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
 await screen.findByRole('region',{name:'Lembretes de guias'});expect(checkbox()).toBeDisabled();
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

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CompanyAutomation } from '../CompanyAutomation';

const initial = { revision: 'r1', rotinas: [{ key: 'das', label: 'DAS', enabled: true }], serproPolicy: { paused: false, reason: '' } };
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
  fireEvent.click(screen.getByText('Recarregar configuração'));
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Pausar operações SERPRO' })).not.toBeChecked());
  expect(api.getCompanyAutomation).toHaveBeenCalledTimes(2);
});
test('resposta antiga de outra empresa não substitui política atual', async () => {
  let resolveOld;
  const old = new Promise(resolve => { resolveOld = resolve; });
  const { api, view } = setup({ getCompanyAutomation: jest.fn().mockImplementation(id => id === 'a' ? old : Promise.resolve({ ...initial, serproPolicy: { paused: true, reason: 'Empresa B' } })) });
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

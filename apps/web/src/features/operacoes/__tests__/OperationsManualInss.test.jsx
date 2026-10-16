import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CompanyManualInss, OperationsManualInss, previousInssMonth } from '../OperationsManualInss';

const initial = { companyId: 'a', competencia: '2026-09', revision: 'r1', hasProlabore: true, applicable: true, applicabilitySource: 'company', regime: 'SIMPLES', state: { applicable: null, responsible: '', dueDate: null, note: '', reason: '' }, guides: [], status: 'PENDING_DOCUMENT' };
function setup(overrides = {}, props = {}) {
  const api = { getCompanyManualInss: jest.fn().mockResolvedValue(initial), saveCompanyManualInss: jest.fn(async (_, __, input) => ({ ...initial, revision: 'r2', state: input.state })), ...overrides };
  const view = render(<OperationsManualInss api={api} companyId="a" competencia="2026-09" canEdit {...props} />);
  return { api, view };
}
beforeEach(() => Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => 'inss-request' }));
async function prepare() {
  fireEvent.change(await screen.findByLabelText('Responsável'), { target: { value: 'Equipe fiscal' } });
  fireEvent.click(screen.getByRole('button', { name: 'Conferir controle' }));
}
test('controle recolhido não faz chamadas e preserva formulário ao recolher', async () => {
  const api = { getCompanyManualInss: jest.fn().mockResolvedValue(initial) };
  const { container } = render(<CompanyManualInss api={api} companyId="a" canEdit />);
  expect(api.getCompanyManualInss).not.toHaveBeenCalled();
  const details = container.querySelector('details');
  details.open = true; fireEvent(details, new Event('toggle'));
  fireEvent.change(await screen.findByLabelText('Responsável'), { target: { value: 'Rascunho' } });
  expect(screen.getByLabelText('Competência do INSS')).toBeDisabled();
  details.open = false; fireEvent(details, new Event('toggle'));
  details.open = true; fireEvent(details, new Event('toggle'));
  expect(screen.getByLabelText('Responsável')).toHaveValue('Rascunho');
  expect(api.getCompanyManualInss).toHaveBeenCalledTimes(1);
});
test('salva somente controle após prévia e exige motivo para exceção mensal', async () => {
  const { api } = setup();
  fireEvent.change(await screen.findByLabelText('Aplicação nesta competência'), { target: { value: 'false' } });
  expect(screen.getByRole('button', { name: 'Conferir controle' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Motivo da exceção ou retorno ao cadastro'), { target: { value: 'Sem retirada neste mês' } });
  fireEvent.click(screen.getByRole('button', { name: 'Conferir controle' }));
  expect(api.saveCompanyManualInss).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Salvar controle' }));
  await screen.findByText(/Controle salvo/);
  expect(api.saveCompanyManualInss).toHaveBeenCalledWith('a', '2026-09', { expectedRevision: 'r1', requestId: 'inss-request', state: { ...initial.state, applicable: false, reason: 'Sem retirada neste mês' } });
});
test('resultado incerto preserva pedido, bloqueia edição e repete mesma chave', async () => {
  const save = jest.fn().mockRejectedValueOnce(Error('offline')).mockImplementation(async (_, __, input) => ({ ...initial, revision: 'r2', state: input.state }));
  setup({ saveCompanyManualInss: save }); await prepare();
  fireEvent.click(screen.getByRole('button', { name: 'Salvar controle' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Responsável')).toBeDisabled();
  expect(screen.queryByText('Recarregar controle')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Conferir salvamento' }));
  await screen.findByText(/Controle salvo/);
  expect(save.mock.calls[0]).toEqual(save.mock.calls[1]);
});
test('duplo clique não duplica salvamento e resposta tardia não invade outra competência', async () => {
  let resolve;
  const save = jest.fn(() => new Promise(r => { resolve = r; }));
  const { api, view } = setup({ saveCompanyManualInss: save }); await prepare();
  const button = screen.getByRole('button', { name: 'Salvar controle' });
  fireEvent.click(button); fireEvent.click(button);
  expect(save).toHaveBeenCalledTimes(1);
  api.getCompanyManualInss.mockResolvedValue({ ...initial, competencia: '2026-10', state: { ...initial.state, responsible: 'Outubro' } });
  view.rerender(<OperationsManualInss api={api} companyId="a" competencia="2026-10" canEdit />);
  await waitFor(() => expect(screen.getByLabelText('Responsável')).toHaveValue('Outubro'));
  await act(async () => resolve({ ...initial, state: { ...initial.state, responsible: 'Setembro' } }));
  expect(screen.getByLabelText('Responsável')).toHaveValue('Outubro');
  expect(screen.queryByText(/Controle salvo/)).not.toBeInTheDocument();
});
test('conflito pede nova leitura e acesso somente leitura não oferece gravação', async () => {
  const { api, view } = setup({ saveCompanyManualInss: jest.fn().mockRejectedValue(Object.assign(Error('Registro mudou'), { status: 409 })) });
  await prepare(); fireEvent.click(screen.getByRole('button', { name: 'Salvar controle' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Conferir salvamento' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Recarregar controle' }));
  await waitFor(() => expect(api.getCompanyManualInss).toHaveBeenCalledTimes(2));
  view.rerender(<OperationsManualInss api={api} companyId="a" competencia="2026-09" canEdit={false} />);
  expect(await screen.findByLabelText('Responsável')).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Conferir controle' })).not.toBeInTheDocument();
  expect(screen.getByRole('link')).toHaveAttribute('href', '/companies/a/guides?competencia=2026-09');
});
test('usa mês anterior em Brasília inclusive na virada UTC', () => {
  expect(previousInssMonth(new Date('2026-10-01T01:00:00Z'))).toBe('2026-08');
  expect(previousInssMonth(new Date('2026-01-15T12:00:00Z'))).toBe('2025-12');
});
test('resumo compacto mostra pendência e motivo sem formulário ou mensagem de permissão', async () => {
  setup({ getCompanyManualInss: jest.fn().mockResolvedValue({ ...initial, status: 'DOCUMENT_REVIEW', state: { ...initial.state, responsible: 'Equipe B', dueDate: '2020-09-18' }, guides: [{ id: 'g1', reviewReason: 'Arquivo não disponível' }] }) }, { compact: true, canEdit: false });
  expect(await screen.findByText('Arquivo não disponível')).toBeInTheDocument();
  expect(screen.getByText(/Prazo operacional vencido/)).toBeInTheDocument();
  expect(screen.getByText(/Responsável: Equipe B/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Responsável')).not.toBeInTheDocument();
  expect(screen.queryByText(/Seu acesso permite/)).not.toBeInTheDocument();
});
test('permissão retirada após prévia impede salvar', async () => {
  const { api, view } = setup(); await prepare();
  view.rerender(<OperationsManualInss api={api} companyId="a" competencia="2026-09" canEdit={false} />);
  expect(screen.queryByRole('button', { name: 'Salvar controle' })).not.toBeInTheDocument();
  expect(api.saveCompanyManualInss).not.toHaveBeenCalled();
});

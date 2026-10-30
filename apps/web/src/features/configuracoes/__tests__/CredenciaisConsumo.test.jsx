import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { CredenciaisConsumoPage } from '../CredenciaisConsumo';
import { SERVICOS_CONSUMO } from '../CredenciaisConsumo.shared.js';

const empresas = [{ companyId: 'A', razao: 'Prisma', cnpj: '111' }, { companyId: 'B', razao: 'Educação', cnpj: '222' }];
const registro = (id = 'c1', login = 'client-antigo') => ({ id, login, rotulo: SERVICOS_CONSUMO[0].rotulo, temSenha: true });
function criarApi(credenciais = []) {
  return {
    listCompanies: jest.fn().mockResolvedValue(empresas),
    listCompanyCredentials: jest.fn().mockResolvedValue({ credenciais }),
    createCompanyCredential: jest.fn().mockImplementation(async (_id, p) => ({ credencial: { id: 'novo', rotulo: p.rotulo, login: p.login, temSenha: true } })),
    updateCompanyCredential: jest.fn().mockImplementation(async (_id, id, p) => ({ credencial: { id, rotulo: p.rotulo, login: p.login, temSenha: true } })),
  };
}
async function abrir(api) {
  render(<CredenciaisConsumoPage api={api}/>);
  fireEvent.change(await screen.findByLabelText('Empresa'), { target: { value: 'A' } });
  return within(await screen.findByRole('region', { name: 'Credenciais CBS' }));
}
test('salva par na empresa escolhida, limpa segredo e não revela nem consulta provedor', async () => {
  const api = criarApi(); const cbs = await abrir(api);
  fireEvent.change(cbs.getByLabelText('Client ID'), { target: { value: 'client-cbs' } });
  fireEvent.change(cbs.getByLabelText('Client Secret'), { target: { value: 'segredo-teste' } });
  fireEvent.click(cbs.getByRole('button', { name: 'Salvar credenciais CBS' }));
  expect(await cbs.findByRole('status')).toHaveTextContent('Credenciais salvas');
  expect(api.createCompanyCredential).toHaveBeenCalledWith('A', { rotulo: SERVICOS_CONSUMO[0].rotulo, login: 'client-cbs', senha: 'segredo-teste' });
  expect(cbs.getByLabelText('Client Secret')).toHaveValue('');
  expect(cbs.getByText(/Credenciais cadastradas/)).toBeInTheDocument();
  expect(localStorage.length).toBe(0);
});
test('sem alteração não grava; trocar ID exige novo par e espaços não substituem secret', async () => {
  const api = criarApi([registro()]); const cbs = await abrir(api);
  expect(cbs.getByRole('button', { name: 'Salvar credenciais CBS' })).toBeDisabled();
  expect(api.updateCompanyCredential).not.toHaveBeenCalled();
  fireEvent.change(cbs.getByLabelText('Client Secret'), { target: { value: '   ' } });
  fireEvent.click(cbs.getByRole('button', { name: 'Salvar credenciais CBS' }));
  expect(cbs.getByRole('alert')).toHaveTextContent('mesmo par');
  fireEvent.change(cbs.getByLabelText('Client Secret'), { target: { value: '' } });
  fireEvent.change(cbs.getByLabelText('Client ID'), { target: { value: 'novo-id' } });
  fireEvent.click(cbs.getByRole('button', { name: 'Salvar credenciais CBS' }));
  expect(cbs.getByRole('alert')).toHaveTextContent('mesmo par');
  expect(api.updateCompanyCredential).not.toHaveBeenCalled();
  fireEvent.change(cbs.getByLabelText('Client Secret'), { target: { value: 'novo-secret' } });
  fireEvent.click(cbs.getByRole('button', { name: 'Salvar credenciais CBS' }));
  await cbs.findByRole('status');
  expect(api.updateCompanyCredential).toHaveBeenCalledWith('A', 'c1', { rotulo: SERVICOS_CONSUMO[0].rotulo, login: 'novo-id', senha: 'novo-secret' });
});
test('duplicados exigem seleção explícita e não cria outro cadastro', async () => {
  const api = criarApi([registro(), registro('c2', 'outro')]); const cbs = await abrir(api);
  expect(cbs.getByRole('button')).toBeDisabled();
  fireEvent.change(cbs.getByLabelText('Cadastro para editar'), { target: { value: 'c2' } });
  expect(cbs.getByLabelText('Client ID')).toHaveValue('outro');
  fireEvent.change(cbs.getByLabelText('Client Secret'), { target: { value: 'novo-secret' } });
  fireEvent.click(cbs.getByRole('button', { name: 'Salvar credenciais CBS' }));
  await cbs.findByRole('status');
  expect(api.updateCompanyCredential).toHaveBeenCalledWith('A', 'c2', expect.any(Object));
  expect(api.createCompanyCredential).not.toHaveBeenCalled();
});
test('resposta tardia de outra empresa não aparece após troca', async () => {
  const api = criarApi(); let resolver;
  api.listCompanyCredentials.mockImplementation(id => id === 'A' ? new Promise(r => { resolver = r; }) : Promise.resolve({ credenciais: [] }));
  render(<CredenciaisConsumoPage api={api}/>);
  fireEvent.change(await screen.findByLabelText('Empresa'), { target: { value: 'A' } });
  fireEvent.change(screen.getByLabelText('Empresa'), { target: { value: 'B' } });
  await screen.findByRole('region', { name: 'Credenciais CBS' });
  await act(async () => resolver({ credenciais: [registro()] }));
  expect(screen.queryByDisplayValue('client-antigo')).not.toBeInTheDocument();
});
test('troca de empresa exige saída explícita sem confirmar cancelamento da gravação e ignora resposta tardia', async () => {
  const api = criarApi(); let resolver;
  api.createCompanyCredential.mockImplementation(() => new Promise(r => { resolver = r; }));
  const cbs = await abrir(api);
  fireEvent.change(cbs.getByLabelText('Client ID'), { target: { value: 'id-a' } });
  fireEvent.change(cbs.getByLabelText('Client Secret'), { target: { value: 'secret-a' } });
  fireEvent.click(cbs.getByRole('button', { name: 'Salvar credenciais CBS' }));
  fireEvent.change(screen.getByLabelText('Empresa'), { target: { value: 'B' } });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  const dialogo = within(screen.getByRole('dialog', { name: 'Alterações não salvas', exact: true }));
  expect(dialogo.getByText(/Gravações já iniciadas podem continuar e não serão canceladas/)).toBeVisible();
  expect(dialogo.getByText(/Esta confirmação não comprova salvamento nem descarte/)).toBeVisible();
  expect(screen.getByLabelText('Empresa')).toHaveValue('A');
  expect(cbs.getByLabelText('Client Secret')).toHaveValue('secret-a');
  expect(api.createCompanyCredential).toHaveBeenCalledTimes(1);
  expect(api.createCompanyCredential.mock.calls[0][0]).toBe('A');
  fireEvent.click(dialogo.getByRole('button', { name: 'Sair sem confirmação', exact: true }));
  const novo = within(await screen.findByRole('region', { name: 'Credenciais CBS' }));
  await act(async () => resolver({ credencial: registro() }));
  expect(novo.getByLabelText('Client ID')).toHaveValue('');
  expect(novo.getByLabelText('Client Secret')).toHaveValue('');
  expect(screen.getByLabelText('Empresa')).toHaveValue('B');
  expect(api.createCompanyCredential).toHaveBeenCalledTimes(1);
  expect(api.updateCompanyCredential).not.toHaveBeenCalled();
});
test('erro de listagem bloqueia edição e permite tentar novamente', async () => {
  const api = criarApi(); api.listCompanyCredentials.mockRejectedValueOnce(new Error('segredo que não deve ser exibido'));
  render(<CredenciaisConsumoPage api={api}/>);
  fireEvent.change(await screen.findByLabelText('Empresa'), { target: { value: 'A' } });
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível consultar');
  expect(screen.queryByLabelText('Client Secret')).toBeNull();
  expect(screen.queryByText(/segredo que/)).toBeNull();
  fireEvent.click(screen.getByText('Tentar novamente'));
  expect(await screen.findByRole('region', { name: 'Credenciais IBS' })).toBeInTheDocument();
});
test('edição CBS não perde a proteção do rascunho IBS ao selecionar duplicados', async () => {
  const api = criarApi([registro(), registro('c2', 'outro')]); const cbs = await abrir(api);
  const ibs = within(screen.getByRole('region', { name: 'Credenciais IBS' }));
  fireEvent.change(ibs.getByLabelText('Client ID'), { target: { value: 'ibs-id' } });
  fireEvent.change(ibs.getByLabelText('Client Secret'), { target: { value: 'ibs-secret' } });
  fireEvent.change(cbs.getByLabelText('Cadastro para editar'), { target: { value: 'c2' } });
  fireEvent.change(screen.getByLabelText('Empresa'), { target: { value: 'B' } });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Continuar editando'));
  expect(ibs.getByLabelText('Client Secret')).toHaveValue('ibs-secret');
  fireEvent.click(ibs.getByRole('button', { name: 'Salvar credenciais IBS' }));
  await ibs.findByRole('status');
  expect(api.createCompanyCredential).toHaveBeenCalledWith('A', { rotulo: SERVICOS_CONSUMO[1].rotulo, login: 'ibs-id', senha: 'ibs-secret' });
});

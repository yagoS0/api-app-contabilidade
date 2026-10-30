import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import App from '../../../App';
import { createApiClient } from '../../../api/client';
import { useManageAuthSession } from '../useManageAuthSession';
import { WorkspaceNavigationProvider } from '../../navigation/WorkspaceNavigation';
import { destinoInternoSeguro } from '../../../features/whatsapp/lib/atendimentoPwa';

// Keep the real App, session boundary, router and read page. Only the API factory
// supplies the existing isolated demonstration client; there is no network login.
jest.mock('../../../api/client', () => {
  const { createMockApi } = jest.requireActual('../../../api/mock/mockApi');
  const { withBackgroundTasksMock } = jest.requireActual('../../../api/mock/backgroundTasksMock');
  const api = { mode: 'mock', ...withBackgroundTasksMock(createMockApi()) };
  return { createApiClient: jest.fn(() => api) };
});
jest.setTimeout(30000);
let navigate;
function Caminho() { navigate = useNavigate(); const location = useLocation(); return <output aria-label="rota integrada">{location.pathname}{location.search}</output>; }
// Imports transitivos também usam a factory. Espionar a instância compartilhada
// explicitamente, sem presumir que a primeira chamada veio de App.
const api = createApiClient();
const lista = { ok: true, itens: [{ id: 'central-1', titulo: 'Pedido integrado', resumo: 'Leitura sintética', portalClientId: 'empresa-1', triagem: false,
  situacao: 'NOVA', prioridade: null, responsavelId: null, prazoCivil: null, apresentacao: { empresa: { id: 'empresa-1', nome: 'Empresa sintética' }, responsavel: null, criador: null } }],
  total: 1, hoje: '2026-10-27', resumo: {}, porPrioridade: {}, porEmpresa: { 'empresa-1': 1 }, proximoCursor: null };
let leitura;
beforeAll(() => {
  window.matchMedia = jest.fn(() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  window.scrollTo = jest.fn(); Element.prototype.scrollIntoView = jest.fn();
});
beforeEach(() => {
  localStorage.setItem('portal_firm_access_token', 'mock-solicitacoes');
  leitura = jest.spyOn(api, 'listarSolicitacoes').mockResolvedValue(lista);
});
afterEach(() => { leitura.mockRestore(); localStorage.removeItem('portal_firm_access_token'); });

test('destino seguro preserva Solicitações e filtros, recusando redirects externos', () => {
  const query = '?busca=A%C3%A7%C3%A3o&responsavelId=null&cursor=opaco%2F%2B%3D';
  expect(destinoInternoSeguro(`/solicitacoes${query}`)).toBe(`/solicitacoes${query}`);
  expect(destinoInternoSeguro(`/solicitacoes/${query}`)).toBe(`/solicitacoes/${query}`);
  for (const destino of ['https://externo.invalid/solicitacoes', '//externo.invalid/solicitacoes', '/\\externo.invalid/solicitacoes', '/solicitacoes\n', '/solicitacoes/ficha']) {
    expect(destinoInternoSeguro(destino)).toBe('/companies');
  }
});
function montar(url = '/solicitacoes?prioridade=null') {
  return render(<MemoryRouter initialEntries={[url]}><Caminho /><App /></MemoryRouter>);
}

test('App real monta a central com API, normaliza barra, mantém histórico e restaura scroll ao retornar', async () => {
  const view = montar('/solicitacoes/?prioridade=null');
  await screen.findByText('Pedido integrado', {}, { timeout: 10000 });
  expect(leitura).toHaveBeenCalledWith({ limite: 100, situacao: 'ABERTAS', prioridade: null });
  expect(screen.getByLabelText('rota integrada').textContent).toBe('/solicitacoes?prioridade=null');
  const tabela = screen.getByRole('region', { name: 'Lista de solicitações' });
  tabela.scrollTop = 80; tabela.scrollLeft = 40; fireEvent.scroll(tabela);
  await act(async () => navigate('/configuracoes'));
  expect(screen.queryByText('Pedido integrado')).toBeNull();
  await act(async () => navigate(-1));
  await screen.findByText('Pedido integrado');
  expect(screen.getByLabelText('Prioridade')).toHaveValue('null');
  expect(screen.getByRole('region', { name: 'Lista de solicitações' }).scrollLeft).toBe(40);
  await act(async () => navigate(1));
  expect(screen.queryByText('Pedido integrado')).toBeNull();
  await act(async () => navigate(-1));
  await screen.findByText('Pedido integrado');
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar', exact: true }));
  await waitFor(() => expect(screen.queryByText('Atualizando…')).toBeNull());
  view.unmount();
  montar('/solicitacoes?prioridade=null');
  await screen.findByText('Pedido integrado', {}, { timeout: 10000 });
  expect(screen.getByLabelText('Prioridade')).toHaveValue('null');
});

test('entrada sem sessão conserva filtros no login e login retorna à central', async () => {
  localStorage.removeItem('portal_firm_access_token');
  montar('/solicitacoes?busca=A%C3%A7%C3%A3o&responsavelId=null');
  await screen.findByRole('button', { name: 'Entrar' });
  expect(leitura).not.toHaveBeenCalled();
  const url = screen.getByLabelText('rota integrada').textContent;
  expect(new URLSearchParams(url.split('?')[1]).get('redirect')).toBe('/solicitacoes?busca=A%C3%A7%C3%A3o&responsavelId=null');
  fireEvent.change(screen.getByLabelText('E-mail ou usuário'), { target: { value: 'teste-local' } });
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'fixture-local' } });
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
  await screen.findByText('Pedido integrado', {}, { timeout: 10000 });
  expect(leitura).toHaveBeenLastCalledWith({ limite: 100, situacao: 'ABERTAS', busca: 'Ação', responsavelId: null });
});

test('entrada direta tem Voltar seguro para o workspace sem histórico externo', async () => {
  montar();
  await screen.findByText('Pedido integrado', {}, { timeout: 10000 });
  fireEvent.click(screen.getByRole('button', { name: 'Voltar', exact: true }));
  await waitFor(() => expect(screen.getByLabelText('rota integrada').textContent).toBe('/companies'));
});

test('setPage usa o mapeamento real para Solicitações', async () => {
  const fixture = { clearSession: jest.fn(), setAccessToken: jest.fn(), me: jest.fn().mockResolvedValue({ id: 'sintetico' }) };
  const feedback = { clearFeedback: jest.fn(), setError: jest.fn() };
  function Navegador() {
    const session = useManageAuthSession({ api: fixture, tokenStorageKey: 'portal_firm_access_token', feedback });
    return <button onClick={() => session.setPage('solicitacoes')}>Ir às solicitações</button>;
  }
  render(<MemoryRouter initialEntries={['/companies']}><WorkspaceNavigationProvider><Caminho /><Navegador /></WorkspaceNavigationProvider></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Ir às solicitações' }));
  await waitFor(() => expect(screen.getByLabelText('rota integrada').textContent).toBe('/solicitacoes'));
});

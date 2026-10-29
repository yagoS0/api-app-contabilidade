import { Request } from 'node-fetch/lib/index.js';
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from 'react';
import { createMemoryRouter, RouterProvider, MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { OfficeNavigation } from "../../../../app/navigation/OfficeNavigation";
jest.mock("../../../tasks/TaskCenterPlacement", () => ({ TaskCenterSlot: () => null }));

function Local() { return <output data-testid="rota">{useLocation().pathname}</output>; }
test("Comercial aponta para raiz, aguarda salvar e fica na ficha se salvar falha", async () => {
  const salvar = jest.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({});
  const proteger = e => e.detail.push(salvar);
  window.addEventListener("altan:onboarding-antes-de-navegar", proteger);
  try {
    render(<MemoryRouter initialEntries={["/onboardings/o"]}><OfficeNavigation /><Local /></MemoryRouter>);
    const link = screen.getByRole("link", { name: /^Comercial/ });
    expect(link).toHaveAttribute("href", "/comercial");
    fireEvent.click(link);
    await waitFor(() => expect(salvar).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("rota")).toHaveTextContent("/onboardings/o");
    fireEvent.click(link);
    await waitFor(() => expect(screen.getByTestId("rota")).toHaveTextContent("/comercial"));
  } finally { window.removeEventListener("altan:onboarding-antes-de-navegar", proteger); }
});

// Real shell, wizard, detail and provider. Only transport/task infrastructure is simulated.
import { WorkspaceNavigationProvider } from '../../../../app/navigation/WorkspaceNavigation';
import { OnboardingWizardPage } from '../../pages/renderOnboardingWizardPage';
import { OnboardingDetailPage } from '../../pages/renderOnboardingDetailPage';
const routers = [];
afterEach(() => { cleanup(); routers.splice(0).forEach(r => r.dispose()); jest.useRealTimers(); });
function client() {
  let record = { id: 'o', versao: 1, origem: 'PESSOA_FISICA', status: 'RASCUNHO', ultimoPasso: 'responsavel', dados: { responsavelNome: 'Original' }, etapas: [] };
  return { getOnboarding: jest.fn(async () => ({ onboarding: record })),
    salvarOnboarding: jest.fn(async (id, patch) => { record = { ...record, ...patch, id, versao: patch.versao + 1 }; return { onboarding: record }; }) };
}
async function workspace(detail = false, api = client()) {
  function Page() {
    const location = useLocation(), navigate = useNavigate();
    return <><OfficeNavigation/><Local/>{location.pathname.startsWith('/onboardings/o') &&
      (detail ? <OnboardingDetailPage api={api} onboardingId="o" preenchimentoInicial onVoltar={() => navigate('/comercial')} />
        : <OnboardingWizardPage api={api} onboardingId="o" onVoltar={() => navigate('/comercial')} onAbrirDetalhe={() => navigate('/concluido')} />)}</>;
  }
  const router = createMemoryRouter([{ path: '*', element: <WorkspaceNavigationProvider><Page/></WorkspaceNavigationProvider> }],
    { initialEntries: ['/comercial', '/onboardings/o/editar'], initialIndex: 1 });
  routers.push(router); render(<RouterProvider router={router}/>);
  const input = await screen.findByDisplayValue('Original');
  jest.useFakeTimers();
  fireEvent.change(input, { target: { value: 'Editado' } });
  return { router, api, input };
}
test.each([false, true])('Descartar no menu/detalhe %s não salva antes da escolha nem depois de 800ms', async detail => {
  const { api } = await workspace(detail);
  fireEvent.click(detail ? screen.getByRole('button', { name: /Entrada de clientes/ }) : screen.getByRole('link', { name: /^Comercial/ }));
  expect(screen.getByRole('dialog', { name: 'Alterações não salvas' })).toBeInTheDocument();
  await act(async () => { jest.advanceTimersByTime(1600); });
  expect(api.salvarOnboarding).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Descartar e sair' }));
  await act(async () => { await Promise.resolve(); jest.advanceTimersByTime(1600); });
  expect(screen.getByTestId('rota')).toHaveTextContent('/comercial');
  expect(api.salvarOnboarding).not.toHaveBeenCalled();
});
test.each([false, true])('Cancelar conserva origem e campos; Guardar aguarda resposta válida (detalhe=%s)', async detail => {
  const { router, api } = await workspace(detail);
  if (detail) fireEvent.click(screen.getByRole('button', { name: /Entrada de clientes/ }));
  else await act(async () => { await router.navigate(-1); });
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(screen.getByTestId('rota')).toHaveTextContent('/onboardings/o/editar');
  expect(screen.getByDisplayValue('Editado')).toBeInTheDocument();
  let resolve;
  api.salvarOnboarding.mockImplementationOnce((id, patch) => new Promise(done => { resolve = () => done({ onboarding: { id, versao: patch.versao + 1, origem: 'PESSOA_FISICA', dados: patch.dados } }); }));
  fireEvent.click(detail ? screen.getByRole('button', { name: /Entrada de clientes/ }) : screen.getByRole('link', { name: /^Comercial/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar e sair' }));
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByTestId('rota')).toHaveTextContent('/onboardings/o/editar');
  await act(async () => { resolve(); });
  expect(screen.getByTestId('rota')).toHaveTextContent('/comercial');
  expect(api.salvarOnboarding).toHaveBeenCalledTimes(1);
});
test.each([[false, undefined], [false, false], [false, { ok: false }], [false, '409'], [true, '409']])('falha mantém editor real e destino bloqueado (detalhe=%s, resposta=%p)', async (detail, response) => {
  const { api } = await workspace(detail);
  if (response === '409') api.salvarOnboarding.mockRejectedValueOnce(Object.assign(new Error('Conflito'), { status: 409 }));
  else api.salvarOnboarding.mockResolvedValueOnce(response);
  fireEvent.click(detail ? screen.getByRole('button', { name: /Entrada de clientes/ }) : screen.getByRole('link', { name: /^Comercial/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar e sair' }));
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByTestId('rota')).toHaveTextContent('/onboardings/o/editar');
  expect(screen.getByDisplayValue('Editado')).toBeInTheDocument();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Descartar e sair' }));
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByTestId('rota')).toHaveTextContent('/onboardings/o/editar');
  expect(screen.getByDisplayValue('Editado')).toBeInTheDocument();
});

test.each(['api', 'onboarding', 'sessao'])('finalização real não executa callback após troca de %s', async change => {
  const api = client();
  api.getOnboarding.mockResolvedValue({ onboarding: { id: 'o', versao: 1, origem: 'PESSOA_FISICA',
    ultimoPasso: 'revisao', status: 'RASCUNHO', dados: { responsavelNome: 'Original' } } });
  let resolve, setContext;
  api.salvarOnboarding.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const detailCallback = jest.fn();
  function Page() {
    const [context, changeContext] = useState({ api, id: 'o' });
    setContext = changeContext;
    const location = useLocation();
    return <><OfficeNavigation/><Local/>{location.pathname !== '/login' &&
      <OnboardingWizardPage api={context.api} onboardingId={context.id} onAbrirDetalhe={detailCallback}/>}</>;
  }
  const router = createMemoryRouter([{ path: '*', element: <WorkspaceNavigationProvider><Page/></WorkspaceNavigationProvider> }],
    { initialEntries: ['/onboardings/o/editar'] });
  routers.push(router); render(<RouterProvider router={router}/>);
  fireEvent.click(await screen.findByRole('button', { name: 'Salvar e continuar atendimento' }));
  await waitFor(() => expect(api.salvarOnboarding).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('link', { name: /^Comercial/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar e sair' }));
  const next = client();
  const id = change === 'onboarding' ? 'b' : 'o';
  next.getOnboarding.mockResolvedValue({ onboarding: { id, versao: 1, origem: 'PESSOA_FISICA',
    ultimoPasso: 'responsavel', dados: { responsavelNome: 'Novo contexto' } } });
  await act(async () => {
    if (change === 'sessao') await router.navigate('/login');
    else setContext({ api: next, id });
  });
  await act(async () => {
    resolve({ onboarding: { id: 'o', versao: 2, origem: 'PESSOA_FISICA', dados: {} } });
  });
  expect(detailCallback).not.toHaveBeenCalled();
  expect(next.salvarOnboarding).not.toHaveBeenCalled();
  expect(router.state.location.pathname).toBe(change === 'sessao' ? '/login' : '/onboardings/o/editar');
  if (change !== 'sessao') expect(await screen.findByDisplayValue('Novo contexto')).toBeInTheDocument();
});

test.each([
  ['finalizar', 'confirmado'], ['finalizar', '409'],
  ['irPara', 'confirmado'], ['irPara', '409'],
  ['trocarOrigem', 'confirmado'], ['trocarOrigem', '409'],
])('saída durante %s real: %s não duplica gravação nem toma o destino', async (action, outcome) => {
  const api = client();
  api.getOnboarding.mockResolvedValue({ onboarding: { id: 'o', versao: 1, origem: action === 'trocarOrigem' ? null : 'PESSOA_FISICA', status: 'RASCUNHO',
    ultimoPasso: action === 'finalizar' ? 'revisao' : action === 'irPara' ? 'responsavel' : 'origem', dados: {} } });
  let resolve, reject;
  api.salvarOnboarding.mockImplementationOnce(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
  const detailCallback = jest.fn();
  function Page() {
    const location = useLocation();
    return <><OfficeNavigation/><Local/>{location.pathname === '/onboardings/o/editar' &&
      <OnboardingWizardPage api={api} onboardingId="o" onAbrirDetalhe={detailCallback}/>}</>;
  }
  const router = createMemoryRouter([{ path: '*', element: <WorkspaceNavigationProvider><Page/></WorkspaceNavigationProvider> }],
    { initialEntries: ['/onboardings/o/editar'] });
  routers.push(router); render(<RouterProvider router={router}/>);
  fireEvent.click(await screen.findByRole('button', { name: action === 'finalizar' ? 'Salvar e continuar atendimento' : action === 'irPara' ? 'Avançar' : /Vai abrir a empresa/ }));
  await waitFor(() => expect(api.salvarOnboarding).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('link', { name: /^Comercial/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar e sair' }));
  expect(router.state.location.pathname).toBe('/onboardings/o/editar');
  await act(async () => {
    if (outcome === '409') reject(Object.assign(new Error('Conflito'), { status: 409 }));
    else resolve({ onboarding: { id: 'o', versao: 2, origem: action === 'trocarOrigem' ? 'ABERTURA' : 'PESSOA_FISICA', dados: {} } });
  });
  expect(api.salvarOnboarding).toHaveBeenCalledTimes(1);
  expect(api.salvarOnboarding.mock.calls[0][1].finalizar).toBe(action === 'finalizar' ? true : undefined);
  if (action === 'trocarOrigem') expect(api.salvarOnboarding.mock.calls[0][1].origem).toBe('ABERTURA');
  if (action === 'irPara') expect(api.salvarOnboarding.mock.calls[0][1].ultimoPasso).toBeDefined();
  expect(detailCallback).not.toHaveBeenCalled();
  expect(router.state.location.pathname).toBe(outcome === '409' ? '/onboardings/o/editar' : '/comercial');
  if (outcome === '409') expect(screen.getByRole('dialog')).toBeInTheDocument();
});

// Same installed Request implementation as bootstrapDataRouter; no router mock or fetch replacement.
const requestDescriptorBeforeSuite = Object.getOwnPropertyDescriptor(globalThis, 'Request');
beforeEach(() => { Object.defineProperty(globalThis, 'Request', { configurable: true, writable: true, value: Request }); });
afterEach(() => {
  if (requestDescriptorBeforeSuite) Object.defineProperty(globalThis, 'Request', requestDescriptorBeforeSuite);
  else delete globalThis.Request;
});
test('recusa 400 permanece visível após corrigir campo; só Guardar explícito tenta novamente', async () => {
  const api = client();
  api.salvarOnboarding.mockRejectedValueOnce(Object.assign(new Error('Corrija os dados'), { status: 400, code: 'dados_invalidos' }));
  const { router, input } = await workspace(false, api);
  await act(async () => { await jest.advanceTimersByTimeAsync(800); });
  expect(api.salvarOnboarding).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('alert')).toHaveTextContent(/Não foi possível confirmar/);
  fireEvent.change(input, { target: { value: 'Corrigido explicitamente' } });
  await act(async () => { await jest.advanceTimersByTimeAsync(2400); });
  expect(api.salvarOnboarding).toHaveBeenCalledTimes(1);
  expect(input).toHaveValue('Corrigido explicitamente');
  expect(screen.getByRole('alert')).toHaveTextContent(/Não foi possível confirmar/);
  await act(async () => { await router.navigate('/comercial'); });
  expect(router.state.location.pathname).toBe('/onboardings/o/editar');
  fireEvent.click(screen.getByRole('button', { name: 'Guardar e sair' }));
  await act(async () => { await Promise.resolve(); });
  expect(api.salvarOnboarding).toHaveBeenCalledTimes(2);
  expect(api.salvarOnboarding.mock.calls[1][1]).toMatchObject({ versao: 1, dados: { responsavelNome: 'Corrigido explicitamente' } });
  expect(router.state.location.pathname).toBe('/comercial');
});
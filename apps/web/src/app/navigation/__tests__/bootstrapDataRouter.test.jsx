import React, { StrictMode, useEffect, useState } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as routing from 'react-router-dom';
import { Request } from 'node-fetch/lib/index.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import App from '../../../App';
import { createApiClient } from '../../../api/client';
import { createMockApi } from '../../../api/mock/mockApi';
import { withBackgroundTasksMock } from '../../../api/mock/backgroundTasksMock';
import { nomeDaOportunidade } from '../../../features/comercial/comercialModel';
import { ErrorBoundary } from '../../../components/ui/ErrorBoundary';
import { SessionBoundary } from '../../../features/auth/login/SessionBoundary';
import { pathToPageName } from '../../hooks/useManageAuthSession';
import * as workspaceNavigation from '../WorkspaceNavigation';
import { useWorkspaceNavigation } from '../WorkspaceNavigation.shared';

// The real App, SessionBoundary, screen map and public screens are loaded. Only
// transport is replaced. The probe isolates the session-map contract; the real
// authenticated App cases below additionally retain all pages, hooks/providers.
// Neither group is a browser E2E test or proof of protection for unsaved edits.
jest.mock('../../../api/client', () => {
  const api = {
    mode: 'mock', clearSession: jest.fn(), setAccessToken: jest.fn(),
    me: jest.fn(), getResumoWhatsapp: jest.fn().mockResolvedValue({ ok: false }),
  };
  return { createApiClient: () => api };
});

const api = createApiClient();
const { WorkspaceNavigationProvider } = workspaceNavigation;
const mounted = jest.fn();
const unmounted = jest.fn();
const originalRequest = globalThis.Request;
const originalFetch = globalThis.fetch;
let routers = [];

function SessionProbe({ session }) {
  const location = routing.useLocation();
  const params = routing.useParams();
  const workspace = useWorkspaceNavigation();
  const [value, setValue] = useState('');
  useEffect(() => { mounted(); return unmounted; }, []);
  return <>
    <output aria-label="route">{location.pathname}{location.search}{location.hash}</output>
    <output aria-label="page">{session.page}</output>
    <output aria-label="params">{JSON.stringify(params)}</output>
    <output aria-label="view">{workspace.modoVisao}</output>
    <input aria-label="synthetic session state" value={value} onChange={e => setValue(e.target.value)} />
  </>;
}

function SyntheticApp() {
  return <WorkspaceNavigationProvider><SessionBoundary api={api} tokenStorageKey="portal_firm_access_token">
    {session => <SessionProbe session={session} />}
  </SessionBoundary></WorkspaceNavigationProvider>;
}

// Execute the entrypoint itself in a fresh registry. Capture its root render,
// then mount exactly that element; never rebuild its routes in the test.
function bootstrap({ path = '/companies', component = SyntheticApp, dev = false } = {}) {
  window.history.replaceState(null, '', path);
  const host = document.createElement('div');
  host.id = 'root';
  document.body.appendChild(host);
  const root = { render: jest.fn() };
  const createRoot = jest.fn(() => root);
  const createBrowserRouter = jest.fn((...args) => {
    const router = routing.createBrowserRouter(...args);
    routers.push(router);
    return router;
  });
  jest.isolateModules(() => {
    jest.doMock('react', () => React);
    jest.doMock('react/jsx-runtime', () => jsxRuntime);
    jest.doMock('react-dom/client', () => ({ createRoot }));
    jest.doMock('react-router-dom', () => ({ ...routing, createBrowserRouter }));
    jest.doMock('../../../App', () => ({ __esModule: true, default: component }));
    jest.doMock('../../../components/ui/ErrorBoundary', () => ({ ErrorBoundary }));
    jest.doMock('../WorkspaceNavigation', () => workspaceNavigation);
    if (dev) require('../../../dev/comercial');
    else require('../../../main');
  });
  for (const module of ['react', 'react/jsx-runtime', 'react-dom/client', 'react-router-dom', '../../../App', '../../../components/ui/ErrorBoundary', '../WorkspaceNavigation']) {
    jest.dontMock(module);
  }
  const router = createBrowserRouter.mock.results[0]?.value;
  return { router, createBrowserRouter, createRoot, root, host,
    mount: () => render(root.render.mock.calls[0][0], { container: host }) };
}

beforeEach(() => {
  // jsdom lacks Request; use the installed WHATWG implementation, never fetch.
  globalThis.Request = Request;
  globalThis.fetch = jest.fn(() => { throw new Error('Network forbidden in bootstrap tests'); });
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('portal_firm_access_token', 'synthetic-only');
  api.me.mockReset().mockResolvedValue({ id: 'synthetic-user', accountType: 'FIRM' });
  api.clearSession.mockClear();
  api.setAccessToken.mockClear();
  api.getResumoWhatsapp.mockClear();
  mounted.mockClear(); unmounted.mockClear();
  document.head.innerHTML = '<title>Altan</title><link rel="manifest" href="/manifest.webmanifest">';
});

afterEach(() => {
  cleanup();
  routers.forEach(router => router.dispose());
  routers = [];
  document.body.innerHTML = '';
  expect(globalThis.fetch).not.toHaveBeenCalled();
  globalThis.Request = originalRequest;
  globalThis.fetch = originalFetch;
});

test('real main supplies one catch-all router, ErrorBoundary and StrictMode', () => {
  const entry = bootstrap({ component: App });
  const tree = entry.root.render.mock.calls[0][0];
  expect(entry.createRoot).toHaveBeenCalledWith(entry.host);
  expect(entry.createBrowserRouter).toHaveBeenCalledTimes(1);
  expect(tree.type).toBe(StrictMode);
  expect(tree.props.children.type).toBe(routing.RouterProvider);
  expect(tree.props.children.props.router).toBe(entry.router);
  const [routes] = entry.createBrowserRouter.mock.calls[0];
  expect(routes).toHaveLength(1);
  expect(routes[0].path).toBe('*');
  expect(routes[0].element.type).toBe(ErrorBoundary);
  expect(routes[0].element.props.children.type).toBe(App);
  expect(routes[0].children).toBeUndefined();
  const source = readFileSync(resolve(__dirname, '../../../main.jsx'), 'utf8');
  expect(source.match(/import ['"]([^'"]+\.css)['"]/g)).toEqual([
    "import './features/whatsapp/comunicados.css'", "import './index.css'",
    "import './features/onboarding/jornada-comercial.css'", "import './styles/conferencia.css'",
  ]);
  expect(source).not.toMatch(/BrowserRouter[>\s]/);
});

const deepLinks = [
  ['/companies?visao=calendario', 'companies'], ['/companies/demo/anotacoes', 'companyDetail'],
  ['/comercial', 'comercial'], ['/comercial/conversas', 'comercial'],
  ['/onboardings', 'onboardings'], ['/onboardings/demo', 'onboardingDetail'],
  ['/onboardings/demo/editar', 'onboardingWizard'], ['/suporte?conversa=demo', 'whatsapp'],
  ['/whatsapp', 'whatsapp'], ['/biblioteca', 'bibliotecaComercial'],
  ['/download-notas', 'serproFuncoes'], ['/configuracoes/atendimento', 'configuracoesGerais'],
];

test.each(deepLinks)('direct bootstrap/reload contract %s resolves through the real session map', async (path, page) => {
  const entry = bootstrap({ path });
  entry.mount();
  expect(await screen.findByLabelText('page')).toHaveTextContent(page);
  expect(pathToPageName(entry.router.state.location.pathname)).toBe(page);
  expect(screen.getByLabelText('route').textContent).toBe(path);
  const params = JSON.parse(screen.getByLabelText('params').textContent);
  expect(params.companyId).toBeUndefined();
  expect(params.onboardingId).toBeUndefined();
});

test('PUSH, REPLACE and POP preserve URL and mounted synthetic session/provider state', async () => {
  const entry = bootstrap({ path: '/companies?visao=calendario#inicio' });
  entry.mount();
  await screen.findByLabelText('page');
  fireEvent.change(screen.getByLabelText('synthetic session state'), { target: { value: 'preservar' } });
  const mounts = mounted.mock.calls.length, unmounts = unmounted.mock.calls.length;
  const length = window.history.length;
  await act(async () => entry.router.navigate('/companies?visao=tabela#lista'));
  expect(window.history.length).toBe(length + 1);
  expect(entry.router.state.historyAction).toBe('PUSH');
  await act(async () => entry.router.navigate('/companies?visao=tabela&busca=demo#fim', { replace: true }));
  expect(window.history.length).toBe(length + 1);
  expect(entry.router.state.historyAction).toBe('REPLACE');
  expect(window.location.search + window.location.hash).toBe('?visao=tabela&busca=demo#fim');
  act(() => { entry.router.navigate(-1); });
  await waitFor(() => expect(screen.getByLabelText('route').textContent).toBe('/companies?visao=calendario#inicio'));
  expect(entry.router.state.historyAction).toBe('POP');
  act(() => { entry.router.navigate(1); });
  await waitFor(() => expect(screen.getByLabelText('route').textContent).toBe('/companies?visao=tabela&busca=demo#fim'));
  expect(screen.getByLabelText('view')).toHaveTextContent('tabela');
  expect(screen.getByLabelText('synthetic session state')).toHaveValue('preservar');
  expect(mounted).toHaveBeenCalledTimes(mounts);
  expect(unmounted).toHaveBeenCalledTimes(unmounts);
  expect(entry.createBrowserRouter).toHaveBeenCalledTimes(1);
  expect(entry.root.render).toHaveBeenCalledTimes(1);
});

describe('authenticated real App, pages and providers with local demonstration transport', () => {
  const sessionTransport = { ...api };
  let company, onboarding;

  beforeEach(async () => {
    // Use the existing in-memory API contracts, not page/hook substitutes or a
    // permissive proxy returning success for unknown endpoints. No real client
    // is constructed. The outer fetch trap also rejects accidental networking.
    const transport = withBackgroundTasksMock(createMockApi({ delay: () => Promise.resolve() }));
    Object.assign(api, transport, sessionTransport);
    api.me.mockResolvedValue({ id: 'synthetic-user', accountType: 'FIRM', role: 'contador', name: 'Sessão sintética' });
    const companies = await transport.listCompanies();
    // The demonstration store starts without onboardings. Create this fixture
    // through that local API only; never depend on a user's persisted record.
    const result = await transport.criarOnboarding('ABERTURA');
    company = companies[0];
    onboarding = result.onboarding;
    expect(company?.companyId).toBeTruthy();
    expect(onboarding?.id).toBeTruthy();
    api.getOnboarding = jest.fn(transport.getOnboarding);
  });

  afterEach(() => {
    // Unmount while the transport is still present, before restoring the small
    // session fixture used by the other cases. Dispose is also done globally.
    cleanup();
    for (const key of Object.keys(api)) delete api[key];
    Object.assign(api, sessionTransport);
  });

  test.each([
    ['calendar', '/companies?visao=calendario'],
    ['company', '/companies/:id/anotacoes'],
    ['commercial', '/comercial'],
    ['commercial-chat', '/comercial/conversas'],
    ['onboardings', '/onboardings'],
    ['detail', '/onboardings/:id'],
    ['edit', '/onboardings/:id/editar'],
    ['support', '/suporte?conversa'],
    ['whatsapp', '/whatsapp'],
  ])('real authenticated direct entry/reload: %s (%s)', async (kind, template) => {
    const id = kind === 'company' ? company.companyId : onboarding.id;
    const path = template.replace(':id', encodeURIComponent(id));
    const entry = bootstrap({ path, component: App });
    entry.mount();
    expect(await screen.findByRole('navigation', { name: kind === 'company' ? 'Grupos da empresa' : 'Áreas do escritório' })).toBeVisible();
    if (kind === 'calendar') {
      expect(await screen.findByRole('heading', { name: 'Calendario', level: 1 })).toBeInTheDocument();
    } else if (kind === 'company') {
      await waitFor(() => expect(entry.host.querySelector('.company-topbar__name')).toHaveTextContent(company.razao));
      expect(entry.host.querySelector('a[href$="/anotacoes"]')).toHaveAttribute('aria-current', 'page');
    } else if (kind === 'commercial') {
      expect(await screen.findByRole('heading', { name: 'Comercial', level: 1 })).toBeVisible();
      expect(await screen.findByRole('textbox', { name: 'Buscar oportunidade' })).toBeVisible();
    } else if (kind === 'onboardings') {
      expect(await screen.findByRole('textbox', { name: 'Buscar atendimento' })).toBeVisible();
    } else if (kind === 'detail' || kind === 'edit') {
      expect(await screen.findByText(nomeDaOportunidade(onboarding), { selector: 'strong.page-shell__title' })).toBeVisible();
      expect(api.getOnboarding).toHaveBeenCalledWith(onboarding.id);
    } else {
      expect(await screen.findByRole('heading', { name: 'Conversas', level: 2 })).toBeVisible();
      expect(await screen.findByPlaceholderText('Buscar contato ou empresa')).toBeVisible();
    }
    expect(entry.host.querySelector('.office-workspace')).not.toBeNull();
    expect(entry.router.state.errors).toBeNull();
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(path);
  });

  test('real Commercial state and workspace survive query/hash PUSH, REPLACE and POP', async () => {
    const entry = bootstrap({ path: '/companies?visao=tabela', component: App });
    entry.mount();
    await screen.findByRole('heading', { name: 'Empresas', level: 1 });
    await act(async () => entry.router.navigate('/comercial?origem=carteira#inicio'));
    const search = await screen.findByRole('textbox', { name: 'Buscar oportunidade' });
    fireEvent.change(search, { target: { value: 'estado local preservado' } });
    const shell = entry.host.querySelector('.office-workspace');
    const sessionChecks = api.me.mock.calls.length;
    const length = window.history.length;
    await act(async () => entry.router.navigate('/comercial?origem=teste#push'));
    expect(entry.router.state.historyAction).toBe('PUSH');
    expect(window.history.length).toBe(length + 1);
    await act(async () => entry.router.navigate('/comercial?origem=teste&filtro=1#replace', { replace: true }));
    expect(entry.router.state.historyAction).toBe('REPLACE');
    expect(window.history.length).toBe(length + 1);
    expect(window.location.search + window.location.hash).toBe('?origem=teste&filtro=1#replace');
    act(() => { entry.router.navigate(-1); });
    await waitFor(() => expect(window.location.search + window.location.hash).toBe('?origem=carteira#inicio'));
    expect(entry.router.state.historyAction).toBe('POP');
    act(() => { entry.router.navigate(1); });
    await waitFor(() => expect(window.location.search + window.location.hash).toBe('?origem=teste&filtro=1#replace'));
    expect(screen.getByRole('textbox', { name: 'Buscar oportunidade' })).toBe(search);
    expect(search).toHaveValue('estado local preservado');
    expect(entry.host.querySelector('.office-workspace')).toBe(shell);
    expect(api.me).toHaveBeenCalledTimes(sessionChecks);
    // No visao query: the actual provider must remember its earlier choice.
    await act(async () => entry.router.navigate('/companies'));
    expect(await screen.findByRole('heading', { name: 'Empresas', level: 1 })).toBeInTheDocument();
    expect(entry.createBrowserRouter).toHaveBeenCalledTimes(1);
    expect(entry.root.render).toHaveBeenCalledTimes(1);
  });

  test('confirmed session redirects from login into the real Commercial page without an extra entry', async () => {
    const entry = bootstrap({ path: '/login?redirect=%2Fcomercial%3Forigem%3Dlogin%23inicio', component: App });
    const length = window.history.length;
    entry.mount();
    expect(await screen.findByRole('textbox', { name: 'Buscar oportunidade' })).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Áreas do escritório' })).toBeVisible();
    expect(entry.router.state.historyAction).toBe('REPLACE');
    // destinoInternoSeguro preserves pathname/search and drops the redirect hash.
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/comercial?origem=login');
    expect(window.history.length).toBe(length);
    expect(api.me).toHaveBeenCalled();
  });
});

test('real App and SessionBoundary do not treat redirect query as authentication', async () => {
  localStorage.clear();
  const entry = bootstrap({ path: '/login?redirect=%2Fcomercial%2Fconversas', component: App });
  entry.mount();
  expect(await screen.findByRole('button', { name: 'Entrar' })).toBeVisible();
  expect(api.me).not.toHaveBeenCalled();
  expect(api.getResumoWhatsapp).not.toHaveBeenCalled();
  expect(screen.queryByRole('navigation', { name: 'Áreas do escritório' })).not.toBeInTheDocument();
});

test('confirmed synthetic session follows the existing internal login redirect with REPLACE', async () => {
  const entry = bootstrap({ path: '/login?redirect=%2Fcomercial%2Fconversas%3Fconversa%3Ddemo' });
  const length = window.history.length;
  entry.mount();
  expect(await screen.findByLabelText('page')).toHaveTextContent('comercial');
  expect(screen.getByLabelText('route').textContent).toBe('/comercial/conversas?conversa=demo');
  expect(entry.router.state.historyAction).toBe('REPLACE');
  expect(window.history.length).toBe(length);
});

test.each([
  ['/proposta/publica', 'A proposta precisa ser aberta no endereço fornecido pelo escritório.'],
  ['/onboarding/publico', 'Link incompleto. Peça um novo link ao escritório.'],
])('real App bypasses private session on %s without public document transport', async (path, message) => {
  const entry = bootstrap({ path, component: App });
  entry.mount();
  expect(await screen.findByText(message)).toBeVisible();
  expect(api.me).not.toHaveBeenCalled();
  expect(api.setAccessToken).not.toHaveBeenCalled();
  expect(api.getResumoWhatsapp).not.toHaveBeenCalled();
  expect(entry.host.querySelector('.office-workspace')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Entrar' })).not.toBeInTheDocument();
});

test.each([
  ['/whatsapp', true], ['/login?redirect=%2Fwhatsapp%3Fapp%3Datendimento', true],
  ['/comercial', false], ['/suporte?conversa=demo', false], ['/login?redirect=%2Fcomercial', false],
])('entry identity remains unchanged for %s', (path, atendimento) => {
  bootstrap({ path });
  expect(document.title).toBe(atendimento ? 'Altan Atendimento' : 'Altan');
  expect(document.querySelector('link[rel="manifest"]').getAttribute('href'))
    .toBe(atendimento ? '/atendimento.webmanifest' : '/manifest.webmanifest');
});

test.each(['synthetic runtime error', 'Failed to fetch dynamically imported module'])('existing boundary handles App error: %s', async message => {
  sessionStorage.setItem('app:recarga-por-chunk-velho', String(Date.now()));
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  function BrokenApp() { throw new Error(message); }
  try {
    const entry = bootstrap({ component: BrokenApp });
    entry.mount();
    expect(await screen.findByText(message.startsWith('Failed') ? 'Não foi possível carregar esta tela' : '⚠ Erro de runtime no componente')).toBeVisible();
    expect(entry.router.state.errors).toBeNull();
  } finally { errorLog.mockRestore(); }
});

describe('real DEV entry (existing Babel import.meta.env transform)', () => {
  let previousDev, previousMode;
  beforeEach(() => { previousDev = process.env.DEV; previousMode = process.env.VITE_API_MODE; });
  afterEach(() => {
    if (previousDev === undefined) delete process.env.DEV; else process.env.DEV = previousDev;
    if (previousMode === undefined) delete process.env.VITE_API_MODE; else process.env.VITE_API_MODE = previousMode;
  });

  test.each([[undefined, 'mock'], ['true', 'real']])('guard disabled (%s/%s) creates neither router nor root', (dev, mode) => {
    if (dev === undefined) delete process.env.DEV; else process.env.DEV = dev;
    process.env.VITE_API_MODE = mode;
    const entry = bootstrap({ dev: true });
    expect(entry.createBrowserRouter).not.toHaveBeenCalled();
    expect(entry.createRoot).not.toHaveBeenCalled();
  });

  test('DEV mock mounts the real Previa fallback inside its workspace', () => {
    process.env.DEV = 'true'; process.env.VITE_API_MODE = 'mock';
    const entry = bootstrap({ dev: true, path: '/preview-bootstrap?local=1#teste' });
    entry.mount();
    expect(screen.getByRole('heading', { name: 'Prévia do atendimento' })).toBeVisible();
    expect(entry.createBrowserRouter).toHaveBeenCalledTimes(1);
    expect(entry.router.state.location).toMatchObject({ pathname: '/preview-bootstrap', search: '?local=1', hash: '#teste' });
  });

  test('DEV html normalization replaces once and retains the previous query/hash removal contract', async () => {
    process.env.DEV = 'true'; process.env.VITE_API_MODE = 'mock';
    const length = window.history.length;
    const entry = bootstrap({ dev: true, path: '/comercial-dev.html?legacy=1#legacy' });
    await waitFor(() => expect(entry.router.state.location.pathname).toBe('/comercial'));
    expect(entry.router.state.location).toMatchObject({ search: '', hash: '' });
    expect(entry.router.state.historyAction).toBe('REPLACE');
    expect(window.history.length).toBe(length);
    expect(entry.createBrowserRouter).toHaveBeenCalledTimes(1);
  });
});

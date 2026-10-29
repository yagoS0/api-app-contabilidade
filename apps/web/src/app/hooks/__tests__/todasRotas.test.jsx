import { Request } from 'node-fetch/lib/index.js';
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useNavigate, useLocation } from 'react-router-dom';
import App from '../../../App';
import { createApiClient } from '../../../api/client';
import { TAB_TO_SEGMENT } from '../../../features/companies/detail/lib/rotasDaEmpresa';

jest.setTimeout(180000);
let navigate;
function Caminho() {
  navigate = useNavigate();
  return <output data-testid="caminho">{useLocation().pathname}</output>;
}
beforeAll(() => {
  window.matchMedia = jest.fn(() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  window.scrollTo = jest.fn();
  Element.prototype.scrollIntoView = jest.fn();
});

test('todas as abas canônicas abrem e alternam no app completo para Simples e Presumido', async () => {
  localStorage.setItem('portal_firm_access_token', 'mock-rota');
  const erros = jest.spyOn(console, 'error').mockImplementation(() => {});
  const api = createApiClient();
  expect(api.mode).toBe('mock');
  const empresas = await api.listCompanies('2026-09');
  const selecionadas = ['SIMPLES', 'PRESUMIDO'].map(regime => empresas.find(c => String(c.legacyCompany?.regimeTributario || c.regimeTributario).includes(regime)));
  expect(selecionadas.every(Boolean)).toBe(true);
  mountRouter(<><Caminho/><App/></>, ['/companies']);
  await screen.findByRole('button', { name: 'Empresas', exact: true }, { timeout: 10000 });
  for (const empresa of selecionadas) {
    for (const segmento of Object.values(TAB_TO_SEGMENT)) {
      const destino = `/companies/${empresa.companyId}/${segmento}`;
      await act(async () => { navigate(destino); });
      // O mock usa 250 ms por leitura. Também drena os efeitos disparados pela mudança de empresa.
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 650)); });
      expect(screen.getByTestId('caminho')).toHaveTextContent(destino);
      expect(screen.queryByText(/Erro de runtime no componente/)).not.toBeInTheDocument();
      expect(screen.queryByText('Não foi possível carregar esta tela')).not.toBeInTheDocument();
      await waitFor(() => expect(document.body.textContent).toContain(empresa.razao), { timeout: 7000 });
      await waitFor(() => expect(screen.queryByText('Carregando…')).not.toBeInTheDocument(), { timeout: 7000 });
      expect(screen.queryByText('Empresa não encontrada ou sem acesso.')).not.toBeInTheDocument();
    }
  }
  const rotas = ['/companies/new', '/guides/pending', '/guides/batch-email', '/firm-settings/guides', '/firm-settings/chart', '/apuracao', '/rotinas', '/laboratorio', '/planejamento', '/obrigacoes', '/suporte', '/comercial', '/comercial/oportunidades', '/comercial/conversas', '/onboardings', '/biblioteca', '/whatsapp/comunicados', '/configuracoes', '/configuracoes/cbs-ibs', '/funcoes-serpro'];
  for (const destino of rotas) {
    await act(async () => { navigate(destino); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 650)); });
    expect(screen.queryByText(/Erro de runtime no componente/)).not.toBeInTheDocument();
    expect(screen.queryByText('Não foi possível carregar esta tela')).not.toBeInTheDocument();
    expect(document.body.textContent.length).toBeGreaterThan(100);
  }
  for (const legado of ['/guides/upload', '/guides/upload/']) {
    await act(async () => { navigate(legado); });
    await waitFor(() => expect(screen.getByTestId('caminho').textContent).toBe('/companies'));
    expect(screen.queryByRole('link', { name: 'Guias não identificadas' })).not.toBeInTheDocument();
  }
  const falhas = erros.mock.calls.flat().filter(x => x instanceof Error);
  erros.mockRestore();
  expect(falhas).toEqual([]);
});

const mountedRouters = [];
function mountRouter(element, initialEntries) {
  const router = createMemoryRouter([{ path: '*', element }], { initialEntries });
  mountedRouters.push(router);
  const view = render(<RouterProvider router={router} />);
  return { ...view, unmount: () => { view.unmount(); router.dispose(); } };
}
afterEach(() => { cleanup(); mountedRouters.splice(0).forEach(router => router.dispose()); });

// Same installed Request implementation as bootstrapDataRouter; no router mock or fetch replacement.
const requestDescriptorBeforeSuite = Object.getOwnPropertyDescriptor(globalThis, 'Request');
beforeEach(() => { Object.defineProperty(globalThis, 'Request', { configurable: true, writable: true, value: Request }); });
afterEach(() => {
  if (requestDescriptorBeforeSuite) Object.defineProperty(globalThis, 'Request', requestDescriptorBeforeSuite);
  else delete globalThis.Request;
});
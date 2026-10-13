import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate, useLocation } from 'react-router-dom';
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
  render(<MemoryRouter initialEntries={['/companies']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Caminho/><App/></MemoryRouter>);
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
  const rotas = ['/companies/new', '/guides/upload', '/guides/pending', '/guides/batch-email', '/firm-settings/guides', '/firm-settings/chart', '/apuracao', '/rotinas', '/laboratorio', '/planejamento', '/obrigacoes', '/suporte', '/comercial', '/comercial/oportunidades', '/comercial/conversas', '/onboardings', '/biblioteca', '/whatsapp/comunicados', '/configuracoes', '/configuracoes/cbs-ibs', '/funcoes-serpro'];
  for (const destino of rotas) {
    await act(async () => { navigate(destino); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 650)); });
    expect(screen.queryByText(/Erro de runtime no componente/)).not.toBeInTheDocument();
    expect(screen.queryByText('Não foi possível carregar esta tela')).not.toBeInTheDocument();
    expect(document.body.textContent.length).toBeGreaterThan(100);
  }
  const falhas = erros.mock.calls.flat().filter(x => x instanceof Error);
  erros.mockRestore();
  expect(falhas).toEqual([]);
});

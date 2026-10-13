import { render, screen, fireEvent } from '@testing-library/react';
import { CompanyDetailPage } from '../pages/renderCompanyDetailPage';
import { TAB_TO_SEGMENT } from '../lib/rotasDaEmpresa';

test.each(Object.keys(TAB_TO_SEGMENT))('entrada direta em %s aguarda a empresa antes de montar a aba', companyDetailTab => {
  render(<CompanyDetailPage company={{ selectedCompany: null, companyDetailTab, loadingCompany: true }} />);
  expect(screen.getByText('Carregando…')).toBeVisible();
  expect(screen.queryByText(/Erro de runtime/)).not.toBeInTheDocument();
});

test('falha de carga oferece retorno e nova tentativa em vez de espera infinita', () => {
  const retry = jest.fn();
  render(<CompanyDetailPage company={{ selectedCompany: null, loadingCompany: false, companyError: 'Falha ao carregar empresas', onRetryCompany: retry }} />);
  expect(screen.getByText('Falha ao carregar empresas')).toBeVisible();
  expect(screen.queryByText('Carregando…')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  expect(retry).toHaveBeenCalledTimes(1);
});

test('empresa ausente na carteira não monta painel fiscal sem identidade', () => {
  render(<CompanyDetailPage company={{ selectedCompany: null, loadingCompany: false }} />);
  expect(screen.getByText('Empresa não encontrada ou sem acesso.')).toBeVisible();
});

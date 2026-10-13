import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { GuiaChip } from '../renderGuiaChip';

function Caminho() {
  const navigate = useNavigate();
  return <><output data-testid="url">{useLocation().pathname}</output><button onClick={() => navigate(-1)}>Voltar teste</button><button onClick={() => navigate(1)}>Avançar teste</button></>;
}
const empresa = { companyId: 'empresa-b', razao: 'Empresa B' };
test.each([['Abrir guias da empresa', 'guides'], ['Abrir parcelamentos', 'parcelamento']])('%s navega dentro do app e conserva voltar/avançar', (nome, aba) => {
  render(<MemoryRouter initialEntries={['/companies']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Caminho/><GuiaChip empresa={empresa} competencia="2026-09" tag={{ key: 'parcDas', label: 'Parcelamento', state: 'missing' }}/></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: /Parcelamento:/ }));
  const link = screen.getByRole('link', { name: nome });
  expect(link).toHaveAttribute('href', `/companies/empresa-b/${aba}`);
  const modificado = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true });
  fireEvent(link, modificado);
  expect(modificado.defaultPrevented).toBe(false);
  expect(screen.getByTestId('url')).toHaveTextContent('/companies');
  fireEvent.click(link);
  expect(screen.getByTestId('url')).toHaveTextContent(`/companies/empresa-b/${aba}`);
  fireEvent.click(screen.getByRole('button', { name: 'Voltar teste' }));
  expect(screen.getByTestId('url').textContent).toBe('/companies');
  fireEvent.click(screen.getByRole('button', { name: 'Avançar teste' }));
  expect(screen.getByTestId('url')).toHaveTextContent(`/companies/empresa-b/${aba}`);
});

test('Abrir apuração vai à apuração da empresa indicada, sem passar pela aba genérica', () => {
  render(<MemoryRouter initialEntries={['/companies']}><Caminho/><GuiaChip empresa={empresa} competencia="2026-09" tag={{ key: 'das', label: 'DAS', state: 'missing' }}/></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: /DAS:/ }));
  fireEvent.click(screen.getByRole('link', { name: 'Abrir apuração' }));
  expect(screen.getByTestId('url')).toHaveTextContent('/companies/empresa-b/cadastro-fiscal');
});

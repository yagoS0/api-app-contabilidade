import { render, screen } from '@testing-library/react';
import { CompaniesHomePage } from '../renderCompaniesHomePage';
import { WorkspaceNavigation } from '../../../../../app/navigation/WorkspaceNavigation.shared';
jest.mock('../../../../operacoes/OperationsPage', () => ({ OperationsPage: ({ loading, error, companies }) => <output data-testid="availability">{JSON.stringify({ loading, error, count: companies.length })}</output> }));
const companies = [{ companyId:'a', razao:'Empresa' }];
test('erro global não substitui erro da carteira; loading, restauração e erro próprio continuam bloqueantes', () => {
  const props = { companies, user:{name:'Contador'}, dashboardCompetencia:'2026-10', loadingCompanies:false, companiesLoadError:'', error:'Serviço de mensagens indisponível' };
  const { rerender } = render(<CompaniesHomePage {...props} />);
  expect(JSON.parse(screen.getByTestId('availability').textContent)).toEqual({ loading:false, error:'', count:1 });
  rerender(<CompaniesHomePage {...props} companiesLoadError="Carteira indisponível" />);
  expect(JSON.parse(screen.getByTestId('availability').textContent).error).toBe('Carteira indisponível');
  rerender(<CompaniesHomePage {...props} loadingCompanies />);
  expect(JSON.parse(screen.getByTestId('availability').textContent).loading).toBe(true);
  rerender(<WorkspaceNavigation.Provider value={{modoVisao:'operacoes',location:{search:'?competencia=2026-09'},navigate:jest.fn()}}><CompaniesHomePage {...props} onChangeCompetencia={jest.fn()} /></WorkspaceNavigation.Provider>);
  expect(JSON.parse(screen.getByTestId('availability').textContent).loading).toBe(true);
});

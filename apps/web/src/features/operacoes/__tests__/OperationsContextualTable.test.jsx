import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OperationsPage } from '../OperationsPage';
import { WorkspaceNavigation } from '../../../app/navigation/WorkspaceNavigation.shared';
jest.mock('../OperationsAlerts', () => ({ OperationsAlerts: () => null }));
jest.mock('../OperationsRoutineCompanies', () => ({ OperationsRoutineCompanies: () => null }));
const period = '2026-10';
const company = (index, apurada = null) => ({ companyId: String(index), razao: `Empresa ${String(index).padStart(2, '0')}`, fluxoCarteira: { competencia: period, status: { chave: 'apuracao' }, apuracao: { apurada }, contabilizacao: {} } });

test('modal pagina todas as empresas e busca sem modificar indicadores', () => {
  const companies = Array.from({ length: 31 }, (_, i) => company(i, i === 0));
  render(<OperationsPage companies={companies} competencia={period} />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Calculado 1/31 empresas' }));
  const table = within(screen.getByRole('dialog', { name: 'Calculado · outubro de 2026' }));
  expect(table.getAllByRole('rowheader')).toHaveLength(30);
  fireEvent.click(table.getByRole('button', { name: 'Próxima' }));
  expect(table.getAllByRole('rowheader')).toHaveLength(1);
  expect(table.queryByLabelText('Ordenar empresas')).not.toBeInTheDocument();
  fireEvent.change(table.getByLabelText('Buscar empresa'), { target: { value: 'Empresa 00' } });
  expect(table.getAllByRole('rowheader')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Calculado 1/31 empresas' })).toHaveAttribute('aria-pressed', 'true');
});

test('carregamento, falha e vazio permanecem distintos e troca de competência descarta dados antigos', () => {
  const companies = [company(0)];
  const view = render(<OperationsPage companies={companies} competencia={period} loading />);
  expect(screen.getByRole('button', {name:/Calculado —/})).toBeDisabled();
  expect(screen.queryByRole('rowheader')).not.toBeInTheDocument();
  view.rerender(<OperationsPage companies={companies} competencia={period} error="Leitura indisponível" />);
  const table = screen.getByRole('region', { name: 'Operações' });
  expect(within(table).getByRole('alert')).toHaveTextContent('Leitura indisponível');
  expect(within(table).queryByText('Nenhuma empresa neste conjunto.')).not.toBeInTheDocument();
  view.rerender(<OperationsPage companies={companies} competencia="2026-11" />);
  expect(screen.queryByText('Empresa 00')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('zero salvo não vira ausência; abrir indicador só lê e resposta tardia não mistura períodos', async () => {
  let finish;
  const companies = [company(0, true)];
  const api = { getCompanyOperation: jest.fn(), saveCompanyOperation: jest.fn(), executeCompanyOperation: jest.fn(), getOperationEvidence: jest.fn(period => period === '2026-10' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ competencia: period, total: 1, items: [{ companyId: '0', competencia: period, revision: 'new', status: 'PENDING', pending: [], calculation: { dasValor: 0, receitaBruta: 0 } }] })) };
  const view = render(<OperationsPage companies={companies} competencia={period} api={api} />);
  fireEvent.click(screen.getByRole('button', { name: 'Calculado 1/1 empresas' }));
  await waitFor(() => expect(finish).toBeDefined());
  const newer = [{ ...companies[0], fluxoCarteira: { ...companies[0].fluxoCarteira, competencia: '2026-11' } }];
  view.rerender(<OperationsPage companies={newer} competencia="2026-11" api={api} />);
  await act(async () => finish({ competencia: period, total: 1, items: [{ companyId: '0', competencia: period, revision: 'old', status: 'CONFIRMED', pending: [], calculation: { dasValor: 999999 } }] }));
  fireEvent.click(screen.getByRole('button', { name: 'Calculado 1/1 empresas' }));
  await waitFor(() => expect(screen.queryByText('Lendo cálculos e evidências…')).not.toBeInTheDocument());
  expect(screen.queryByText(/999\.999/)).not.toBeInTheDocument();
  expect(screen.getAllByText(/0,00/).length).toBeGreaterThan(0);
  expect(api.getCompanyOperation).not.toHaveBeenCalled(); expect(api.saveCompanyOperation).not.toHaveBeenCalled(); expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});

test('recarga restaura busca, ordem e página da URL sem restaurar seleção de comandos', () => {
  const companies = Array.from({ length: 31 }, (_, i) => company(i, false));
  const navigation = { navigate: jest.fn(), location: { pathname: '/companies', search: '?competencia=2026-10&operacoesCompetencia=2026-10&operacoesModal=aberto&operacoesEtapa=calculado&operacoesLista=all&operacoesBusca=Empresa&operacoesOrdem=name&operacoesPagina=1' } };
  render(<WorkspaceNavigation.Provider value={navigation}><OperationsPage companies={companies} competencia={period} /></WorkspaceNavigation.Provider>);
  expect(screen.getByLabelText('Buscar empresa')).toHaveValue('Empresa');
  expect(screen.queryByLabelText('Ordenar empresas')).not.toBeInTheDocument();
  expect(screen.getAllByRole('rowheader')).toHaveLength(1);
  expect(screen.getByRole('rowheader')).toHaveTextContent('Empresa 30');
  expect(navigation.navigate).not.toHaveBeenCalled();
});

test('concluído aguarda evidência manual e mantém falha distinta de conclusão', async () => {
  let reject;
  const api = { getOperationManualInss: jest.fn(() => new Promise((resolve, fail) => { reject = fail; })) };
  const navigation = { navigate: jest.fn(), location: { pathname: '/companies', search: '?competencia=2026-10&operacoesCompetencia=2026-10&operacoesModal=aberto&operacoesEtapa=concluido&operacoesLista=stage' } };
  const companies = [{ ...company(0, true), fluxoCarteira: { ...company(0, true).fluxoCarteira, status: { chave: 'concluido' } } }];
  render(<WorkspaceNavigation.Provider value={navigation}><OperationsPage companies={companies} competencia={period} api={api} /></WorkspaceNavigation.Provider>);
  const table = within(screen.getByRole('dialog', { name: 'Concluído · outubro de 2026' }));
  expect(table.getByRole('status')).toHaveTextContent('Carregando empresas');
  expect(table.queryByRole('rowheader')).not.toBeInTheDocument();
  await waitFor(() => expect(reject).toBeDefined());
  await act(async () => reject(new Error('Indisponível')));
  expect(table.getByRole('alert')).toHaveTextContent('Não foi possível conferir o INSS manual');
  expect(table.queryByRole('rowheader')).not.toBeInTheDocument();
});

test('indicador leva foco ao título; busca preserva foco e Guias mantém acesso separado aos erros', async () => {
  render(<OperationsPage companies={[company(0, false)]} competencia={period} />);
  fireEvent.click(screen.getByRole('button', { name: 'Calculado 0/1 empresas' }));
  expect(screen.getByLabelText('Buscar empresa')).toHaveFocus();
  const search = screen.getByLabelText('Buscar empresa');
  search.focus(); fireEvent.change(search, { target: { value: 'Empresa' } });
  expect(search).toHaveFocus();
  fireEvent.click(screen.getByRole('button', {name:'Fechar'}));
  fireEvent.click(screen.getByRole('button', { name: 'Guias', exact: true }));
  expect(screen.getByRole('dialog', { name: 'Guias · outubro de 2026' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Erros de envio de guias 0' })).toBeEnabled();
});

test('seleção de Calculado alcança todas as páginas e não executa comandos', async () => {
  const companies = Array.from({ length: 31 }, (_, i) => ({ ...company(i, false), myRole: 'ACCOUNTANT' }));
  const records = companies.map(c => ({ companyId: c.companyId, competencia: period, revision: `r-${c.companyId}`, regime: 'SIMPLES', status: 'PENDING', pending: [], calculation: null }));
  const api = { getCompanyOperation: jest.fn(), saveCompanyOperation: jest.fn(), executeCompanyOperation: jest.fn(), getOperationEvidence: jest.fn(async () => ({ competencia: period, total: records.length, items: records })) };
  render(<OperationsPage api={api} companies={companies} competencia={period} />);
  fireEvent.click(screen.getByRole('button', { name: 'Calculado 0/31 empresas' }));
  const all = await screen.findByRole('checkbox', { name: 'Selecionar todas as elegíveis do filtro (31)' });
  fireEvent.click(all);
  expect(screen.getByText('31 selecionadas', {exact:true})).toBeVisible();
  expect(screen.queryByText(/fora da busca/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Buscar empresa'), {target:{value:'Empresa 00'}});
  expect(screen.getByText('31 selecionadas · 30 fora da busca')).toBeVisible();
  expect(screen.getByRole('checkbox', {name:'Selecionar Empresa 00'})).toBeChecked();
  fireEvent.change(screen.getByLabelText('Buscar empresa'), {target:{value:''}});
  expect(screen.getByText('31 selecionadas', {exact:true})).toBeVisible();
  expect(screen.queryByText(/fora da busca/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
  expect(screen.getByRole('checkbox', { name: 'Selecionar Empresa 30' })).toBeChecked();
  expect(api.getCompanyOperation).not.toHaveBeenCalled();
  expect(api.saveCompanyOperation).not.toHaveBeenCalled();
  expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});

import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { OperationsRoutineCompanies } from '../OperationsRoutineCompanies';

const companies = [{ companyId: 'a', razao: 'Empresa Alfa', cnpj: '111' }, { companyId: 'b', razao: 'Empresa Beta', cnpj: '222' }];
const response = { items: [{ companyId: 'a', enabledKeys: ['das'] }, { companyId: 'b', enabledKeys: [] }], routines: [{ key: 'das', label: 'DAS' }, { key: 'inss', label: 'INSS' }] };

test('consumidor sem competência mantém rotinas disponíveis e não consulta período indefinido', async () => {
  const api = { getOperationRoutines: async () => response, getOperationConsultas: jest.fn() };
  render(<OperationsRoutineCompanies api={api} companies={companies} />);
  expect(await screen.findByRole('button', { name: 'Habilitadas 1' })).toBeEnabled();
  expect(screen.getByRole('button', { name: /Erros —/ })).toBeDisabled();
  expect(api.getOperationConsultas).not.toHaveBeenCalled();
});

test('caixa mostra contagens e abre empresas sob demanda sem consultas fiscais', async () => {
  const api = { getOperationRoutines: jest.fn(async () => response), getCompanyAutomation: jest.fn(), executeCompanyOperation: jest.fn() };
  render(<OperationsRoutineCompanies api={api} companies={companies} />);
  const button = await screen.findByRole('button', { name: 'Habilitadas 1' });
  expect(screen.queryByText('Empresa Alfa')).not.toBeInTheDocument();
  fireEvent.click(button);
  const modal = screen.getByRole('dialog');
  expect(within(modal).getByRole('link', { name: 'Empresa Alfa' })).toHaveAttribute('href', '/companies/a/cadastro');
  expect(within(modal).getByRole('link', { name: 'Configurar rotinas' })).toHaveAttribute('href', '/companies/a/automacao');
  expect(within(modal).queryByText('Empresa Beta')).not.toBeInTheDocument();
  expect(api.getOperationRoutines).toHaveBeenCalledTimes(1);
  expect(api.getCompanyAutomation).not.toHaveBeenCalled();
  expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});

test('filtro por rotina diferencia empresas e permite buscar não habilitadas', async () => {
  render(<OperationsRoutineCompanies api={{ getOperationRoutines: async () => response }} companies={companies} />);
  await screen.findByRole('button', { name: 'Habilitadas 1' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Rotina' }), { target: { value: 'inss' } });
  fireEvent.click(screen.getByRole('button', { name: 'Rotinas: Não habilitadas 2' }));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar empresa' }), { target: { value: '222' } });
  expect(screen.getByRole('link', { name: 'Empresa Beta' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Empresa Alfa' })).not.toBeInTheDocument();
});

test('erro de leitura não trata empresas como desabilitadas', async () => {
  render(<OperationsRoutineCompanies api={{ getOperationRoutines: async () => { throw Error('Sem conexão'); } }} companies={companies} />);
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Rotinas: Não habilitadas —' })).toBeDisabled();
});

test('empresa ausente do retorno autorizado não é contada como não habilitada', async () => {
  render(<OperationsRoutineCompanies api={{ getOperationRoutines: async () => ({ ...response, items: response.items.slice(0, 1) }) }} companies={companies} />);
  await screen.findByRole('button', { name: 'Habilitadas 1' });
  expect(screen.getByRole('button', { name: 'Rotinas: Não habilitadas 0' })).toBeEnabled();
  expect(screen.getByText(/Algumas empresas não têm configuração disponível/)).toBeInTheDocument();
});

test('resposta de sessão antiga não substitui leitura atual', async () => {
  let completeOld;
  const oldApi = { getOperationRoutines: () => new Promise(resolve => { completeOld = resolve; }) };
  const view = render(<OperationsRoutineCompanies api={oldApi} companies={companies} />);
  view.rerender(<OperationsRoutineCompanies api={{ getOperationRoutines: async () => ({ ...response, items: response.items.map(c => ({ ...c, enabledKeys: [] })) }) }} companies={companies} />);
  await screen.findByRole('button', { name: 'Rotinas: Não habilitadas 2' });
  await act(async () => completeOld(response));
  expect(screen.getByRole('button', { name: 'Rotinas: Não habilitadas 2' })).toBeInTheDocument();
});

test('DAS não conta presumido como desabilitado nem regime desconhecido como elegível', async () => {
  const data = { ...response, items: [
    { companyId: 'a', enabledKeys: [], applicableKeys: ['das', 'inss'], regime: 'SIMPLES' },
    { companyId: 'b', enabledKeys: ['presumido'], applicableKeys: ['presumido', 'inss'], regime: 'LUCRO_PRESUMIDO' },
    { companyId: 'c', enabledKeys: [], applicableKeys: [], regime: null, unavailableReason: 'Regime não confirmado' },
  ] };
  render(<OperationsRoutineCompanies api={{ getOperationRoutines: async () => data }} companies={[...companies, { companyId: 'c', razao: 'Sem regime' }]} />);
  await screen.findByRole('button', { name: 'Habilitadas 1' });
  expect(screen.getByRole('button', { name: 'Rotinas: Não habilitadas 1' })).toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Rotina' }), { target: { value: 'das' } });
  fireEvent.click(screen.getByRole('button', { name: 'Rotinas: Não habilitadas 1' }));
  expect(screen.getByRole('link', { name: 'Empresa Alfa' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Empresa Beta' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Sem regime' })).not.toBeInTheDocument();
});



test('erro da carteira dentro do modal recarrega empresas e rotinas sem executar operações', async () => {
 const api={getOperationRoutines:jest.fn(async()=>response),executeCompanyOperation:jest.fn()};
 const refresh=jest.fn(async()=>{});
 const view=render(<OperationsRoutineCompanies api={api} companies={companies} onRefreshCompanies={refresh}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Habilitadas 1'}));
 view.rerender(<OperationsRoutineCompanies api={api} companies={companies} error="Falha na carteira" onRefreshCompanies={refresh}/>);
 const dialog=within(screen.getByRole('dialog'));
 expect(dialog.getByRole('alert')).toHaveTextContent('Falha na carteira');
 await act(async()=>fireEvent.click(dialog.getByRole('button',{name:'Tentar novamente'})));
 expect(refresh).toHaveBeenCalledTimes(1);expect(api.getOperationRoutines).toHaveBeenCalledTimes(2);
 expect(api.executeCompanyOperation).not.toHaveBeenCalled();
 view.rerender(<OperationsRoutineCompanies api={api} companies={companies} onRefreshCompanies={refresh}/>);
 expect(dialog.getByRole('link',{name:'Empresa Alfa'})).toBeInTheDocument();

});

test('erros de consulta têm lista própria, busca e descarte de resposta da competência antiga', async () => {
  let old;
  const api = { getOperationRoutines: async () => response, getOperationConsultas: jest.fn(comp => comp === '2026-09' ? new Promise(resolve => { old = resolve; }) : Promise.resolve({ items: [{ id: 'erro', companyId: 'b', action: 'CONS', errorMessage: 'Consulta recusada' }], total: 1, competencia: comp })) };
  const view = render(<OperationsRoutineCompanies api={api} companies={companies} competencia="2026-09" />);
  await act(async () => {});
  view.rerender(<OperationsRoutineCompanies api={api} companies={companies} competencia="2026-10" />);
  const errors = await screen.findByRole('button', { name: 'Erros 1 consultas com erro' });
  fireEvent.click(errors);
  expect(within(screen.getByRole('dialog')).getByText('Empresa Beta')).toBeInTheDocument();
  expect(within(screen.getByRole('dialog')).getByText(/Consulta recusada/)).toBeInTheDocument();
  await act(async () => old({ items: [], total: 0, competencia: '2026-09' }));
  expect(screen.getByRole('button', { name: 'Erros 1 consultas com erro' })).toBeInTheDocument();
  fireEvent.change(within(screen.getByRole('dialog')).getByRole('searchbox'), { target: { value: 'Alfa' } });
  expect(within(screen.getByRole('dialog')).queryByText('Empresa Beta')).not.toBeInTheDocument();
});
test('procuração desconhecida fica a verificar e não entra em não habilitadas', async () => {
  render(<OperationsRoutineCompanies api={{ getOperationRoutines: async () => response }} companies={companies} competencia="2026-10" />);
  fireEvent.click(await screen.findByRole('button', { name: '2 a verificar' }));
  expect(within(screen.getByRole('dialog')).getAllByRole('link', { name: /Empresa/ })).toHaveLength(2);
});

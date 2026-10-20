import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ChartOfAccountsPage } from '../renderChartOfAccountsPage';
import { GlobalChartOfAccountsPage } from '../renderGlobalChartOfAccountsPage';
import { createRealApi } from '../../../../../api/real/realApi';

const conta = { codigo: '1', nome: 'Caixa de teste', tipo: 'ATIVO', natureza: 'DEVEDORA', status: 'CONFIRMADA', scope: 'GLOBAL' };

test('plano global com adaptador real recupera HTTP 200 inválido sem repetir gravação', async () => {
 const anterior = global.fetch;
 const resposta = payload => ({ ok: true, status: 200, json: async () => payload });
 global.fetch = jest.fn()
  .mockResolvedValueOnce(resposta({ data: [conta] }))
  .mockResolvedValueOnce(resposta({ ok: true }))
  .mockResolvedValueOnce(resposta({ data: null }))
  .mockResolvedValueOnce(resposta({ data: [] }));
 try {
  render(<MemoryRouter><GlobalChartOfAccountsPage api={createRealApi()} /></MemoryRouter>);
  await screen.findByText(conta.nome);
  fireEvent.change(screen.getByLabelText('Código', { exact: true }), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Banco fictício' } });
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Resposta inválida do plano de contas global');
  expect(screen.getByText(conta.nome)).toBeVisible();
  await waitFor(() => {
   expect(screen.getByLabelText('Código', { exact: true })).toHaveValue('');
   expect(screen.getByLabelText('Nome')).toHaveValue('');
  });
  expect(screen.getByRole('button', { name: 'Adicionar', exact: true })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Código', { exact: true }), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Próximo rascunho' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Adicionar', exact: true })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  await screen.findByText(/Nenhuma conta cadastrada/);
  expect(screen.getByLabelText('Código', { exact: true })).toHaveValue('3');
  expect(screen.getByLabelText('Nome')).toHaveValue('Próximo rascunho');
  expect(screen.getByRole('button', { name: 'Adicionar', exact: true })).toBeEnabled();
  expect(global.fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
 } finally { global.fetch = anterior; }
});

test('carga e erro não afirmam plano vazio; releitura conserva conta e formulário', () => {
  const retry = jest.fn();
  const { rerender } = render(<ChartOfAccountsPage loading onReload={retry} />);
  expect(screen.getByRole('status')).toHaveTextContent('Carregando plano');
  expect(screen.queryByText(/Nenhuma conta cadastrada/)).not.toBeInTheDocument();
  rerender(<ChartOfAccountsPage loadError="Leitura recusada" onReload={retry} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Leitura recusada');
  expect(screen.queryByText(/Nenhuma conta cadastrada/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  expect(retry).toHaveBeenCalledTimes(1);
  rerender(<ChartOfAccountsPage accounts={[conta]} />);
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Rascunho preservado' } });
  const linha = screen.getByText('Caixa de teste').closest('tr');
  rerender(<ChartOfAccountsPage accounts={[conta]} loading />);
  expect(screen.getByText('Caixa de teste').closest('tr')).toBe(linha);
  rerender(<ChartOfAccountsPage accounts={[conta]} loadError="Falha na recarga" />);
  expect(screen.getByText('Caixa de teste').closest('tr')).toBe(linha);
  expect(screen.getByRole('alert')).toHaveTextContent('última leitura');
  expect(screen.getByLabelText('Nome')).toHaveValue('Rascunho preservado');
  rerender(<ChartOfAccountsPage accounts={[]} />);
  expect(screen.getByText(/Nenhuma conta cadastrada/)).toBeVisible();
});

test('plano global preserva última lista se retorno inválido e permite recuperar', async () => {
  const api = {
    getGlobalChartOfAccounts: jest.fn().mockResolvedValueOnce([conta]).mockResolvedValueOnce({}).mockResolvedValueOnce([]),
    createGlobalChartOfAccount: jest.fn().mockResolvedValue({ ok: true }),
  };
  render(<MemoryRouter><GlobalChartOfAccountsPage api={api} /></MemoryRouter>);
  await screen.findByText('Caixa de teste');
  fireEvent.change(screen.getByLabelText('Código', { exact: true }), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Banco teste' } });
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Resposta inválida');
  expect(screen.getByText('Caixa de teste')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  await screen.findByText(/Nenhuma conta cadastrada/);
  expect(api.createGlobalChartOfAccount).toHaveBeenCalledTimes(1);
});

test('troca de API descarta resposta antiga do plano global', async () => {
  let concluir;
  const antiga = { getGlobalChartOfAccounts: jest.fn(() => new Promise(resolve => { concluir = resolve; })) };
  const atual = { getGlobalChartOfAccounts: jest.fn().mockResolvedValue([]) };
  const { rerender } = render(<MemoryRouter><GlobalChartOfAccountsPage api={antiga} /></MemoryRouter>);
  rerender(<MemoryRouter><GlobalChartOfAccountsPage api={atual} /></MemoryRouter>);
  await screen.findByText(/Nenhuma conta cadastrada/);
  await act(async () => concluir([conta]));
  expect(screen.queryByText('Caixa de teste')).not.toBeInTheDocument();
});

import { act, fireEvent, render, screen } from '@testing-library/react';
import { OperationsDasPendencias } from '../OperationsDasPendencias';
const companies = [{ companyId: 'a', razao: 'Alfa' }, { companyId: 'b', razao: 'Beta' }];
const result = { ok: true, contrato: 'pendencias-das-leitura-4.4.6', companyId: 'a', competencia: '2026-10', consultadoEm: '2026-11-14T12:00:00Z', limit: 50, fontes: [], achados: [], limitacoes: ['Sem comprovação global.'] };
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Pendências DAS/SERPRO' }));
test('queries one company only on click, never on opening or selection', async () => {
  const api = { getCompanyDasPendencias: jest.fn(async () => result) };
  render(<OperationsDasPendencias api={api} companies={companies} competencia="2026-10" />); open();
  fireEvent.change(screen.getByLabelText('Empresa'), { target: { value: 'a' } }); expect(api.getCompanyDasPendencias).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Consultar evidências locais' }));
  expect(await screen.findByText(/Nenhum achado retornado/)).toBeInTheDocument();
  expect(api.getCompanyDasPendencias).toHaveBeenCalledTimes(1); expect(api.getCompanyDasPendencias).toHaveBeenCalledWith('a', '2026-10');
});
test('late result after changing company is discarded; failure has no automatic retry', async () => {
  let resolve; const api = { getCompanyDasPendencias: jest.fn(() => new Promise(r => { resolve = r; })) };
  render(<OperationsDasPendencias api={api} companies={companies} competencia="2026-10" />); open();
  fireEvent.change(screen.getByLabelText('Empresa'), { target: { value: 'a' } }); fireEvent.click(screen.getByText('Consultar evidências locais'));
  fireEvent.change(screen.getByLabelText('Empresa'), { target: { value: 'b' } }); await act(async () => resolve(result));
  expect(screen.queryByText(/Nenhum achado retornado/)).not.toBeInTheDocument(); expect(api.getCompanyDasPendencias).toHaveBeenCalledTimes(1);
});
test('local pagination never issues another request', async () => {
  const api = { getCompanyDasPendencias: jest.fn(async () => ({ ...result, achados: Array.from({ length: 13 }, (_, i) => ({ id: String(i), dimensao: 'Fiscal', origem: 'Registro local', classificacao: 'A verificar', evidencia: `Achado ${i}`, limitacao: 'Leitura local.' })) })) };
  render(<OperationsDasPendencias api={api} companies={companies} competencia="2026-10" />); open();
  fireEvent.change(screen.getByLabelText('Empresa'), { target: { value: 'a' } }); fireEvent.click(screen.getByText('Consultar evidências locais'));
  await screen.findByText('Achado 0'); fireEvent.click(screen.getByRole('button', { name: 'Próxima página de achados' }));
  expect(screen.getByText('Achado 12')).toBeInTheDocument(); expect(api.getCompanyDasPendencias).toHaveBeenCalledTimes(1);
});
test('failure is visible and is not retried', async () => {
  const api = { getCompanyDasPendencias: jest.fn(async () => { throw Error('source unavailable'); }) };
  render(<OperationsDasPendencias api={api} companies={companies} competencia="2026-10" />); open();
  fireEvent.change(screen.getByLabelText('Empresa'), { target: { value: 'a' } }); fireEvent.click(screen.getByText('Consultar evidências locais'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Nenhuma retentativa automática');
  expect(api.getCompanyDasPendencias).toHaveBeenCalledTimes(1); expect(screen.queryByText(/Nenhum achado retornado/)).not.toBeInTheDocument();
});
test.each(['api','carteira','sessao'])('context change %s hides stale results', async change => {
  let token = 'one'; const api = { getAccessToken: () => token, getCompanyDasPendencias: jest.fn(async () => result) };
  const view = render(<OperationsDasPendencias api={api} companies={companies} competencia="2026-10" />); open();
  fireEvent.change(screen.getByLabelText('Empresa'), { target: { value: 'a' } }); fireEvent.click(screen.getByText('Consultar evidências locais'));
  await screen.findByText(/Nenhum achado retornado/);
  if (change === 'sessao') token = 'two';
  view.rerender(<OperationsDasPendencias api={change === 'api' ? { ...api } : api} companies={change === 'carteira' ? [] : companies} competencia="2026-10" />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(api.getCompanyDasPendencias).toHaveBeenCalledTimes(1);
});

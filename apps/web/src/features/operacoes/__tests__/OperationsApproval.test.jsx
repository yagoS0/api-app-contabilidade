import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OperationsApproval } from '../OperationsApproval';

const rows = [{ company: { companyId: 'a', razao: 'CDA', myRole: 'ACCOUNTANT' } }];
function fixture(overrides = {}) {
  let state = { companyId: 'a', competencia: '2026-09', revision: 'r1', status: 'PENDING', pending: [], schedule: null, calculation: { dasValor: 100 }, ...overrides };
  return { getCompanyOperation: jest.fn(async () => state), saveCompanyOperation: jest.fn(async (id, comp, input) => {
    state = { ...state, revision: 'r2', status: { confirm: 'CONFIRMED', review: 'IN_REVIEW', release: 'RELEASED' }[input.action] || state.status, ...(input.action === 'schedule' ? { schedule: input.schedule } : {}) }; return state;
  }) };
}
test('confirmação e liberação são separadas e exigem prévia explícita', async () => {
  const api = fixture(); api.executeCompanyOperation = jest.fn(async () => ({ ok: true })); render(<OperationsApproval api={api} rows={rows} competencia="2026-09" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Conferir' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Conferir' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar apuração' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Liberar confirmadas (1)' })).toBeEnabled());
  expect(api.saveCompanyOperation).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Liberar confirmadas (1)' }));
  expect(api.saveCompanyOperation).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Liberar e executar' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Digite a competência 2026-09 para executar'), { target: { value: '2026-09' } });
  fireEvent.click(screen.getByRole('button', { name: 'Liberar e executar' }));
  await screen.findByText(/1 liberação\(ões\) processada/);
  expect(api.executeCompanyOperation).toHaveBeenCalledWith('a', '2026-09', 'r2');
  expect(api.saveCompanyOperation.mock.calls[1][2]).toMatchObject({ action: 'release', expectedRevision: 'r2' });
});
test('nota de setembro impede confirmação e aponta para revisão sem alterar competência', async () => {
  const api = fixture({ blocked: 'Revise a nota de setembro', pending: [{ id: 'p', observacoes: 'Emitida em outubro, competência setembro' }] });
  render(<OperationsApproval api={api} rows={rows} competencia="2026-09" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Conferir' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Conferir' }));
  expect(screen.getByRole('button', { name: 'Confirmar apuração' })).toBeDisabled();
  expect(screen.getByRole('link', { name: 'Revisar notas da competência' })).toHaveAttribute('href', '/companies/a/auditoria?competencia=2026-09');
  expect(api.saveCompanyOperation).not.toHaveBeenCalled();
});
test('programação salva reaparece após remontar; timeout não reenvia', async () => {
  const api = fixture(); const view = render(<OperationsApproval api={api} rows={rows} competencia="2026-09" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Conferir' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Conferir' }));
  fireEvent.change(screen.getByLabelText('Programar conferência'), { target: { value: '2026-10-16T08:30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar programação' }));
  await screen.findByText(/2026-10-16 · 08:30/);
  view.unmount(); render(<OperationsApproval api={api} rows={rows} competencia="2026-09" />);
  await screen.findByText(/2026-10-16 · 08:30/);
  fireEvent.click(screen.getByRole('button', { name: 'Conferir' }));
  api.saveCompanyOperation.mockRejectedValueOnce(Error('Resultado desconhecido'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar apuração' }));
  await screen.findByRole('alert');
  expect(api.saveCompanyOperation).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'Conferir' })).toBeDisabled();
});

test.each(['STAFF', 'VIEWER', undefined])('papel %s mantém leitura sem ações de escrita', async myRole => {
  const api = fixture({ status: 'CONFIRMED' });
  render(<OperationsApproval api={api} rows={[{ company: { ...rows[0].company, myRole } }]} competencia="2026-09" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Conferir' })).toBeEnabled());
  expect(screen.queryByRole('button', { name: /Liberar confirmadas/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Conferir' }));
  expect(screen.getByRole('link', { name: 'Revisar notas da competência' })).toBeInTheDocument();
  expect(screen.getByText('Seu acesso permite somente consultar esta apuração.')).toBeInTheDocument();
  for (const name of ['Confirmar apuração', 'Marcar para revisão', 'Salvar programação']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  expect(api.saveCompanyOperation).not.toHaveBeenCalled();
});

test('permissão retirada com prévia aberta bloqueia execução', async () => {
  const api = fixture({ status: 'CONFIRMED' }); api.executeCompanyOperation = jest.fn();
  const view = render(<OperationsApproval api={api} rows={rows} competencia="2026-09" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Liberar confirmadas (1)' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Liberar confirmadas (1)' }));
  fireEvent.change(screen.getByLabelText('Digite a competência 2026-09 para executar'), { target: { value: '2026-09' } });
  view.rerender(<OperationsApproval api={api} rows={[{ company: { ...rows[0].company, myRole: 'STAFF' } }]} competencia="2026-09" />);
  expect(screen.getByRole('button', { name: 'Liberar e executar' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Liberar e executar' }));
  expect(api.saveCompanyOperation).not.toHaveBeenCalled();
  expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});

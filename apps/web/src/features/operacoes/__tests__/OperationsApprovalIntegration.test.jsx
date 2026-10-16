import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OperationsPage } from '../OperationsPage';

jest.mock('../OperationsDailyCalendar', () => ({ OperationsDailyCalendar: () => null }));
jest.mock('../OperationsRoutineCompanies', () => ({ OperationsRoutineCompanies: () => null }));
jest.mock('../OperationsAlerts', () => ({ OperationsAlerts: () => null }));

const companies = [{ companyId: 'a', razao: 'CDA', myRole: 'ACCOUNTANT', apuracao: { competencia: '2026-09' } }];
beforeAll(() => {
  if (!global.crypto.randomUUID) global.crypto.randomUUID = () => 'request-demo';
});

function fixture(status = 'CONFIRMED') {
  let resolveExecution, rejectExecution;
  let current = { companyId: 'a', competencia: '2026-09', revision: 'r1', status, pending: [], schedule: null, calculation: { dasValor: 100 } };
  const api = {
    getCompanyOperation: jest.fn(async () => current),
    saveCompanyOperation: jest.fn(async () => {
      current = { ...current, status: 'RELEASED', revision: 'r2' };
      return current;
    }),
    executeCompanyOperation: jest.fn(() => new Promise((resolve, reject) => { resolveExecution = resolve; rejectExecution = reject; })),
  };
  render(<OperationsPage api={api} companies={companies} competencia="2026-09" />);
  return { api, resolve: () => { current = { ...current, status: 'EXECUTED', execution: { status: 'DONE' } }; resolveExecution({ ok: true }); }, reject: () => rejectExecution(new Error('Resultado desconhecido')) };
}

async function openApprovals() {
  fireEvent.click(screen.getByRole('button', { name: 'Conferir e liberar apurações' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Conferir' })).toBeEnabled());
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
}

test('a conferência da empresa usa uma só camada de diálogo e não executa ao abrir', async () => {
  const { api } = fixture('PENDING');
  await openApprovals();
  fireEvent.click(screen.getByRole('button', { name: 'Conferir' }));
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.getByRole('region', { name: 'Conferir CDA' })).toHaveTextContent('Imposto salvo');
  fireEvent.click(within(screen.getByRole('region', { name: 'Conferir CDA' })).getByRole('button', { name: 'Voltar' }));
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Conferir' })).toBeEnabled();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(api.saveCompanyOperation).not.toHaveBeenCalled();
  expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});

test.each(['success', 'timeout'])('liberação explícita mantém diálogo ocupado e não repete execução (%s)', async result => {
  const task = fixture();
  await openApprovals();
  fireEvent.click(screen.getByRole('button', { name: 'Liberar confirmadas (1)' }));
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  const execute = screen.getByRole('button', { name: 'Liberar e executar' });
  expect(execute).toBeDisabled();
  expect(task.api.saveCompanyOperation).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Digite a competência 2026-09 para executar'), { target: { value: '2026-09' } });
  fireEvent.click(execute);
  await waitFor(() => expect(task.api.executeCompanyOperation).toHaveBeenCalledTimes(1));
  const dialog = screen.getByRole('dialog');
  expect(execute).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Fechar' })).toBeDisabled();
  expect(within(dialog).queryByRole('link')).not.toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(dialog);
  fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
  fireEvent.click(execute);
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(task.api.executeCompanyOperation).toHaveBeenCalledTimes(1);
  expect(task.api.saveCompanyOperation).toHaveBeenCalledTimes(1);
  await act(async () => { if (result === 'success') task.resolve(); else task.reject(); });
  if (result === 'success') expect(await screen.findByRole('status')).toHaveTextContent('1 liberação(ões) processada(s)');
  else {
    expect(await screen.findByRole('alert')).toHaveTextContent('Resultado desconhecido');
    expect(screen.getByRole('button', { name: 'Conferir' })).toBeDisabled();
  }
  expect(task.api.executeCompanyOperation).toHaveBeenCalledWith('a', '2026-09', 'r2');
  expect(task.api.executeCompanyOperation).toHaveBeenCalledTimes(1);
});

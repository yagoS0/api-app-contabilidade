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
  let current = { regime: 'SIMPLES', companyId: 'a', competencia: '2026-09', revision: 'r1', status, pending: [], schedule: null, calculation: { calculoId: 'calculo-1', dasValor: 100 } };
  const api = {
    listOperationsBatches: jest.fn(async () => ({ ok: true, items: [] })),
    previewOperationsBatch: jest.fn(async () => ({ ok: true, preview: { id: 'preview-batch', competencia: '2026-09', items: [{ companyId: 'a', name: 'CDA' }], blocked: [] } })),
    acceptOperationsBatch: jest.fn(async () => ({ ok: true, batch: { id: 'batch', competencia: '2026-09', items: [] } })),
    getApuracaoSnapshot: jest.fn(async (id, competencia) => ({ snapshot: { portalClientId: id, competencia, estado: 'calculada', idempotencyKey: 'calculo-1', dasSimuladoSerpro: 100, atividadesEscolhidas: [] } })),
    getAuditoriaNotas: jest.fn(async (id, competencia) => ({ auditoria: { competencia, totalAchados: 0, perguntas: [] } })),
    getPgdasHistorico: jest.fn(async (id, competencia) => ({ competencia, versoes: [] })),
    getCompanyOperation: jest.fn(async () => current),
    getOperationEvidence: jest.fn(async () => ({items:[current], total:1, competencia:'2026-09'})),
    saveCompanyOperation: jest.fn(async () => {
      current = { ...current, status: 'RELEASED', revision: 'r2' };
      return current;
    }),
    executeCompanyOperation: jest.fn(() => new Promise((resolve, reject) => { resolveExecution = resolve; rejectExecution = reject; })),
  };
  render(<OperationsPage api={api} companies={companies} competencia="2026-09" />);
  return { api, resolve: () => { current = { ...current, status: 'EXECUTED', execution: { status: 'DONE' } }; resolveExecution({ ok: true }); }, reject: () => rejectExecution(new Error('Resultado desconhecido')) };
}

async function openApprovals(stage = 'Confirmado') {
  const trigger = screen.getByRole('button', { name: new RegExp(`^${stage} `) });
  await waitFor(() => expect(trigger).toBeEnabled());
  trigger.focus();
  fireEvent.click(trigger);
  await waitFor(() => expect(stage === 'Calculado' ? screen.getByRole('checkbox', { name: 'Selecionar CDA' }) : screen.getByRole('button', { name: 'Conferir detalhes' })).toBeEnabled());
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.getByRole('dialog', { name: new RegExp(`^${stage} ·`) })).toBeVisible();
}

test('acompanhamento integrado anuncia falha de atualização sem perder o último resultado', async () => {
  const { api } = fixture();
  api.listOperationsBatches.mockResolvedValue({ ok: true, items: [{ id: 'batch', competencia: '2026-09', taskId: 'task-1', items: [
    { companyId: 'a', name: 'CDA', state: 'ATTENTION', message: 'Resultado incerto.' },
  ] }] });
  api.getBackgroundTask = jest.fn().mockResolvedValueOnce({ task: {
    jobId: 'task-1', competencia: '2026-09', status: 'interrupted', total: 1, processadas: 0,
  } }).mockRejectedValueOnce(new Error('Falha ao atualizar acompanhamento'));
  await openApprovals();
  fireEvent.click(await screen.findByRole('button', { name: 'Acompanhar tarefa' }));
  const detail = await screen.findByRole('region', { name: 'Acompanhamento da tarefa' });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(detail).toContainElement(document.activeElement);
  fireEvent.click(within(detail).getByRole('button', { name: 'Atualizar tarefa' }));
  expect(await within(detail).findByRole('alert')).toHaveTextContent('Falha ao atualizar acompanhamento');
  expect(within(detail).getByText('0/1 itens processados')).toBeInTheDocument();
  expect(within(detail).getByText(/Interrompida/)).toBeInTheDocument();
  expect(api.getBackgroundTask).toHaveBeenCalledTimes(2);
  expect(api.acceptOperationsBatch).not.toHaveBeenCalled();
  expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});

test('a conferência da empresa usa uma só camada de diálogo e não executa ao abrir', async () => {
  const { api } = fixture();
  await openApprovals('Confirmado');
  expect(api.getOperationEvidence).toHaveBeenCalledTimes(1);
  expect(api.getCompanyOperation).not.toHaveBeenCalled();
  expect(api.getAuditoriaNotas).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Conferir detalhes' }));
  expect(await screen.findByRole('region', { name: 'Conferir CDA' })).toHaveTextContent('Imposto salvo');
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Conferir detalhes' })).toBeEnabled();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(api.saveCompanyOperation).not.toHaveBeenCalled();
  expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});

test('rotina integrada usa uma camada, retorna foco e bloqueia Escape durante aceite', async () => {
  const { api } = fixture();
  let finish;
  api.acceptOperationsBatch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await openApprovals();
  fireEvent.click(screen.getByRole('button', { name: 'Liberar rotina' }));
  await screen.findByRole('region', { name: 'Liberar rotina de transmissão' });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  await waitFor(() => expect(screen.getByRole('region', { name: 'Liberar rotina de transmissão' })).toContainElement(document.activeElement));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Liberar rotina' })).toHaveFocus());
  fireEvent.click(screen.getByRole('button', { name: 'Liberar rotina' }));
  const input = await screen.findByLabelText('Digite a competência 2026-09');
  fireEvent.change(input, { target: { value: '2026-09' } });
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Liberar rotina' }));
  await waitFor(() => expect(api.acceptOperationsBatch).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('button', { name: 'Fechar' })).not.toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.keyDown(document, { key: 'Tab' });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.getByRole('dialog')).toContainElement(document.activeElement);
  await act(async () => finish({ ok: true, batch: { id: 'batch', competencia: '2026-09', items: [] } }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Liberar rotina' })).toHaveFocus());
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});

test.each(['success', 'timeout'])('liberação explícita mantém diálogo ocupado e não repete execução (%s)', async result => {
  const task = fixture();
  await openApprovals();
  fireEvent.click(screen.getByRole('checkbox', { name: /Selecionar todas as elegíveis do filtro/ }));
  expect(screen.getByRole('checkbox', { name: 'Selecionar CDA' })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Transmitir selecionadas' }));
  await screen.findByRole('region', { name: 'Conferir transmissão' });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  const execute = await screen.findByRole('button', { name: 'Liberar e executar' });
  expect(execute).toBeDisabled();
  expect(task.api.saveCompanyOperation).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Digite a competência 2026-09 para executar'), { target: { value: '2026-09' } });
  fireEvent.click(execute);
  await waitFor(() => expect(task.api.executeCompanyOperation).toHaveBeenCalledTimes(1));
  const dialog = screen.getByRole('dialog');
  expect(execute).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Fechar' })).not.toBeInTheDocument();
  expect(within(dialog).queryByRole('link')).not.toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(dialog);
  fireEvent.keyDown(document, { key: 'Tab' });
  expect(dialog).toContainElement(document.activeElement);
  fireEvent.click(execute);
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(task.api.executeCompanyOperation).toHaveBeenCalledTimes(1);
  expect(task.api.saveCompanyOperation).toHaveBeenCalledTimes(1);
  await act(async () => { if (result === 'success') task.resolve(); else task.reject(); });
  if (result === 'success') expect(await within(screen.getByRole('region', { name: 'Conferência e programação de Operações' })).findByRole('status')).toHaveTextContent('1 liberação(ões) processada(s)');
  else {
    expect(await screen.findByRole('alert')).toHaveTextContent('Resultado desconhecido');
    expect(screen.queryByRole('button', { name: 'Conferir detalhes' })).not.toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Transmitir selecionadas' });
    expect(retry).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Selecionar todas as elegíveis do filtro/ })).toBeDisabled();
    fireEvent.click(retry);
    expect(task.api.saveCompanyOperation).toHaveBeenCalledTimes(1);
  }
  expect(task.api.executeCompanyOperation).toHaveBeenCalledWith('a', '2026-09', 'r2');
  expect(task.api.executeCompanyOperation).toHaveBeenCalledTimes(1);
});

test('confirmação inline mantém diálogo ocupado único e indicadores durante persistência', async () => {
  const { api } = fixture('PENDING');
  let finish;
  api.saveCompanyOperation.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await openApprovals('Calculado');
  const indicator = screen.getByRole('button', { name: /^Calculado / });
  const indicatorName = indicator.getAttribute('aria-label');
  const indicatorValue = indicator.querySelector('strong').textContent;
  fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar CDA' }));
  fireEvent.click(screen.getByRole('button', { name: 'Conferir selecionadas' }));
  const confirm = await screen.findByRole('button', { name: 'Confirmar cálculos selecionados' });
  expect(api.saveCompanyOperation).not.toHaveBeenCalled();
  fireEvent.click(confirm);
  await waitFor(() => expect(api.saveCompanyOperation).toHaveBeenCalledTimes(1));
  const dialog = screen.getByRole('dialog', { name: /^Calculado ·/ });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(indicator).toBeDisabled();
  expect(indicator).toHaveAttribute('aria-label', indicatorName);
  expect(indicator.querySelector('strong')).toHaveTextContent(indicatorValue);
  expect(screen.getByRole('button', { name: 'Mês anterior' })).toBeDisabled();
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(dialog);
  fireEvent.keyDown(document, { key: 'Tab' });
  expect(dialog).toContainElement(document.activeElement);
  expect(screen.queryByRole('button', { name: 'Fechar' })).not.toBeInTheDocument();
  const repeat = screen.getByRole('button', { name: 'Conferir selecionadas' });
  expect(repeat).toBeDisabled();
  fireEvent.click(repeat);
  expect(api.saveCompanyOperation).toHaveBeenCalledTimes(1);
  expect(api.executeCompanyOperation).not.toHaveBeenCalled();
  expect(api.acceptOperationsBatch).not.toHaveBeenCalled();
  const current = await api.getCompanyOperation.mock.results[0].value;
  await act(async () => finish({ ...current, status: 'CONFIRMED', revision: 'r2' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Fechar' })).toBeEnabled());
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(indicator).toBeEnabled();
  expect(api.saveCompanyOperation).toHaveBeenCalledTimes(1);
  expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OperationsCalculationBatch } from '../OperationsCalculationBatch';
import { OperationsExternalBatch } from '../OperationsExternalBatch';

const items = [{ companyId: 'a', name: 'Empresa A' }, { companyId: 'b', name: 'Empresa B' }];
const competencia = '2026-10';
const preview = id => ({ companyId: id, competencia, revision: `revision-${id}`, canCalculate: id === 'a', blockers: id === 'a' ? [] : ['Apuração externa do Lucro Presumido.'], regime: id === 'a' ? 'SIMPLES' : 'PRESUMIDO' });
beforeAll(() => { if (!crypto.randomUUID) crypto.randomUUID = () => 'request-ficticio'; });
function setup(overrides = {}, props = {}) {
  const api = { previewOperationsCalculation: jest.fn(async id => preview(id)), executeOperationsCalculation: jest.fn(async (id, pa, input) => ({ companyId: id, competencia, requestId: input.requestId, status: 'CALCULATED', calculation: { receita: 1000, imposto: 60 }, audit: { status: 'COMPLETE', totalAchados: 0 }, warnings: ['Anexo alterado; conferir.'] })), getOperationsCalculationResult: jest.fn(), ...overrides };
  const onChanged = jest.fn();
  const result = render(<OperationsCalculationBatch api={api} items={items} competencia={competencia} onChanged={onChanged} {...props} />);
  return { ...result, api, onChanged };
}
test('prévia não escreve; comando coleta somente aptas e apresenta cálculo/auditoria sem confirmar nem transmitir', async () => {
  const { api, onChanged } = setup();
  const confirm = await screen.findByRole('button', { name: 'Confirmar cálculo (1)' });
  await waitFor(() => expect(confirm).toBeEnabled());
  expect(api.executeOperationsCalculation).not.toHaveBeenCalled();
  fireEvent.click(confirm);
  expect(await screen.findByText('Calculado')).toBeInTheDocument();
  expect(screen.getByText('Auditoria concluída · 0 achados')).toBeInTheDocument();
  expect(screen.getByText('Anexo alterado; conferir.')).toBeInTheDocument();
  expect(api.executeOperationsCalculation).toHaveBeenCalledTimes(1);
  expect(api.executeOperationsCalculation).toHaveBeenCalledWith('a', competencia, { expectedRevision: 'revision-a', requestId: expect.any(String), confirmCompetencia: competencia });
  expect(onChanged).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: /Confirmar cálculo/ })).not.toBeInTheDocument();
});
test('resultado incerto recupera mesma tentativa por GET sem repetir o POST', async () => {
  const { api } = setup({ executeOperationsCalculation: jest.fn().mockRejectedValue(new Error('Conexão interrompida')) });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar cálculo (1)' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar cálculo (1)' }));
  expect(await screen.findByText('Resultado a conferir')).toBeInTheDocument();
  const requestId = api.executeOperationsCalculation.mock.calls[0][2].requestId;
  api.getOperationsCalculationResult.mockResolvedValue({ companyId: 'a', competencia, attempt: { companyId: 'a', competencia, requestId, status: 'CALCULATED', calculation: { imposto: 60 } } });
  fireEvent.click(screen.getByRole('button', { name: 'Conferir resultado' }));
  expect(await screen.findByText('Calculado')).toBeInTheDocument();
  expect(api.getOperationsCalculationResult).toHaveBeenCalledWith('a', competencia, requestId);
  expect(api.executeOperationsCalculation).toHaveBeenCalledTimes(1);
});
test('recusa resultado de outra tentativa e reconhecimento vazio do background', async () => {
  const { api } = setup({ executeOperationsCalculation: jest.fn(async () => ({ companyId: 'a', competencia, status: 'accepted', taskId: 'task' })), getOperationsCalculationResult: jest.fn(async () => ({ companyId: 'a', competencia, attempt: { requestId: 'outro', status: 'CALCULATED' } })) });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar cálculo (1)' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar cálculo (1)' }));
  await screen.findByText('Resultado a conferir');
  fireEvent.click(screen.getByRole('button', { name: 'Conferir resultado' }));
  expect(await screen.findByText('Resultado desta tentativa ainda indisponível.')).toBeInTheDocument();
  expect(screen.queryByText('Calculado')).not.toBeInTheDocument();
  expect(api.executeOperationsCalculation).toHaveBeenCalledTimes(1);
});
test('perda de acesso após prévia não faz cálculo', async () => {
  const { api } = setup({}, { canWrite: () => false });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar cálculo (1)' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar cálculo (1)' }));
  expect(await screen.findByText('Seu acesso mudou. Atualize antes de calcular.')).toBeInTheDocument();
  expect(api.executeOperationsCalculation).not.toHaveBeenCalled();
});
test('reabrir recupera a identidade persistida da tentativa incerta sem refazer cálculo', async () => {
  const attempt = { companyId: 'a', competencia, requestId: 'previous-request', status: 'UNCERTAIN' };
  const { api } = setup({ previewOperationsCalculation: jest.fn(async id => ({ ...preview(id), canCalculate: false, blockers: ['Conferir tentativa'], lastAttempt: id === 'a' ? attempt : null })), getOperationsCalculationResult: jest.fn(async () => ({ companyId: 'a', competencia, attempt: { ...attempt, status: 'CALCULATED' } })) });
  const read = await screen.findByRole('button', { name: 'Conferir resultado' });
  await waitFor(() => expect(read).toBeEnabled());
  fireEvent.click(read);
  expect(await screen.findByText('Calculado')).toBeInTheDocument();
  expect(api.getOperationsCalculationResult).toHaveBeenCalledWith('a', competencia, 'previous-request');
  expect(api.executeOperationsCalculation).not.toHaveBeenCalled();
});
test('troca de competência descarta resposta atrasada sem gravar', async () => {
  let resolve;
  const api = { previewOperationsCalculation: jest.fn(() => new Promise(r => { resolve = r; })) };
  const { unmount } = setup(api);
  unmount();
  await act(async () => resolve(preview('a')));
  expect(api.previewOperationsCalculation).toHaveBeenCalledTimes(1);
});
test('conclusão externa preserva chave versão hash e não aciona transmissão', async () => {
  const value = { companyId: 'a', competencia, regime: 'PRESUMIDO', tasks: [{ chave: 'apurar', versao: 4, hash: 'hash-atual', concluida: false, aguardando: [] }] };
  const api = { getOperationsExternal: jest.fn(async () => value), saveOperationsExternal: jest.fn(async () => ({ ...value, tasks: [{ ...value.tasks[0], concluida: true }] })) };
  render(<OperationsExternalBatch api={api} items={[items[0]]} competencia={competencia} taskKey="apurar" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar conclusão externa (1)' })).toBeEnabled());
  expect(api.saveOperationsExternal).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar conclusão externa (1)' }));
  expect(await screen.findByText('Feita externamente')).toBeInTheDocument();
  expect(api.saveOperationsExternal).toHaveBeenCalledWith('a', competencia, { chave: 'apurar', versao: 4, hash: 'hash-atual', confirmCompetencia: competencia });
  expect(api.saveOperationsExternal).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: /Confirmar conclusão externa/ })).not.toBeInTheDocument();
});
test('conclusão externa já persistida não oferece nova gravação', async () => {
  const api = { getOperationsExternal: jest.fn(async () => ({ companyId: 'a', competencia, regime: 'PRESUMIDO', tasks: [{ chave: 'transmitir', versao: 5, hash: 'hash-atual', concluida: true }] })), saveOperationsExternal: jest.fn() };
  render(<OperationsExternalBatch api={api} items={[items[0]]} competencia={competencia} taskKey="transmitir" />);
  await screen.findByText('Feita externamente');
  expect(screen.getByRole('button', { name: 'Confirmar conclusão externa (0)' })).toBeDisabled();
  expect(api.saveOperationsExternal).not.toHaveBeenCalled();
});
test('dependência real da tarefa externa bloqueia gravação e informa o motivo', async () => {
  const api = { getOperationsExternal: jest.fn(async () => ({ companyId: 'a', competencia, regime: 'PRESUMIDO', tasks: [{ chave: 'transmitir', versao: 0, hash: 'hash-atual', concluida: false, aguardando: ['apurar'] }] })), saveOperationsExternal: jest.fn() };
  render(<OperationsExternalBatch api={api} items={[items[0]]} competencia={competencia} taskKey="transmitir" />);
  await screen.findByText('Aguardando: apurar.');
  expect(screen.getByRole('button', { name: 'Confirmar conclusão externa (0)' })).toBeDisabled();
  expect(api.saveOperationsExternal).not.toHaveBeenCalled();
});

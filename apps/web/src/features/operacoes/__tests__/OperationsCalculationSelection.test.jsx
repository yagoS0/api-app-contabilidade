import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OperationsApproval } from '../OperationsApproval';
import { resumirEtapasOperacoes } from '../operacoes';

const competencia = '2026-10';
const rows = [{ company: { companyId: 'a', razao: 'Sem cálculo', myRole: 'ACCOUNTANT' } }, { company: { companyId: 'b', razao: 'Presumida', myRole: 'ACCOUNTANT' } }];
const records = [
  { companyId: 'a', competencia, revision: 'r-a', regime: 'SIMPLES', status: 'PENDING', calculation: null, pending: [], routine: { label: 'Rotina pausada' } },
  { companyId: 'b', competencia, revision: 'r-b', regime: 'PRESUMIDO', status: 'PENDING', calculation: null, pending: [], externalSummary: { apurar: { concluida: true }, transmitir: { concluida: false } } },
];
function fixture() { return {
  getCompanyOperation: jest.fn(), getOperationEvidence: jest.fn(async () => ({ competencia, total: 2, items: records })),
  previewOperationsCalculation: jest.fn(async id => ({ companyId: id, competencia, revision: `preview-${id}`, canCalculate: id === 'a', blockers: id === 'a' ? [] : ['Apuração externa'] })),
  executeOperationsCalculation: jest.fn(async (id, pa, input) => ({ companyId: id, competencia, requestId: input.requestId, status: 'CALCULATED' })),
  getOperationsExternal: jest.fn(async id => ({ companyId: id, competencia, regime: 'PRESUMIDO', tasks: [{ chave: 'transmitir', versao: 3, hash: 'actual', concluida: false, aguardando: [] }] })),
  saveOperationsExternal: jest.fn(), executeCompanyOperation: jest.fn(), saveCompanyOperation: jest.fn(),
}; }
beforeAll(() => { if (!crypto.randomUUID) crypto.randomUUID = () => 'request-fixture'; });
test('empresa sem cálculo pode ser selecionada; conferência permanece bloqueada e cálculo limpa seleção', async () => {
  const api = fixture();
  render(<OperationsApproval api={api} rows={rows} competencia={competencia} stage="calculado" embedded />);
  const select = await screen.findByRole('checkbox', { name: 'Selecionar Sem cálculo' });
  await waitFor(() => expect(select).toBeEnabled());
  fireEvent.click(select);
  expect(screen.getByRole('button', { name: 'Calcular selecionadas' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Conferir selecionadas' })).toBeDisabled();
  expect(screen.getByText('Simples Nacional · Rotina pausada')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Calcular selecionadas' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar cálculo (1)' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar cálculo (1)' }));
  await screen.findByText('Calculado');
  fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Selecionar Sem cálculo' })).not.toBeChecked());
  await waitFor(() => expect(screen.getByRole('region', { name: 'Cálculos para conferência' })).toHaveFocus());
  expect(api.saveCompanyOperation).not.toHaveBeenCalled();
  expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});
test('seleção preserva empresa fora da busca e não confunde seleção com aptidão para transmissão', async () => {
  const api = fixture();
  render(<OperationsApproval api={api} rows={rows} competencia={competencia} stage="calculado" embedded />);
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Selecionar elegíveis exibidas' })).toBeEnabled());
  fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar elegíveis exibidas' }));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar empresa' }), { target: { value: 'Sem cálculo' } });
  expect(screen.getByText('2 selecionadas · 1 fora da busca')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Conferir selecionadas' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Calcular selecionadas' }));
  await screen.findByText('1 aptas · 1 bloqueadas');
  expect(api.previewOperationsCalculation).toHaveBeenCalledTimes(2);
  expect(api.executeOperationsCalculation).not.toHaveBeenCalled();
});
test('Presumido apurado entra em Confirmado sem virar aprovação PGDAS e só permite conclusão externa', async () => {
  const api = fixture();
  render(<OperationsApproval api={api} rows={rows} competencia={competencia} stage="confirmado" embedded />);
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Selecionar Presumida' })).toBeEnabled());
  expect(screen.queryByRole('checkbox', { name: 'Selecionar Sem cálculo' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar Presumida' }));
  expect(screen.getByRole('button', { name: 'Transmitir selecionadas' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Registrar conclusão externa' }));
  expect(await screen.findByRole('heading', { name: 'Registrar entrega externa' })).toBeInTheDocument();
  await waitFor(() => expect(api.getOperationsExternal).toHaveBeenCalledWith('b', competencia));
  expect(api.executeCompanyOperation).not.toHaveBeenCalled();
  expect(api.saveCompanyOperation).not.toHaveBeenCalled();
});
test('Presumido sem conclusão externa não entra em Confirmado por aprovação PGDAS antiga', async () => {
  const api = fixture();
  const legacy = { ...records[1], status: 'CONFIRMED', externalSummary: { apurar: { concluida: false }, transmitir: { concluida: false } } };
  api.getOperationEvidence.mockResolvedValue({ competencia, total: 2, items: [records[0], legacy] });
  render(<OperationsApproval api={api} rows={rows} competencia={competencia} stage="confirmado" embedded />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Atualizar conferências' })).toBeEnabled());
  expect(screen.queryByRole('checkbox', { name: 'Selecionar Presumida' })).not.toBeInTheDocument();
  expect(screen.getByText('Nenhuma empresa nesta etapa ou busca.')).toBeInTheDocument();
  expect(api.executeCompanyOperation).not.toHaveBeenCalled();
  expect(api.saveCompanyOperation).not.toHaveBeenCalled();
});

const externalRows = [{ company: { companyId: 'b' }, fluxo: { competencia, regime: 'Presumido', apuracao: { apurada: true, transmitida: false }, tarefas: [{ chave: 'apurar', etapa: 'apuracao', concluida: true }, { chave: 'transmitir', etapa: 'apuracao', concluida: false }], obrigacoes: [], status: { chave: 'apurar' } } }];
test('contador Confirmado inclui a mesma empresa externa exibida no modal sem mudar estado PGDAS', () => {
  const result = resumirEtapasOperacoes(externalRows, [records[1]]);
  expect(result.metrics.confirmado.done.map(row => row.company.companyId)).toEqual(['b']);
  expect(result.items[0].operation.status).toBe('PENDING');
  expect(records[1].status).toBe('PENDING');
});
test.each([[true, 1], [false, 0]])('contador do Presumido respeita conclusão externa %s', (concluida, count) => {
  const evidence = [{ ...records[1], externalSummary: { apurar: { concluida } } }];
  expect(resumirEtapasOperacoes(externalRows, evidence).metrics.confirmado.done).toHaveLength(count);
  expect(evidence[0].status).toBe('PENDING');
});
test('contador não inventa conclusão sem resumo ou com empresa/competência incompatível', () => {
  expect(resumirEtapasOperacoes(externalRows, [{ ...records[1], externalSummary: null }]).items[0].axes.confirmado).toBeNull();
  for (const evidence of [{ ...records[1], competencia: '2026-11' }, { ...records[1], companyId: 'outra' }]) {
    const result = resumirEtapasOperacoes(externalRows, [evidence]);
    expect(result.metrics.confirmado.done).toHaveLength(0);
    expect(result.items[0].axes.confirmado).toBeNull();
  }
});
test.each([['PENDING', 0], ['CONFIRMED', 1], ['INVALIDATED', 0]])('contador do Simples mantém prova PGDAS %s', (status, count) => {
  const evidence = [{ ...records[1], regime: 'SIMPLES', status }];
  expect(resumirEtapasOperacoes(externalRows, evidence).metrics.confirmado.done).toHaveLength(count);
});

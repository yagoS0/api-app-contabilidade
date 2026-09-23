import { act, fireEvent, render, screen } from '@testing-library/react';
import { AccountingEntriesTab } from '../renderAccountingEntriesTab';
jest.mock('../../../../../api/client', () => ({ createApiClient: () => ({
  getFechamentoContabil: jest.fn(async () => ({ fechado: false, checklist: {} })),
  getVerificacaoLancamentos: jest.fn(async () => ({ ok: true, resumo: {}, porRegra: [] })),
  getConferenciaPendencias: jest.fn(async () => ({ total: 0 })),
}) }));
const props = {
  companyId: 'empresa', filters: { competencia: '2026-08' }, accounts: [], loading: false,
  onFilterChange: jest.fn(), onLoad: jest.fn(), onCreateEntry: jest.fn(), onUpdateEntry: jest.fn(), onDeleteEntry: jest.fn(), onLoadAccounts: jest.fn(), onExportCsv: jest.fn(),
  entries: [{ id: 'entry1', tipo: 'DESPESA', origem: 'MANUAL', historico: 'Aluguel teste', data: '2026-08-01', lines: [{ tipo: 'D', conta: '1', valor: 25 }, { tipo: 'C', conta: '2', valor: 25 }] }],
};
it('recarga mantém a mesma linha e sua seleção; trocar competência limpa seleção', async () => {
  const view = render(<AccountingEntriesTab {...props} />);
  await act(async () => {});
  const row = document.getElementById('lanc-entry1');
  fireEvent.click(row.querySelector('input[type=checkbox]'));
  expect(screen.getByRole('button', { name: 'Exportar selecionados (1)' })).toBeEnabled();
  view.rerender(<AccountingEntriesTab {...props} loading />);
  await act(async () => {});
  expect(document.getElementById('lanc-entry1')).toBe(row);
  expect(row.querySelector('input[type=checkbox]')).toBeChecked();
  expect(screen.getByText('Atualizando lançamentos…')).toBeInTheDocument();
  view.rerender(<AccountingEntriesTab {...props} filters={{ competencia: '2026-09' }} entries={[]} />);
  await act(async () => {});
  expect(screen.queryByRole('button', { name: 'Exportar selecionados (1)' })).not.toBeInTheDocument();
});

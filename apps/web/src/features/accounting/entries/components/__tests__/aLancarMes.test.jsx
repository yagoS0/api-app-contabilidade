import { act, render, screen } from '@testing-library/react';
import { AccountingEntriesTab } from '../renderAccountingEntriesTab';
import { createApiClient } from '../../../../../api/client';
jest.mock('../../../../../api/client', () => {
  const api = {
    getFechamentoContabil: jest.fn(async () => ({ fechado: false, checklist: {} })),
    getVerificacaoLancamentos: jest.fn(async () => ({ ok: true, resumo: {}, porRegra: [] })),
    getConferenciaPendencias: jest.fn(),
  };
  return { createApiClient: () => api };
});
const props = { companyId: 'empresa', filters: { competencia: '2026-09' }, entries: [], accounts: [],
  onOpenConferencia: jest.fn(), onLoadAccounts: jest.fn() };

test('contador considera só o mês e ignora resposta atrasada de outra competência', async () => {
  const api = createApiClient();
  let responderSetembro;
  api.getConferenciaPendencias.mockImplementation((_id, { competencia }) => competencia === '2026-09'
    ? new Promise(resolve => { responderSetembro = resolve; })
    : Promise.resolve({ aLancar: 75, declaradosNaCompetencia: 0 }));
  const view = render(<AccountingEntriesTab {...props} />);
  await act(async () => {});
  expect(api.getConferenciaPendencias).toHaveBeenCalledWith('empresa', { competencia: '2026-09' });
  view.rerender(<AccountingEntriesTab {...props} filters={{ competencia: '2026-10' }} />);
  await act(async () => {});
  expect(screen.getByRole('button', { name: /A lançar/ })).toHaveAttribute('data-pendencias', '0');
  await act(async () => responderSetembro({ aLancar: 75, declaradosNaCompetencia: 5 }));
  expect(screen.getByRole('button', { name: /A lançar/ })).toHaveAttribute('data-pendencias', '0');
});

test('falha na contagem mensal não reaproveita total de todos os meses', async () => {
  createApiClient().getConferenciaPendencias.mockResolvedValue({ aLancar: 75, declaradosNaCompetencia: null });
  render(<AccountingEntriesTab {...props} />);
  await act(async () => {});
  expect(screen.getByRole('button', { name: /A lançar/ })).not.toHaveAttribute('data-pendencias');
});

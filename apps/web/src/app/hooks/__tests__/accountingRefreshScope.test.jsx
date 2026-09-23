import { act, renderHook, waitFor } from '@testing-library/react';
import { useManageAccountingWorkspace } from '../useManageAccountingWorkspace';
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
it('estado real mostra dados carregados, conserva durante refresh e descarta resposta de empresa anterior', async () => {
  const api = { getAccountingEntries: jest.fn(async () => ({ data: [{ id: 'a' }], total: 1 })), getChartOfAccounts: jest.fn(async () => []) };
  const initialProps = { api, page: 'companyDetail', selectedCompanyId: 'A', companyDetailTab: 'lancamentos', feedback: {} };
  const { result, rerender } = renderHook(props => useManageAccountingWorkspace(props), { initialProps });
  await waitFor(() => expect(result.current.accountingEntriesState.entries).toEqual([{ id: 'a' }]));
  const old = deferred(); api.getAccountingEntries.mockReturnValueOnce(old.promise);
  let reload;
  act(() => { reload = result.current.loadAccountingEntries(); });
  expect(result.current.accountingEntriesState.entries).toEqual([{ id: 'a' }]);
  api.getAccountingEntries.mockResolvedValueOnce({ data: [{ id: 'b' }], total: 1 });
  rerender({ ...initialProps, selectedCompanyId: 'B' });
  expect(result.current.accountingEntriesState.entries).toEqual([]);
  await waitFor(() => expect(result.current.accountingEntriesState.entries).toEqual([{ id: 'b' }]));
  await act(async () => { old.resolve({ data: [{ id: 'old-a' }], total: 1 }); await reload; });
  expect(result.current.accountingEntriesState.entries).toEqual([{ id: 'b' }]);
});

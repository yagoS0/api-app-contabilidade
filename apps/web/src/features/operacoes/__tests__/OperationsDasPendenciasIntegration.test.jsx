import { act, fireEvent, render, screen } from '@testing-library/react';
import { OperationsPage } from '../OperationsPage';
jest.mock('../OperationsAlerts', () => ({ OperationsAlerts: () => null }));
jest.mock('../OperationsRoutineCompanies', () => ({ OperationsRoutineCompanies: () => null }));
const companies = [{ companyId: 'a', razao: 'Alfa' }];
test('existing operations entry queries only selected company; closing/period change discards response', async () => {
  let resolve; const api = { getCompanyDasPendencias: jest.fn(() => new Promise(r => { resolve = r; })) };
  const view = render(<OperationsPage api={api} companies={companies} competencia="2026-10" />);
  fireEvent.click(screen.getByRole('button', { name: 'Pendências DAS/SERPRO' }));
  expect(api.getCompanyDasPendencias).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Empresa'), { target: { value: 'a' } });
  fireEvent.click(screen.getByText('Consultar evidências locais'));
  view.rerender(<OperationsPage api={api} companies={companies} competencia="2026-11" />);
  await act(async () => resolve({ ok: true, companyId: 'a', competencia: '2026-10', achados: [] }));
  expect(screen.queryByRole('dialog', { name: 'Pendências DAS/SERPRO' })).not.toBeInTheDocument();
  expect(api.getCompanyDasPendencias).toHaveBeenCalledTimes(1);
});

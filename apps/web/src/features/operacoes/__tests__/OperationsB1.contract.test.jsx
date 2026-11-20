import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { OperationsPage } from '../OperationsPage';

// Exercise the real page and its children. Only the boundary API is synthetic.
const company = pa => [{ companyId: 'synthetic-a', razao: 'Empresa sintética', status: 'ATIVA', myRole: 'ACCOUNTANT', regimeTributario: 'SIMPLES', apuracao: { competencia: pa, estado: 'aberta' } }];
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const evidence = (pa, status = 'PENDING') => ({ ok: true, competencia: pa, total: 1, items: [{ companyId: 'synthetic-a', competencia: pa, revision: `revision-${pa}`, status, regime: 'SIMPLES' }] });
const apiFor = () => ({
  getOperationEvidence: jest.fn(async pa => evidence(pa)),
  getOperationManualInss: jest.fn(async pa => ({ competencia: pa, items: [] })),
  getOperationAlerts: jest.fn(async () => ({ items: [], total: 0 })),
  getOperationConsultas: jest.fn(async pa => ({ ok: true, competencia: pa, items: [], total: 0 })),
  getOperationRoutines: jest.fn(async () => ({ items: [], routines: [] })),
  getCompanyDasPendencias: jest.fn(),
  saveCompanyOperation: jest.fn(), executeOperationsCalculation: jest.fn(), executeCompanyOperation: jest.fn(), saveOperationsExternal: jest.fn(),
});

it('composição e navegação entre áreas não acrescentam consultas nem comandos; mudança de mês conserva o recorte dos leitores', async () => {
  const api = apiFor(), onChangeCompetencia = jest.fn(), onEnviar = jest.fn(), onEnviarWhatsapp = jest.fn();
  const october = company('2026-10');
  const props = { api, companies: october, competencia: '2026-10', onChangeCompetencia, acoesGuia: { onEnviar, onEnviarWhatsapp } };
  const view = render(<OperationsPage {...props} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmado 0/1 empresas' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Contabilização' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Pendências DAS/SERPRO' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  view.rerender(<OperationsPage {...props} />);
  for (const read of ['getOperationEvidence', 'getOperationManualInss', 'getOperationAlerts', 'getOperationConsultas', 'getOperationRoutines']) expect(api[read]).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Próximo mês' }));
  expect(onChangeCompetencia).toHaveBeenCalledWith('2026-11');
  view.rerender(<OperationsPage {...props} companies={company('2026-11')} competencia="2026-11" />);
  await waitFor(() => expect(api.getOperationEvidence).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmado 0/1 empresas' })).toBeEnabled());
  for (const read of ['getOperationEvidence', 'getOperationManualInss', 'getOperationConsultas']) expect(api[read].mock.calls).toEqual([['2026-10'], ['2026-11']]);
  expect(api.getOperationAlerts).toHaveBeenCalledTimes(1);
  expect(api.getOperationRoutines).toHaveBeenCalledTimes(1);
  for (const command of ['getCompanyDasPendencias', 'saveCompanyOperation', 'executeOperationsCalculation', 'executeCompanyOperation', 'saveOperationsExternal']) expect(api[command]).not.toHaveBeenCalled();
  expect(onEnviar).not.toHaveBeenCalled(); expect(onEnviarWhatsapp).not.toHaveBeenCalled();
});

it('resposta tardia de outra competência não substitui o zero confirmado no mês atual', async () => {
  const old = deferred(), api = apiFor();
  api.getOperationEvidence.mockImplementation(pa => pa === '2026-10' ? old.promise : Promise.resolve(evidence(pa)));
  const view = render(<OperationsPage api={api} companies={company('2026-10')} competencia="2026-10" />);
  expect(screen.getByRole('button', { name: 'Confirmado — empresas' })).toBeDisabled();
  await waitFor(() => expect(api.getOperationEvidence).toHaveBeenCalledWith('2026-10'));
  view.rerender(<OperationsPage api={api} companies={company('2026-11')} competencia="2026-11" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmado 0/1 empresas' })).toBeEnabled());
  await act(async () => { old.resolve(evidence('2026-10', 'CONFIRMED')); });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmado 0/1 empresas' })).toBeEnabled());
  expect(screen.queryByRole('button', { name: 'Confirmado 1/1 empresas' })).not.toBeInTheDocument();
  expect(screen.getByText('Novembro de 2026')).toBeInTheDocument();
});

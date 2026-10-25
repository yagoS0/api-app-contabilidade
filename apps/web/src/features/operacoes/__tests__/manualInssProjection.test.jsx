import { act, render, screen, fireEvent, renderHook, waitFor } from '@testing-library/react';
import { incorporarInssManual, useManualInss } from '../useManualInss';
import { OperationsPage } from '../OperationsPage';

const company = { companyId: 'a' }, other = { companyId: 'b' };
const missing = { id: 'old', company, tipo: 'pendencias', tag: { key: 'inss', state: 'missing' } };
const failure = { id: 'send', company: other, tipo: 'erros', tag: { key: 'inss', state: 'falhou' } };
const projection = { rows: [{ company, fluxo: {} }, { company: other, fluxo: {} }], tasks: [missing, failure], groups: { pendencias: [missing], erros: [failure], apuracoes: [], concluidas: [{ company }] } };

test('monthly pending replaces missing INSS once without mutating fiscal statuses or delivery errors', () => {
  const result = incorporarInssManual(projection, [{ companyId: 'a', status: 'PENDING_DOCUMENT' }]);
  expect(result.groups.pendencias).toHaveLength(1);
  expect(result.groups.pendencias[0].titulo).toMatch(/guia manual/);
  expect(result.groups.erros).toEqual([failure]);
  expect(result.groups.concluidas).toEqual([]);
  expect(projection.tasks).toEqual([missing, failure]);
});

test('monthly exception removes only absent document; a delivery error is never hidden', () => {
  const result = incorporarInssManual(projection, [{ companyId: 'a', status: 'NOT_APPLICABLE' }, { companyId: 'b', status: 'NOT_APPLICABLE' }]);
  expect(result.groups.pendencias).toEqual([]);
  expect(result.groups.erros).toEqual([failure]);
});

test('local document available does not create new collection or erase delivery pending', () => {
  const generated = { ...missing, tag: { key: 'inss', state: 'gerada' } };
  const result = incorporarInssManual({ ...projection, tasks: [generated] }, [{ companyId: 'a', status: 'DOCUMENT_AVAILABLE' }]);
  expect(result.tasks).toEqual([generated]);
});

test('old month response cannot replace current month and retry only reloads local data', async () => {
  let resolveOld;
  const api = { getOperationManualInss: jest.fn(comp => comp === '2026-09' ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve({ items: [{ companyId: 'b' }] })) };
  const companies = [company];
  const { result, rerender } = renderHook(({ competencia }) => useManualInss(api, competencia, companies), { initialProps: { competencia: '2026-09' } });
  await waitFor(() => expect(resolveOld).toBeDefined());
  rerender({ competencia: '2026-10' });
  await waitFor(() => expect(result.current.items).toEqual([{ companyId: 'b' }]));
  await act(async () => resolveOld({ items: [{ companyId: 'a' }] }));
  expect(result.current.items).toEqual([{ companyId: 'b' }]);
  act(() => result.current.reload());
  await waitFor(() => expect(api.getOperationManualInss).toHaveBeenCalledTimes(3));
});

test('manual INSS opens existing guide modal with compact summary and configuration link', async () => {
  const manual = { companyId: 'a', competencia: '2026-09', revision: 'a'.repeat(64), hasProlabore: true, status: 'PENDING_DOCUMENT', guides: [], state: { applicable: null, responsible: 'Equipe fiscal', dueDate: null, note: '', reason: '' } };
  const api = { getOperationManualInss: jest.fn(async () => ({ items: [manual] })), getCompanyManualInss: jest.fn(async () => manual) };
  render(<OperationsPage api={api} companies={[{ ...company, razao: 'Empresa exemplo', apuracao: { competencia: '2026-09' }, guideCompliance: { competencia: '2026-09', inss: { required: true, state: 'missing', ok: false } } }]} competencia="2026-09" />);
  fireEvent.click(await screen.findByRole('button', { name: /Disponível 0\/1/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Ver detalhes do INSS manual' }));
  expect(await screen.findByText('Equipe fiscal')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Configurar INSS manual' })).toHaveAttribute('href', '/companies/a/automacao?competencia=2026-09');
  expect(screen.queryByRole('textbox', { name: 'Responsável' })).not.toBeInTheDocument();
  expect(api.getCompanyManualInss).toHaveBeenCalledTimes(1);
});

test('batch failure is not displayed as zero pendencies or success', async () => {
  render(<OperationsPage api={{ getOperationManualInss: async () => { throw Error('offline'); } }} companies={[company]} competencia="2026-09" />);
  expect(await screen.findByText(/Não foi possível conferir o INSS manual/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Disponível —/ })).toBeDisabled();
});

test('resposta vazia do controle mensal não é uma lista confirmada sem pendências', async () => {
  render(<OperationsPage api={{ getOperationManualInss: async () => ({ ok: false }) }} companies={[company]} competencia="2026-09" />);
  expect(await screen.findByText(/Não foi possível conferir o INSS manual/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Disponível —/ })).toBeDisabled();
});


test('confirmed monthly absence does not become a manual INSS pending and never erases delivery evidence', () => {
  const delivered = { ...missing, id: 'delivered', tipo: 'concluidas', tag: { key: 'inss', state: 'enviada' } };
  const result = incorporarInssManual({ ...projection, tasks: [missing, failure, delivered] }, [{ companyId: 'a', status: 'DOCUMENT_ABSENT' }]);
  expect(result.groups.pendencias).toEqual([]);
  expect(result.tasks).toEqual([failure, delivered]);
  expect(result.groups.concluidas).toEqual([{ company }]);
});

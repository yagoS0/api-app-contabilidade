import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRealApi } from '../../../api/real/realApi';
import { OperationsPage } from '../OperationsPage';

// The fiscal journey and P1 evidence/alerts are real. Unrelated calendar/routines
// are omitted; transport is a closed synthetic contract double, not a server.
jest.mock('../OperationsDailyCalendar', () => ({ OperationsDailyCalendar: () => null }));
jest.mock('../OperationsRoutineCompanies', () => ({ OperationsRoutineCompanies: () => null }));
const period = '2026-09';
const root = `/firm/companies/a/operacoes/${period}`;
let previousFetch;
beforeEach(() => { previousFetch = global.fetch; localStorage.clear(); });
afterEach(() => { global.fetch = previousFetch; });

function mount({ status = 'PENDING', uncertain = false, invalidSnapshot = false } = {}) {
  const requests = [], unexpected = [];
  let current = { regime: 'SIMPLES', companyId: 'a', competencia: period, revision: 'r1', status, pending: [], schedule: null, calculation: { calculoId: 'calculo-1', dasValor: 100 } };
  global.fetch = jest.fn(async (url, options = {}) => {
    const parsed = new URL(url), path = parsed.pathname + parsed.search;
    const method = options.method || 'GET', body = options.body ? JSON.parse(options.body) : null;
    requests.push({ method, path, body });
    let payload;
    if (method === 'GET' && path === `/firm/operacoes/evidencias?competencia=${period}`) payload = { items: [current], total: 1, competencia: period };
    else if (method === 'GET' && path === `/firm/operacoes/lotes?competencia=${period}`) payload = { ok: true, items: [] };
    else if (method === 'GET' && path === '/firm/operacoes/avisos') payload = { items: [], total: 0 };
    else if (method === 'GET' && path === `/firm/operacoes/inss-manual?competencia=${period}`) payload = { items: [], total: 0, competencia: period };
    else if (method === 'GET' && path === root) payload = current;
    else if (method === 'GET' && path === `/firm/companies/a/apuracao-snapshot/${period}`) payload = { snapshot: { portalClientId: invalidSnapshot ? 'another-company' : 'a', competencia: period, estado: 'calculada', idempotencyKey: 'calculo-1', dasSimuladoSerpro: 100, atividadesEscolhidas: [] } };
    else if (method === 'GET' && path === `/firm/companies/a/notas/auditoria?competencia=${period}`) payload = { auditoria: { competencia: period, totalAchados: 0, perguntas: [] } };
    else if (method === 'GET' && path === `/firm/companies/a/pgdas/${period}/historico`) payload = { competencia: period, versoes: [] };
    else if (method === 'GET' && path === `${root}/transmission-documents`) payload = { ok: true, companyId: 'a', competencia: period, items: [], confirmation: null };
    else if (method === 'PUT' && path === root && ['confirm', 'release'].includes(body?.action)) {
      expect(body.expectedRevision).toBe(current.revision);
      current = { ...current, status: body.action === 'confirm' ? 'CONFIRMED' : 'RELEASED', revision: body.action === 'confirm' ? 'r2' : 'r3' };
      payload = current;
    } else if (method === 'POST' && path === `${root}/executar`) {
      expect(body).toEqual({ expectedRevision: 'r3', confirmCompetencia: period });
      if (uncertain) throw Error('Resultado desconhecido');
      current = { ...current, status: 'EXECUTED', execution: { status: 'DONE' } };
      payload = { ok: true };
    } else { unexpected.push({ method, path }); throw Error(`Unexpected request: ${method} ${path}`); }
    return { ok: true, status: 200, json: async () => payload };
  });
  render(<OperationsPage api={createRealApi()} companies={[{ companyId: 'a', razao: 'CDA', myRole: 'ACCOUNTANT', apuracao: { competencia: period } }]} competencia={period} />);
  return { requests, unexpected, writes: () => requests.filter(r => r.method !== 'GET') };
}

async function openStage(stage) {
  const button = screen.getByRole('button', { name: new RegExp(`^${stage} `) });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Conferir detalhes' })).toBeEnabled());
}

test('real page/client: review reads the selected company/period and returns without writes', async () => {
  const flow = mount();
  await openStage('Calculado');
  fireEvent.click(screen.getByRole('button', { name: 'Conferir detalhes' }));
  const detail = await screen.findByRole('region', { name: 'Conferir CDA' });
  expect(detail).toHaveTextContent('Imposto salvo');
  expect(flow.requests.map(r => r.path)).toEqual(expect.arrayContaining([root, `/firm/companies/a/apuracao-snapshot/${period}`, `/firm/companies/a/notas/auditoria?competencia=${period}`, `/firm/companies/a/pgdas/${period}/historico`, `${root}/transmission-documents`]));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Voltar' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Conferir detalhes' })).toHaveFocus());
  expect(screen.getByRole('region', { name: 'Tabela contextual: Calculado' })).toBeVisible();
  expect(flow.writes()).toEqual([]);
  expect(flow.unexpected).toEqual([]);
});

test.each([false, true])('real page/client: confirmation then explicit release/transmission; uncertain=%s', async uncertain => {
  const flow = mount({ uncertain });
  await openStage('Calculado');
  fireEvent.click(screen.getByRole('button', { name: 'Conferir detalhes' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirmar apuração' }));
  await waitFor(() => expect(flow.writes()).toHaveLength(1));
  expect(flow.writes()[0]).toMatchObject({ method: 'PUT', path: root, body: { action: 'confirm', expectedRevision: 'r1' } });
  fireEvent.keyDown(document, { key: 'Escape' });
  await openStage('Confirmado');
  fireEvent.click(screen.getByRole('checkbox', { name: /Selecionar todas as elegíveis do filtro/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Transmitir selecionadas' }));
  const execute = await screen.findByRole('button', { name: 'Liberar e executar' });
  expect(execute).toBeDisabled();
  expect(flow.writes()).toHaveLength(1);
  fireEvent.change(screen.getByLabelText(`Digite a competência ${period} para executar`), { target: { value: period } });
  fireEvent.click(execute);
  await waitFor(() => expect(flow.writes()).toHaveLength(3));
  expect(flow.writes().map(r => [r.method, r.path, r.body?.action])).toEqual([['PUT', root, 'confirm'], ['PUT', root, 'release'], ['POST', `${root}/executar`, undefined]]);
  if (uncertain) {
    expect(await screen.findByRole('alert')).toHaveTextContent('Resultado desconhecido');
    expect(screen.getByRole('button', { name: 'Transmitir selecionadas' })).toBeDisabled();
  } else {
    await screen.findByText(/1 liberação\(ões\) processada/);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /^Transmitido / }));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Tabela contextual: Transmitido' })).toBeVisible());
    expect(await screen.findByText('Vínculo indisponível. Confira o histórico na apuração.')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Selecionar extrato de CDA' })).toBeDisabled();
  }
  expect(flow.writes()).toHaveLength(3);
  expect(flow.unexpected).toEqual([]);
});

test('evidence belonging to another company cannot confirm or transmit', async () => {
  const flow = mount({ invalidSnapshot: true });
  await openStage('Calculado');
  fireEvent.click(screen.getByRole('button', { name: 'Conferir detalhes' }));
  expect(await screen.findByRole('button', { name: 'Confirmar apuração' })).toBeDisabled();
  expect(flow.writes()).toEqual([]);
  expect(flow.unexpected).toEqual([]);
});

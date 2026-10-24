import { createMockApi } from '../mock/mockApi';
import { createRealApi } from '../real/realApi';
import { definirTokens, limparSessao } from '../sessionStore';
afterEach(() => limparSessao());
test('mock preserva mesma projeção no detalhe e recorta antes de paginar', async () => {
  const api = createMockApi();
  const session = await api.login('cliente@exemplo.com', '123456');
  definirTokens(session);
  const all = await api.getInvoices('pc-001', { limit: 200 });
  const known = all.data.find(n => n.dataEmissao?.civil);
  expect(known).toBeDefined();
  const detail = await api.getInvoiceDetail('pc-001', known.invoiceId);
  expect(detail.dataEmissao).toEqual(known.dataEmissao);
  expect(detail._xmlData).toContain(known.dataEmissao.evidencia.original);
  const range = { from: known.dataEmissao.civil, to: known.dataEmissao.civil, sort: 'issueDate', order: 'asc' };
  const one = await api.getInvoices('pc-001', { ...range, limit: 1 });
  const full = await api.getInvoices('pc-001', { ...range, limit: 200 });
  expect(one.total).toBe(full.total);
  expect(one.summary.totalAmount).toBe(full.summary.totalAmount);
  expect(full.data.every(n => n.dataEmissao.civil === known.dataEmissao.civil)).toBe(true);
  expect(all.data.some(n => n.dataEmissao?.motivo === 'XML_AUSENTE')).toBe(true);
});
test('cliente real transporta filtros civis sem convertê-los por timezone', async () => {
  const originalFetch = global.fetch;
  definirTokens({ accessToken: 'sintetico', refreshToken: 'sintetico' });
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ data: [], total: 0 }) }));
  try {
    await createRealApi().getInvoices('a', { from: '2026-09-28', to: '2026-09-28', sort: 'issueDate', order: 'asc', page: 2, direcao: 'todas' });
    const url = new URL(global.fetch.mock.calls[0][0], 'http://localhost');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ from: '2026-09-28', to: '2026-09-28', sort: 'issueDate', order: 'asc', page: '2', direcao: 'todas' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  } finally { global.fetch = originalFetch; }
});

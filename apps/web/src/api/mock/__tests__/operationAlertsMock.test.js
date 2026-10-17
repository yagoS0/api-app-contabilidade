import { createMockApi } from '../mockApi';
beforeAll(() => { global.structuredClone ??= value => JSON.parse(JSON.stringify(value)); });
afterEach(() => jest.useRealTimers());
test('central e auditoria compartilham pendência e reconhecimento, sem inferir transmissão', async () => {
  jest.useFakeTimers();
  const api = createMockApi();
  const before = await api.getOperationAlerts();
  const item = before.items[0];
  expect(before.total).toBe(before.items.length);
  const reading = api.listPendenciasPosFechamento(item.portalClientId);
  await jest.runAllTimersAsync();
  const notes = await reading;
  expect(notes[0].competencia).toBe(item.competencia);
  expect(notes[0].observacoes).toBe(item.observacoes);
  expect(item.situacaoPeriodo).toBe('FECHADA');
  const mutation = api.resolverPendenciaPosFechamento(item.portalClientId, notes[0].id);
  await jest.runAllTimersAsync(); await mutation;
  expect((await api.getOperationAlerts()).total).toBe(before.total - 1);
});

import { act, renderHook } from '@testing-library/react';
import { useSitfis } from '../useSitfis';
afterEach(() => jest.useRealTimers());
it('libera prazo relendo somente status salvo, sem consulta paga', async () => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-18T12:00:00Z'));
  const api = { getSitfis: jest.fn(), getStoredSitfis: jest.fn().mockResolvedValueOnce({ status: { podeConsultar: false, proximaConsultaEm: '2026-09-18T16:00:00Z' } }).mockResolvedValue({ status: { podeConsultar: true } }) };
  const { result } = renderHook(() => useSitfis({ api, companyId: 'A' }));
  await act(async () => {});
  expect(result.current.podeConsultar).toBe(false);
  await act(async () => jest.advanceTimersByTime(4 * 3600000 + 50));
  expect(result.current.podeConsultar).toBe(true);
  expect(api.getStoredSitfis).toHaveBeenCalledTimes(2);
  expect(api.getSitfis).not.toHaveBeenCalled();
});
it('relatório tardio de A não substitui B', async () => {
  let resolver;
  const api = { getStoredSitfis: jest.fn(id => id === 'A' ? new Promise(r => { resolver = r; }) : Promise.resolve({ status: { situacao: 'REGULAR' } })) };
  const { result, rerender } = renderHook(({ id }) => useSitfis({ api, companyId: id }), { initialProps: { id: 'A' } });
  rerender({ id: 'B' }); await act(async () => {});
  await act(async () => resolver({ status: { situacao: 'COM_PENDENCIA' } }));
  expect(result.current.status.situacao).toBe('REGULAR');
});

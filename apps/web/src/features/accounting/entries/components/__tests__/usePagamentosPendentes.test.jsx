import { act, renderHook, waitFor } from '@testing-library/react';
import { usePagamentosPendentes } from '../usePagamentosPendentes';

test('atualiza a contagem após revisão e ignora resposta da competência anterior', async () => {
  let resolverAnterior;
  const api = { getPagamentosPendentes: jest.fn()
    .mockResolvedValueOnce({ itens: [{ id: 'a' }, { id: 'b' }] })
    .mockImplementationOnce(() => new Promise(resolve => { resolverAnterior = resolve; }))
    .mockResolvedValueOnce({ itens: [{ id: 'c' }] })
    .mockResolvedValueOnce({ itens: [] }) };
  const { result, rerender } = renderHook(({ competencia, revisao }) =>
    usePagamentosPendentes(api, 'empresa', competencia, revisao),
  { initialProps: { competencia: '2026-10', revisao: 0 } });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.itens).toHaveLength(2);
  rerender({ competencia: '2026-11', revisao: 0 });
  expect(result.current.loading).toBe(true);
  expect(result.current.itens).toHaveLength(0);
  rerender({ competencia: '2026-12', revisao: 0 });
  await waitFor(() => expect(result.current.itens).toEqual([{ id: 'c' }]));
  await act(async () => resolverAnterior({ itens: [{ id: 'antigo' }] }));
  expect(result.current.itens).toEqual([{ id: 'c' }]);
  rerender({ competencia: '2026-12', revisao: 1 });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.itens).toHaveLength(0);
});

test('expõe falha da consulta para permitir nova tentativa', async () => {
  const api = { getPagamentosPendentes: jest.fn().mockRejectedValue(new Error('Falha local')) };
  const { result } = renderHook(() => usePagamentosPendentes(api, 'empresa', '2026-10', 0));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toBe('Falha local');
});

test("atualização falha preserva evidência e identifica leitura anterior", async () => {
  const api = { getPagamentosPendentes: jest.fn().mockResolvedValueOnce({ itens: [{ id: "p" }] }).mockRejectedValueOnce(new Error("offline")) };
  const { result } = renderHook(() => usePagamentosPendentes(api, "a", "2026-09", 0));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(() => result.current.reload());
  expect(result.current).toMatchObject({ itens: [{ id: "p" }], anterior: true, error: "offline" });
});
test("troca de empresa descarta resposta tardia", async () => {
  let resolver;
  const api = { getPagamentosPendentes: jest.fn().mockImplementationOnce(() => new Promise(r => { resolver = r; })).mockResolvedValueOnce({ itens: [{ id: "b" }] }) };
  const { result, rerender } = renderHook(({ id }) => usePagamentosPendentes(api, id, "2026-09", 0), { initialProps: { id: "a" } });
  rerender({ id: "b" });
  await waitFor(() => expect(result.current.itens).toEqual([{ id: "b" }]));
  await act(async () => resolver({ itens: [{ id: "a" }] }));
  expect(result.current.itens).toEqual([{ id: "b" }]);
});

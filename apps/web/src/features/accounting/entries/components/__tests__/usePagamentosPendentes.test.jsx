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

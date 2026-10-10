import { act, renderHook, waitFor } from '@testing-library/react';
import { usePreviaFiscal } from '../usePreviaFiscal';
const resposta = { ok: true, pendencias: [], regimeVigente: { regime: 'SIMPLES' } };
test('troca de competência bloqueia de imediato e descarta resposta antiga', async () => {
  const resolver = [];
  const api = { previaEmissaoNfse: jest.fn(() => new Promise(r => resolver.push(r))) };
  const { result, rerender } = renderHook(({ competencia }) => usePreviaFiscal(api, 'empresa', { competencia }), { initialProps: { competencia: '2026-01' } });
  await waitFor(() => expect(resolver).toHaveLength(1));
  rerender({ competencia: '2026-02' });
  expect(result.current.bloqueada).toBe(true);
  await waitFor(() => expect(resolver).toHaveLength(2));
  await act(async () => resolver[1]({ ...resposta, competencia: '2026-02' }));
  await act(async () => resolver[0]({ ...resposta, competencia: '2026-01' }));
  expect(result.current.dados.competencia).toBe('2026-02');
  expect(result.current.bloqueada).toBe(false);
});
test('falha não libera emissão e nova conferência exige revisão se mudou', async () => {
  const api = { previaEmissaoNfse: jest.fn().mockResolvedValueOnce(resposta).mockResolvedValueOnce({ ...resposta, regimeVigente: { regime: 'LUCRO_REAL' } }).mockRejectedValueOnce(new Error()) };
  const { result } = renderHook(() => usePreviaFiscal(api, 'empresa', { competencia: '2026-01' }));
  await waitFor(() => expect(result.current.bloqueada).toBe(false));
  let conferida;
  await act(async () => { conferida = await result.current.reconferir(); });
  expect(conferida).toBe(false);
  expect(result.current.dados.regimeVigente.regime).toBe('LUCRO_REAL');
  await act(async () => { conferida = await result.current.reconferir(); });
  expect(conferida).toBe(false);
  expect(result.current.bloqueada).toBe(true);
});

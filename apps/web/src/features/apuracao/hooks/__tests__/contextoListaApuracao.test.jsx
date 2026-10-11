import { act, renderHook, waitFor } from '@testing-library/react';
import { defaultCompetencia, useApuracao } from '../useApuracao';

const pendente = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const fechada = id => ({ portalClientId: id, estado: 'fechada' });
const criarApi = () => ({ listApuracao: jest.fn(async () => ({ items: [fechada('a'), { portalClientId: 'aberta', estado: 'aberta' }] })), criarApuracaoBatch: jest.fn(async () => ({ ok: true, jobId: 'lote', totalEmpresas: 1 })) });
const pronto = result => waitFor(() => expect(result.current.listaPronta).toBe(true));

test.each([
  ['2026-03-31T12:00:00Z', '2026-02'],
  ['2024-03-31T12:00:00Z', '2024-02'],
  ['2026-05-31T12:00:00Z', '2026-04'],
  ['2026-01-31T12:00:00Z', '2025-12'],
  ['2026-03-01T02:59:59Z', '2026-01'],
  ['2026-03-01T03:00:00Z', '2026-02'],
  ['2026-01-01T02:59:59Z', '2025-11'],
])('competência anterior em Brasília para %s é %s', (data, esperado) => {
  expect(defaultCompetencia(new Date(data))).toBe(esperado);
});

test('competência nova descarta resposta tardia e impede lote com seleção anterior', async () => {
  const api = criarApi(), antiga = pendente(), nova = pendente();
  const { result } = renderHook(() => useApuracao({ api }));
  await pronto(result);
  act(() => result.current.toggleSelect('a'));
  const enviarAntigo = result.current.apurarEmLote;
  api.listApuracao.mockReturnValueOnce(antiga.promise).mockReturnValueOnce(nova.promise);
  act(() => result.current.setCompetencia('2026-07'));
  expect(result.current.items).toEqual([]);
  expect(result.current.selected.size).toBe(0);
  act(() => result.current.setCompetencia('2026-08'));
  await act(async () => { await enviarAntigo(); await result.current.apurarEmLote(); });
  expect(api.criarApuracaoBatch).not.toHaveBeenCalled();
  await act(async () => nova.resolve({ items: [fechada('nova')] }));
  await act(async () => antiga.resolve({ items: [fechada('antiga')] }));
  expect(result.current.items.map(i => i.portalClientId)).toEqual(['nova']);
  act(() => result.current.toggleSelect('nova'));
  await act(async () => result.current.apurarEmLote());
  expect(api.criarApuracaoBatch).toHaveBeenCalledWith({ portalClientIds: ['nova'], competencia: '2026-08' });
});

test('busca invalida seleção imediatamente e erro antigo não apaga resposta atual', async () => {
  const api = criarApi(), primeira = pendente(), segunda = pendente();
  const { result } = renderHook(() => useApuracao({ api })); await pronto(result);
  act(() => result.current.toggleSelect('a'));
  const enviar = result.current.apurarEmLote;
  api.listApuracao.mockReturnValueOnce(primeira.promise).mockReturnValueOnce(segunda.promise);
  await act(async () => { result.current.setSearch('antiga'); await enviar(); });
  expect(api.criarApuracaoBatch).not.toHaveBeenCalled();
  act(() => result.current.setSearch('nova'));
  await act(async () => segunda.resolve({ items: [fechada('nova')] }));
  await act(async () => primeira.reject(new Error('falha antiga')));
  expect(result.current.error).toBe(null);
  expect(result.current.loading).toBe(false);
  expect(result.current.items[0].portalClientId).toBe('nova');
});

test('desabilitar e trocar API descartam a lista, seleção e resposta pendente', async () => {
  const api = criarApi(), outra = criarApi(), atraso = pendente();
  const { result, rerender } = renderHook(props => useApuracao(props), { initialProps: { api, enabled: true } });
  await pronto(result); act(() => result.current.toggleSelect('a'));
  api.listApuracao.mockReturnValueOnce(atraso.promise);
  act(() => { result.current.reload(); });
  rerender({ api, enabled: false });
  await act(async () => atraso.resolve({ items: [fechada('atrasada')] }));
  expect(result.current.items).toEqual([]);
  expect(result.current.selected.size).toBe(0);
  expect(result.current.listaPronta).toBe(false);
  await act(async () => result.current.apurarEmLote());
  expect(api.criarApuracaoBatch).not.toHaveBeenCalled();
  outra.listApuracao.mockResolvedValue({ items: [fechada('outro-escritorio')] });
  rerender({ api: outra, enabled: true }); await pronto(result);
  expect(result.current.items[0].portalClientId).toBe('outro-escritorio');
  expect(result.current.selected.size).toBe(0);
});

test('falha atual limpa dados e seleção, informa erro e permite recarregar', async () => {
  const api = criarApi(); const { result } = renderHook(() => useApuracao({ api })); await pronto(result);
  act(() => result.current.selectAllFechadas());
  api.listApuracao.mockRejectedValueOnce(new Error('Sem conexão'));
  await act(async () => result.current.reload());
  expect(result.current.error).toBe('Sem conexão');
  expect(result.current.loading).toBe(false);
  expect(result.current.listaPronta).toBe(false);
  expect(result.current.items).toEqual([]);
  expect(result.current.selected.size).toBe(0);
  await act(async () => result.current.apurarEmLote()); expect(api.criarApuracaoBatch).not.toHaveBeenCalled();
  await act(async () => result.current.reload()); expect(result.current.listaPronta).toBe(true);
});

test('recarga descarta callback da lista anterior e duplo clique envia um único lote', async () => {
  const api = criarApi(), envio = pendente(); const { result } = renderHook(() => useApuracao({ api })); await pronto(result);
  act(() => result.current.toggleSelect('a')); const antigo = result.current.apurarEmLote;
  await act(async () => result.current.reload());
  await act(async () => antigo()); expect(api.criarApuracaoBatch).not.toHaveBeenCalled();
  act(() => { result.current.toggleSelect('aberta'); result.current.toggleSelect('inexistente'); });
  expect(result.current.selected.size).toBe(0);
  act(() => result.current.selectAllFechadas());
  api.criarApuracaoBatch.mockReturnValueOnce(envio.promise);
  let primeiro, segundo;
  act(() => { primeiro = result.current.apurarEmLote(); segundo = result.current.apurarEmLote(); });
  expect(api.criarApuracaoBatch).toHaveBeenCalledTimes(1); expect(result.current.submitting).toBe(true);
  await act(async () => { envio.resolve({ ok: true, taskId: 'tarefa' }); await Promise.all([primeiro, segundo]); });
  expect(result.current.submitting).toBe(false); expect(result.current.selected.size).toBe(0);
  expect(api.listApuracao).toHaveBeenCalledTimes(3);
});

test('retorno de lote antigo não abre modal nem limpa seleção de outro contexto', async () => {
  const api = criarApi(), envio = pendente(), feedback = { notifySuccess: jest.fn(), notifyError: jest.fn() };
  const { result } = renderHook(() => useApuracao({ api, feedback })); await pronto(result);
  act(() => result.current.toggleSelect('a')); api.criarApuracaoBatch.mockReturnValueOnce(envio.promise);
  let executar; act(() => { executar = result.current.apurarEmLote(); });
  act(() => result.current.setCompetencia('2020-01')); await pronto(result);
  await act(async () => { envio.resolve({ ok: true, jobId: 'antigo' }); await executar; });
  expect(result.current.batchJobId).toBe(null); expect(feedback.notifySuccess).not.toHaveBeenCalled();
  expect(result.current.submitting).toBe(false);
});

test('erro de lote libera a ação sem anunciar sucesso', async () => {
  const api = criarApi(), feedback = { notifyError: jest.fn(), notifySuccess: jest.fn() };
  const { result } = renderHook(() => useApuracao({ api, feedback })); await pronto(result);
  act(() => result.current.toggleSelect('a')); api.criarApuracaoBatch.mockRejectedValueOnce(new Error('Recusado'));
  await act(async () => result.current.apurarEmLote());
  expect(result.current.submitting).toBe(false); expect(feedback.notifyError).toHaveBeenCalledWith('Recusado');
  expect(feedback.notifySuccess).not.toHaveBeenCalled();
});

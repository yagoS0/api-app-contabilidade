import { act, renderHook, waitFor } from "@testing-library/react";
import { useNotasFiscais } from "../useNotasFiscais";

const pendente = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
const apiBase = () => ({ listNotas: jest.fn(async () => ({ notas: [], total: 0 })), getDfeState: jest.fn(async () => null), getAdnState: jest.fn(async () => null) });

test("fechar nota invalida sua resposta; nota posterior e empresa nova não herdam o detalhe", async () => {
  const a = pendente(), b = pendente();
  const api = { ...apiBase(), getNota: jest.fn((_company, id) => id === "a" ? a.promise : b.promise) };
  const { result, rerender } = renderHook(p => useNotasFiscais({ api, ...p }), { initialProps: { companyId: "A" } });
  await waitFor(() => expect(result.current.loadingNotas).toBe(false));
  let primeiro, segundo;
  act(() => { primeiro = result.current.abrirNota("a"); });
  act(() => result.current.fecharNota());
  act(() => { segundo = result.current.abrirNota("b"); });
  await act(async () => { b.resolve({ nota: { id: "b" } }); await segundo; });
  await act(async () => { a.resolve({ nota: { id: "a" } }); await primeiro; });
  expect(result.current.notaAberta).toEqual({ id: "b" });
  rerender({ companyId: "B" });
  expect(result.current.notaAbertaId).toBeNull();
  expect(result.current.notaAberta).toBeNull();
  await act(async () => {});
});

test("estado de captura antigo e detalhe de A não aparecem em B", async () => {
  const a = pendente(), nota = pendente();
  const api = { ...apiBase(), getDfeState: jest.fn(company => company === "A" ? a.promise : Promise.resolve({ nsu: "B" })), getNota: jest.fn(() => nota.promise) };
  const { result, rerender } = renderHook(p => useNotasFiscais({ api, ...p }), { initialProps: { companyId: "A" } });
  let leitura;
  act(() => { leitura = result.current.abrirNota("a"); });
  rerender({ companyId: "B" });
  await waitFor(() => expect(result.current.dfeState).toEqual({ nsu: "B" }));
  await act(async () => { a.resolve({ nsu: "A" }); nota.resolve({ nota: { id: "a" } }); await leitura; });
  expect(result.current.dfeState).toEqual({ nsu: "B" });
  expect(result.current.notaAberta).toBeNull();
});

test("trocar competência fecha o detalhe e invalida a resposta pendente", async () => {
  const nota = pendente();
  const api = { ...apiBase(), getNota: jest.fn(() => nota.promise) };
  const { result } = renderHook(() => useNotasFiscais({ api, companyId: "A" }));
  await act(async () => {});
  let tarefa;
  act(() => { tarefa = result.current.abrirNota("a"); });
  act(() => result.current.setNotasFilters({ ...result.current.notasFilters, competencia: "2026-01" }));
  await act(async () => { nota.resolve({ nota: { id: "a" } }); await tarefa; });
  expect(result.current.notaAbertaId).toBeNull();
  expect(result.current.notaAberta).toBeNull();
});

test("falha da listagem é independente da captura e retry bem sucedido limpa somente ela", async () => {
  const api = apiBase(); api.listNotas.mockRejectedValueOnce(new Error("Lista indisponível"));
  const { result } = renderHook(() => useNotasFiscais({ api, companyId: "A" }));
  await waitFor(() => expect(result.current.erroNotas).toBe("Lista indisponível"));
  await act(async () => result.current.reload());
  expect(result.current.erroNotas).toBe("Lista indisponível");
  expect(api.listNotas).toHaveBeenCalledTimes(1);
  await act(async () => result.current.loadNotas());
  expect(result.current.erroNotas).toBeNull();
  expect(result.current.erroCaptura).toBeNull();
});

test("captura recarrega os filtros atuais, impede duplicata e não recarrega outra empresa", async () => {
  const captura = pendente();
  const api = { ...apiBase(), syncAdn: jest.fn(() => captura.promise) };
  const { result, rerender } = renderHook(p => useNotasFiscais({ api, ...p }), { initialProps: { companyId: "A" } });
  await waitFor(() => expect(result.current.loadingNotas).toBe(false));
  let tarefa;
  act(() => { tarefa = result.current.syncAdn(); result.current.syncAdn(); });
  act(() => result.current.setNotasFilters({ ...result.current.notasFilters, search: "novo" }));
  await act(async () => { captura.resolve({ ok: true, result: { totalDocs: 0 } }); await tarefa; });
  expect(api.syncAdn).toHaveBeenCalledTimes(1);
  expect(api.listNotas).toHaveBeenLastCalledWith("A", expect.objectContaining({ search: "novo" }));
  const antiga = pendente(); api.syncAdn.mockImplementationOnce(() => antiga.promise);
  act(() => { tarefa = result.current.syncAdn(); });
  rerender({ companyId: "B" });
  await waitFor(() => expect(result.current.loadingNotas).toBe(false));
  api.listNotas.mockClear();
  await act(async () => { antiga.resolve({ ok: true }); await tarefa; });
  expect(api.listNotas).not.toHaveBeenCalled();
});

test("resposta sem lista não vira nenhuma nota encontrada", async () => {
  const api = apiBase(); api.listNotas.mockResolvedValue({ ok: true });
  const { result } = renderHook(() => useNotasFiscais({ api, companyId: "A" }));
  await waitFor(() => expect(result.current.erroNotas).toMatch(/confirmar a lista/));
});

test.each([{}, { ok: false, result: { message: "Captura recusada" } }])("captura sem confirmação mantém erro visível depois da recarga: %j", async resposta => {
  const api = { ...apiBase(), syncAdn: jest.fn(async () => resposta) };
  const feedback = { notifySuccess: jest.fn() };
  const { result } = renderHook(() => useNotasFiscais({ api, companyId: "A", feedback }));
  await waitFor(() => expect(result.current.loadingNotas).toBe(false));
  await act(async () => result.current.syncAdn());
  expect(result.current.erroCaptura).toBeTruthy();
  expect(feedback.notifySuccess).not.toHaveBeenCalled();
});

import { act, renderHook } from "@testing-library/react";
import { useParcelamentos } from "../useParcelamentos";

const deferred = () => { let resolve; let reject; const promise = new Promise((ok, no) => { resolve = ok; reject = no; }); return { promise, resolve, reject }; };

it("não mostra contrato nem erro de resposta atrasada da empresa anterior", async () => {
  const anterior = deferred();
  const api = { listParcelamentos: jest.fn((id) => id === "A" ? anterior.promise : Promise.resolve([{ id: "contrato-B" }])) };
  const { result, rerender } = renderHook(({ companyId }) => useParcelamentos({ api, companyId }), { initialProps: { companyId: "A" } });
  await act(async () => { rerender({ companyId: "B" }); });
  expect(result.current.parcelamentos).toEqual([{ id: "contrato-B" }]);
  await act(async () => { anterior.reject(new Error("Falha da A")); });
  expect(result.current.parcelamentos).toEqual([{ id: "contrato-B" }]);
  expect(result.current.error).toBeNull();
  expect(result.current.loading).toBe(false);
});

it("mantém a última recarga mesmo quando a consulta anterior termina depois", async () => {
  const antiga = deferred();
  const api = { listParcelamentos: jest.fn().mockReturnValueOnce(antiga.promise).mockResolvedValue([{ id: "atualizado" }]) };
  const { result } = renderHook(() => useParcelamentos({ api, companyId: "A" }));
  await act(async () => { await result.current.load(); });
  await act(async () => { antiga.resolve([{ id: "antigo" }]); });
  expect(result.current.parcelamentos).toEqual([{ id: "atualizado" }]);
});

it("gravação iniciada em A não recarrega nem mostra erro em B", async () => {
  const gravacao = deferred();
  const api = { listParcelamentos: jest.fn((id) => Promise.resolve([{ id }])), ingestParcelamento: jest.fn(() => gravacao.promise) };
  const { result, rerender } = renderHook(({ companyId }) => useParcelamentos({ api, companyId }), { initialProps: { companyId: "A" } });
  await act(async () => {});
  let operation;
  act(() => { operation = result.current.ingest({}); });
  await act(async () => { rerender({ companyId: "B" }); });
  await act(async () => { gravacao.resolve({ ok: true }); await operation; });
  expect(result.current.parcelamentos).toEqual([{ id: "B" }]);
  expect(api.listParcelamentos.mock.calls.map(([id]) => id)).toEqual(["A", "B"]);
  expect(result.current.saving).toBe(false);
});

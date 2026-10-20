import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useParcelamentos } from "../useParcelamentos";
import { ConferenciaParcelasPanel } from "../../components/ParcelamentoModals";

const deferred = () => { let resolve; let reject; const promise = new Promise((ok, no) => { resolve = ok; reject = no; }); return { promise, resolve, reject }; };

it('conferência comunica resposta inválida e recupera fila vazia válida sem aprovar baixas', async () => {
  const api = {
    listParcelamentos: jest.fn().mockResolvedValue([]),
    getConferenciaParcelas: jest.fn().mockResolvedValueOnce({}).mockResolvedValue({ items: [] }),
    aprovarConferenciaParcelas: jest.fn(),
  };
  function ConferenciaIntegrada() {
    const state = useParcelamentos({ api, companyId: 'A' });
    return <ConferenciaParcelasPanel listConferencia={state.listConferencia} aprovarConferencia={state.aprovarConferencia} />;
  }
  const { container } = render(<ConferenciaIntegrada />);
  expect(await screen.findByRole('status')).toHaveTextContent('Não foi possível saber se há parcelas a conferir');
  expect(screen.getByRole('status')).toHaveTextContent('não quer dizer que a fila está vazia');
  fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
  await waitFor(() => expect(container).toBeEmptyDOMElement());
  expect(api.getConferenciaParcelas).toHaveBeenCalledTimes(2);
  expect(api.getConferenciaParcelas).toHaveBeenLastCalledWith('A');
  expect(api.aprovarConferenciaParcelas).not.toHaveBeenCalled();
});

it('resposta inválida não apaga contratos já carregados nem simula fila vazia', async () => {
  const api = { listParcelamentos: jest.fn().mockResolvedValueOnce([{ id: 'contrato' }]).mockResolvedValue(null),
    getConferenciaParcelas: jest.fn().mockResolvedValue({ ok: false }) };
  const { result } = renderHook(() => useParcelamentos({ api, companyId: 'A' }));
  await act(async () => {});
  await act(async () => { await result.current.load(); });
  expect(result.current.parcelamentos).toEqual([{ id: 'contrato' }]);
  expect(result.current.error).toMatch(/Resposta inválida/);
  await expect(result.current.listConferencia()).rejects.toThrow(/conferência/);
});

it('falha de rede conserva última lista válida e permite recuperação vazia legítima', async () => {
  const api = { listParcelamentos: jest.fn().mockResolvedValueOnce([{ id: 'contrato' }])
    .mockRejectedValueOnce(new Error('Offline')).mockResolvedValue([]) };
  const { result } = renderHook(() => useParcelamentos({ api, companyId: 'A' }));
  await act(async () => {});
  await act(async () => { await result.current.load(); });
  expect(result.current.parcelamentos).toHaveLength(1);
  expect(result.current.error).toBe('Offline');
  await act(async () => { await result.current.load(); });
  expect(result.current.parcelamentos).toEqual([]);
  expect(result.current.error).toBeNull();
});

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

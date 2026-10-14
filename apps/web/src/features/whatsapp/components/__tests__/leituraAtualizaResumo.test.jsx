import { act, renderHook, render, screen, fireEvent } from "@testing-library/react";
import { PendenciasSuporte } from "../PendenciasSuporte";
import { useResumoWhatsapp } from "../../hooks/useResumoWhatsapp";
import { useConversasWhatsapp } from "../../hooks/useConversasWhatsapp";

const resumo = mensagensNaoLidas => ({ conversas: 2, naoVinculadas: 0, conversasNaoLidas: mensagensNaoLidas ? 1 : 0, mensagensNaoLidas });
const adiada = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = () => act(async () => {});
function preparar() {
  const globalApi = { getResumoWhatsapp: jest.fn().mockResolvedValue({ ok: true, resumo: resumo(2) }), getPendenciasSuporte: jest.fn().mockResolvedValue({ ok: true, total: 4 }) };
  const inboxApi = {
    listarConversasWhatsapp: jest.fn().mockResolvedValue({ conversas: [{ id: "a", mensagensNaoLidas: 2 }] }),
    getMensagensWhatsapp: jest.fn().mockResolvedValue({ conversa: { id: "a" }, mensagens: [] }),
    marcarConversaWhatsappLida: jest.fn().mockResolvedValue({ ok: true }),
  };
  const view = renderHook(({ api }) => ({ resumo: useResumoWhatsapp({ api: globalApi }), inbox: useConversasWhatsapp({ api }) }), { initialProps: { api: inboxApi } });
  return { ...view, globalApi, inboxApi };
}
beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});
afterEach(() => jest.useRealTimers());

test("excluir demanda atualiza badge da equipe sem marcar mensagens como lidas", async () => {
  let total = 1;
  const api = {
    getResumoWhatsapp: jest.fn(async () => ({ ok: true, resumo: resumo(2) })),
    getPendenciasSuporte: jest.fn(async () => ({ ok: true, total, itens: total ? [{ id: "p", conversaId: "a", empresa: "Empresa teste", estado: "AGUARDANDO" }] : [] })),
    excluirDemandaSuporte: jest.fn(async () => { total = 0; return { ok: true }; }),
    marcarConversaWhatsappLida: jest.fn(),
  };
  const { result } = renderHook(() => useResumoWhatsapp({ api }));
  render(<PendenciasSuporte api={api} onAbrir={() => {}} companyId="pc1" />);
  await flush();
  expect(result.current.pendenciasSuporte).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "Excluir demanda" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirmar exclusão" }));
  await flush();
  expect(result.current.pendenciasSuporte).toBe(0);
  expect(result.current.selo).toBe(2);
  expect(api.marcarConversaWhatsappLida).not.toHaveBeenCalled();
});

test("leitura confirmada atualiza imediatamente lista e selo global sem resolver pendências", async () => {
  const { result, globalApi, inboxApi } = preparar();
  await flush();
  await act(async () => { await result.current.inbox.abrir("a"); });
  expect(inboxApi.marcarConversaWhatsappLida).not.toHaveBeenCalled();
  const leitura = adiada();
  inboxApi.marcarConversaWhatsappLida.mockReturnValueOnce(leitura.promise);
  act(() => { result.current.inbox.marcarLida("a", "m1"); });
  expect(result.current.resumo.selo).toBe(2);
  expect(globalApi.getResumoWhatsapp).toHaveBeenCalledTimes(1);
  globalApi.getResumoWhatsapp.mockResolvedValue({ ok: true, resumo: resumo(0) });
  inboxApi.listarConversasWhatsapp.mockResolvedValue({ conversas: [{ id: "a", mensagensNaoLidas: 0 }] });
  await act(async () => { leitura.resolve({ ok: true }); });
  expect(result.current.resumo.selo).toBeNull();
  expect(result.current.resumo.pendenciasSuporte).toBe(4);
  expect(result.current.inbox.conversas[0].mensagensNaoLidas).toBe(0);
  expect(globalApi.getResumoWhatsapp).toHaveBeenCalledTimes(2);
});

test("resumo anterior em voo é descartado e consulta após leitura não se perde", async () => {
  const { result, globalApi } = preparar();
  await flush();
  await act(async () => { await result.current.inbox.abrir("a"); });
  const antigo = adiada();
  const novo = adiada();
  globalApi.getResumoWhatsapp.mockReturnValueOnce(antigo.promise).mockReturnValueOnce(novo.promise);
  await act(async () => { jest.advanceTimersByTime(30000); });
  await act(async () => { await result.current.inbox.marcarLida("a", "m1"); });
  await act(async () => { antigo.resolve({ ok: true, resumo: resumo(9) }); });
  expect(result.current.resumo.selo).toBe(2);
  expect(globalApi.getResumoWhatsapp).toHaveBeenCalledTimes(3);
  await act(async () => { novo.resolve({ ok: true, resumo: resumo(0) }); });
  expect(result.current.resumo.selo).toBeNull();
});

test("leitura recusada preserva selo e permite tentar novamente", async () => {
  const { result, globalApi, inboxApi } = preparar();
  await flush();
  await act(async () => { await result.current.inbox.abrir("a"); });
  inboxApi.marcarConversaWhatsappLida.mockResolvedValueOnce({ ok: false });
  await act(async () => { await result.current.inbox.marcarLida("a", "m1"); });
  expect(result.current.resumo.selo).toBe(2);
  expect(globalApi.getResumoWhatsapp).toHaveBeenCalledTimes(1);
  expect(result.current.inbox.erroFio).toBeTruthy();
  await act(async () => { await result.current.inbox.marcarLida("a", "m1"); });
  expect(inboxApi.marcarConversaWhatsappLida).toHaveBeenCalledTimes(2);
  expect(globalApi.getResumoWhatsapp).toHaveBeenCalledTimes(2);
});

test("resposta de leitura do contexto anterior não invalida o contexto novo", async () => {
  const { result, rerender, globalApi, inboxApi } = preparar();
  await flush();
  await act(async () => { await result.current.inbox.abrir("a"); });
  const leitura = adiada();
  inboxApi.marcarConversaWhatsappLida.mockReturnValueOnce(leitura.promise);
  act(() => { result.current.inbox.marcarLida("a", "m1"); });
  rerender({ api: { ...inboxApi } });
  await flush();
  await act(async () => { leitura.resolve({ ok: true }); });
  expect(globalApi.getResumoWhatsapp).toHaveBeenCalledTimes(1);
});

test("aba oculta não registra leitura e resumo só retoma quando visível", async () => {
  const { result, globalApi, inboxApi, unmount } = preparar();
  await flush();
  await act(async () => { await result.current.inbox.abrir("a"); });
  const leitura = adiada();
  inboxApi.marcarConversaWhatsappLida.mockReturnValueOnce(leitura.promise);
  act(() => { result.current.inbox.marcarLida("a", "m1"); });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  await act(async () => { leitura.resolve({ ok: true }); });
  await act(async () => { await result.current.inbox.marcarLida("a", "m2"); });
  expect(inboxApi.marcarConversaWhatsappLida).toHaveBeenCalledTimes(1);
  expect(globalApi.getResumoWhatsapp).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(globalApi.getResumoWhatsapp).toHaveBeenCalledTimes(2);
  unmount();
});

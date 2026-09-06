import { act, renderHook, render, screen, fireEvent } from "@testing-library/react";
import { useResumoWhatsapp } from "../../hooks/useResumoWhatsapp";
import { useConversasWhatsapp } from "../../hooks/useConversasWhatsapp";
import { leituraDoResumo } from "../../lib/resumoTela";
import { GavetaFerramentas } from "../../../companies/list/pages/renderCompaniesHomePage";

const resumo = { conversas: 5, naoVinculadas: 1, conversasNaoLidas: 2, mensagensNaoLidas: 3 };
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
beforeEach(() => { jest.useFakeTimers(); Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); });
afterEach(() => { jest.useRealTimers(); });

test("ausência e resposta inválida nunca viram zero; zero medido não tem selo", () => {
  for (const r of [null, {}, { ...resumo, mensagensNaoLidas: null }, { ...resumo, mensagensNaoLidas: -1 }]) expect(leituraDoResumo(r)).toEqual({ selo: null, frase: "não foi possível ler" });
  expect(leituraDoResumo({ ...resumo, mensagensNaoLidas: 0 }).selo).toBeNull();
  expect(leituraDoResumo(resumo).selo).toBe(3);
});
test("selo chega ao hambúrguer fechado e à gaveta; falha remove os dois", () => {
  const items = [{ label: "WhatsApp", onClick: jest.fn() }];
  const { rerender } = render(<GavetaFerramentas items={items} resumoWhatsapp={leituraDoResumo(resumo)} />);
  expect(screen.getByTestId("whatsapp-ponto")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Abrir o menu/ }));
  expect(screen.getByTestId("whatsapp-selo")).toHaveTextContent("3");
  rerender(<GavetaFerramentas items={items} resumoWhatsapp={leituraDoResumo(null)} />);
  expect(screen.queryByTestId("whatsapp-ponto")).toBeNull();
  expect(screen.queryByTestId("whatsapp-selo")).toBeNull();
  expect(screen.getByText("não foi possível ler")).toBeInTheDocument();
});
test("resumo falho apaga selo antigo, pausa oculta e retoma ao voltar", async () => {
  const api = { getResumoWhatsapp: jest.fn().mockResolvedValue({ ok: true, resumo }) };
  const { result, unmount } = renderHook(() => useResumoWhatsapp({ api }));
  await flush(); expect(result.current.selo).toBe(3);
  api.getResumoWhatsapp.mockRejectedValueOnce(new Error("offline"));
  await act(async () => { jest.advanceTimersByTime(30000); });
  expect(result.current.selo).toBeNull(); expect(result.current.frase).toBe("não foi possível ler");
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  fireEvent(document, new Event("visibilitychange"));
  await act(async () => { jest.advanceTimersByTime(90000); });
  expect(api.getResumoWhatsapp).toHaveBeenCalledTimes(2);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  fireEvent(document, new Event("visibilitychange")); await flush();
  expect(api.getResumoWhatsapp).toHaveBeenCalledTimes(3); expect(result.current.selo).toBe(3);
  unmount(); await act(async () => { jest.advanceTimersByTime(90000); });
});
test("fio atualiza em 8s, lista ociosa em 30s, e não consulta escondida", async () => {
  const api = { listarConversasWhatsapp: jest.fn().mockResolvedValue({ conversas: [] }), getMensagensWhatsapp: jest.fn(async id => ({ conversa: { id }, mensagens: [] })) };
  const { result, unmount } = renderHook(() => useConversasWhatsapp({ api }));
  await flush();
  await act(async () => { jest.advanceTimersByTime(8000); });
  expect(api.listarConversasWhatsapp).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(22000); });
  expect(api.listarConversasWhatsapp).toHaveBeenCalledTimes(2);
  await act(async () => { await result.current.abrir("a"); });
  await act(async () => { jest.advanceTimersByTime(8000); });
  expect(api.getMensagensWhatsapp).toHaveBeenCalledTimes(2);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  fireEvent(document, new Event("visibilitychange"));
  await act(async () => { jest.advanceTimersByTime(90000); });
  expect(api.getMensagensWhatsapp).toHaveBeenCalledTimes(2);
  unmount(); await act(async () => { jest.advanceTimersByTime(90000); });
});
test("resposta atrasada não reabre o contato anterior nem um fio fechado", async () => {
  const pendentes = {};
  const api = { listarConversasWhatsapp: jest.fn().mockResolvedValue({ conversas: [] }), getMensagensWhatsapp: jest.fn(id => new Promise(resolve => { pendentes[id] = resolve; })) };
  const { result } = renderHook(() => useConversasWhatsapp({ api })); await flush();
  act(() => { result.current.abrir("a"); result.current.abrir("b"); });
  await act(async () => { pendentes.b({ conversa: { id: "b" }, mensagens: [] }); });
  await act(async () => { pendentes.a({ conversa: { id: "a" }, mensagens: [] }); });
  expect(result.current.aberta.conversa.id).toBe("b");
  act(() => { result.current.abrir("c"); result.current.fechar(); });
  await act(async () => { pendentes.c({ conversa: { id: "c" }, mensagens: [] }); });
  expect(result.current.aberta).toBeNull();
});

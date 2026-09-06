import { StrictMode } from "react";
import { act, render, renderHook, fireEvent, screen, within } from "@testing-library/react";
import { useConversasWhatsapp } from "../../hooks/useConversasWhatsapp";
import { ChatDaEmpresa } from "../ChatDaEmpresa";

const flush = async () => { await act(async () => { await Promise.resolve(); }); };
const adiada = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const conversa = (id, updatedAt = "2026-09-06T12:00:00Z") => ({ id, updatedAt, portalClientId: "empresa-a", contato: { nome: id }, telefoneMascarado: "+55…1234", janela: { situacao: "ABERTA" } });
const fio = id => ({ conversa: conversa(id), mensagens: [], temMais: false });
beforeEach(() => { jest.useFakeTimers(); Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); });
afterEach(() => { jest.useRealTimers(); });

test("trocar o filtro durante polling do fio não restaura a lista anterior", async () => {
  const espera = adiada();
  const api = { listarConversasWhatsapp: jest.fn(async filtro => ({ conversas: [{ id: filtro }] })), getMensagensWhatsapp: jest.fn(async id => fio(id)) };
  const { result } = renderHook(() => useConversasWhatsapp({ api })); await flush();
  await act(async () => { await result.current.abrir("a"); });
  api.getMensagensWhatsapp.mockImplementationOnce(() => espera.promise);
  await act(async () => { jest.advanceTimersByTime(8000); });
  act(() => result.current.setFiltro("fila")); await flush();
  await act(async () => { espera.resolve(fio("a")); });
  expect(result.current.filtro).toBe("fila");
  expect(api.listarConversasWhatsapp).toHaveBeenLastCalledWith("fila", { empresa: null });
  expect(result.current.conversas).toEqual([{ id: "fila" }]);
});

test("ocultar a aba durante a leitura do fio impede a próxima consulta da lista", async () => {
  const espera = adiada();
  const api = { listarConversasWhatsapp: jest.fn(async () => ({ conversas: [] })), getMensagensWhatsapp: jest.fn(async id => fio(id)) };
  const { result } = renderHook(() => useConversasWhatsapp({ api })); await flush();
  await act(async () => { await result.current.abrir("a"); });
  api.getMensagensWhatsapp.mockImplementationOnce(() => espera.promise);
  await act(async () => { jest.advanceTimersByTime(8000); });
  const chamadas = api.listarConversasWhatsapp.mock.calls.length;
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  fireEvent(document, new Event("visibilitychange"));
  await act(async () => { espera.resolve(fio("a")); });
  expect(api.listarConversasWhatsapp).toHaveBeenCalledTimes(chamadas);
});

test("resposta pendente da empresa anterior não ocupa a empresa nova", async () => {
  const listaAntiga = adiada(); const fioAntigo = adiada();
  const api = { listarConversasWhatsapp: jest.fn((f, { empresa }) => empresa === "a" ? listaAntiga.promise : Promise.resolve({ conversas: [conversa("b")] })), getMensagensWhatsapp: jest.fn(() => fioAntigo.promise) };
  const { result, rerender } = renderHook(({ empresa }) => useConversasWhatsapp({ api, empresa }), { initialProps: { empresa: "a" } });
  act(() => { result.current.abrir("a"); });
  rerender({ empresa: "b" }); await flush();
  await act(async () => { listaAntiga.resolve({ conversas: [conversa("a")] }); fioAntigo.resolve(fio("a")); });
  expect(result.current.conversas.map(c => c.id)).toEqual(["b"]);
  expect(result.current.aberta).toBeNull();
  expect(result.current.carregandoFio).toBe(false);
});

test("ação iniciada em outra empresa não recarrega a carteira antiga ao terminar", async () => {
  const resposta = adiada();
  const api = { listarConversasWhatsapp: jest.fn(async (f, { empresa }) => ({ conversas: [conversa(empresa)] })), getMensagensWhatsapp: jest.fn(async id => fio(id)), responderConversaWhatsapp: jest.fn(() => resposta.promise) };
  const { result, rerender } = renderHook(({ empresa }) => useConversasWhatsapp({ api, empresa }), { initialProps: { empresa: "a" } }); await flush();
  let envio;
  act(() => { envio = result.current.responder("a", "resposta"); });
  rerender({ empresa: "b" }); await flush();
  const chamadas = api.listarConversasWhatsapp.mock.calls.length;
  await act(async () => { resposta.resolve({ ok: true }); await envio; });
  expect(api.listarConversasWhatsapp).toHaveBeenCalledTimes(chamadas);
  expect(result.current.conversas.map(c => c.id)).toEqual(["b"]);
});

test("trocar a API descarta respostas pendentes e desmontar encerra consultas", async () => {
  const espera = adiada();
  const antiga = { listarConversasWhatsapp: jest.fn(() => espera.promise) };
  const nova = { listarConversasWhatsapp: jest.fn(async () => ({ conversas: [conversa("nova")] })) };
  const { result, rerender, unmount } = renderHook(({ api }) => useConversasWhatsapp({ api }), { initialProps: { api: antiga } });
  rerender({ api: nova }); await flush();
  await act(async () => { espera.resolve({ conversas: [conversa("antiga")] }); });
  expect(result.current.conversas.map(c => c.id)).toEqual(["nova"]);
  const recarregar = result.current.carregar;
  unmount();
  await act(async () => { await recarregar(); jest.advanceTimersByTime(60000); });
  expect(nova.listarConversasWhatsapp).toHaveBeenCalledTimes(1);
});

test("nova mensagem de outro contato preserva destinatário inicial e rascunho", async () => {
  const a = conversa("Ana", "2026-09-06T12:00:00Z"); const b = conversa("Bruno", "2026-09-06T11:00:00Z");
  const api = { listarConversasWhatsapp: jest.fn(async () => ({ conversas: [a, b] })), getMensagensWhatsapp: jest.fn(async id => fio(id)) };
  render(<ChatDaEmpresa api={api} companyId="empresa-a" />); await flush();
  fireEvent.change(screen.getByRole("textbox", { name: "Responder ao cliente" }), { target: { value: "Rascunho para Ana" } });
  api.listarConversasWhatsapp.mockResolvedValue({ conversas: [a, { ...b, updatedAt: "2026-09-06T13:00:00Z" }] });
  await act(async () => { jest.advanceTimersByTime(8000); });
  expect(screen.getByTestId("seletor-de-contato")).toHaveValue("Ana");
  expect(within(screen.getByTestId("fio")).getByTestId("pessoa-da-conversa")).toHaveTextContent("Ana");
  expect(screen.getByRole("textbox", { name: "Responder ao cliente" })).toHaveValue("Rascunho para Ana");
  fireEvent.change(screen.getByTestId("seletor-de-contato"), { target: { value: "Bruno" } }); await flush();
  expect(screen.getByRole("textbox", { name: "Responder ao cliente" })).toHaveValue("");
});

test("falha ao abrir fio na empresa oferece nova tentativa funcional", async () => {
  const api = { listarConversasWhatsapp: jest.fn(async () => ({ conversas: [conversa("Ana")] })), getMensagensWhatsapp: jest.fn().mockRejectedValueOnce(Object.assign(new Error("indisponível"), { status: 404 })).mockResolvedValue(fio("Ana")) };
  render(<ChatDaEmpresa api={api} companyId="empresa-a" />); await flush();
  expect(screen.queryByTestId("chat-abrindo")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Tentar abrir novamente" })); await flush();
  expect(screen.getByTestId("fio")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(api.getMensagensWhatsapp).toHaveBeenCalledTimes(2);
});

test("StrictMode abre o fio inicial, troca contato e acompanha a troca de empresa", async () => {
  const api = { listarConversasWhatsapp: jest.fn(async (f, { empresa }) => ({ conversas: [conversa(`${empresa}-Ana`), conversa(`${empresa}-Bruno`)] })), getMensagensWhatsapp: jest.fn(async id => fio(id)) };
  const tela = empresa => <StrictMode><ChatDaEmpresa api={api} companyId={empresa} /></StrictMode>;
  const { rerender } = render(tela("primeira")); await flush();
  expect(within(screen.getByTestId("fio")).getByTestId("pessoa-da-conversa")).toHaveTextContent("primeira-Ana");
  fireEvent.change(screen.getByTestId("seletor-de-contato"), { target: { value: "primeira-Bruno" } }); await flush();
  expect(within(screen.getByTestId("fio")).getByTestId("pessoa-da-conversa")).toHaveTextContent("primeira-Bruno");
  rerender(tela("segunda")); await flush();
  expect(within(screen.getByTestId("fio")).getByTestId("pessoa-da-conversa")).toHaveTextContent("segunda-Ana");
  expect(screen.queryByTestId("chat-abrindo")).toBeNull();
});

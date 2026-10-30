import { act, renderHook, waitFor } from "@testing-library/react";
import { useRascunhoServidor, limparRascunhosDaSessao } from "../useRascunhoServidor";
const adiar = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
let api;
afterEach(() => { limparRascunhosDaSessao(api); jest.useRealTimers(); });
async function montar() {
  api = { getRascunhoWhatsapp: jest.fn(async () => ({ rascunho: { versao: 1, conteudo: { texto: "original" } } })),
    salvarRascunhoWhatsapp: jest.fn(async (_, { versao, conteudo }) => ({ rascunho: { versao: versao + 1, conteudo } })),
    excluirRascunhoWhatsapp: jest.fn(async (_, versao) => ({ versao: versao + 1 })) };
  const ui = renderHook(props => useRascunhoServidor({ api, conversaId: "A", ...props }), { initialProps: {} });
  await waitFor(() => expect(ui.result.current.pronto).toBe(true)); return ui;
}
test("agendamento não confirma gravação; Guardar aguarda DTO e revisão", async () => {
  const ui = await montar(), post = adiar(); api.salvarRascunhoWhatsapp.mockReturnValueOnce(post.promise);
  await act(async () => { expect(await ui.result.current.salvar({ texto: "novo" })).toBe(true); });
  expect(api.salvarRascunhoWhatsapp).not.toHaveBeenCalled();
  let guardar, fim = false;
  act(() => { ui.result.current.suspend(); guardar = ui.result.current.guardarConfirmado().then(r => { fim = true; return r; }); });
  await act(async () => {}); expect(fim).toBe(false);
  await act(async () => { post.resolve({ rascunho: { versao: 2, conteudo: { texto: "novo" } } }); expect(await guardar).toEqual({ ok: true, context: ui.result.current.context, revision: 2 }); });
  expect(ui.result.current.pendente).toBe(false);
});
test.each([undefined, { ok: false }, { rascunho: { versao: 2 } }, { rascunho: { versao: 2, conteudo: { texto: "outro" } } }])("DTO inválido mantém proteção (%j)", async retorno => {
  const ui = await montar(); api.salvarRascunhoWhatsapp.mockResolvedValueOnce(retorno);
  await act(async () => { await ui.result.current.salvar({ texto: "novo" }); expect(await ui.result.current.guardarConfirmado()).toEqual({ ok: false }); });
  expect(ui.result.current.pendente).toBe(true);
});
test.each([409, 503])("recusa %s impede repetição sem conferência", async status => {
  const ui = await montar(); api.salvarRascunhoWhatsapp.mockRejectedValueOnce(Object.assign(new Error("falha"), { status }));
  await act(async () => { await ui.result.current.salvar({ texto: "novo" }); await ui.result.current.guardarConfirmado(); });
  await act(async () => { expect(await ui.result.current.guardarConfirmado()).toEqual({ ok: false }); });
  expect(api.salvarRascunhoWhatsapp).toHaveBeenCalledTimes(1); expect(ui.result.current.pendente).toBe(true);
});
test("suspender e cancelar preserva debounce; descarte não grava no cleanup", async () => {
  const ui = await montar(); jest.useFakeTimers();
  await act(async () => { await ui.result.current.salvar({ texto: "novo" }); ui.result.current.suspend(); jest.advanceTimersByTime(1000); });
  expect(api.salvarRascunhoWhatsapp).not.toHaveBeenCalled(); act(() => ui.result.current.resume());
  await act(async () => { jest.advanceTimersByTime(599); }); expect(api.salvarRascunhoWhatsapp).not.toHaveBeenCalled();
  await act(async () => { expect((await ui.result.current.descartarConfirmado()).ok).toBe(true); });
  ui.unmount(); await act(async () => { jest.advanceTimersByTime(1000); });
  expect(api.salvarRascunhoWhatsapp).not.toHaveBeenCalled(); expect(api.excluirRascunhoWhatsapp).toHaveBeenCalledTimes(1);
});
test("edição posterior e logout não confirmam a revisão anterior", async () => {
  const ui = await montar(), post = adiar(); api.salvarRascunhoWhatsapp.mockReturnValueOnce(post.promise);
  await act(async () => { await ui.result.current.salvar({ texto: "primeiro" }); });
  let guardar; act(() => { ui.result.current.suspend(); guardar = ui.result.current.guardarConfirmado(); });
  await act(async () => { await ui.result.current.salvar({ texto: "posterior" }); post.resolve({ rascunho: { versao: 2, conteudo: { texto: "primeiro" } } }); expect(await guardar).toEqual({ ok: false }); });
  expect(ui.result.current.pendente).toBe(true);
  act(() => limparRascunhosDaSessao(api));
  await act(async () => { expect(await ui.result.current.guardarConfirmado()).toEqual({ ok: false }); });
});

test.each([{}, { ok: false }, { rascunho: undefined }, { rascunho: { versao: -1, conteudo: { texto: "" } } }])("recuperação recusa DTO não confirmado %j sem perder texto", async dto => {
  const ui = await montar();
  api.salvarRascunhoWhatsapp.mockRejectedValueOnce(Object.assign(new Error("incerto"), { status: 503 }));
  await act(async () => { await ui.result.current.salvar({ texto: "preservado" }, true); });
  api.getRascunhoWhatsapp.mockResolvedValueOnce(dto);
  await act(async () => { await expect(ui.result.current.conferir()).rejects.toThrow("Leitura do rascunho não confirmada"); expect(await ui.result.current.resolverConflito()).toBe(false); });
  expect(ui.result.current.pendente).toBe(true);
  await act(async () => { expect(await ui.result.current.excluir()).toBe(false); });
  expect(api.excluirRascunhoWhatsapp).not.toHaveBeenCalled();
  const restaurar = jest.fn(); ui.unmount();
  renderHook(() => useRascunhoServidor({ api, conversaId: "A", onRestaurar: restaurar }));
  await waitFor(() => expect(restaurar).toHaveBeenLastCalledWith({ texto: "preservado" }));
  expect(api.salvarRascunhoWhatsapp).toHaveBeenCalledTimes(1);
});

test.each([409, 503])("conferência válida e escolha explícita recuperam %s sem retry automático", async status => {
  const ui = await montar(); api.salvarRascunhoWhatsapp.mockRejectedValueOnce(Object.assign(new Error("falha"), { status }));
  await act(async () => { await ui.result.current.salvar({ texto: "local" }, true); ui.result.current.suspend(); ui.result.current.resume(); });
  expect(api.salvarRascunhoWhatsapp).toHaveBeenCalledTimes(1);
  api.getRascunhoWhatsapp.mockResolvedValueOnce({ rascunho: { versao: 4, conteudo: { texto: "remoto" } } });
  await act(async () => { expect(await ui.result.current.conferir()).toEqual({ texto: "remoto" }); await ui.result.current.resolverConflito({ texto: "conferido" }); });
  expect(api.salvarRascunhoWhatsapp).toHaveBeenLastCalledWith("A", { modo: "texto", versao: 4, conteudo: { texto: "conferido" } });
  expect(ui.result.current.pendente).toBe(false);
  await act(async () => { expect((await ui.result.current.guardarConfirmado()).revision).toBe(5); });
});

test("ausência explícita é válida, mas edição posterior invalida a comparação anterior", async () => {
  const ui = await montar(), restaurar = jest.fn(); ui.rerender({ onRestaurar: restaurar });
  api.getRascunhoWhatsapp.mockResolvedValueOnce({ rascunho: null });
  await act(async () => { expect(await ui.result.current.conferir()).toEqual({ texto: "" }); });
  await act(async () => { await ui.result.current.salvar({ texto: "posterior" }); expect(await ui.result.current.resolverConflito()).toBe(false); });
  expect(restaurar).not.toHaveBeenCalled(); expect(ui.result.current.pendente).toBe(true);
});

test.each(["conversa", "canal", "vinculo", "api", "sessao", "unmount"])("GET de recuperação tardio não restaura outro contexto: %s", async tipo => {
  const ui = await montar(), get = adiar(), restaurar = jest.fn(); let sessao = "sessao";
  api.getAccessToken = () => sessao; ui.rerender({ onRestaurar: restaurar });
  api.getRascunhoWhatsapp.mockReturnValueOnce(get.promise); let consulta;
  act(() => { consulta = ui.result.current.conferir(); }); await act(async () => {});
  const antigo = ui.result.current;
  if (tipo === "unmount") ui.unmount();
  else { if (tipo === "sessao") sessao = "nova"; ui.rerender({ onRestaurar: restaurar, ...(tipo === "conversa" ? { conversaId: "B" } : tipo === "canal" ? { canalId: "novo" } : tipo === "vinculo" ? { vinculoId: "novo" } : tipo === "api" ? { api: { ...api } } : {}) }); }
  await act(async () => {}); restaurar.mockClear();
  await act(async () => { get.resolve({ rascunho: { versao: 99, conteudo: { texto: "antigo" } } }); expect(await consulta).toBeNull(); expect(await antigo.resolverConflito()).toBe(false); });
  expect(restaurar).not.toHaveBeenCalled(); expect(api.salvarRascunhoWhatsapp).not.toHaveBeenCalled();
});

test("dois leases do mesmo cache: cleanup e resume de um não liberam suspensão do outro", async () => {
  const a = await montar();
  const b = renderHook(() => useRascunhoServidor({ api, conversaId: "A" }));
  await waitFor(() => expect(b.result.current.pronto).toBe(true)); jest.useFakeTimers();
  await act(async () => { await a.result.current.salvar({ texto: "compartilhado" }); a.result.current.suspend(); b.result.current.suspend(); a.result.current.resume(); });
  a.unmount(); await act(async () => { jest.advanceTimersByTime(1200); });
  expect(api.salvarRascunhoWhatsapp).not.toHaveBeenCalled(); expect(b.result.current.pendente).toBe(true);
  await act(async () => { expect((await b.result.current.guardarConfirmado()).ok).toBe(true); });
  expect(api.salvarRascunhoWhatsapp).toHaveBeenCalledTimes(1); expect(b.result.current.pendente).toBe(false);
  act(() => b.result.current.resume()); await act(async () => { jest.advanceTimersByTime(1200); });
  expect(api.salvarRascunhoWhatsapp).toHaveBeenCalledTimes(1);
});

test.each([undefined, null, {}])("backend ausente (%j) preserva retorno booleano legado sem alegar confirmação", async backend => {
  api = backend; const ui = renderHook(() => useRascunhoServidor({ api, conversaId: "A" }));
  await act(async () => { expect(await ui.result.current.salvar({ texto: "memória" })).toBe(true); expect(await ui.result.current.guardarConfirmado()).toEqual({ ok: false }); expect(await ui.result.current.descartarConfirmado()).toEqual({ ok: false }); });
});

test("recusa comprovada 400 permite descarte explícito, sem publicar novamente a edição recusada", async () => {
  const ui = await montar(); api.salvarRascunhoWhatsapp.mockRejectedValueOnce(Object.assign(new Error("recusa"), { status: 400 }));
  await act(async () => { await ui.result.current.salvar({ texto: "recusado" }, true); });
  expect(ui.result.current.pendente).toBe(true);
  await act(async () => { expect(await ui.result.current.excluir()).toBe(true); });
  expect(api.salvarRascunhoWhatsapp).toHaveBeenCalledTimes(1); expect(api.excluirRascunhoWhatsapp).toHaveBeenCalledWith("A", 1, "texto"); expect(ui.result.current.pendente).toBe(false);
});

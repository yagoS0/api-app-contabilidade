import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { CompositorConversa } from "../CompositorConversa";
import { chaveDoRascunho } from "../../lib/identidadeAtendimento";
import { haRascunhoPendente, limparRascunhosDaSessao, useRascunhoServidor } from "../../hooks/useRascunhoServidor";

jest.mock("../AtendimentoComercial", () => ({ OrientacoesRapidas: () => null }));
const adiar = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
const conversa = id => ({ id, interlocutorId: `pessoa-${id}`, canalId: "principal", relacionamento: { tipo: "CLIENTE" },
  canais: [{ id: "principal", conversaId: id, janela: { situacao: "ABERTA" } }] });
let api;
afterEach(() => { if (api) limparRascunhosDaSessao(api); });
async function montar() {
  const a = conversa("A"), b = conversa("B"), exclusao = adiar();
  const servidor = new Map([["A", { versao: 1, conteudo: { texto: "Texto A" } }], ["B", { versao: 1, conteudo: { texto: "Texto B" } }]]);
  api = {
    getRascunhoWhatsapp: jest.fn(async id => ({ rascunho: servidor.get(id) })),
    salvarRascunhoWhatsapp: jest.fn(async (id, { versao, conteudo }) => {
      const rascunho = { versao: versao + 1, conteudo }; servidor.set(id, rascunho); return { rascunho };
    }),
    excluirRascunhoWhatsapp: jest.fn(async id => { await exclusao.promise; servidor.set(id, { versao: 2, conteudo: { texto: "" } }); return { versao: 2 }; }),
  };
  const hook = { api, rascunhosRef: { current: new Map() }, responder: jest.fn(), atualizarConversa: jest.fn() };
  const ui = render(<CompositorConversa conversa={a} hook={hook} />);
  await waitFor(() => expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Texto A"));
  fireEvent.click(screen.getByLabelText("Ações da mensagem e arquivos"));
  fireEvent.click(screen.getByRole("button", { name: "Descartar rascunho" }));
  await waitFor(() => expect(api.excluirRascunhoWhatsapp).toHaveBeenCalledWith("A", 1, "texto"));
  return { a, b, exclusao, hook, servidor, trocar: c => ui.rerender(<CompositorConversa conversa={c} hook={hook} />) };
}

test("DELETE adiado A → B não apaga B; edição volta após conclusão", async () => {
  const t = await montar(); t.trocar(t.b);
  await waitFor(() => expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Texto B"));
  expect(screen.getByLabelText("Responder ao cliente")).toBeDisabled();
  await act(async () => { t.exclusao.resolve(); });
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Texto B");
  fireEvent.change(screen.getByLabelText("Responder ao cliente"), { target: { value: "Nova edição B" } });
  expect(t.hook.rascunhosRef.current.get(chaveDoRascunho(t.b, { canalId: "principal" })).texto).toBe("Nova edição B");
  expect(t.hook.responder).not.toHaveBeenCalled();
});

test.each(["sucesso", "erro PUT", "erro DELETE"])("remontagem durante descarte com PUT pendente: %s", async desfecho => {
  const a = conversa("A"), put = adiar(), del = adiar();
  let servidor = { versao: 1, conteudo: { texto: "Texto A" } };
  api = {
    getRascunhoWhatsapp: jest.fn(async () => ({ rascunho: servidor })),
    salvarRascunhoWhatsapp: jest.fn(async (_, { versao, conteudo }) => {
      await put.promise; servidor = { versao: versao + 1, conteudo }; return { rascunho: servidor };
    }),
    excluirRascunhoWhatsapp: jest.fn(async (_, versao) => {
      await del.promise; servidor = { versao: versao + 1, conteudo: { texto: "" } }; return { versao: servidor.versao };
    }),
  };
  const hook = { api, rascunhosRef: { current: new Map() }, responder: jest.fn(), atualizarConversa: jest.fn() };
  let ui = render(<CompositorConversa conversa={a} hook={hook} />);
  await waitFor(() => expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Texto A"));
  fireEvent.change(screen.getByLabelText("Responder ao cliente"), { target: { value: "Texto editado A" } });
  // Este cenário cobre PUT já em voo; descarte antes de 600ms não inicia PUT.
  await waitFor(() => expect(api.salvarRascunhoWhatsapp).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByLabelText("Ações da mensagem e arquivos"));
  fireEvent.click(screen.getByRole("button", { name: "Descartar rascunho" }));
  await waitFor(() => expect(api.salvarRascunhoWhatsapp).toHaveBeenCalledTimes(1));
  ui.unmount();
  ui = render(<CompositorConversa conversa={a} hook={hook} />);
  await waitFor(() => expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Texto editado A"));
  expect(screen.getByLabelText("Responder ao cliente")).toBeDisabled();
  expect(screen.getByText("Descartando rascunho…")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Responder ao cliente"), { target: { value: "Evento durante exclusão" } });
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Texto editado A");
  await act(async () => { desfecho === "erro PUT" ? put.reject(new Error("PUT indisponível")) : put.resolve(); });
  if (desfecho !== "erro PUT") {
    await waitFor(() => expect(api.excluirRascunhoWhatsapp).toHaveBeenCalledWith("A", 2, "texto"));
    expect(screen.getByLabelText("Responder ao cliente")).toBeDisabled();
    await act(async () => { desfecho === "erro DELETE" ? del.reject(new Error("DELETE indisponível")) : del.resolve(); });
  }
  if (desfecho !== "sucesso") {
    expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Texto editado A");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Rascunho descartado.")).not.toBeInTheDocument();
    if (desfecho === "erro PUT") expect(api.excluirRascunhoWhatsapp).not.toHaveBeenCalled();
    return;
  }
  await waitFor(() => expect(screen.getByLabelText("Responder ao cliente")).toBeEnabled());
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Responder ao cliente"), { target: { value: "Novo texto após descarte" } });
  ui.unmount();
  ui = render(<CompositorConversa conversa={a} hook={hook} />);
  await waitFor(() => expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Novo texto após descarte"));
  await waitFor(() => expect(servidor.conteudo.texto).toBe("Novo texto após descarte"));
  expect(hook.responder).not.toHaveBeenCalled();
});

test.each(["texto", "anexo", "retomar"])("exclusão compartilhada bloqueia todos os listeners do modo %s", async modo => {
  const del = adiar(), restaurarA = jest.fn(), restaurarB = jest.fn();
  api = { getRascunhoWhatsapp: jest.fn(async () => ({ rascunho: { versao: 1, conteudo: { texto: "Original" } } })),
    excluirRascunhoWhatsapp: jest.fn(async () => { await del.promise; return { versao: 2 }; }), salvarRascunhoWhatsapp: jest.fn() };
  const a = renderHook(() => useRascunhoServidor({ api, conversaId: "A", modo, onRestaurar: restaurarA }));
  await waitFor(() => expect(a.result.current.pronto).toBe(true));
  const b = renderHook(() => useRascunhoServidor({ api, conversaId: "A", modo, onRestaurar: restaurarB }));
  await waitFor(() => expect(b.result.current.pronto).toBe(true));
  let exclusao;
  act(() => { exclusao = a.result.current.excluir(); });
  expect(a.result.current.pronto).toBe(false); expect(b.result.current.pronto).toBe(false);
  expect(haRascunhoPendente()).toBe(true);
  await act(async () => { expect(await b.result.current.salvar({ texto: "Não deve salvar" })).toBe(false); });
  await act(async () => { del.resolve(); await exclusao; });
  expect(a.result.current.pronto).toBe(true); expect(b.result.current.pronto).toBe(true);
  expect(restaurarA).toHaveBeenLastCalledWith({ texto: "" });
  expect(restaurarB).toHaveBeenLastCalledWith({ texto: "" });
  expect(api.salvarRascunhoWhatsapp).not.toHaveBeenCalled();
  expect(haRascunhoPendente()).toBe(false);
});

test("DELETE adiado A → B → A não restaura a versão apagada nem apaga nova digitação", async () => {
  const t = await montar(); t.trocar(t.b);
  await waitFor(() => expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Texto B"));
  t.trocar(t.a);
  expect(screen.getByLabelText("Responder ao cliente")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Responder ao cliente"), { target: { value: "Evento durante trava" } });
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Texto A");
  await act(async () => { t.exclusao.resolve(); });
  await waitFor(() => expect(screen.getByLabelText("Responder ao cliente")).toBeEnabled());
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Responder ao cliente"), { target: { value: "Novo rascunho A" } });
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Novo rascunho A");
  expect(api.excluirRascunhoWhatsapp).toHaveBeenCalledTimes(1);
});

test("falha de DELETE mantém texto e versão para conferência", async () => {
  const t = await montar();
  await act(async () => { t.exclusao.reject(new Error("Falha sintética")); });
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Texto A");
  expect(screen.getByRole("alert")).toHaveTextContent("Seu texto foi preservado");
  expect(t.servidor.get("A").conteudo.texto).toBe("Texto A");
  expect(screen.queryByText("Rascunho descartado.")).not.toBeInTheDocument();
});

test("duplo clique reserva um único DELETE", async () => {
  const t = await montar();
  fireEvent.click(screen.getByRole("button", { name: "Descartar rascunho" }));
  expect(api.excluirRascunhoWhatsapp).toHaveBeenCalledTimes(1);
  await act(async () => { t.exclusao.resolve(); });
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("");
});

test("remontagem sem PUT pendente conserva bloqueio e recebe tombstone real", async () => {
  const t = await montar();
  // A troca de key reproduz a remontagem por interlocutor usada pelo fio real.
  t.trocar(t.b);
  const outro = render(<CompositorConversa key="remontado-A" conversa={t.a} hook={t.hook} />);
  expect(screen.getAllByLabelText("Responder ao cliente")).toHaveLength(2);
  expect(outro.getAllByLabelText("Responder ao cliente").at(-1)).toBeDisabled();
  await act(async () => { t.exclusao.resolve(); });
  await waitFor(() => expect(screen.getAllByLabelText("Responder ao cliente").at(-1)).toBeEnabled());
  expect(screen.getAllByLabelText("Responder ao cliente").at(-1)).toHaveValue("");
  expect(t.servidor.get("A").conteudo).toEqual({ texto: "" });
});

test("DELETE antigo não restaura nem limpa rascunho de uma nova sessão", async () => {
  const del = adiar(); let sessao = "sessao-A";
  const restaurar = jest.fn();
  api = { getAccessToken: () => sessao,
    getRascunhoWhatsapp: jest.fn(async () => ({ rascunho: { versao: 1, conteudo: { texto: sessao } } })),
    excluirRascunhoWhatsapp: jest.fn(async () => { await del.promise; return { versao: 2 }; }) };
  const ui = renderHook(() => useRascunhoServidor({ api, conversaId: "A", onRestaurar: restaurar }));
  await waitFor(() => expect(ui.result.current.pronto).toBe(true));
  let exclusao;
  act(() => { exclusao = ui.result.current.excluir(); });
  await waitFor(() => expect(api.excluirRascunhoWhatsapp).toHaveBeenCalled());
  act(() => { limparRascunhosDaSessao(api); sessao = "sessao-B"; ui.rerender(); });
  await waitFor(() => expect(restaurar).toHaveBeenLastCalledWith({ texto: "sessao-B" }));
  await act(async () => { del.resolve(); expect(await exclusao).toBe(false); });
  expect(restaurar).toHaveBeenLastCalledWith({ texto: "sessao-B" });
  expect(ui.result.current.pronto).toBe(true);
});

test("descartar texto não bloqueia nem apaga outro modo ou outra conversa", async () => {
  const del = adiar(), restaurarAnexo = jest.fn(), restaurarB = jest.fn();
  api = { getRascunhoWhatsapp: jest.fn(async (id, modo) => ({ rascunho: { versao: 1, conteudo: { texto: `${id}-${modo}` } } })),
    excluirRascunhoWhatsapp: jest.fn(async () => { await del.promise; return { versao: 2 }; }) };
  const a = renderHook(() => useRascunhoServidor({ api, conversaId: "A" }));
  const anexo = renderHook(() => useRascunhoServidor({ api, conversaId: "A", modo: "anexo", onRestaurar: restaurarAnexo }));
  const b = renderHook(() => useRascunhoServidor({ api, conversaId: "B", onRestaurar: restaurarB }));
  await waitFor(() => expect([a.result.current.pronto, anexo.result.current.pronto, b.result.current.pronto]).toEqual([true, true, true]));
  let exclusao;
  act(() => { exclusao = a.result.current.excluir(); });
  expect(anexo.result.current.pronto).toBe(true); expect(b.result.current.pronto).toBe(true);
  await act(async () => { del.resolve(); await exclusao; });
  expect(restaurarAnexo).toHaveBeenLastCalledWith({ texto: "A-anexo" });
  expect(restaurarB).toHaveBeenLastCalledWith({ texto: "B-texto" });
  expect(api.excluirRascunhoWhatsapp).toHaveBeenCalledWith("A", 1, "texto");
});

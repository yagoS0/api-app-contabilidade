import { Modal } from "../../../../components/ui/Modal";
import { Request } from "node-fetch/lib/index.js";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, Link, useLocation } from "react-router-dom";
import { WorkspaceNavigationProvider } from "../../../../app/navigation/WorkspaceNavigation";
import { CompositorConversa } from "../../components/CompositorConversa";
import { limparRascunhosDaSessao } from "../../hooks/useRascunhoServidor";
import { WhatsappPage } from "../renderWhatsappPage";
jest.mock("../../components/AtendimentoComercial", () => ({ OrientacoesRapidas: () => null }));
const anterior = globalThis.Request;
beforeAll(() => { globalThis.Request = Request; }); afterAll(() => { globalThis.Request = anterior; });
let api;
afterEach(() => { if (api) limparRascunhosDaSessao(api); });
function Tela({ hook, dois }) {
  const location = useLocation();
  const conversa = id => ({ id, canalId: "principal", relacionamento: { tipo: "CLIENTE" }, canais: [{ id: "principal", conversaId: id, janela: { situacao: "ABERTA" } }] });
  return <><output aria-label="rota">{location.pathname}</output><Link to="/destino">Destino</Link>
    <CompositorConversa conversa={conversa("A")} hook={hook} />{dois && <CompositorConversa conversa={conversa("B")} hook={hook} />}</>;
}
async function montar(dois = false) {
  api = { getRascunhoWhatsapp: jest.fn(async () => ({ rascunho: { versao: 1, conteudo: { texto: "" } } })),
    salvarRascunhoWhatsapp: jest.fn(async (_, { conteudo, versao }) => ({ rascunho: { conteudo, versao: versao + 1 } })),
    excluirRascunhoWhatsapp: jest.fn(async (_, versao) => ({ versao: versao + 1 })) };
  const hook = { api, rascunhosRef: { current: new Map() }, responder: jest.fn(), atualizarConversa: jest.fn() };
  const router = createMemoryRouter([{ path: "*", element: <WorkspaceNavigationProvider><Tela hook={hook} dois={dois} /></WorkspaceNavigationProvider> }], { initialEntries: ["/anterior", "/whatsapp"], initialIndex: 1 });
  render(<RouterProvider router={router} />);
  await waitFor(() => screen.getAllByLabelText("Responder ao cliente").forEach(el => expect(el).toBeEnabled())); return { router, hook };
}
test("link aguarda Guardar real; Cancelar conserva texto; nenhum envio", async () => {
  const { hook } = await montar();
  fireEvent.change(screen.getByLabelText("Responder ao cliente"), { target: { value: "rascunho" } }); fireEvent.click(screen.getByText("Destino"));
  expect(screen.getByLabelText("rota")).toHaveTextContent("/whatsapp");
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar" })); expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("rascunho");
  fireEvent.click(screen.getByText("Destino")); fireEvent.click(await screen.findByRole("button", { name: "Guardar e sair" }));
  await waitFor(() => expect(screen.getByLabelText("rota")).toHaveTextContent("/destino"));
  expect(api.salvarRascunhoWhatsapp).toHaveBeenCalledTimes(1); expect(hook.responder).not.toHaveBeenCalled();
});
test("dois editores: conflito de um não desfaz gravação do outro nem libera destino", async () => {
  const { hook } = await montar(true);
  api.salvarRascunhoWhatsapp.mockImplementation(async (id, { conteudo, versao }) => { if (id === "B") throw Object.assign(new Error("conflito"), { status: 409 }); return { rascunho: { conteudo, versao: versao + 1 } }; });
  screen.getAllByLabelText("Responder ao cliente").forEach((el, i) => fireEvent.change(el, { target: { value: `texto-${i}` } }));
  fireEvent.click(screen.getByText("Destino")); fireEvent.click(await screen.findByRole("button", { name: "Guardar e sair" }));
  await waitFor(() => expect(api.salvarRascunhoWhatsapp).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText("rota")).toHaveTextContent("/whatsapp"); expect(screen.getAllByLabelText("Responder ao cliente")[1]).toHaveValue("texto-1"); expect(hook.responder).not.toHaveBeenCalled();
});
test("POP passa pela mesma decisão e descarte cancela debounce", async () => {
  const { router } = await montar();
  fireEvent.change(screen.getByLabelText("Responder ao cliente"), { target: { value: "descartar" } });
  await act(async () => { await router.navigate(-1); });
  fireEvent.click(await screen.findByRole("button", { name: "Descartar e sair" }));
  await waitFor(() => expect(screen.getByLabelText("rota")).toHaveTextContent("/anterior"));
  expect(api.salvarRascunhoWhatsapp).not.toHaveBeenCalled(); expect(api.excluirRascunhoWhatsapp).toHaveBeenCalledTimes(1);
});

test("página real: notificação e clique conservam seleção até decisão, sem transporte", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "serviceWorker"), worker = new EventTarget();
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: worker });
  const contato = id => ({ id, interlocutorId: `pessoa-${id}`, nomePerfilProvedor: `Pessoa ${id}`, relacionamento: { tipo: "A_IDENTIFICAR" }, canalId: "principal", janela: { situacao: "ABERTA" } });
  api = { listarConversasWhatsapp: jest.fn(async () => ({ conversas: [contato("A"), contato("B")], temMais: false })),
    getMensagensWhatsapp: jest.fn(async id => ({ conversa: contato(id), mensagens: [], temMais: false })),
    getRascunhoWhatsapp: jest.fn(async () => ({ rascunho: null })),
    salvarRascunhoWhatsapp: jest.fn(async (_, { conteudo, versao }) => ({ rascunho: { conteudo, versao: versao + 1 } })),
    excluirRascunhoWhatsapp: jest.fn(async (_, versao) => ({ versao: versao + 1 })),
    responderConversaWhatsapp: jest.fn(), assumirConversaWhatsapp: jest.fn(), marcarConversaWhatsappLida: jest.fn() };
  const router = createMemoryRouter([{ path: "*", element: <WorkspaceNavigationProvider><WhatsappPage api={api} /></WorkspaceNavigationProvider> }], { initialEntries: ["/whatsapp?conversa=A"] });
  const view = render(<RouterProvider router={router} />);
  try {
    await waitFor(() => expect(screen.getByLabelText("Responder ao cliente")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Responder ao cliente"), { target: { value: "edição A" } });
    act(() => worker.dispatchEvent(new MessageEvent("message", { data: { tipo: "ABRIR_CONVERSA", url: "/whatsapp?conversa=B" } })));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(router.state.location.search).toBe("?conversa=A"); expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("edição A");
    fireEvent.click(screen.getByTestId("conversa-B"));
    fireEvent.click(await screen.findByRole("button", { name: "Guardar e sair" }));
    await waitFor(() => expect(router.state.location.search).toBe("?conversa=B"));
    expect(api.salvarRascunhoWhatsapp).toHaveBeenCalledTimes(1);
    expect(api.salvarRascunhoWhatsapp.mock.calls[0][0]).toBe("A");
    expect(api.responderConversaWhatsapp).not.toHaveBeenCalled(); expect(api.assumirConversaWhatsapp).not.toHaveBeenCalled();
  } finally { view.unmount(); router.dispose(); if (descriptor) Object.defineProperty(navigator, "serviceWorker", descriptor); else delete navigator.serviceWorker; }
});

test("troca explícita de canal espera decisão e mantém escrita no destino anterior", async () => {
  api = { getRascunhoWhatsapp: jest.fn(async () => ({ rascunho: null })),
    salvarRascunhoWhatsapp: jest.fn(async (_, { conteudo, versao }) => ({ rascunho: { conteudo, versao: versao + 1 } })),
    excluirRascunhoWhatsapp: jest.fn(async (_, versao) => ({ versao: versao + 1 })) };
  const hook = { api, rascunhosRef: { current: new Map() }, responder: jest.fn(), atualizarConversa: jest.fn() };
  const conversa = { id: "A", interlocutorId: "pessoa", canalId: "principal", relacionamento: { tipo: "CLIENTE" },
    canais: [{ id: "principal", conversaId: "A", nome: "Principal", janela: { situacao: "ABERTA" } }, { id: "comercial", conversaId: "B", nome: "Comercial", janela: { situacao: "ABERTA" } }] };
  const router = createMemoryRouter([{ path: "*", element: <WorkspaceNavigationProvider><CompositorConversa conversa={conversa} hook={hook} /></WorkspaceNavigationProvider> }], { initialEntries: ["/whatsapp"] });
  const view = render(<RouterProvider router={router} />);
  try {
    await waitFor(() => expect(screen.getByLabelText("Responder ao cliente")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Responder ao cliente"), { target: { value: "para A" } });
    fireEvent.click(screen.getByLabelText("Ações da mensagem e arquivos"));
    fireEvent.change(screen.getByLabelText("Canal da mensagem"), { target: { value: "comercial" } });
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(screen.getByLabelText("Canal da mensagem")).toHaveValue("principal"); expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("para A");
    fireEvent.change(screen.getByLabelText("Canal da mensagem"), { target: { value: "comercial" } });
    fireEvent.click(await screen.findByRole("button", { name: "Guardar e sair" }));
    await waitFor(() => expect(screen.getByLabelText("Canal da mensagem")).toHaveValue("comercial"));
    await waitFor(() => expect(screen.getByLabelText("Responder ao cliente")).toHaveValue(""));
    expect(api.salvarRascunhoWhatsapp).toHaveBeenCalledTimes(1); expect(api.salvarRascunhoWhatsapp.mock.calls[0][0]).toBe("A"); expect(hook.responder).not.toHaveBeenCalled();
  } finally { view.unmount(); router.dispose(); }
});

// Real route/provider/page integration. jsdom has no layout; supply only the
// geometry contract, while preserving hidden/inert/style visibility conditions.
async function montarFocoLista({ outroDialogo = false } = {}) {
  const rects = jest.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function () {
    if (!this.isConnected || this.closest('[hidden], [inert], [aria-hidden="true"]')) return [];
    for (let el = this; el; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return [];
    }
    return [{ x: 0, y: 0, width: 100, height: 44 }];
  });
  const contato = id => ({ id, interlocutorId: `pessoa-${id}`, nomePerfilProvedor: `Pessoa ${id}`, relacionamento: { tipo: "A_IDENTIFICAR" }, canalId: "principal", janela: { situacao: "ABERTA" } });
  api = { listarConversasWhatsapp: jest.fn(async () => ({ conversas: [contato("A"), contato("B")], temMais: false })),
    getMensagensWhatsapp: jest.fn(async id => ({ conversa: contato(id), mensagens: [], temMais: false })),
    getRascunhoWhatsapp: jest.fn(async () => ({ rascunho: { versao: 1, conteudo: { texto: "" } } })),
    salvarRascunhoWhatsapp: jest.fn(async (_, { conteudo, versao }) => ({ rascunho: { conteudo, versao: versao + 1 } })),
    excluirRascunhoWhatsapp: jest.fn(async (_, versao) => ({ versao: versao + 1 })),
    responderConversaWhatsapp: jest.fn(), assumirConversaWhatsapp: jest.fn(), marcarConversaWhatsappLida: jest.fn() };
  const router = createMemoryRouter([{ path: "*", element: <WorkspaceNavigationProvider><button>Outro controle</button><WhatsappPage api={api} />{outroDialogo && <Modal titulo="Outro diálogo" aoFechar={() => {}}><button>Controle do outro diálogo</button></Modal>}</WorkspaceNavigationProvider> }], { initialEntries: ["/whatsapp", "/whatsapp?conversa=A"], initialIndex: 1 });
  const view = render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByLabelText("Responder ao cliente")).toBeEnabled());
  return { router, finish() { view.unmount(); router.dispose(); rects.mockRestore(); } };
}
const quadro = () => new Promise(resolve => requestAnimationFrame(resolve));

test.each(["Guardar e sair", "Descartar e sair"])("POP aceito por %s devolve foco à lista após remover fio", async escolha => {
  const ui = await montarFocoLista();
  try {
    const texto = screen.getByLabelText("Responder ao cliente"); texto.focus();
    fireEvent.change(texto, { target: { value: "rascunho foco A" } });
    await act(async () => { await ui.router.navigate(-1); });
    fireEvent.click(await screen.findByRole("button", { name: escolha }));
    await waitFor(() => expect(ui.router.state.location.search).toBe(""));
    await waitFor(() => expect(screen.getByLabelText("Buscar nas conversas carregadas")).toHaveFocus());
    expect(screen.queryByLabelText("Responder ao cliente")).not.toBeInTheDocument();
    expect(api.responderConversaWhatsapp).not.toHaveBeenCalled();
    expect(api.salvarRascunhoWhatsapp).toHaveBeenCalledTimes(escolha === "Guardar e sair" ? 1 : 0);
    expect(api.excluirRascunhoWhatsapp).toHaveBeenCalledTimes(escolha === "Descartar e sair" ? 1 : 0);
  } finally { ui.finish(); }
});
test("Cancelar POP mantém A e não manda foco para lista", async () => {
  const ui = await montarFocoLista();
  try {
    const texto = screen.getByLabelText("Responder ao cliente"); texto.focus();fireEvent.change(texto, { target: { value: "preservar A" } });
    await act(async () => { await ui.router.navigate(-1); });
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    await act(async () => { await quadro(); });
    expect(ui.router.state.location.search).toBe("?conversa=A");expect(texto).toHaveValue("preservar A");expect(texto).toHaveFocus();
    expect(screen.getByLabelText("Buscar nas conversas carregadas")).not.toHaveFocus();expect(api.responderConversaWhatsapp).not.toHaveBeenCalled();
  } finally { ui.finish(); }
});
test("Voltar normal usa transição aceita e mantém foco na lista", async () => {
  const ui = await montarFocoLista();
  try {
    const voltar = screen.getByRole("button", { name: "Voltar para conversas" });voltar.focus();fireEvent.click(voltar);
    await waitFor(() => expect(ui.router.state.location.search).toBe(""));
    await waitFor(() => expect(screen.getByLabelText("Buscar nas conversas carregadas")).toHaveFocus());expect(api.salvarRascunhoWhatsapp).not.toHaveBeenCalled();
  } finally { ui.finish(); }
});
test("POP aceito não rouba foco vivo de outro controle", async () => {
  const ui = await montarFocoLista();
  try {
    const outro = screen.getByRole("button", { name: "Outro controle" });outro.focus();
    await act(async () => { await ui.router.navigate(-1); await quadro(); });
    expect(ui.router.state.location.search).toBe("");expect(outro).toHaveFocus();expect(screen.getByLabelText("Buscar nas conversas carregadas")).not.toHaveFocus();
  } finally { ui.finish(); }
});
test("POP aceito não rouba foco de outro Modal real", async () => {
  const ui = await montarFocoLista({ outroDialogo: true });
  try {
    const outro = screen.getByRole("button", { name: "Controle do outro diálogo" });outro.focus();
    await act(async () => { await ui.router.navigate(-1); await quadro(); });
    expect(ui.router.state.location.search).toBe("");expect(outro).toHaveFocus();expect(screen.getByRole("dialog", { name: "Outro diálogo" })).toBeVisible();
  } finally { ui.finish(); }
});
// The trace observed the first frame before the route effect's queued state
// committed. Run RAF immediately at this scheduling seam to preserve that order;
// this is deterministic React regression, not a browser timing/geometry claim.
test("POP mantém intenção de foco quando primeiro frame precede desmontagem do fio", async () => {
  const ui = await montarFocoLista();
  const raf = jest.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { callback(0); return 1; });
  try {
    const texto = screen.getByLabelText("Responder ao cliente"); texto.focus();
    await act(async () => { await ui.router.navigate(-1); });
    await waitFor(() => expect(ui.router.state.location.search).toBe(""));
    await waitFor(() => expect(screen.queryByLabelText("Responder ao cliente")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText("Buscar nas conversas carregadas")).toHaveFocus());
    expect(api.responderConversaWhatsapp).not.toHaveBeenCalled();
    expect(api.salvarRascunhoWhatsapp).not.toHaveBeenCalled();
  } finally { raf.mockRestore(); ui.finish(); }
});

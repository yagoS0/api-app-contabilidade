import { MemoryRouter, createMemoryRouter, RouterProvider } from "react-router-dom";
import { StrictMode, useState } from "react";
import { Request } from "node-fetch/lib/index.js";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as rascunhos from "../../hooks/useRascunhoServidor";
import { WhatsappPage } from "../renderWhatsappPage";
import { ChatDaEmpresa } from "../../components/ChatDaEmpresa";

let criarUrlOriginal, revogarUrlOriginal;
beforeEach(() => {
  criarUrlOriginal = URL.createObjectURL; revogarUrlOriginal = URL.revokeObjectURL;
  URL.createObjectURL = jest.fn(() => "blob:apresentacao-sintetica"); URL.revokeObjectURL = jest.fn();
});
afterEach(() => { URL.createObjectURL = criarUrlOriginal; URL.revokeObjectURL = revogarUrlOriginal; });

const clonar = valor => JSON.parse(JSON.stringify(valor));
function cenario() {
  const canais = [
    { id: "principal", chave: "Principal", conversaId: "antiga", janela: { situacao: "EXPIRADA", instante: "2026-09-17T10:00:00Z" }, podeResponder: false },
    { id: "comercial", chave: "Comercial", conversaId: "recente", janela: { situacao: "ABERTA", instante: "2026-09-21T15:54:22Z" }, podeResponder: true },
  ];
  const conversa = { id: "antiga", canalId: "principal", interlocutorId: "pessoa-teste", nomePerfilProvedor: "Pessoa teste", relacionamento: { tipo: "LEAD" }, escopoVerificado: true, canais, janela: canais[0].janela, solicitacaoComercial: { id: "caso", onboardingId: "o", origem: "INATIVA" } };
  const passos = ["publica", "autorizacao", "fiscal", "diagnostico", "devolutiva", "proposta", "contrato", "pagamento"].map((id, i) => ({ id, titulo: id, concluido: i < 4, acessivel: i <= 4, pendencias: [], instrucao: "Confira esta etapa." }));
  const estado = { onboarding: { id: "o", origem: "INATIVA", versao: 2, cnpj: "11222333000181", dados: {} }, atendimento: { conversaId: "antiga" }, propostas: [], contratos: [], documentos: [], trabalhos: [], jornada: {
    projecao: { atual: "devolutiva", passos }, diagnostico: { id: "d", dados: { texto: "Análise sintética e serviços conferidos.", servicos: "Regularização sintética.", analiseId: "fiscal" } }, devolutiva: { partes: [{ parte: "RELATORIO", status: "nao_enviado" }, { parte: "TEXTO", status: "nao_enviado" }], concluida: false },
  } };
  const api = {
    listarConversasWhatsapp: jest.fn(async () => ({ conversas: [clonar(conversa)], temMais: false })),
    getMensagensWhatsapp: jest.fn(async () => ({ conversa: clonar(conversa), mensagens: [], temMais: false })),
    baixarApresentacaoComercial: jest.fn(async (id, diagnostico, hash) => {
      if (id !== "o" || diagnostico !== "d" || hash !== "hash-atual") throw new Error("PDF de outro contexto");
      return new Blob(["%PDF-1.4 sintético"], { type: "application/pdf" });
    }),
    comercial: jest.fn(async (path, body) => {
      if (path === "/recursos") return { recursos: [] };
      if (path.startsWith("/conversas/")) return { atendimento: { id: "caso", onboardingId: "o", onboarding: estado.onboarding } };
      if (path === "/onboardings/o/apresentacao" && body === undefined) return { diagnosticoId: "d", conteudoHash: "hash-atual", versao: 2, pdfDisponivel: true };
      if (path === "/onboardings/o/apresentacao/d/enviar") {
        if (body.conteudoHash !== "hash-atual") throw new Error("Apresentação desatualizada");
        if (body.conversaId !== "recente" || canais[1].janela.situacao !== "ABERTA") throw Object.assign(new Error("Canal fechado"), { code: "FORA_DA_JANELA", status: 409 });
        return { envio: { estado: "ENVIADO" } };
      }
      if (path === "/onboardings/o/apresentacao/d/conferir") {
        if (body.versao !== 2 || body.conteudoHash !== "hash-atual" || body.confirmado !== true) throw new Error("Conferência de outra revisão");
        estado.jornada.devolutiva.concluida = true;
        return { conferencia: { atorId: "contador-sintetico", createdAt: "2026-10-21T15:00:00Z" } };
      }
      if (estado.jornada.devolutiva.concluida) { estado.jornada.projecao.atual = "proposta"; passos[4].concluido = true; passos[5].acessivel = true; }
      return clonar(estado);
    }),
  };
  return { api, conversa, canais };
}
async function abrir(api) {
  render(<WhatsappPage api={api} />, { wrapper: RouterWhatsapp });
  fireEvent.click(await screen.findByTestId("conversa-antiga"));
  await screen.findByLabelText("Responder ao cliente");
  fireEvent.click(screen.getByRole("button", { name: "Detalhes da conversa" }));
  await screen.findByRole("navigation", { name: "Passo a passo do lead" });
}

test("entrada comercial recente escolhe o mesmo canal no chat e na etapa cinco, preservando a ficha antiga", async () => {
  const { api } = cenario(); await abrir(api);
  expect(screen.queryByLabelText("Canal da resposta")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Canal do atendimento")).not.toBeInTheDocument();
  expect(screen.getByText("WhatsApp · Comercial")).toBeVisible();
  const mapa = screen.getByRole("navigation", { name: "Passo a passo do lead" });
  expect(mapa).toBeVisible(); expect(mapa.closest("details")).toBeNull();
  expect(screen.getByRole("button", { name: "5. devolutiva" })).toHaveAttribute("aria-current", "step");
  expect(await screen.findByTitle("Prévia PDF da apresentação da empresa")).toBeVisible();
  expect(api.baixarApresentacaoComercial).toHaveBeenCalledWith("o", "d", "hash-atual");
  expect(api.comercial.mock.calls.some(([p]) => p.endsWith("/enviar"))).toBe(false);
  await waitFor(() => expect(screen.getByRole("button", { name: "Enviar ao cliente" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Enviar ao cliente" }));
  await waitFor(() => expect(api.comercial).toHaveBeenCalledWith("/onboardings/o/apresentacao/d/enviar", { conteudoHash: "hash-atual", conversaId: "recente" }));
  expect(screen.queryByText("Preparar uma nova proposta em PDF")).not.toBeInTheDocument();
  expect(api.comercial.mock.calls.some(([p]) => p.endsWith("/conferir"))).toBe(false);
});

test("cliente pode trocar canal na própria etapa sem perder diagnóstico nem enviar automaticamente", async () => {
  const { api, conversa } = cenario(); conversa.relacionamento = { tipo: "CLIENTE" }; await abrir(api);
  fireEvent.change(screen.getByLabelText("Canal do atendimento"), { target: { value: "principal" } });
  await waitFor(() => expect(screen.getByLabelText("Canal do atendimento")).toHaveValue("principal"));
  expect(screen.getByRole("button", { name: "Enviar ao cliente" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Usar Comercial — conversa aberta" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Enviar ao cliente" })).toBeEnabled());
  expect(await screen.findByTitle("Prévia PDF da apresentação da empresa")).toBeVisible();
  expect(api.baixarApresentacaoComercial).toHaveBeenCalledWith("o", "d", "hash-atual");
  expect(api.comercial.mock.calls.some(([p]) => p.endsWith("/enviar"))).toBe(false);
});

test("janela fechada permite baixar PDF e conferir a revisão sem enviar ao cliente", async () => {
  const { api, canais } = cenario(); canais[1].janela.situacao = "EXPIRADA"; canais[1].podeResponder = false;
  const baixar = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  try {
    await abrir(api);
    await screen.findByTitle("Prévia PDF da apresentação da empresa");
    expect(screen.getByRole("button", { name: "Enviar ao cliente" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Baixar PDF" }));
    await waitFor(() => expect(api.baixarApresentacaoComercial).toHaveBeenCalledTimes(2));
    expect(api.baixarApresentacaoComercial).toHaveBeenLastCalledWith("o", "d", "hash-atual");
    await waitFor(() => expect(baixar).toHaveBeenCalled());
    expect(screen.queryByText("Preparar uma nova proposta em PDF")).not.toBeInTheDocument();
    expect(api.comercial.mock.calls.some(([p]) => p.endsWith("/conferir"))).toBe(false);
    await waitFor(() => expect(screen.getByRole("button", { name: "Conferi o PDF e quero preparar a proposta" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Conferi o PDF e quero preparar a proposta" }));
    expect(await screen.findByText("Preparar uma nova proposta em PDF")).toBeVisible();
    expect(api.comercial).toHaveBeenCalledWith("/onboardings/o/apresentacao/d/conferir", { versao: 2, conteudoHash: "hash-atual", confirmado: true });
    expect(api.comercial.mock.calls.some(([p]) => p.endsWith("/enviar"))).toBe(false);
  } finally { baixar.mockRestore(); }
});

test("chat da ficha abre o mesmo atendimento e envia a devolutiva pelo canal preparado", async () => {
  const { api, conversa } = cenario();
  conversa.relacionamento = { tipo: "CLIENTE" };
  conversa.portalClientId = "empresa-da-ficha";
  conversa.empresa = { id: "empresa-da-ficha", razao: "Empresa sintética" };
  render(<ChatDaEmpresa api={api} companyId="empresa-da-ficha" usuarioId="contador-sintetico" />);
  await screen.findByLabelText("Responder ao cliente");
  fireEvent.click(screen.getByRole("button", { name: "Detalhes da conversa" }));
  await screen.findByRole("navigation", { name: "Passo a passo do lead" });
  expect(screen.getByRole("button", { name: "5. devolutiva" })).toHaveAttribute("aria-current", "step");
  expect(screen.getByLabelText("Canal do atendimento")).toHaveValue("comercial");
  fireEvent.change(screen.getByLabelText("Canal do atendimento"), { target: { value: "principal" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Enviar ao cliente" })).toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Usar Comercial — conversa aberta" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Enviar ao cliente" })).toBeEnabled());
  await waitFor(() => expect(screen.getByRole("button", { name: "Enviar ao cliente" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Enviar ao cliente" }));
  await waitFor(() => expect(api.comercial).toHaveBeenCalledWith("/onboardings/o/apresentacao/d/enviar", { conteudoHash: "hash-atual", conversaId: "recente" }));
  expect(screen.queryByText("Preparar uma nova proposta em PDF")).not.toBeInTheDocument();
  expect(api.comercial.mock.calls.some(([p]) => p.endsWith("/conferir"))).toBe(false);
});

function RouterWhatsapp({ children }) { return <MemoryRouter initialEntries={['/whatsapp']}>{children}</MemoryRouter>; }

describe("histórico público da página WhatsApp", () => {
  const routers = [];
  const originalRequest = globalThis.Request;
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    // Same installed WHATWG Request used by bootstrapDataRouter; no real fetch.
    globalThis.Request = Request;
    globalThis.fetch = jest.fn(() => { throw new Error("Network forbidden in navigation tests"); });
  });
  afterEach(() => {
    try {
      routers.splice(0).forEach(router => router.dispose());
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.Request = originalRequest;
      globalThis.fetch = originalFetch;
      jest.restoreAllMocks();
    }
  });
  const contato = id => ({ id, interlocutorId: `pessoa-${id}`, nomePerfilProvedor: `Pessoa ${id}`, relacionamento: { tipo: "A_IDENTIFICAR" }, janela: { situacao: "ABERTA" }, canalId: "principal" });
  const fio = id => ({ conversa: contato(id), mensagens: [] });
  function apiNavegacao() {
    return {
      listarConversasWhatsapp: jest.fn(async () => ({ conversas: [contato("a"), contato("b")], temMais: false })),
      getMensagensWhatsapp: jest.fn(async id => fio(id)),
      comercial: jest.fn(async () => ({ atendimento: null, anteriores: [] })),
      responderConversaWhatsapp: jest.fn(), assumirConversaWhatsapp: jest.fn(), devolverConversaWhatsapp: jest.fn(),
      marcarConversaWhatsappLida: jest.fn(), consultarSituacaoFiscal: jest.fn(),
    };
  }
  function semAtos(api) {
    for (const metodo of ["responderConversaWhatsapp", "assumirConversaWhatsapp", "devolverConversaWhatsapp", "consultarSituacaoFiscal"]) expect(api[metodo]).not.toHaveBeenCalled();
    expect(api.comercial.mock.calls.every(([, body]) => body === undefined)).toBe(true);
  }
  function montar(api, entrada = "/whatsapp?filtro=atual#lista", estrito = false) {
    let atualizar;
    function Tela() {
      const [props, setProps] = useState({ api }); atualizar = setProps;
      return <WhatsappPage {...props} />;
    }
    const router = createMemoryRouter([{ path: "*", element: estrito ? <StrictMode><Tela /></StrictMode> : <Tela /> }], { initialEntries: [entrada] });
    routers.push(router);
    const view = render(<RouterProvider router={router} />);
    return { router, ...view, atualizar: props => act(async () => atualizar(props)) };
  }
  const selecionada = id => waitFor(() => expect(screen.getByTestId(`conversa-${id}`)).toHaveAttribute("aria-current", "true"));

  test("PUSH abre pelo efeito uma vez; repeatclick não cria entrada; POP e REPLACE preservam query/hash", async () => {
    const api = apiNavegacao(), { router } = montar(api);
    fireEvent.click(await screen.findByTestId("conversa-a")); await selecionada("a");
    expect(router.state.historyAction).toBe("PUSH");
    expect(router.state.location.search).toBe("?filtro=atual&conversa=a");
    expect(router.state.location.hash).toBe("#lista");
    expect(api.getMensagensWhatsapp.mock.calls.map(([id]) => id)).toEqual(["a"]);
    const chave = router.state.location.key;
    fireEvent.click(screen.getByTestId("conversa-a"));
    expect(router.state.location.key).toBe(chave);
    expect(api.getMensagensWhatsapp).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("conversa-b")); await selecionada("b");
    await act(async () => router.navigate(-1)); await selecionada("a");
    expect(router.state.historyAction).toBe("POP");
    expect(new URLSearchParams(router.state.location.search).get("conversa")).toBe("a");
    await act(async () => router.navigate(1)); await selecionada("b");
    expect(new URLSearchParams(router.state.location.search).get("conversa")).toBe("b");
    fireEvent.click(screen.getByRole("button", { name: "Voltar para conversas" }));
    expect(router.state.historyAction).toBe("REPLACE");
    expect(router.state.location.search).toBe("?filtro=atual");
    expect(router.state.location.hash).toBe("#lista");
    expect(screen.queryByLabelText("Responder ao cliente")).not.toBeInTheDocument();
    await act(async () => router.navigate(-1)); await selecionada("a");
    semAtos(api);
  });

  test("query e hash irrelevantes não reabrem; nova API e área releem o mesmo ID", async () => {
    const api = apiNavegacao(), outra = apiNavegacao();
    const view = montar(api, "/whatsapp?conversa=a");
    await selecionada("a");
    await act(async () => view.router.navigate("/whatsapp?conversa=a&filtro=outro#detalhe"));
    expect(api.getMensagensWhatsapp).toHaveBeenCalledTimes(1);
    expect(api.marcarConversaWhatsappLida).not.toHaveBeenCalled();
    await view.atualizar({ api: outra }); await selecionada("a");
    expect(outra.getMensagensWhatsapp).toHaveBeenCalledTimes(1);
    await view.atualizar({ api: outra, area: "comercial" }); await selecionada("a");
    expect(outra.getMensagensWhatsapp).toHaveBeenCalledTimes(2);
    expect(outra.getMensagensWhatsapp).toHaveBeenLastCalledWith("a", { area: "comercial" });
    semAtos(api); semAtos(outra);
  });

  test("resposta atrasada não troca destino nem contexto da API", async () => {
    let resolver;
    const api = apiNavegacao(), outra = apiNavegacao();
    api.getMensagensWhatsapp.mockImplementationOnce(() => new Promise(resolve => { resolver = resolve; }));
    const view = montar(api, "/whatsapp?conversa=a");
    await waitFor(() => expect(api.getMensagensWhatsapp).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByTestId("conversa-b")); await selecionada("b");
    await view.atualizar({ api: outra, area: "suporte" }); await selecionada("b");
    await act(async () => resolver(fio("a")));
    expect(screen.getByTestId("conversa-b")).toHaveAttribute("aria-current", "true");
    expect(outra.getMensagensWhatsapp).toHaveBeenLastCalledWith("b", { area: "suporte" });
    semAtos(api); semAtos(outra);
  });

  test("notificação validada usa router atual, conserva rascunho e remove listener ao desmontar", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
    const worker = new EventTarget();
    const adicionar = jest.spyOn(worker, "addEventListener"), remover = jest.spyOn(worker, "removeEventListener");
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: worker });
    const pendente = jest.spyOn(rascunhos, "haRascunhoPendente").mockReturnValue(false);
    const api = apiNavegacao(), outra = apiNavegacao();
    const view = montar(api);
    const avisar = url => act(async () => worker.dispatchEvent(new MessageEvent("message", { data: { tipo: "ABRIR_CONVERSA", url } })));
    try {
      await screen.findByTestId("conversa-a");
      await view.atualizar({ api, area: "comercial" });
      await view.atualizar({ api: outra });
      expect(adicionar.mock.calls.filter(([tipo]) => tipo === "message")).toHaveLength(1);
      const chave = view.router.state.location.key;
      for (const url of ["https://externo.invalid/whatsapp?conversa=a", "/suporte?conversa=a", "/whatsapp/?conversa=a", "/suporte/?conversa=a", "/whatsapp?conversa=%2F", "http://[", "/whatsapp"]) await avisar(url);
      expect(view.router.state.location.key).toBe(chave);
      expect(outra.getMensagensWhatsapp).not.toHaveBeenCalled();
      pendente.mockReturnValue(true);
      await avisar("/whatsapp?conversa=b&app=atendimento#fio");
      fireEvent.click(screen.getByRole("button", { name: "Abrir conversa da notificação" }));
      expect(view.router.state.location.key).toBe(chave);
      expect(outra.getMensagensWhatsapp).not.toHaveBeenCalled();
      pendente.mockReturnValue(false);
      fireEvent.click(screen.getByRole("button", { name: "Abrir conversa da notificação" }));
      await selecionada("b");
      expect(view.router.state.historyAction).toBe("PUSH");
      expect(view.router.state.location.hash).toBe("#fio");
      await avisar("/whatsapp?conversa=a"); await selecionada("a");
      expect(api.getMensagensWhatsapp).not.toHaveBeenCalled();
      const final = view.router.state.location.key;
      view.unmount();
      expect(remover.mock.calls.filter(([tipo]) => tipo === "message")).toHaveLength(1);
      await avisar("/whatsapp?conversa=b");
      expect(view.router.state.location.key).toBe(final);
      semAtos(api); semAtos(outra);
    } finally {
      view.unmount();
      if (descriptor) Object.defineProperty(navigator, "serviceWorker", descriptor); else delete navigator.serviceWorker;
    }
  });

  test("StrictMode e remontagem leem o fio vigente; ausência ou ID inválido não selecionam contato", async () => {
    const api = apiNavegacao();
    const view = montar(api, "/comercial/conversas?conversa=a", true);
    await selecionada("a");
    const leituras = api.getMensagensWhatsapp.mock.calls.length;
    expect(leituras).toBeGreaterThan(0);
    view.unmount();
    const nova = montar(api, "/suporte?conversa=a", true); await selecionada("a");
    expect(api.getMensagensWhatsapp.mock.calls.length).toBeGreaterThan(leituras);
    const antes = api.getMensagensWhatsapp.mock.calls.length;
    await act(async () => nova.router.navigate("/suporte?conversa=%2F"));
    expect(screen.queryByLabelText("Responder ao cliente")).not.toBeInTheDocument();
    await act(async () => nova.router.navigate("/suporte"));
    expect(api.getMensagensWhatsapp).toHaveBeenCalledTimes(antes);
    expect(screen.getByText("Selecione uma conversa")).toBeVisible();
    semAtos(api);
  });

  test("mensagem visível confirma leitura; query/hash não repetem GET nem confirmação", async () => {
    const originalObserver = Object.getOwnPropertyDescriptor(globalThis, "IntersectionObserver");
    const observers = [];
    const confirmed = jest.fn();
    window.addEventListener("altan:whatsapp-leitura-confirmada", confirmed);
    Object.defineProperty(globalThis, "IntersectionObserver", { configurable: true, writable: true, value: jest.fn((callback, options) => {
      const observer = { callback, options, active: true, targets: new Set() };
      observers.push(observer);
      return { observe: element => observer.targets.add(element), unobserve: element => observer.targets.delete(element), disconnect: () => { observer.active = false; observer.targets.clear(); } };
    }) });
    const api = apiNavegacao();
    const message = { id: "entrada-visivel-a-1", direcao: "in", corpo: "Mensagem sintética elegível", registradaEm: "2026-09-16T12:00:00Z" };
    api.getMensagensWhatsapp.mockImplementation(async id => ({ ...fio(id), mensagens: id === "a" ? [message] : [] }));
    api.marcarConversaWhatsappLida.mockResolvedValue({ ok: true });
    let view;
    try {
      view = montar(api, "/whatsapp?conversa=a&filtro=inicial#inicio");
      await selecionada("a");
      const balloon = await screen.findByTestId(`balao-${message.id}`);
      expect(screen.getByTestId("fio")).toHaveAttribute("aria-label", "Conversa com Pessoa a");
      expect(balloon).toHaveAttribute("data-mensagem-entrada", "true");
      expect(api.getMensagensWhatsapp).toHaveBeenCalledTimes(1);
      expect(api.getMensagensWhatsapp).toHaveBeenLastCalledWith("a");
      expect(api.marcarConversaWhatsappLida).not.toHaveBeenCalled();
      expect(confirmed).not.toHaveBeenCalled();
      const notifyVisibility = async visible => {
        const observer = observers.findLast(item => item.active && item.targets.has(balloon));
        expect(observer).toBeDefined();
        expect(observer.options.root).toBe(screen.getByLabelText("Histórico de mensagens"));
        await act(async () => observer.callback([{ target: balloon, isIntersecting: visible, intersectionRatio: visible ? 1 : 0 }]));
      };
      await notifyVisibility(false);
      expect(api.marcarConversaWhatsappLida).not.toHaveBeenCalled();
      await notifyVisibility(true);
      await waitFor(() => expect(confirmed).toHaveBeenCalledTimes(1));
      expect(api.marcarConversaWhatsappLida).toHaveBeenCalledTimes(1);
      expect(api.marcarConversaWhatsappLida).toHaveBeenLastCalledWith("a", message.id);
      const readsBefore = api.getMensagensWhatsapp.mock.calls.length;
      const marksBefore = api.marcarConversaWhatsappLida.mock.calls.length;
      expect(readsBefore).toBe(1);
      expect(marksBefore).toBe(1);
      await act(async () => view.router.navigate("/whatsapp?conversa=a&filtro=outro#detalhe"));
      await selecionada("a");
      expect(view.router.state.location.pathname).toBe("/whatsapp");
      expect(view.router.state.location.search).toBe("?conversa=a&filtro=outro");
      expect(view.router.state.location.hash).toBe("#detalhe");
      expect(screen.getByTestId(`balao-${message.id}`)).toBe(balloon);
      await notifyVisibility(true);
      expect(api.getMensagensWhatsapp).toHaveBeenCalledTimes(readsBefore);
      expect(api.marcarConversaWhatsappLida).toHaveBeenCalledTimes(marksBefore);
      expect(confirmed).toHaveBeenCalledTimes(1);
      semAtos(api);
    } finally {
      view?.unmount();
      window.removeEventListener("altan:whatsapp-leitura-confirmada", confirmed);
      if (originalObserver) Object.defineProperty(globalThis, "IntersectionObserver", originalObserver);
      else delete globalThis.IntersectionObserver;
    }
  });

  test.each(["/whatsapp/", "/suporte/", "/whatsapp///", "/suporte///"])("rota aceita %s abre, repete e volta sem perder query/hash", async pathname => {
    const api = apiNavegacao();
    const { router } = montar(api, `${pathname}?filtro=barra#contexto`);
    // Public router navigation collapses repeated slashes; initial location is untouched.
    const pathnameAposNavegar = pathname.replace(/\/+$/, "/");
    expect(router.state.location.pathname).toBe(pathname);
    fireEvent.click(await screen.findByTestId("conversa-a"));
    await selecionada("a");
    expect(router.state.location.pathname).toBe(pathnameAposNavegar);
    expect(router.state.location.search).toBe("?filtro=barra&conversa=a");
    expect(router.state.location.hash).toBe("#contexto");
    expect(router.state.historyAction).toBe("PUSH");
    expect(api.getMensagensWhatsapp.mock.calls.map(([id]) => id)).toEqual(["a"]);
    const key = router.state.location.key;
    fireEvent.click(screen.getByTestId("conversa-a"));
    expect(router.state.location.key).toBe(key);
    expect(api.getMensagensWhatsapp).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("conversa-b"));
    await selecionada("b");
    await act(async () => router.navigate(-1));
    await selecionada("a");
    expect(router.state.historyAction).toBe("POP");
    expect(router.state.location.pathname).toBe(pathnameAposNavegar);
    expect(router.state.location.hash).toBe("#contexto");
    fireEvent.click(screen.getByRole("button", { name: "Voltar para conversas" }));
    await waitFor(() => expect(router.state.location.search).toBe("?filtro=barra"));
    expect(router.state.historyAction).toBe("REPLACE");
    expect(router.state.location.pathname).toBe(pathnameAposNavegar);
    expect(router.state.location.hash).toBe("#contexto");
    expect(screen.queryByLabelText("Responder ao cliente")).not.toBeInTheDocument();
    semAtos(api);
  });

  test.each(["/whatsapp/extra/", "/suporte/extra/"])("subrota não autorizada %s não abre conversa", async pathname => {
    const api = apiNavegacao();
    const { router } = montar(api, `${pathname}?conversa=a&filtro=barra#contexto`);
    const key = router.state.location.key;
    fireEvent.click(await screen.findByTestId("conversa-b"));
    await act(async () => {});
    expect(router.state.location.key).toBe(key);
    expect(router.state.location.pathname).toBe(pathname);
    expect(router.state.location.search).toBe("?conversa=a&filtro=barra");
    expect(router.state.location.hash).toBe("#contexto");
    expect(api.getMensagensWhatsapp).not.toHaveBeenCalled();
    expect(screen.queryByTestId("fio")).not.toBeInTheDocument();
    expect(api.marcarConversaWhatsappLida).not.toHaveBeenCalled();
    semAtos(api);
  });

  test.each(["/whatsapp/", "/suporte/", "/whatsapp///", "/suporte///"])("entrada inicial %s abre ID da URL preservando query/hash", async pathname => {
    const api = apiNavegacao();
    const { router } = montar(api, `${pathname}?conversa=a&filtro=entrada#inicial`);
    await selecionada("a");
    expect(router.state.location.pathname).toBe(pathname);
    expect(router.state.location.search).toBe("?conversa=a&filtro=entrada");
    expect(router.state.location.hash).toBe("#inicial");
    expect(router.state.historyAction).toBe("POP");
    expect(api.getMensagensWhatsapp.mock.calls.map(([id]) => id)).toEqual(["a"]);
    expect(screen.getByTestId("fio")).toHaveAttribute("aria-label", "Conversa com Pessoa a");
    expect(api.marcarConversaWhatsappLida).not.toHaveBeenCalled();
    semAtos(api);
  });
});

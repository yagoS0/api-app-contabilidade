import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { WhatsappPage } from "../renderWhatsappPage";

const conversa = (id, nome, naoLidas, razao = "Contabilidade Árvore") => ({
  id, portalClientId: `empresa-${id}`, empresa: { id: `empresa-${id}`, razao },
  contato: { id: `contato-${id}`, nome }, telefoneMascarado: "+55…1234",
  escopoVerificado: true, naoLidas, janela: { situacao: "ABERTA" },
  atendidaPor: "atendente-1", atendente: { nome: "Equipe" },
  updatedAt: "2026-09-07T12:00:00Z",
  ultimaMensagem: { corpo: `Mensagem de ${nome}`, registradaEm: "2026-09-07T12:00:00Z" },
});
const contatos = [conversa("a", "José Almeida", 2), conversa("b", "Joana Silva", 0), conversa("c", "Rita Souza", 1, "Beta LTDA")];

function apiLocal() {
  return {
    listarConversasWhatsapp: jest.fn(async (_filtro, opcoes = {}) => ({
      conversas: opcoes.cursor ? [conversa("d", "José Oliveira", 1)] : contatos,
      temMais: !opcoes.cursor, proximoCursor: opcoes.cursor ? null : "pagina-2",
    })),
    getMensagensWhatsapp: jest.fn(async id => ({
      conversa: [...contatos, conversa("d", "José Oliveira", 1)].find(c => c.id === id),
      mensagens: [{ id: `msg-${id}`, direcao: "in", tipo: "text", corpo: `Histórico ${id}`, registradaEm: "2026-09-07T12:00:00Z" }],
      temMais: false, proximoCursor: null,
    })),
    responderConversaWhatsapp: jest.fn(async () => ({ ok: true })),
  };
}

async function montar(api = apiLocal()) {
  render(<WhatsappPage api={api} onBack={() => {}} />);
  await screen.findByTestId("conversa-a");
  return api;
}

test("busca sem acentos e não lidas filtram somente carregadas, incluindo nova página", async () => {
  const api = await montar();
  const busca = screen.getByRole("textbox", { name: "Buscar nas conversas carregadas" });
  fireEvent.change(busca, { target: { value: "arvore" } });
  expect(screen.getByTestId("conversa-a")).toBeInTheDocument();
  expect(screen.getByTestId("conversa-b")).toBeInTheDocument();
  expect(screen.queryByTestId("conversa-c")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Não lidas" }));
  expect(screen.queryByTestId("conversa-b")).not.toBeInTheDocument();
  fireEvent.change(busca, { target: { value: "jose" } });
  expect(screen.queryByTestId("conversa-d")).not.toBeInTheDocument();
  expect(api.listarConversasWhatsapp).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Busca e filtro de não lidas aplicados às conversas carregadas.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Carregar mais conversas" }));
  await screen.findByTestId("conversa-d");
  expect(api.listarConversasWhatsapp).toHaveBeenLastCalledWith("todas", { empresa: null, cursor: "pagina-2" });
  expect(screen.getAllByTestId(/^conversa-/)).toHaveLength(2);
  fireEvent.change(busca, { target: { value: "não existe" } });
  expect(screen.getByText("Nenhuma conversa carregada corresponde à busca e aos filtros.")).toBeInTheDocument();
});

test("abrir e fechar detalhes preserva contato selecionado, histórico e rascunho", async () => {
  const api = await montar();
  fireEvent.click(screen.getByTestId("conversa-a"));
  await screen.findByTestId("balao-msg-a");
  const campo = screen.getByRole("textbox", { name: "Responder ao cliente" });
  fireEvent.change(campo, { target: { value: "Rascunho apenas para José" } });
  const botaoDetalhes = screen.getByRole("button", { name: "Detalhes da conversa" });
  botaoDetalhes.focus();
  fireEvent.click(botaoDetalhes);
  const painel = screen.getByRole("complementary", { name: "Detalhes da conversa" });
  expect(within(painel).getByText("José Almeida")).toBeInTheDocument();
  expect(within(painel).getByRole("button", { name: "Fechar detalhes" })).toHaveFocus();
  expect(screen.getByTestId("conversa-a")).toHaveAttribute("aria-current", "true");
  fireEvent.click(within(painel).getByRole("button", { name: "Fechar detalhes" }));
  expect(screen.queryByRole("complementary", { name: "Detalhes da conversa" })).not.toBeInTheDocument();
  expect(botaoDetalhes).toHaveFocus();
  fireEvent.click(botaoDetalhes);
  fireEvent.keyDown(screen.getByRole("button", { name: "Fechar detalhes" }), { key: "Escape" });
  expect(screen.queryByRole("complementary", { name: "Detalhes da conversa" })).not.toBeInTheDocument();
  expect(botaoDetalhes).toHaveFocus();
  expect(campo).toHaveValue("Rascunho apenas para José");
  expect(screen.getByTestId("balao-msg-a")).toBeInTheDocument();
  expect(api.getMensagensWhatsapp).toHaveBeenCalledTimes(1);
  expect(api.responderConversaWhatsapp).not.toHaveBeenCalled();
});

test("Enter normal não envia; Ctrl+Enter envia ao contato aberto e falha preserva o texto", async () => {
  const api = apiLocal();
  api.responderConversaWhatsapp.mockRejectedValueOnce(new Error("Serviço indisponível neste momento."));
  await montar(api);
  fireEvent.click(screen.getByTestId("conversa-a"));
  await screen.findByTestId("balao-msg-a");
  const campo = screen.getByRole("textbox", { name: "Responder ao cliente" });
  fireEvent.change(campo, { target: { value: "Primeira linha" } });
  expect(fireEvent.keyDown(campo, { key: "Enter" })).toBe(true);
  expect(api.responderConversaWhatsapp).not.toHaveBeenCalled();
  // jsdom não executa a edição nativa de textarea; explicita a quebra que Enter permite.
  fireEvent.change(campo, { target: { value: "Primeira linha\nSegunda linha" } });
  expect(fireEvent.keyDown(campo, { key: "Enter", ctrlKey: true })).toBe(false);
  await waitFor(() => expect(api.responderConversaWhatsapp).toHaveBeenCalledWith("a", "Primeira linha\nSegunda linha"));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Serviço indisponível neste momento."));
  await waitFor(() => expect(campo).not.toBeDisabled());
  expect(campo).toHaveValue("Primeira linha\nSegunda linha");
  expect(api.responderConversaWhatsapp).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("conversa-a")).toHaveAttribute("aria-current", "true");
});

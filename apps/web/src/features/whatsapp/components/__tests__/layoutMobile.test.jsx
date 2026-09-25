import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CompositorConversa } from "../CompositorConversa";
import { FioDaConversa } from "../FioDaConversa";

const conversa = { id: "cv", contato: { nome: "Contato com nome longo" }, relacionamento: { tipo: "CLIENTE" }, janela: { situacao: "ABERTA" }, escopoVerificado: true };
const matchOriginal = window.matchMedia;
beforeEach(() => { window.matchMedia = jest.fn(() => ({ matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn() })); });
afterEach(() => { window.matchMedia = matchOriginal; });
function criarHook(api = {}) { return { api, rascunhosRef: { current: new Map() }, responder: jest.fn(async () => ({ ok: true })), assumir: jest.fn(), atualizarConversa: jest.fn(), excluir: jest.fn(), marcarLida: jest.fn() }; }

test("telefone usa uma linha para escrever e abre ações sem perder texto", async () => {
  const h = criarHook({ enviarAnexoWhatsapp: jest.fn() });
  render(<CompositorConversa conversa={conversa} hook={h} />);
  const texto = screen.getByLabelText("Responder ao cliente"), enviar = screen.getByRole("button", { name: "Assumir e responder" });
  expect(texto).toHaveAttribute("rows", "1"); expect(enviar.parentElement).toBe(texto.parentElement);
  expect(screen.queryByRole("button", { name: "Anexar PDF ou imagem" })).not.toBeInTheDocument();
  fireEvent.change(texto, { target: { value: "Sua mensagem está preservada." } });
  fireEvent.click(screen.getByRole("button", { name: "Ações da mensagem e arquivos" }));
  expect(screen.getByRole("button", { name: "Anexar PDF ou imagem" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Descartar rascunho" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Fechar ações da mensagem" }));
  expect(texto).toHaveValue("Sua mensagem está preservada."); fireEvent.click(enviar);
  await waitFor(() => expect(h.responder).toHaveBeenCalledWith("cv", "Sua mensagem está preservada.", { clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/i) }));
});

test("telefone concentra busca e assumir no menu, mantendo detalhes e pendência acessíveis", async () => {
  const h = criarHook({ buscarMensagensWhatsapp: jest.fn() }), detalhes = jest.fn();
  const c = { ...conversa, pendencia: { tipo: "EMITIR_NFSE", codigo: "123456", expiraEm: "2026-09-25T20:00:00Z" } };
  render(<FioDaConversa fio={{ conversa: c, mensagens: [] }} hook={h} onVoltar={jest.fn()} onDetalhes={detalhes} />);
  const header = document.querySelector(".wa-thread-header"), menu = within(header).getByText("⋯", { selector: "summary" });
  expect(within(header).getByRole("button", { name: "Voltar para conversas" })).toBeEnabled();
  fireEvent.click(within(header).getByRole("button", { name: "Detalhes da conversa" })); expect(detalhes).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Assumir atendimento" }).closest("details")).not.toHaveAttribute("open");
  expect(screen.getByRole("button", { name: "Assumir atendimento" })).not.toBeVisible();
  fireEvent.click(menu); fireEvent.click(screen.getByRole("button", { name: "Assumir atendimento" })); expect(h.assumir).toHaveBeenCalledWith("cv");
  const pendencia = screen.getByTestId("pendencia-aberta"); expect(pendencia).not.toHaveAttribute("open");
  fireEvent.click(within(pendencia).getByText("Emissão de nota · aguarda confirmação", { selector: "summary" }));
  expect(within(pendencia).getByText("123456")).toBeVisible();
});

test("anexo incerto continua anunciado quando o painel móvel é recolhido", async () => {
  const h = criarHook({ enviarAnexoWhatsapp: jest.fn(async () => { throw Object.assign(new Error("Conferência necessária"), { status: 409, payload: { intencao: { status: "INCERTA" } } }); }), getIntencaoWhatsapp: jest.fn(async () => ({ intencao: { status: "ACEITA" } })) });
  render(<CompositorConversa conversa={conversa} hook={h} />);
  fireEvent.click(screen.getByRole("button", { name: "Ações da mensagem e arquivos" }));
  fireEvent.change(screen.getByLabelText("Arquivo para enviar no WhatsApp"), { target: { files: [new File(["%PDF"], "guia.pdf", { type: "application/pdf" })] } });
  fireEvent.click(screen.getByRole("button", { name: "Assumir e enviar anexo" }));
  await screen.findByText("Conferência necessária"); fireEvent.click(screen.getByText("Fechar", { selector: "button" }));
  fireEvent.click(screen.getByRole("button", { name: "Fechar ações da mensagem" }));
  fireEvent.click(await screen.findByRole("button", { name: "Envio aguardando confirmação · Conferir" }));
  fireEvent.click(screen.getByRole("button", { name: "Conferir envio do anexo" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Anexar PDF ou imagem" })).toBeEnabled());
  expect(h.api.enviarAnexoWhatsapp).toHaveBeenCalledTimes(1);
});

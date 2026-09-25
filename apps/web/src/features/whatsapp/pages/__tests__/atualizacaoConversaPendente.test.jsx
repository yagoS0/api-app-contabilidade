import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WhatsappPage } from "../renderWhatsappPage";

const recurso = { id: "mensagem", chave: "orientacao", tipo: "ORIENTACAO", titulo: "Orientação de teste", texto: "Olá, {{nome}}", aprovadoEm: "2026-09-21", versao: 1 };
const conversa = id => ({ id, interlocutorId: `pessoa-${id}`, nomePerfilProvedor: `Pessoa ${id}`, relacionamento: { tipo: "A_IDENTIFICAR" }, janela: { situacao: "ABERTA" }, canalId: "principal" });
function apiLocal() {
  return {
    whatsappContratoV2: true,
    listarConversasWhatsapp: jest.fn(async () => ({ conversas: [conversa("a"), conversa("b")], versaoContrato: 2 })),
    getMensagensWhatsapp: jest.fn(async id => ({ conversa: conversa(id), mensagens: [] })),
    comercial: jest.fn(async (path, body) => path === "/recursos" ? { recursos: [recurso] } : path.endsWith("/previa") ? { previa: { texto: `Olá, ${body.variaveis.nome}` } } : { atendimento: null, anteriores: [] }),
    enviarOrientacaoWhatsapp: jest.fn(),
  };
}
function respostaPendente() { let resolver; const promessa = new Promise(resolve => { resolver = resolve; }); return { promessa, resolver }; }

test("orientação enviada em A termina depois da troca para B sem reabrir A nem apagar o rascunho B", async () => {
  const api = apiLocal(), envio = respostaPendente(); api.enviarOrientacaoWhatsapp.mockReturnValue(envio.promessa);
  render(<WhatsappPage api={api} />);
  fireEvent.click(await screen.findByTestId("conversa-a"));
  fireEvent.click(await screen.findByRole("button", { name: "Mensagens rápidas" }));
  fireEvent.click(await screen.findByRole("button", { name: "Usar no chat" }));
  fireEvent.click(await screen.findByRole("button", { name: "Inserir na conversa" }));
  fireEvent.click(screen.getByRole("button", { name: /responder/i }));
  await waitFor(() => expect(api.enviarOrientacaoWhatsapp).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByTestId("conversa-b"));
  await waitFor(() => expect(screen.getByTestId("conversa-b")).toHaveAttribute("aria-current", "true"));
  fireEvent.change(screen.getByLabelText("Responder ao cliente"), { target: { value: "Rascunho da pessoa B" } });
  const leiturasAntes = api.getMensagensWhatsapp.mock.calls.length;
  await act(async () => envio.resolver({ ok: true }));
  expect(screen.getByTestId("conversa-b")).toHaveAttribute("aria-current", "true");
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Rascunho da pessoa B");
  expect(api.getMensagensWhatsapp).toHaveBeenCalledTimes(leiturasAntes);
  expect(api.listarConversasWhatsapp).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByTestId("conversa-a"));
  await waitFor(() => expect(screen.getByLabelText("Responder ao cliente")).toHaveValue(""));
});

test("criação comercial de A concluída após abrir B preserva B e seu rascunho", async () => {
  const api = apiLocal(), criacao = respostaPendente(), original = api.comercial.getMockImplementation();
  api.comercial.mockImplementation((path, body) => path === "/conversas/a/iniciar" ? criacao.promessa : original(path, body));
  render(<WhatsappPage api={api} />);
  fireEvent.click(await screen.findByTestId("conversa-a"));
  fireEvent.click(await screen.findByRole("button", { name: "Detalhes da conversa" }));
  fireEvent.change(await screen.findByLabelText("Motivo do atendimento"), { target: { value: "ABERTURA" } });
  fireEvent.click(screen.getByRole("button", { name: "Iniciar atendimento" }));
  await waitFor(() => expect(api.comercial).toHaveBeenCalledWith("/conversas/a/iniciar", { origem: "ABERTURA" }));
  fireEvent.click(screen.getByRole("button", { name: "Fechar detalhes" }));
  fireEvent.click(screen.getByTestId("conversa-b"));
  await waitFor(() => expect(screen.getByTestId("conversa-b")).toHaveAttribute("aria-current", "true"));
  fireEvent.change(screen.getByLabelText("Responder ao cliente"), { target: { value: "Rascunho B" } });
  await act(async () => criacao.resolver({ atendimento: { id: "caso-a", onboardingId: "ficha-a" } }));
  expect(screen.getByTestId("conversa-b")).toHaveAttribute("aria-current", "true");
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Rascunho B");
  expect(api.getMensagensWhatsapp.mock.calls.map(([id]) => id)).toEqual(["a", "b"]);
});

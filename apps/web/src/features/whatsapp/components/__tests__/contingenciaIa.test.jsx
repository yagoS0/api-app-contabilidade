import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WhatsappPage } from "../../pages/renderWhatsappPage";
import { ContingenciaIa } from "../ContingenciaIa";
import { ResumoPreatendimento } from "../ResumoPreatendimento";

const conversaBase = { id: "cv", contato: { nome: "Cliente teste" }, janela: { situacao: "ABERTA" }, escopoVerificado: true,
  atendidaDesde: "2026-10-13T12:00:00Z", atendidaPor: null, naoLidas: 0,
  contingenciaIa: { estado: "PENDENTE", motivo: "OPENAI_TIMEOUT", criadaEm: "2026-10-13T12:00:00Z" } };

test("pendência permanece mesmo lida; contador assume pelo fio e mantém o histórico", async () => {
  let conversa = { ...conversaBase };
  const api = {
    listarConversasWhatsapp: jest.fn(async () => ({ conversas: [conversa] })),
    getMensagensWhatsapp: jest.fn(async () => ({ conversa, mensagens: [{ id: "m", direcao: "in", tipo: "text", corpo: "Tenho débitos desde 2024", registradaEm: "2026-10-13T12:00:00Z" }] })),
    assumirConversaWhatsapp: jest.fn(async () => { conversa = { ...conversa, atendidaPor: "contador", atendente: { nome: "Ana" } }; return { ok: true }; }),
  };
  render(<WhatsappPage api={api} />);
  expect(await screen.findByText("Precisa de atendimento")).toBeVisible();
  fireEvent.click(screen.getByTestId("conversa-cv"));
  expect(await screen.findByText("IA indisponível · atendimento humano necessário")).toBeVisible();
  expect(screen.getByText("Tenho débitos desde 2024")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Assumir conversa" }));
  await waitFor(() => expect(api.assumirConversaWhatsapp).toHaveBeenCalledWith("cv"));
  expect(await screen.findByText("Responsável: Ana. A automação permanece pausada.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Assumir conversa" })).not.toBeInTheDocument();
  expect(screen.queryByText("Precisa de atendimento")).not.toBeInTheDocument();
  expect(screen.getByText("Tenho débitos desde 2024")).toBeVisible();
});

test("recusa ao assumir não apaga a pendência e permite consultar resumo", async () => {
  const assumir = jest.fn(async () => ({ ok: false })), detalhes = jest.fn();
  render(<ContingenciaIa conversa={conversaBase} hook={{ assumir }} onDetalhes={detalhes} />);
  fireEvent.click(screen.getByRole("button", { name: "Assumir conversa" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível confirmar");
  expect(screen.getByText("IA indisponível · atendimento humano necessário")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Ver resumo" })); expect(detalhes).toHaveBeenCalledTimes(1);
});

test("histórico não oferece assumir e conversa sem falha não exibe alerta", () => {
  const { rerender } = render(<ContingenciaIa conversa={conversaBase} hook={{ assumir: jest.fn() }} somenteLeitura />);
  expect(screen.queryByRole("button", { name: "Assumir conversa" })).not.toBeInTheDocument();
  rerender(<ContingenciaIa conversa={{ ...conversaBase, contingenciaIa: null }} hook={{}} />);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("não duplica a atribuição nem anuncia sucesso antes da confirmação do servidor", async () => {
  let concluir;
  const assumir = jest.fn(() => new Promise(resolve => { concluir = resolve; }));
  render(<ContingenciaIa conversa={conversaBase} hook={{ assumir }} />);
  const botao = screen.getByRole("button", { name: "Assumir conversa" });
  fireEvent.click(botao); fireEvent.click(botao);
  expect(assumir).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Assumindo…" })).toBeDisabled();
  expect(screen.queryByText("Atendimento com a equipe")).not.toBeInTheDocument();
  await act(async () => { concluir({ ok: true }); });
  expect(screen.getByText("IA indisponível · atendimento humano necessário")).toBeVisible();
});

test("devolução à automação não mantém banner de pausa de uma falha anterior", () => {
  render(<ContingenciaIa conversa={{ ...conversaBase, atendidaDesde: null, atendidaPor: null }} hook={{ assumir: jest.fn() }} />);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("falha antes de classificar intenção ainda preserva resumo para o contador", () => {
  render(<ResumoPreatendimento atendimento={{ triagem: { contingenciaIa: conversaBase.contingenciaIa,
    preatendimento: { estado: "ENCAMINHADO", nome: "Ana", ultimoRelato: "Minha empresa está com problemas" } } }} />);
  expect(screen.getByRole("heading", { name: "Atendimento inicial" })).toBeVisible();
  expect(screen.getByText("Ana")).toBeVisible();
  expect(screen.getByText("Minha empresa está com problemas")).toBeInTheDocument();
});

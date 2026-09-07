import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { WhatsappPage } from "../renderWhatsappPage";
import { ChatDaEmpresa } from "../../components/ChatDaEmpresa";
import { leituraDoResumo } from "../../lib/resumoTela";

function fixture() {
  const atual = { id: "atual", portalClientId: "empresa", telefoneE164: "5511999991234", telefoneMascarado: "+55…1234", contato: { nome: "Julia" }, empresa: { id: "empresa", razao: "Empresa Julia" }, escopoVerificado: true, janela: { situacao: "ABERTA" }, updatedAt: "2026-09-07T12:00:00Z" };
  const antigo = { ...atual, id: "antigo", escopoVerificado: false, legadoNaoVerificado: true, updatedAt: "2026-09-05T12:00:00Z", atendidaPor: "alguem" };
  const dados = [atual, antigo];
  const api = {
    listarConversasWhatsapp: jest.fn(async filtro => ({ conversas: dados.filter(c => filtro === "lixeira" ? c.excluidaEm : !c.excluidaEm && (filtro === "historico" ? !c.escopoVerificado : c.escopoVerificado)).map(c => ({ ...c })), temMais: false })),
    getMensagensWhatsapp: jest.fn(async id => ({ conversa: { ...dados.find(c => c.id === id) }, mensagens: [{ id: `m-${id}`, direcao: "in", tipo: "text", corpo: `Mensagem preservada ${id}`, registradaEm: "2026-09-05T12:00:00Z" }], temMais: false })),
    excluirConversaWhatsapp: jest.fn(async id => { dados.find(c => c.id === id).excluidaEm = "2026-09-07T12:00:00Z"; return { ok: true }; }),
    restaurarConversaWhatsapp: jest.fn(async id => { dados.find(c => c.id === id).excluidaEm = null; return { ok: true }; }),
    responderConversaWhatsapp: jest.fn(async () => ({ ok: true })),
    assumirConversaWhatsapp: jest.fn(), devolverConversaWhatsapp: jest.fn(),
  };
  return { api, dados };
}

test("empresa mostra Julia atual uma vez e consulta legado sem misturar mensagens nem perder rascunho", async () => {
  const { api } = fixture();
  render(<ChatDaEmpresa api={api} companyId="empresa" />);
  await screen.findByTestId("balao-m-atual");
  expect(screen.queryByTestId("seletor-de-contato")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Responder ao cliente"), { target: { value: "Rascunho para Julia" } });
  const filtro = screen.getByLabelText("Visualização das conversas da empresa");
  fireEvent.change(filtro, { target: { value: "historico" } });
  await screen.findByTestId("balao-m-antigo");
  expect(api.listarConversasWhatsapp).toHaveBeenLastCalledWith("historico", { empresa: "empresa" });
  expect(screen.queryByTestId("balao-m-atual")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Responder ao cliente")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Assumir|Devolver à IA/ })).not.toBeInTheDocument();
  expect(screen.getByText("Verificar vínculo e iniciar conversa atual")).toBeInTheDocument();
  fireEvent.change(filtro, { target: { value: "todas" } });
  await screen.findByTestId("balao-m-atual");
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Rascunho para Julia");
  expect(api.responderConversaWhatsapp).not.toHaveBeenCalled();
});

test("central cancela exclusão, depois move só o histórico confirmado e restaura a mesma mensagem", async () => {
  const { api } = fixture();
  render(<WhatsappPage api={api} />);
  await screen.findByTestId("conversa-atual");
  expect(screen.queryByTestId("conversa-antigo")).not.toBeInTheDocument();
  const filtro = screen.getByLabelText("Filtro das conversas");
  fireEvent.change(filtro, { target: { value: "historico" } });
  fireEvent.click(await screen.findByTestId("conversa-antigo"));
  await screen.findByTestId("balao-m-antigo");
  fireEvent.click(screen.getByRole("button", { name: "Excluir chat" }));
  let dialogo = screen.getByRole("dialog", { name: "Mover conversa para lixeira?" });
  expect(dialogo).toHaveTextContent("Julia");
  expect(dialogo).toHaveTextContent("Empresa Julia");
  expect(api.excluirConversaWhatsapp).not.toHaveBeenCalled();
  fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
  expect(api.excluirConversaWhatsapp).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Excluir chat" }));
  dialogo = screen.getByRole("dialog");
  fireEvent.click(within(dialogo).getByRole("button", { name: "Mover para lixeira" }));
  await waitFor(() => expect(screen.queryByTestId("conversa-antigo")).not.toBeInTheDocument());
  expect(screen.queryByTestId("fio")).not.toBeInTheDocument();
  expect(api.excluirConversaWhatsapp).toHaveBeenCalledTimes(1);
  expect(api.excluirConversaWhatsapp).toHaveBeenCalledWith("antigo");
  fireEvent.change(filtro, { target: { value: "lixeira" } });
  fireEvent.click(await screen.findByTestId("conversa-antigo"));
  await screen.findByTestId("balao-m-antigo");
  expect(screen.queryByLabelText("Responder ao cliente")).not.toBeInTheDocument();
  expect(screen.queryByText("Verificar vínculo e iniciar conversa atual")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Restaurar chat" }));
  await waitFor(() => expect(screen.queryByTestId("conversa-antigo")).not.toBeInTheDocument());
  fireEvent.change(filtro, { target: { value: "historico" } });
  fireEvent.click(await screen.findByTestId("conversa-antigo"));
  expect(await screen.findByTestId("balao-m-antigo")).toHaveTextContent("Mensagem preservada antigo");
  expect(api.restaurarConversaWhatsapp).toHaveBeenCalledWith("antigo");
  expect(api.responderConversaWhatsapp).not.toHaveBeenCalled();
});

test("exclusão pendente não duplica; falha preserva fio e permite tentar novamente", async () => {
  const { api } = fixture();
  let rejeitar;
  api.excluirConversaWhatsapp.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejeitar = reject; }));
  render(<WhatsappPage api={api} />);
  fireEvent.click(await screen.findByTestId("conversa-atual"));
  await screen.findByTestId("fio");
  fireEvent.change(screen.getByLabelText("Responder ao cliente"), { target: { value: "Texto preservado" } });
  fireEvent.click(screen.getByRole("button", { name: "Excluir chat" }));
  const dialogo = screen.getByRole("dialog");
  const confirmar = within(dialogo).getByRole("button", { name: "Mover para lixeira" });
  fireEvent.click(confirmar); fireEvent.click(confirmar);
  expect(api.excluirConversaWhatsapp).toHaveBeenCalledTimes(1);
  await act(async () => { rejeitar(new Error("Sem conexão para excluir.")); });
  expect(within(dialogo).getByRole("alert")).toHaveTextContent("Sem conexão para excluir.");
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Texto preservado");
  expect(confirmar).not.toBeDisabled();
  fireEvent.click(confirmar);
  await waitFor(() => expect(screen.queryByTestId("fio")).not.toBeInTheDocument());
  expect(api.excluirConversaWhatsapp).toHaveBeenCalledTimes(2);
});

test("não lidas do legado ficam explícitas no resumo mesmo sem conversas atuais pendentes", () => {
  const r = leituraDoResumo({ conversas: 1, naoVinculadas: 0, conversasNaoLidas: 0, mensagensNaoLidas: 0, historicoMensagensNaoLidas: 3, lixeiraMensagensNaoLidas: 2 });
  expect(r.selo).toBe(3);
  expect(r.frase).toContain("3 mensagens não lidas no histórico anterior");
  expect(r.frase).toContain("2 não lidas na lixeira");
});

test("falha ao restaurar mantém o histórico na lixeira e oferece nova tentativa", async () => {
  const { api, dados } = fixture();
  dados[1].excluidaEm = "2026-09-07T12:00:00Z";
  api.restaurarConversaWhatsapp.mockRejectedValueOnce(new Error("Não foi possível restaurar agora."));
  render(<WhatsappPage api={api} />);
  await screen.findByTestId("conversa-atual");
  fireEvent.change(screen.getByLabelText("Filtro das conversas"), { target: { value: "lixeira" } });
  fireEvent.click(await screen.findByTestId("conversa-antigo"));
  await screen.findByTestId("balao-m-antigo");
  fireEvent.click(screen.getByRole("button", { name: "Restaurar chat" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível restaurar agora."));
  expect(screen.getByTestId("balao-m-antigo")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Restaurar chat" })).not.toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Restaurar chat" }));
  await waitFor(() => expect(screen.queryByTestId("fio")).not.toBeInTheDocument());
  expect(api.restaurarConversaWhatsapp).toHaveBeenCalledTimes(2);
});

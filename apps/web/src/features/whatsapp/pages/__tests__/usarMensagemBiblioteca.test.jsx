import { useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { WhatsappPage } from "../renderWhatsappPage";
import { BibliotecaComercialPage } from "../../../onboarding/pages/BibliotecaComercialPage";
import { lerUsosMensagens } from "../../lib/mensagensRapidas";

const recurso = { id: "mensagem-1", tipo: "ORIENTACAO", chave: "cnpj", titulo: "Conferir empresa", texto: "Empresa {{cnpj}}", versao: 2, aprovadoEm: "2026-09-21", dados: { descricao: "Conferir os dados do atendimento." } };
const conversa = id => ({ id, portalClientId: `empresa-${id}`, empresa: { id: `empresa-${id}`, razao: `Empresa ${id}`, cnpj: "11222333000181" }, contato: { nome: `Pessoa ${id}` }, janela: { situacao: "ABERTA" }, escopoVerificado: true, ultimaMensagem: { corpo: "Olá" } });
function apiLocal() {
  return {
    listarConversasWhatsapp: jest.fn(async () => ({ conversas: [conversa("a"), conversa("b")], temMais: false })),
    getMensagensWhatsapp: jest.fn(async id => ({ conversa: conversa(id), mensagens: [], temMais: false })),
    comercial: jest.fn(async (path, body) => path === "/recursos" ? { recursos: [recurso] } : path.startsWith("/conversas/") ? { atendimento: { id: "caso", onboarding: { cnpj: "55666777000181" } } } : { previa: { texto: `Conferir empresa ${body.variaveis.cnpj}` } }),
    responderConversaWhatsapp: jest.fn(), enviarOrientacaoWhatsapp: jest.fn(),
  };
}
function Caminho({ api, iniciarNaBiblioteca = true, pedidoInicial = null }) {
  const [biblioteca, setBiblioteca] = useState(iniciarNaBiblioteca), [pedido, setPedido] = useState(pedidoInicial);
  return biblioteca ? <BibliotecaComercialPage api={api} onUsarMensagem={escolha => { setPedido(escolha); setBiblioteca(false); }} /> : <WhatsappPage api={api} usuarioId="operador" mensagemBiblioteca={pedido} onMensagemBibliotecaAberta={() => setPedido(null)} />;
}
beforeEach(() => localStorage.clear());

test("biblioteca leva à escolha do contato e à prévia, e inserir não envia", async () => {
  const api = apiLocal(); render(<Caminho api={api} />);
  fireEvent.click(await screen.findByRole("button", { name: "Usar no chat" }));
  expect(screen.getByText('Escolha uma conversa para usar “Conferir empresa”.')).toBeVisible();
  expect(api.comercial.mock.calls.some(([p]) => p.endsWith("/previa"))).toBe(false);
  fireEvent.click(await screen.findByTestId("conversa-a"));
  expect(await screen.findByText("Conferir empresa 55666777000181")).toBeVisible();
  expect(screen.getByLabelText("CNPJ")).toHaveValue("55666777000181");
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Inserir na conversa" }));
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Conferir empresa 55666777000181");
  expect(screen.queryByRole("complementary", { name: "Mensagens rápidas" })).not.toBeInTheDocument();
  expect(api.enviarOrientacaoWhatsapp).not.toHaveBeenCalled(); expect(api.responderConversaWhatsapp).not.toHaveBeenCalled();
  expect(lerUsosMensagens("operador")).toEqual({ "orientacao:cnpj": 1 });
  fireEvent.click(screen.getByTestId("conversa-b"));
  await waitFor(() => expect(screen.getByLabelText("Responder ao cliente")).toHaveValue(""));
  expect(screen.queryByRole("complementary", { name: "Mensagens rápidas" })).not.toBeInTheDocument();
});

test("mensagem pronta não substitui um rascunho existente nem conta uso", async () => {
  const api = apiLocal(); render(<Caminho api={api} iniciarNaBiblioteca={false} />);
  fireEvent.click(await screen.findByTestId("conversa-a"));
  fireEvent.change(await screen.findByLabelText("Responder ao cliente"), { target: { value: "Texto já digitado" } });
  fireEvent.click(screen.getByRole("button", { name: "Mensagens rápidas" }));
  fireEvent.click(await screen.findByRole("button", { name: "Usar no chat" }));
  fireEvent.click(await screen.findByRole("button", { name: "Inserir na conversa" }));
  expect(screen.getByRole("alert")).toHaveTextContent("já tem um rascunho");
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Texto já digitado");
  expect(lerUsosMensagens("operador")).toEqual({}); expect(api.enviarOrientacaoWhatsapp).not.toHaveBeenCalled();
});

test("trocar contato durante a preparação descarta a resposta atrasada", async () => {
  let resolver;
  const previa = new Promise(resolve => { resolver = resolve; }), api = apiLocal();
  const normal = api.comercial.getMockImplementation();
  api.comercial.mockImplementation((path, body) => path.endsWith("/previa") ? previa : normal(path, body));
  render(<Caminho api={api} iniciarNaBiblioteca={false} pedidoInicial={{ id: recurso.id, titulo: recurso.titulo }} />);
  fireEvent.click(await screen.findByTestId("conversa-a"));
  await waitFor(() => expect(api.comercial).toHaveBeenCalledWith("/recursos/mensagem-1/previa", expect.anything()));
  fireEvent.click(screen.getByTestId("conversa-b"));
  await act(async () => resolver({ previa: { texto: "Texto da pessoa anterior" } }));
  expect(screen.queryByText("Texto da pessoa anterior")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("");
  expect(api.enviarOrientacaoWhatsapp).not.toHaveBeenCalled();
});

test("rascunho da biblioteca não oferece uso e pedido indisponível não gera prévia", async () => {
  const api = apiLocal(), normal = api.comercial.getMockImplementation();
  api.comercial.mockImplementation((path, body) => path === "/recursos" ? Promise.resolve({ recursos: [{ ...recurso, aprovadoEm: null }] }) : normal(path, body));
  const view = render(<Caminho api={api} />);
  const card = (await screen.findByText("Conferir empresa")).closest("article");
  expect(within(card).queryByRole("button", { name: "Usar no chat" })).not.toBeInTheDocument();
  view.unmount();
  render(<Caminho api={api} iniciarNaBiblioteca={false} pedidoInicial={{ id: recurso.id, titulo: recurso.titulo }} />);
  fireEvent.click(await screen.findByTestId("conversa-a"));
  expect(await screen.findByRole("alert")).toHaveTextContent("mensagem não está disponível");
  expect(api.comercial.mock.calls.some(([p]) => p.endsWith("/previa"))).toBe(false);
  expect(api.enviarOrientacaoWhatsapp).not.toHaveBeenCalled();
});

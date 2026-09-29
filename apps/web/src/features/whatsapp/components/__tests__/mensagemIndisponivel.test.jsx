import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FioDaConversa } from "../FioDaConversa";
import { CompositorConversa } from "../CompositorConversa";
import { mensagemIndisponivel, PEDIDO_REENVIO } from "../../lib/mensagemIndisponivel";

const conversa = { id: "cv", interlocutorId: "pessoa", canalId: "principal", nomePerfilProvedor: "Cliente de teste",
  janela: { situacao: "ABERTA" }, atendidaPor: "u1", capacidades: { notaInterna: false } };
const pedido = () => ({ interlocutorId: "pessoa", conversaId: "cv", canalId: "principal", texto: PEDIDO_REENVIO });
const novoHook = () => ({ api: {}, rascunhosRef: { current: new Map() }, responder: jest.fn(), atualizarConversa: jest.fn() });

test("mensagem recebida sem conteúdo prepara texto editável sem enviar nem alterar o histórico", async () => {
  const hook = novoHook();
  const mensagem = { id: "indisponivel", conversaId: "cv", canal: { id: "principal" }, direcao: "in", tipo: "unsupported", corpo: null, registradaEm: "2026-09-29T11:16:40Z" };
  render(<FioDaConversa fio={{ conversa, mensagens: [mensagem] }} hook={hook} temMais={false} />);
  expect(screen.getByRole("note", { name: "Conteúdo indisponível" })).toHaveTextContent("O WhatsApp não disponibilizou");
  expect(screen.queryByTestId("midia-do-balao")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Preparar pedido de reenvio" }));
  await waitFor(() => expect(screen.getByLabelText("Responder ao cliente")).toHaveValue(PEDIDO_REENVIO));
  expect(screen.getByLabelText("Responder ao cliente")).toHaveFocus();
  expect(hook.responder).not.toHaveBeenCalled(); expect(mensagem.corpo).toBeNull();
  fireEvent.change(screen.getByLabelText("Responder ao cliente"), { target: { value: "Meu texto" } });
  fireEvent.click(screen.getByRole("button", { name: "Preparar pedido de reenvio" }));
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Meu texto");
  expect(screen.getByRole("alert")).toHaveTextContent("já tem um rascunho");
});

test.each(["out", "in"])("conteúdo disponível não recebe pedido de reenvio (%s)", direcao => {
  expect(mensagemIndisponivel({ tipo: "unsupported", direcao, corpo: "Texto real" })).toBe(false);
  expect(mensagemIndisponivel({ tipo: "unsupported", direcao, midiaProvedorId: "123" })).toBe(false);
  expect(mensagemIndisponivel({ tipo: "unsupported", direcao, arquivo: { podeAbrir: true } })).toBe(false);
  expect(mensagemIndisponivel({ tipo: "text", direcao })).toBe(false);
});

test.each([
  ["canal", { ...conversa, canalId: "comercial" }, /Selecione o canal/],
  ["segmento", { ...conversa, id: "outra-cv" }, /Selecione o canal/],
  ["janela fechada", { ...conversa, janela: { situacao: "EXPIRADA" } }, /Retome a conversa/],
])("pedido não atravessa %s", (_, alvo, aviso) => {
  const hook = novoHook(); render(<CompositorConversa conversa={alvo} hook={hook} pedidoResposta={pedido()} />);
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("");
  expect(screen.getByRole("alert")).toHaveTextContent(aviso); expect(hook.responder).not.toHaveBeenCalled();
});

test("pedido de outra pessoa é descartado; consumo não se repete em polling", () => {
  const hook = novoHook(), consumir = jest.fn(), p = pedido();
  const ui = render(<CompositorConversa conversa={{ ...conversa, interlocutorId: "outra" }} hook={hook} pedidoResposta={p} aoConsumirPedidoResposta={consumir} />);
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue(""); expect(consumir).toHaveBeenCalledTimes(1);
  ui.rerender(<CompositorConversa conversa={conversa} hook={hook} pedidoResposta={p} aoConsumirPedidoResposta={consumir} />);
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue(""); expect(hook.responder).not.toHaveBeenCalled();
});

test("pedido aguarda o rascunho remoto e não substitui texto vindo de outro aparelho", async () => {
  const hook = novoHook();
  hook.api.getRascunhoWhatsapp = jest.fn(async (_id, modo) => ({ rascunho: modo === "texto" ? { versao: 1, conteudo: { texto: "Rascunho do telefone" } } : null }));
  render(<CompositorConversa conversa={conversa} hook={hook} pedidoResposta={pedido()} />);
  await waitFor(() => expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Rascunho do telefone"));
  expect(screen.getByRole("alert")).toHaveTextContent("já tem um rascunho"); expect(hook.responder).not.toHaveBeenCalled();
});

test("envio incerto não pode ser substituído pelo pedido de reenvio", () => {
  const hook = novoHook();
  hook.rascunhosRef.current.set(JSON.stringify(["pessoa", "principal", "MENSAGEM", null]), { texto: "Mensagem pendente", envioIncerto: true });
  render(<CompositorConversa conversa={conversa} hook={hook} pedidoResposta={pedido()} />);
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Mensagem pendente");
  expect(screen.getByRole("alert")).toHaveTextContent("ação pendente"); expect(hook.responder).not.toHaveBeenCalled();
});

test("metadado temMidia conserva o tratamento do arquivo existente", () => {
  expect(mensagemIndisponivel({ direcao: "in", tipo: "unknown", temMidia: true })).toBe(false);
});

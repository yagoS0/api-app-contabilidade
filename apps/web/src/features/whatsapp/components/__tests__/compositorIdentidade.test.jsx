import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CompositorConversa } from "../CompositorConversa";
import { relacionamentoDaConversa, chaveDoRascunho } from "../../lib/identidadeAtendimento";

jest.mock("../AtendimentoComercial", () => ({ OrientacoesRapidas: ({ onPreparado }) => <button onClick={() => onPreparado({ texto: "Orientação aprovada", orientacaoId: "orientacao-1", versao: 2, variaveis: { nome: "Liz" }, atendimentoLeadId: "caso-1" })}>Preparar exemplo</button> }));

const c = {
  id: "conversa-a", interlocutorId: "liz", canalId: "principal", portalClientId: "klaus",
  janela: { situacao: "ABERTA" },
  canais: [{ id: "principal", chave: "Atendimento", conversaId: "conversa-a", janela: { situacao: "ABERTA" } }, { id: "comercial", chave: "Comercial", conversaId: "conversa-b", janela: { situacao: "ABERTA" } }],
  capacidades: { escoposNotas: [{ id: "klaus", rotulo: "Klaus Nigro", escopo: "EMPRESA", portalClientId: "klaus" }, { id: "lente", rotulo: "Lente", escopo: "EMPRESA", portalClientId: "lente" }] },
};
function hook() {
  return { api: { criarNotaInternaWhatsapp: jest.fn(), enviarOrientacaoWhatsapp: jest.fn(async () => ({ ok: true })) },
    rascunhosRef: { current: new Map() }, responder: jest.fn(async () => ({ ok: true })), salvarNota: jest.fn(async () => ({ ok: true })), abrir: jest.fn() };
}

test("número desconhecido não vira lead; relacionamento e solicitação são independentes", () => {
  expect(relacionamentoDaConversa({ portalClientId: null }).tipo).toBe("A_IDENTIFICAR");
  expect(relacionamentoDaConversa({ relacionamento: { tipo: "CLIENTE" }, solicitacaoComercial: { origem: "ABERTURA" } }).tipo).toBe("CLIENTE");
  expect(chaveDoRascunho(c, { modo: "NOTA", escopo: { portalClientId: "klaus" } })).not.toBe(chaveDoRascunho(c, { modo: "NOTA", escopo: { portalClientId: "lente" } }));
});

test("chegada em outro canal não muda remetente; rascunhos dos canais ficam separados", async () => {
  const h = hook(); const ui = render(<CompositorConversa conversa={c} hook={h} />);
  const texto = screen.getByRole("textbox", { name: "Responder ao cliente" });
  fireEvent.change(texto, { target: { value: "Mensagem pelo atendimento" } });
  ui.rerender(<CompositorConversa conversa={{ ...c, canalId: "comercial" }} hook={h} />);
  expect(screen.getByLabelText("Canal da resposta")).toHaveValue("principal");
  expect(texto).toHaveValue("Mensagem pelo atendimento");
  fireEvent.change(screen.getByLabelText("Canal da resposta"), { target: { value: "comercial" } });
  expect(texto).toHaveValue("");
  fireEvent.change(texto, { target: { value: "Mensagem comercial" } });
  fireEvent.click(screen.getByRole("button", { name: "Responder" }));
  await waitFor(() => expect(h.responder).toHaveBeenCalledWith("conversa-b", "Mensagem comercial"));
  fireEvent.change(screen.getByLabelText("Canal da resposta"), { target: { value: "principal" } });
  expect(texto).toHaveValue("Mensagem pelo atendimento");
});

test("troca de telefone no mesmo canal bloqueia envio até conferir e preserva o rascunho ao reabrir", async () => {
  const h = hook();
  const anterior = { ...c, canais: c.canais.map(canal => ({ ...canal, vinculoNumeroId: "numero-antigo", telefoneMascarado: "(21) *****-1111" })) };
  const atual = { ...anterior, canais: anterior.canais.map(canal => canal.id === "principal" ? { ...canal, conversaId: "conversa-nova", vinculoNumeroId: "numero-novo", telefoneMascarado: "(21) *****-2222" } : canal) };
  const ui = render(<CompositorConversa conversa={anterior} hook={h} />);
  fireEvent.change(screen.getByLabelText("Responder ao cliente"), { target: { value: "Texto preparado antes da associação" } });
  ui.rerender(<CompositorConversa conversa={atual} hook={h} />);
  expect(screen.getByRole("button", { name: "Responder" })).toBeDisabled();
  fireEvent.keyDown(screen.getByLabelText("Responder ao cliente"), { key: "Enter", ctrlKey: true });
  expect(h.responder).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("(21) *****-2222");
  ui.unmount(); render(<CompositorConversa conversa={atual} hook={h} />);
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Texto preparado antes da associação");
  expect(screen.getByRole("button", { name: "Responder" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Conferi o destinatário: manter este rascunho" }));
  expect(h.responder).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Responder" }));
  await waitFor(() => expect(h.responder).toHaveBeenCalledWith("conversa-nova", "Texto preparado antes da associação"));
});

test("mudança de vigência também exige conferência quando conversa e canal permanecem iguais", () => {
  const h = hook(); const anterior = { ...c, canais: c.canais.map(canal => ({ ...canal, vinculoNumeroId: "v1" })) };
  const ui = render(<CompositorConversa conversa={anterior} hook={h} />);
  fireEvent.change(screen.getByLabelText("Responder ao cliente"), { target: { value: "Mensagem na vigência anterior" } });
  ui.rerender(<CompositorConversa conversa={{ ...anterior, canais: anterior.canais.map(canal => ({ ...canal, vinculoNumeroId: "v2" })) }} hook={h} />);
  expect(screen.getByRole("button", { name: "Responder" })).toBeDisabled();
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Mensagem na vigência anterior");
  expect(h.responder).not.toHaveBeenCalled();
});

test("nota privada não usa transporte e trocar empresa conserva rascunhos separados", async () => {
  const h = hook(); render(<CompositorConversa conversa={{ ...c, janela: { situacao: "EXPIRADA" }, canais: c.canais.map(canal => ({ ...canal, janela: { situacao: "EXPIRADA" } })) }} hook={h} />);
  fireEvent.click(screen.getByRole("button", { name: /Nota interna/ }));
  fireEvent.change(screen.getByLabelText("Escopo da nota interna"), { target: { value: "klaus" } });
  const texto = screen.getByLabelText("Texto da nota interna");
  fireEvent.change(texto, { target: { value: "Somente equipe Klaus" } });
  fireEvent.change(screen.getByLabelText("Escopo da nota interna"), { target: { value: "lente" } });
  expect(texto).toHaveValue("");
  fireEvent.change(texto, { target: { value: "Somente equipe Lente" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar nota interna" }));
  await waitFor(() => expect(h.salvarNota).toHaveBeenCalledWith("conversa-a", expect.objectContaining({ texto: "Somente equipe Lente", escopo: "EMPRESA", portalClientId: "lente", chaveIdempotencia: expect.any(String) })));
  expect(h.responder).not.toHaveBeenCalled();
  expect(h.api.enviarOrientacaoWhatsapp).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Escopo da nota interna"), { target: { value: "klaus" } });
  expect(texto).toHaveValue("Somente equipe Klaus");
});
test("contexto fiscal pendente não impede resposta manual pela janela aberta", async () => {
  const h = hook(); render(<CompositorConversa conversa={{ ...c, contextoOperacional: { pendente: true }, capacidades: { fiscal: false } }} hook={h} />);
  fireEvent.change(screen.getByLabelText("Responder ao cliente"), { target: { value: "Vou conferir o seu cadastro." } });
  fireEvent.click(screen.getByRole("button", { name: "Responder" }));
  await waitFor(() => expect(h.responder).toHaveBeenCalledWith("conversa-a", "Vou conferir o seu cadastro."));
});

test("nota após falha reutiliza a chave e não limpa o conteúdo", async () => {
  const h = hook(); h.salvarNota.mockResolvedValueOnce({ ok: false, erro: new Error("Sem confirmação") });
  render(<CompositorConversa conversa={c} hook={h} />);
  fireEvent.click(screen.getByRole("button", { name: /Nota interna/ }));
  fireEvent.change(screen.getByLabelText("Escopo da nota interna"), { target: { value: "klaus" } });
  fireEvent.change(screen.getByLabelText("Texto da nota interna"), { target: { value: "Preservar esta nota" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar nota interna" }));
  await screen.findByText("Sem confirmação");
  fireEvent.click(screen.getByRole("button", { name: "Salvar nota interna" }));
  await waitFor(() => expect(h.salvarNota).toHaveBeenCalledTimes(2));
  expect(h.salvarNota.mock.calls[0][1].chaveIdempotencia).toBe(h.salvarNota.mock.calls[1][1].chaveIdempotencia);
});

test("orientação editada exige prévia e guarda origem sem certificar texto aprovado", async () => {
  const h = hook(); h.api.comercial = jest.fn();
  render(<CompositorConversa conversa={c} hook={h} />);
  fireEvent.click(screen.getByText("Preparar exemplo"));
  fireEvent.change(screen.getByLabelText("Responder ao cliente"), { target: { value: "Texto adaptado pela equipe" } });
  fireEvent.keyDown(screen.getByLabelText("Responder ao cliente"), { key: "Enter", ctrlKey: true });
  expect(h.api.enviarOrientacaoWhatsapp).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Conferi: enviar adaptação" }));
  await waitFor(() => expect(h.api.enviarOrientacaoWhatsapp).toHaveBeenCalledWith("conversa-a", { texto: "Texto adaptado pela equipe", assumir: true, orientacaoAdaptada: { id: "orientacao-1", versao: 2, atendimentoLeadId: "caso-1" } }));
  expect(h.responder).not.toHaveBeenCalled();
});

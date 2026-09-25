import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CompositorConversa } from "../CompositorConversa";
import { relacionamentoDaConversa, chaveDoRascunho } from "../../lib/identidadeAtendimento";

jest.mock("../AtendimentoComercial", () => ({ OrientacoesRapidas: ({ onPreparado }) => <button onClick={() => onPreparado({ texto: "Orientação aprovada", orientacaoId: "orientacao-1", versao: 2, variaveis: { nome: "Liz" }, atendimentoLeadId: "caso-1" })}>Preparar exemplo</button> }));

const c = {
  id: "conversa-a", interlocutorId: "liz", canalId: "principal", portalClientId: "klaus", relacionamento: { tipo: "CLIENTE" },
  janela: { situacao: "ABERTA" },
  canais: [{ id: "principal", chave: "Atendimento", conversaId: "conversa-a", janela: { situacao: "ABERTA" } }, { id: "comercial", chave: "Comercial", conversaId: "conversa-b", janela: { situacao: "ABERTA" } }],
  capacidades: { escoposNotas: [{ id: "klaus", rotulo: "Klaus Nigro", escopo: "EMPRESA", portalClientId: "klaus" }, { id: "lente", rotulo: "Lente", escopo: "EMPRESA", portalClientId: "lente" }] },
};
function hook() {
  return { api: { criarNotaInternaWhatsapp: jest.fn(), enviarOrientacaoWhatsapp: jest.fn(async () => ({ ok: true })) },
    rascunhosRef: { current: new Map() }, responder: jest.fn(async () => ({ ok: true })), salvarNota: jest.fn(async () => ({ ok: true })), abrir: jest.fn(), atualizarConversa: jest.fn() };
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
  expect(screen.queryByLabelText("Canal da resposta")).not.toBeInTheDocument();
  expect(screen.getByText(/WhatsApp Atendimento/)).toBeVisible();
  expect(texto).toHaveValue("Mensagem pelo atendimento");
  ui.rerender(<CompositorConversa conversa={c} hook={h} pedidoCanal={{ interlocutorId: "liz", canalId: "comercial" }} />);
  expect(texto).toHaveValue("");
  fireEvent.change(texto, { target: { value: "Mensagem comercial" } });
  fireEvent.click(screen.getByRole("button", { name: /responder/i }));
  await waitFor(() => expect(h.responder).toHaveBeenCalledWith("conversa-b", "Mensagem comercial", { clientRequestId: expect.any(String) }));
  ui.rerender(<CompositorConversa conversa={c} hook={h} pedidoCanal={{ interlocutorId: "liz", canalId: "principal" }} />);
  expect(texto).toHaveValue("Mensagem pelo atendimento");
});

test("troca de telefone no mesmo canal bloqueia envio até conferir e preserva o rascunho ao reabrir", async () => {
  const h = hook();
  const anterior = { ...c, canais: c.canais.map(canal => ({ ...canal, vinculoNumeroId: "numero-antigo", telefoneMascarado: "(21) *****-1111" })) };
  const atual = { ...anterior, canais: anterior.canais.map(canal => canal.id === "principal" ? { ...canal, conversaId: "conversa-nova", vinculoNumeroId: "numero-novo", telefoneMascarado: "(21) *****-2222" } : canal) };
  const ui = render(<CompositorConversa conversa={anterior} hook={h} />);
  fireEvent.change(screen.getByLabelText("Responder ao cliente"), { target: { value: "Texto preparado antes da associação" } });
  ui.rerender(<CompositorConversa conversa={atual} hook={h} />);
  expect(screen.getByRole("button", { name: /responder/i })).toBeDisabled();
  fireEvent.keyDown(screen.getByLabelText("Responder ao cliente"), { key: "Enter", ctrlKey: true });
  expect(h.responder).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("(21) *****-2222");
  ui.unmount(); render(<CompositorConversa conversa={atual} hook={h} />);
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Texto preparado antes da associação");
  expect(screen.getByRole("button", { name: /responder/i })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Conferi o destinatário: manter este rascunho" }));
  expect(h.responder).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /responder/i }));
  await waitFor(() => expect(h.responder).toHaveBeenCalledWith("conversa-nova", "Texto preparado antes da associação", { clientRequestId: expect.any(String) }));
});

test("mudança de vigência também exige conferência quando conversa e canal permanecem iguais", () => {
  const h = hook(); const anterior = { ...c, canais: c.canais.map(canal => ({ ...canal, vinculoNumeroId: "v1" })) };
  const ui = render(<CompositorConversa conversa={anterior} hook={h} />);
  fireEvent.change(screen.getByLabelText("Responder ao cliente"), { target: { value: "Mensagem na vigência anterior" } });
  ui.rerender(<CompositorConversa conversa={{ ...anterior, canais: anterior.canais.map(canal => ({ ...canal, vinculoNumeroId: "v2" })) }} hook={h} />);
  expect(screen.getByRole("button", { name: /responder/i })).toBeDisabled();
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Mensagem na vigência anterior");
  expect(h.responder).not.toHaveBeenCalled();
});

test("compositor não oferece nota nem seletor de canal; notas ficam nas ações da mensagem", () => {
  const h = hook(); render(<CompositorConversa conversa={{ ...c, janela: { situacao: "EXPIRADA" }, canais: c.canais.map(canal => ({ ...canal, janela: { situacao: "EXPIRADA" } })) }} hook={h} />);
  expect(screen.queryByRole("button", { name: /Nota interna/i })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Escopo da nota interna")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Canal da resposta")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Responder ao cliente")).toBeDisabled();
  expect(h.salvarNota).not.toHaveBeenCalled();
  expect(h.responder).not.toHaveBeenCalled();
  expect(h.api.enviarOrientacaoWhatsapp).not.toHaveBeenCalled();
});

test("mudar canal fecha a prévia de retomada e exige preparar o novo destinatário", async () => {
  const h = hook(); h.api.getRetomadaWhatsapp = jest.fn(async id => ({ disponivel: true, previaHash: id, texto: `Prévia para ${id}` }));
  const fechada = { ...c, canais: c.canais.map(canal => ({ ...canal, janela: { situacao: "EXPIRADA" } })) };
  const ui = render(<CompositorConversa conversa={fechada} hook={h} />);
  fireEvent.click(screen.getByRole("button", { name: "Retomar conversa" }));
  expect(await screen.findByText("Prévia para conversa-a")).toBeVisible();
  ui.rerender(<CompositorConversa conversa={fechada} hook={h} pedidoCanal={{ interlocutorId: "liz", canalId: "comercial" }} />);
  expect(screen.queryByText("Prévia para conversa-a")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Enviar modelo de retomada" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retomar conversa" }));
  expect(await screen.findByText("Prévia para conversa-b")).toBeVisible();
  expect(h.api.getRetomadaWhatsapp.mock.calls).toEqual([["conversa-a"], ["conversa-b"]]);
});
test("contexto fiscal pendente não impede resposta manual pela janela aberta", async () => {
  const h = hook(); render(<CompositorConversa conversa={{ ...c, contextoOperacional: { pendente: true }, capacidades: { fiscal: false } }} hook={h} />);
  fireEvent.change(screen.getByLabelText("Responder ao cliente"), { target: { value: "Vou conferir o seu cadastro." } });
  fireEvent.click(screen.getByRole("button", { name: /responder/i }));
  await waitFor(() => expect(h.responder).toHaveBeenCalledWith("conversa-a", "Vou conferir o seu cadastro.", { clientRequestId: expect.any(String) }));
});

test("lead responde pelo comercial e ignora pedido para trocar ao principal", async () => {
  const h = hook(), lead = { ...c, relacionamento: { tipo: "LEAD" } };
  const ui = render(<CompositorConversa conversa={lead} hook={h} />);
  fireEvent.change(screen.getByLabelText("Responder ao cliente"), { target: { value: "Atendimento comercial preparado." } });
  ui.rerender(<CompositorConversa conversa={lead} hook={h} pedidoCanal={{ interlocutorId: "liz", canalId: "principal" }} />);
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Atendimento comercial preparado.");
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /responder/i }));
  await waitFor(() => expect(h.responder).toHaveBeenCalledWith("conversa-b", "Atendimento comercial preparado.", { clientRequestId: expect.any(String) }));
  expect(h.responder).toHaveBeenCalledTimes(1);
});

test("lead sem comercial não envia pelo principal mesmo com janela aberta", () => {
  const h = hook();
  render(<CompositorConversa conversa={{ ...c, relacionamento: { tipo: "LEAD" }, canais: [c.canais[0]] }} hook={h} />);
  expect(screen.getByLabelText("Responder ao cliente")).toBeDisabled();
  expect(screen.getByRole("button", { name: /responder/i })).toBeDisabled();
  expect(screen.getByTestId("resposta-bloqueada")).toHaveTextContent("ainda não tem conversa nesse número");
  expect(h.responder).not.toHaveBeenCalled();
});

test("orientação editada exige prévia e guarda origem sem certificar texto aprovado", async () => {
  const h = hook(); h.api.comercial = jest.fn();
  render(<CompositorConversa conversa={c} hook={h} />);
  fireEvent.click(screen.getByText("Preparar exemplo"));
  fireEvent.change(screen.getByLabelText("Responder ao cliente"), { target: { value: "Texto adaptado pela equipe" } });
  fireEvent.keyDown(screen.getByLabelText("Responder ao cliente"), { key: "Enter", ctrlKey: true });
  expect(h.api.enviarOrientacaoWhatsapp).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Conferi: enviar adaptação" }));
  await waitFor(() => expect(h.api.enviarOrientacaoWhatsapp).toHaveBeenCalledWith("conversa-a", { texto: "Texto adaptado pela equipe", assumir: true, clientRequestId: expect.any(String), orientacaoAdaptada: { id: "orientacao-1", versao: 2, atendimentoLeadId: "caso-1" } }));
  expect(h.responder).not.toHaveBeenCalled();
});

test("descartar só apaga o rascunho do canal atual e não o restaura ao reabrir", () => {
  const h = hook(); const ui = render(<CompositorConversa conversa={c} hook={h} />);
  fireEvent.change(screen.getByLabelText("Responder ao cliente"), { target: { value: "Manter no principal" } });
  ui.rerender(<CompositorConversa conversa={c} hook={h} pedidoCanal={{ interlocutorId: "liz", canalId: "comercial" }} />);
  fireEvent.change(screen.getByLabelText("Responder ao cliente"), { target: { value: "Descartar no comercial" } });
  fireEvent.click(screen.getByRole("button", { name: "Descartar rascunho" }));
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("");
  expect(screen.getByRole("status")).toHaveTextContent("Rascunho descartado");
  ui.rerender(<CompositorConversa conversa={c} hook={h} pedidoCanal={{ interlocutorId: "liz", canalId: "principal" }} />);
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Manter no principal");
  expect(screen.queryByRole("button", { name: "Desfazer" })).not.toBeInTheDocument();
  ui.unmount(); render(<CompositorConversa conversa={{ ...c, canalId: "comercial" }} hook={h} />);
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("");
  expect(h.responder).not.toHaveBeenCalled();
});

test("desfazer descarte recupera texto e referência da mensagem rápida sem enviar", async () => {
  const h = hook(); h.api.comercial = jest.fn();
  render(<CompositorConversa conversa={c} hook={h} />);
  fireEvent.click(screen.getByText("Preparar exemplo"));
  fireEvent.click(screen.getByRole("button", { name: "Descartar rascunho" }));
  fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Orientação aprovada");
  expect(h.api.enviarOrientacaoWhatsapp).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /responder/i }));
  await waitFor(() => expect(h.api.enviarOrientacaoWhatsapp).toHaveBeenCalledWith("conversa-a", expect.objectContaining({ orientacaoId: "orientacao-1", orientacaoVersao: 2 })));
});

test("janela fechada permite descartar, sem liberar envio nem apagar a nota interna", () => {
  const h = hook();
  const chave = chaveDoRascunho(c, { canalId: "principal", modo: "MENSAGEM" });
  const chaveNota = chaveDoRascunho(c, { canalId: "principal", modo: "NOTA", escopo: c.capacidades.escoposNotas[0] });
  h.rascunhosRef.current.set(chave, "Texto preparado ontem");
  h.rascunhosRef.current.set(chaveNota, "Nota preservada");
  render(<CompositorConversa conversa={{ ...c, canais: c.canais.map(canal => ({ ...canal, janela: { situacao: "EXPIRADA" } })) }} hook={h} />);
  expect(screen.getByRole("button", { name: /responder/i })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Descartar rascunho" }));
  expect(h.rascunhosRef.current.has(chave)).toBe(false);
  expect(h.rascunhosRef.current.get(chaveNota)).toBe("Nota preservada");
  expect(screen.getByRole("button", { name: /responder/i })).toBeDisabled();
});

test("envio em andamento impede descarte", async () => {
  const h = hook(); let concluir;
  h.responder.mockImplementation(() => new Promise(resolve => { concluir = resolve; }));
  render(<CompositorConversa conversa={c} hook={h} />);
  fireEvent.change(screen.getByLabelText("Responder ao cliente"), { target: { value: "Em envio" } });
  fireEvent.click(screen.getByRole("button", { name: /responder/i }));
  expect(screen.getByRole("button", { name: "Descartar rascunho" })).toBeDisabled();
  concluir({ ok: true });
  await waitFor(() => expect(screen.getByLabelText("Responder ao cliente")).toHaveValue(""));
});

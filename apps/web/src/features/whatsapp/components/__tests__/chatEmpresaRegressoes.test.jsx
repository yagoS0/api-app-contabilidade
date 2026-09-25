import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ChatDaEmpresa } from "../ChatDaEmpresa";
import { AcoesRapidas } from "../AcoesRapidas";
import { criarAtendimentoMovelMock } from "../../../../api/mock/atendimentoMovelMock";

const EMPRESA = { id: "empresa-1", razao: "Empresa da ficha", cnpj: "12345678000190" };
const OUTRA = { id: "empresa-2", razao: "Outra empresa" };
const CONVERSA = {
  id: "conversa-escritorio", interlocutorId: "pessoa-1", canalId: "escritorio",
  nomePerfilProvedor: "Maria", telefoneE164: "5521999998888", telefoneMascarado: "+55…8888",
  contato: { id: "contato-1", nome: "Maria" }, relacionamento: { tipo: "CLIENTE" },
  portalClientId: OUTRA.id, empresa: OUTRA, empresas: [EMPRESA, OUTRA], escopoVerificado: true,
  atendimento: { id: "atendimento-1", contextoSelecionado: false, aguardandoSelecao: true },
  updatedAt: "2026-09-21T12:00:00Z", janela: { situacao: "ABERTA" },
  canais: [
    { id: "escritorio", nome: "Escritório", conversaId: "conversa-escritorio", janela: { situacao: "ABERTA" }, podeResponder: true },
    { id: "comercial", nome: "Comercial", conversaId: "conversa-comercial", janela: { situacao: "ABERTA" }, podeResponder: true },
  ],
};
const OUTRO_CONTATO = { ...CONVERSA, id: "outro-contato", interlocutorId: "pessoa-2", nomePerfilProvedor: "João", contato: { id: "contato-2", nome: "João" }, canais: null, updatedAt: "2026-09-20T12:00:00Z" };
function pendente() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function fio(conversa) { return { ok: true, conversa, mensagens: [{ id: `mensagem-${conversa.id}`, corpo: `Mensagem de ${conversa.contato.nome}`, direcao: "in", tipo: "text", registradaEm: "2026-09-21T11:00:00Z" }], temMais: false }; }
function apiFalsa(conversas = [CONVERSA], extra = {}) {
  return {
    listarConversasWhatsapp: jest.fn(async () => ({ conversas, temMais: false })),
    getMensagensWhatsapp: jest.fn(async id => fio(conversas.find(c => c.id === id))),
    responderConversaWhatsapp: jest.fn(async () => ({ ok: true })),
    listCompanyDocuments: jest.fn(async () => ({ documentos: [{ id: "doc-1", nome: "Documento.pdf", mimeType: "application/pdf" }] })),
    fetchCompanyDocumentBlob: jest.fn(async () => new Blob(["PDF sintético"], { type: "application/pdf" })),
    enviarAnexoWhatsapp: jest.fn(async () => ({ ok: true })),
    enviarDocumentoWhatsapp: jest.fn(),
    getCompanyGuides: jest.fn(async () => []),
    listarContatosWhatsapp: jest.fn(async () => ({ contatos: [{ id: "contato-1", telefoneE164: "5521999998888", optInEm: "2026-09-21" }] })),
    ...extra,
  };
}
async function prepararDocumento() {
  const summary = screen.queryByText("Guias e documentos", { selector: "summary" });
  if (summary && !summary.parentElement.open) fireEvent.click(summary);
  fireEvent.click(screen.getByTestId("acao-ENVIAR_DOCUMENTO"));
  fireEvent.change(await screen.findByLabelText("Documento a enviar"), { target: { value: "doc-1" } });
  return within(screen.getByTestId("escolha-do-envio")).getByRole("button", { name: "Enviar" });
}

test("documento vem da ficha aberta e sai no canal escolhido sem trocar contexto da IA", async () => {
  const api = apiFalsa();
  render(<ChatDaEmpresa api={api} companyId={EMPRESA.id} />);
  fireEvent.change(await screen.findByLabelText("Canal da mensagem"), { target: { value: "comercial" } });
  const enviar = await prepararDocumento();
  expect(screen.getByTestId("escolha-do-envio")).toHaveTextContent("Empresa da ficha");
  expect(screen.getByTestId("escolha-do-envio")).toHaveTextContent("WhatsApp Comercial");
  fireEvent.click(enviar);
  await waitFor(() => expect(api.enviarAnexoWhatsapp).toHaveBeenCalledWith("conversa-comercial", expect.any(File), "Empresa da ficha · Documento.pdf", { clientRequestId: expect.any(String) }));
  expect(api.fetchCompanyDocumentBlob).toHaveBeenCalledWith(EMPRESA.id, "doc-1");
  expect(api.enviarDocumentoWhatsapp).not.toHaveBeenCalled();
});

test("rascunhos de escritório e comercial ficam separados e a resposta usa o canal selecionado", async () => {
  const api = apiFalsa();
  render(<ChatDaEmpresa api={api} companyId={EMPRESA.id} />);
  const texto = await screen.findByLabelText("Responder ao cliente");
  fireEvent.change(texto, { target: { value: "Texto do escritório" } });
  fireEvent.change(screen.getByLabelText("Canal da mensagem"), { target: { value: "comercial" } });
  expect(texto).toHaveValue("");
  fireEvent.change(texto, { target: { value: "Texto comercial" } });
  fireEvent.change(screen.getByLabelText("Canal da mensagem"), { target: { value: "escritorio" } });
  expect(texto).toHaveValue("Texto do escritório");
  fireEvent.change(screen.getByLabelText("Canal da mensagem"), { target: { value: "comercial" } });
  expect(texto).toHaveValue("Texto comercial");
  fireEvent.click(screen.getByRole("button", { name: /responder/i, exact: true }));
  await waitFor(() => expect(api.responderConversaWhatsapp).toHaveBeenCalledWith("conversa-comercial", "Texto comercial", { clientRequestId: expect.any(String) }));
});

test("reordenar contatos na atualização conserva a pessoa selecionada e seu rascunho", async () => {
  const api = apiFalsa([CONVERSA, OUTRO_CONTATO]);
  render(<ChatDaEmpresa api={api} companyId={EMPRESA.id} />);
  fireEvent.change(await screen.findByLabelText("Responder ao cliente"), { target: { value: "Mensagem preparada para Maria" } });
  api.listarConversasWhatsapp.mockResolvedValue({ conversas: [{ ...OUTRO_CONTATO, updatedAt: "2026-09-22T12:00:00Z" }, CONVERSA], temMais: false });
  fireEvent.click(screen.getByRole("button", { name: "Atualizar conversa" }));
  await waitFor(() => expect(api.listarConversasWhatsapp).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText("Contato da conversa")).toHaveValue("pessoa-1");
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("Mensagem preparada para Maria");
  expect(screen.getByTestId("pessoa-da-conversa")).toHaveTextContent("Maria");
});

test("trocar de ficha descarta o rascunho anterior e ignora uma leitura tardia da outra empresa", async () => {
  const leituraAntiga = pendente();
  const api = apiFalsa([CONVERSA]);
  const ui = render(<ChatDaEmpresa api={api} companyId={EMPRESA.id} />);
  fireEvent.change(await screen.findByLabelText("Responder ao cliente"), { target: { value: "Rascunho só da primeira ficha" } });
  api.getMensagensWhatsapp.mockImplementationOnce(() => leituraAntiga.promise);
  fireEvent.click(screen.getByRole("button", { name: "Atualizar conversa" }));
  await waitFor(() => expect(api.getMensagensWhatsapp).toHaveBeenCalledTimes(2));
  ui.rerender(<ChatDaEmpresa api={api} companyId={OUTRA.id} />);
  await waitFor(() => expect(screen.getByLabelText("Responder ao cliente")).toHaveValue(""));
  await act(async () => leituraAntiga.resolve({ ...fio(CONVERSA), mensagens: [{ id: "antiga", corpo: "Não deve aparecer", direcao: "in", tipo: "text" }] }));
  expect(screen.queryByText("Não deve aparecer")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Responder ao cliente")).toHaveValue("");
  expect(api.responderConversaWhatsapp).not.toHaveBeenCalled();
});

test("envio que termina após mudar contato não reabre a pessoa anterior", async () => {
  const envio = pendente();
  const api = apiFalsa([CONVERSA, OUTRO_CONTATO], { enviarAnexoWhatsapp: jest.fn(() => envio.promise) });
  render(<ChatDaEmpresa api={api} companyId={EMPRESA.id} />);
  await screen.findByTestId("fio");
  fireEvent.click(await prepararDocumento());
  await waitFor(() => expect(api.enviarAnexoWhatsapp).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText("Contato da conversa"), { target: { value: "pessoa-2" } });
  await screen.findByTestId("balao-mensagem-outro-contato");
  await act(async () => envio.resolve({ ok: true }));
  expect(screen.getByTestId("pessoa-da-conversa")).toHaveTextContent("João");
  expect(screen.getByLabelText("Contato da conversa")).toHaveValue("pessoa-2");
  expect(api.getMensagensWhatsapp).toHaveBeenLastCalledWith("outro-contato");
});

test("falha inicial de listagem permite recuperação pelo botão atualizar", async () => {
  const api = apiFalsa();
  api.listarConversasWhatsapp.mockRejectedValueOnce(new Error("Falha temporária"));
  render(<ChatDaEmpresa api={api} companyId={EMPRESA.id} />);
  await screen.findByTestId("chat-falha");
  fireEvent.click(screen.getByRole("button", { name: "Atualizar conversa" }));
  await screen.findByTestId("fio");
  expect(screen.queryByTestId("chat-falha")).not.toBeInTheDocument();
});

test("ações usam os vínculos autorizados da pessoa mesmo sem seleção de empresa pela IA", async () => {
  const api = apiFalsa();
  render(<AcoesRapidas api={api} companyId={EMPRESA.id} conversa={{ ...CONVERSA, portalClientId: null, empresa: null }} janela={CONVERSA.janela} />);
  expect(screen.getByTestId("acao-ENVIAR_GUIA")).toBeEnabled();
  fireEvent.click(await prepararDocumento());
  await waitFor(() => expect(api.fetchCompanyDocumentBlob).toHaveBeenCalledWith(EMPRESA.id, "doc-1"));
});

test("empresa fora dos vínculos retornados não oferece envio de guias ou documentos", () => {
  render(<AcoesRapidas api={apiFalsa()} companyId="empresa-nao-autorizada" conversa={CONVERSA} janela={CONVERSA.janela} />);
  expect(screen.getByTestId("acao-ENVIAR_GUIA")).toBeDisabled();
  expect(screen.getByTestId("acao-ENVIAR_DOCUMENTO")).toBeDisabled();
});

test("falha de download permite tentar novamente porque nenhum envio foi iniciado", async () => {
  const api = apiFalsa();
  api.fetchCompanyDocumentBlob.mockRejectedValueOnce(new Error("Não foi possível baixar o documento"));
  render(<AcoesRapidas api={api} companyId={EMPRESA.id} conversa={CONVERSA} janela={CONVERSA.janela} />);
  fireEvent.click(await prepararDocumento());
  await screen.findByText("Não foi possível baixar o documento");
  expect(api.enviarAnexoWhatsapp).not.toHaveBeenCalled();
  expect(screen.queryByText(/Envio sem confirmação/)).not.toBeInTheDocument();
  const enviar = within(screen.getByTestId("escolha-do-envio")).getByRole("button", { name: "Enviar" });
  expect(enviar).toBeEnabled();
  fireEvent.click(enviar);
  await waitFor(() => expect(api.enviarAnexoWhatsapp).toHaveBeenCalledTimes(1));
});

test.each([null, "INCERTA", "PROCESSANDO", "ACEITA"])("documento com falha %s bloqueia repetição e permite conferir o resultado", async status => {
  const api = apiFalsa([CONVERSA], { enviarAnexoWhatsapp: jest.fn(async () => { throw Object.assign(new Error("Conexão interrompida"), status ? { status: 409, payload: { intencao: { status } } } : {}); }), getIntencaoWhatsapp: jest.fn(async () => ({ intencao: { status: "ACEITA" } })) });
  render(<AcoesRapidas api={api} companyId={EMPRESA.id} conversa={CONVERSA} janela={CONVERSA.janela} />);
  fireEvent.click(await prepararDocumento());
  await screen.findByText(/Envio sem confirmação/);
  expect(within(screen.getByTestId("escolha-do-envio")).getByRole("button", { name: "Enviar" })).toBeDisabled();
  expect(api.enviarAnexoWhatsapp).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Conferir resultado do documento" }));
  await waitFor(() => expect(screen.queryByTestId("escolha-do-envio")).not.toBeInTheDocument());
  expect(screen.queryByText(/Envio sem confirmação/)).not.toBeInTheDocument();
  expect(api.enviarAnexoWhatsapp).toHaveBeenCalledTimes(1);
});

test("trocar a empresa do mesmo contato conserva a intenção pendente de documento", async () => {
  const drafts = criarAtendimentoMovelMock({ conversas: [CONVERSA], usuario: () => "contador" });
  const api = apiFalsa([CONVERSA], { getRascunhoWhatsapp: drafts.getRascunhoWhatsapp, salvarRascunhoWhatsapp: drafts.salvarRascunhoWhatsapp, excluirRascunhoWhatsapp: drafts.excluirRascunhoWhatsapp,
    enviarAnexoWhatsapp: jest.fn(async () => { throw Object.assign(new Error("Conferência pendente"), { status: 409, payload: { intencao: { status: "INCERTA" } } }); }), getIntencaoWhatsapp: jest.fn(async () => ({ intencao: { status: "ACEITA" } })) });
  const ui = render(<AcoesRapidas api={api} companyId={EMPRESA.id} conversa={CONVERSA} janela={CONVERSA.janela} />);
  await waitFor(() => expect(screen.getByTestId("acao-ENVIAR_DOCUMENTO")).toBeEnabled());
  fireEvent.click(await prepararDocumento()); await screen.findByText(/Envio sem confirmação/);
  const chave = api.enviarAnexoWhatsapp.mock.calls[0][3].clientRequestId;
  ui.rerender(<AcoesRapidas api={api} companyId={OUTRA.id} conversa={CONVERSA} janela={CONVERSA.janela} />);
  await screen.findByRole("button", { name: "Conferir resultado do documento" });
  expect(screen.getByTestId("acao-ENVIAR_DOCUMENTO")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Conferir resultado do documento" }));
  await waitFor(() => expect(screen.getByTestId("acao-ENVIAR_DOCUMENTO")).toBeEnabled());
  expect(api.getIntencaoWhatsapp).toHaveBeenCalledWith(CONVERSA.id, chave); expect(api.enviarAnexoWhatsapp).toHaveBeenCalledTimes(1);
});

test("resultado incerto de documento não bloqueia o envio independente de uma guia", async () => {
  const api = apiFalsa([CONVERSA], {
    enviarAnexoWhatsapp: jest.fn(async () => { throw new Error("Conexão interrompida"); }),
    getCompanyGuides: jest.fn(async () => [{ id: "guia-1", tipo: "SIMPLES", competencia: "2026-08" }]),
    enviarGuiaWhatsapp: jest.fn(async () => ({ ok: true })),
  });
  render(<AcoesRapidas api={api} companyId={EMPRESA.id} conversa={CONVERSA} janela={CONVERSA.janela} />);
  fireEvent.click(await prepararDocumento());
  await screen.findByText(/Envio sem confirmação/);
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  fireEvent.click(screen.getByTestId("acao-ENVIAR_GUIA"));
  fireEvent.change(await screen.findByLabelText("Guia a enviar"), { target: { value: "guia-1" } });
  fireEvent.click(within(screen.getByTestId("escolha-do-envio")).getByRole("button", { name: "Enviar" }));
  await waitFor(() => expect(api.enviarGuiaWhatsapp).toHaveBeenCalledWith(EMPRESA.id, "guia-1"));
  expect(api.enviarAnexoWhatsapp).toHaveBeenCalledTimes(1);
});

test("se a janela fechar enquanto o PDF baixa, não envia nem trata como entrega incerta", async () => {
  const download = pendente();
  const api = apiFalsa([CONVERSA], { fetchCompanyDocumentBlob: jest.fn(() => download.promise) });
  const ui = render(<AcoesRapidas api={api} companyId={EMPRESA.id} conversa={CONVERSA} janela={CONVERSA.janela} />);
  fireEvent.click(await prepararDocumento());
  await waitFor(() => expect(api.fetchCompanyDocumentBlob).toHaveBeenCalledTimes(1));
  ui.rerender(<AcoesRapidas api={api} companyId={EMPRESA.id} conversa={CONVERSA} janela={{ situacao: "EXPIRADA" }} />);
  await act(async () => download.resolve(new Blob(["PDF"], { type: "application/pdf" })));
  expect(api.enviarAnexoWhatsapp).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent(/Fora da janela/);
  expect(screen.queryByText(/Envio sem confirmação/)).not.toBeInTheDocument();
});

test("canal indisponível com janela aberta bloqueia documento, mantendo guias por modelo", () => {
  render(<AcoesRapidas api={apiFalsa()} companyId={EMPRESA.id} conversa={{ ...CONVERSA, podeResponder: false }} janela={CONVERSA.janela} />);
  expect(screen.getByTestId("acao-ENVIAR_DOCUMENTO")).toBeDisabled();
  expect(screen.getByTestId("motivo-ENVIAR_DOCUMENTO")).toHaveTextContent(/canal está indisponível/);
  expect(screen.getByTestId("acao-ENVIAR_GUIA")).toBeEnabled();
});

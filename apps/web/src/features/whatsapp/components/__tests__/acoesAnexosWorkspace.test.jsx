import { Request } from "node-fetch/lib/index.js";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, Link, useLocation } from "react-router-dom";
import { WorkspaceNavigationProvider } from "../../../../app/navigation/WorkspaceNavigation";
import { AnexoDaConversa } from "../AnexoDaConversa";
import { AcoesRapidas } from "../AcoesRapidas";
import { limparRascunhosDaSessao } from "../../hooks/useRascunhoServidor";
const anterior = globalThis.Request;
beforeAll(() => { globalThis.Request = Request; }); afterAll(() => { globalThis.Request = anterior; });
let api;
afterEach(() => { if (api) limparRascunhosDaSessao(api); });
function Tela({ documento }) {
  const location = useLocation();
  const conversa = { id: "A", canalId: "principal", janela: { situacao: "ABERTA" } };
  return <><output aria-label="rota">{location.pathname}</output><Link to="/destino">Destino</Link>{documento ? <AcoesRapidas conversa={conversa} api={api} /> : <AnexoDaConversa conversa={conversa} api={api} />}</>;
}
async function montar(documento = false) {
  api = { getRascunhoWhatsapp: jest.fn(async () => ({ rascunho: { versao: 1, conteudo: documento ? { texto: "", envioIncerto: true, clientRequestId: "intencao-original" } : { texto: "" } } })),
    enviarAnexoWhatsapp: jest.fn(), excluirRascunhoWhatsapp: jest.fn(), salvarRascunhoWhatsapp: jest.fn() };
  const router = createMemoryRouter([{ path: "*", element: <WorkspaceNavigationProvider><Tela documento={documento} /></WorkspaceNavigationProvider> }], { initialEntries: ["/whatsapp"] });
  render(<RouterProvider router={router} />); await act(async () => {}); return router;
}
test("arquivo local não é anunciado guardado e descarte não faz upload", async () => {
  const router = await montar();
  fireEvent.change(screen.getByLabelText("Arquivo para enviar no WhatsApp"), { target: { files: [new File(["pdf"], "local.pdf", { type: "application/pdf" })] } });
  await act(async () => { await router.navigate("/destino"); });
  fireEvent.click(await screen.findByRole("button", { name: "Guardar e sair" }));
  expect(await screen.findByText(/não pode ser guardado como rascunho/)).toBeInTheDocument();
  expect(screen.getByLabelText("rota")).toHaveTextContent("/whatsapp");
  fireEvent.click(screen.getByRole("button", { name: "Descartar e sair" }));
  await waitFor(() => expect(screen.getByLabelText("rota")).toHaveTextContent("/destino"));
  expect(api.enviarAnexoWhatsapp).not.toHaveBeenCalled(); expect(api.salvarRascunhoWhatsapp).not.toHaveBeenCalled();
});
test("intenção incerta de documento conserva identidade e impede guardar ou descartar como texto", async () => {
  await montar(true); await screen.findByText(/Envio sem confirmação/);
  fireEvent.click(screen.getByText("Destino")); fireEvent.click(await screen.findByRole("button", { name: "Guardar e sair" }));
  expect(await screen.findByText(/Confira o resultado do documento/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Descartar e sair" }));
  expect(await screen.findByText(/Confira a tentativa de envio/)).toBeInTheDocument();
  expect(screen.getByLabelText("rota")).toHaveTextContent("/whatsapp"); expect(api.enviarAnexoWhatsapp).not.toHaveBeenCalled(); expect(api.excluirRascunhoWhatsapp).not.toHaveBeenCalled();
});

test.each(["anexo", "documento"].flatMap(tipo => ["503", "DTO inválido"].map(falha => [tipo, falha])))("%s: recuperar rascunho após %s antes do transporte conserva preparação sem enviar", async (tipo, falha) => {
  let persistido = null;
  api = {
    getRascunhoWhatsapp: jest.fn(async () => ({ rascunho: persistido })),
    salvarRascunhoWhatsapp: jest.fn(async (_, { conteudo, versao }) => {
      persistido = { versao: versao + 1, conteudo };
      if (falha === "503") throw Object.assign(new Error("Falha sintética ao confirmar rascunho"), { status: 503 });
      return { ok: true, rascunho: { versao: versao + 1 } };
    }),
    excluirRascunhoWhatsapp: jest.fn(), enviarAnexoWhatsapp: jest.fn(), enviarDocumentoWhatsapp: jest.fn(),
    listCompanyDocuments: jest.fn(async () => ({ documentos: [{ id: "doc-1", nome: "documento-sintetico.pdf", mimeType: "application/pdf" }] })),
  };
  const conversa = { id: "A", portalClientId: "empresa-1", canalId: "principal", escopoVerificado: true, janela: { situacao: "ABERTA" } };
  const arquivo = new File(["conteúdo fictício"], "local-preservado.pdf", { type: "application/pdf" });
  render(tipo === "anexo" ? <AnexoDaConversa api={api} conversa={conversa} /> : <AcoesRapidas api={api} conversa={conversa} companyId="empresa-1" janela={conversa.janela} />);
  if (tipo === "anexo") {
    await waitFor(() => expect(screen.getByRole("button", { name: "Anexar PDF ou imagem" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Arquivo para enviar no WhatsApp"), { target: { files: [arquivo] } });
    fireEvent.change(screen.getByLabelText("Legenda opcional"), { target: { value: "Legenda preservada" } });
    fireEvent.click(screen.getByRole("button", { name: "Assumir e enviar anexo" }));
  } else {
    await waitFor(() => expect(screen.getByRole("button", { name: "Enviar documento" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Enviar documento" }));
    fireEvent.change(await screen.findByLabelText("Documento a enviar"), { target: { value: "doc-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar", exact: true }));
  }
  await waitFor(() => expect(api.salvarRascunhoWhatsapp).toHaveBeenCalledTimes(1));
  const primeira = api.salvarRascunhoWhatsapp.mock.calls[0][1];
  expect(primeira.conteudo.clientRequestId).toEqual(expect.any(String));
  expect(api.enviarAnexoWhatsapp).not.toHaveBeenCalled(); expect(api.enviarDocumentoWhatsapp).not.toHaveBeenCalled();
  // A falha deve ocorrer somente depois de alcançar o PUT real da preparação.
  fireEvent.click(await screen.findByRole("button", { name: "Conferir rascunho da tentativa" }));
  await waitFor(() => expect(api.getRascunhoWhatsapp).toHaveBeenCalledTimes(2));
  fireEvent.click(await screen.findByRole("button", { name: "Usar preparação salva" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Usar preparação salva" })).not.toBeInTheDocument());
  expect(persistido.conteudo.clientRequestId).toBe(primeira.conteudo.clientRequestId);
  expect(api.salvarRascunhoWhatsapp).toHaveBeenCalledTimes(1); expect(api.excluirRascunhoWhatsapp).not.toHaveBeenCalled();
  expect(api.enviarAnexoWhatsapp).not.toHaveBeenCalled(); expect(api.enviarDocumentoWhatsapp).not.toHaveBeenCalled();
  if (tipo === "anexo") {
    expect(screen.getByText(/local-preservado.pdf/)).toBeInTheDocument(); expect(screen.getByLabelText("Legenda opcional")).toHaveValue("Legenda preservada");
    expect(screen.getByRole("button", { name: "Assumir e enviar anexo" })).toBeEnabled();
  } else {
    expect(screen.getByLabelText("Documento a enviar")).toHaveValue("doc-1"); expect(screen.getByRole("button", { name: "Enviar", exact: true })).toBeEnabled();
  }
});

test.each(["anexo", "documento"].flatMap(tipo => ["DTO inválido", "outra identidade", "GET falhou"].map(leitura => [tipo, leitura])))("%s: recuperação com %s não oferece adoção nem inicia transporte", async (tipo, leitura) => {
  let preparado;
  api = { getRascunhoWhatsapp: jest.fn().mockResolvedValueOnce({ rascunho: null }).mockImplementation(async () => {
    if (leitura === "GET falhou") throw new Error("Leitura sintética indisponível");
    return leitura === "DTO inválido" ? { ok: false } : { rascunho: { versao: 1, conteudo: { ...preparado, clientRequestId: "outra-tentativa" } } };
  }), salvarRascunhoWhatsapp: jest.fn(async (_, { conteudo }) => { preparado = conteudo; throw Object.assign(new Error("PUT sem confirmação"), { status: 503 }); }),
  excluirRascunhoWhatsapp: jest.fn(), enviarAnexoWhatsapp: jest.fn(), enviarDocumentoWhatsapp: jest.fn(),
  listCompanyDocuments: jest.fn(async () => ({ documentos: [{ id: "doc-1", nome: "documento-sintetico.pdf" }] })) };
  const conversa = { id: "A", portalClientId: "empresa-1", canalId: "principal", escopoVerificado: true, janela: { situacao: "ABERTA" } };
  render(tipo === "anexo" ? <AnexoDaConversa api={api} conversa={conversa} /> : <AcoesRapidas api={api} conversa={conversa} companyId="empresa-1" janela={conversa.janela} />);
  if (tipo === "anexo") {
    await waitFor(() => expect(screen.getByRole("button", { name: "Anexar PDF ou imagem" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Arquivo para enviar no WhatsApp"), { target: { files: [new File(["fictício"], "preservado.pdf", { type: "application/pdf" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Assumir e enviar anexo" }));
  } else {
    await waitFor(() => expect(screen.getByRole("button", { name: "Enviar documento" })).toBeEnabled()); fireEvent.click(screen.getByRole("button", { name: "Enviar documento" }));
    fireEvent.change(await screen.findByLabelText("Documento a enviar"), { target: { value: "doc-1" } }); fireEvent.click(screen.getByRole("button", { name: "Enviar", exact: true }));
  }
  await waitFor(() => expect(api.salvarRascunhoWhatsapp).toHaveBeenCalledTimes(1));
  const id = preparado.clientRequestId;
  fireEvent.click(await screen.findByRole("button", { name: "Conferir rascunho da tentativa" }));
  await screen.findByText(leitura === "GET falhou" ? "Leitura sintética indisponível" : leitura === "DTO inválido" ? "Leitura do rascunho não confirmada." : /A preparação salva não corresponde/);
  expect(screen.queryByRole("button", { name: "Usar preparação salva" })).not.toBeInTheDocument();
  expect(preparado.clientRequestId).toBe(id); expect(api.salvarRascunhoWhatsapp).toHaveBeenCalledTimes(1);
  expect(api.enviarAnexoWhatsapp).not.toHaveBeenCalled(); expect(api.enviarDocumentoWhatsapp).not.toHaveBeenCalled(); expect(api.excluirRascunhoWhatsapp).not.toHaveBeenCalled();
  if (tipo === "anexo") { expect(screen.getByText(/preservado.pdf/)).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Assumir e enviar anexo" })).toBeDisabled(); }
  else { expect(screen.getByLabelText("Documento a enviar")).toHaveValue("doc-1"); expect(screen.getByRole("button", { name: "Enviar", exact: true })).toBeDisabled(); }
});

test.each(["anexo", "documento"])("%s: ausência explícita após PUT503 permite escolher base sem reenviar; conflito tardio mantém a mesma intenção", async tipo => {
  api = { getRascunhoWhatsapp: jest.fn(async () => ({ rascunho: null })),
    salvarRascunhoWhatsapp: jest.fn().mockRejectedValueOnce(Object.assign(new Error("Preparação não confirmada"), { status: 503 }))
      .mockRejectedValueOnce(Object.assign(new Error("A gravação anterior apareceu depois da leitura"), { status: 409 })),
    excluirRascunhoWhatsapp: jest.fn(), enviarAnexoWhatsapp: jest.fn(), enviarDocumentoWhatsapp: jest.fn(),
    listCompanyDocuments: jest.fn(async () => ({ documentos: [{ id: "doc-1", nome: "documento-sintetico.pdf" }] })) };
  const conversa = { id: "A", portalClientId: "empresa-1", canalId: "principal", escopoVerificado: true, janela: { situacao: "ABERTA" } };
  render(tipo === "anexo" ? <AnexoDaConversa api={api} conversa={conversa} /> : <AcoesRapidas api={api} conversa={conversa} companyId="empresa-1" janela={conversa.janela} />);
  const nomeEnviar = tipo === "anexo" ? "Assumir e enviar anexo" : "Enviar";
  if (tipo === "anexo") {
    await waitFor(() => expect(screen.getByRole("button", { name: "Anexar PDF ou imagem" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Arquivo para enviar no WhatsApp"), { target: { files: [new File(["fictício"], "arquivo-local.pdf", { type: "application/pdf" })] } });
  } else {
    await waitFor(() => expect(screen.getByRole("button", { name: "Enviar documento" })).toBeEnabled()); fireEvent.click(screen.getByRole("button", { name: "Enviar documento" }));
    fireEvent.change(await screen.findByLabelText("Documento a enviar"), { target: { value: "doc-1" } });
  }
  fireEvent.click(screen.getByRole("button", { name: nomeEnviar, exact: true }));
  await waitFor(() => expect(api.salvarRascunhoWhatsapp).toHaveBeenCalledTimes(1));
  const intencao = api.salvarRascunhoWhatsapp.mock.calls[0][1].conteudo.clientRequestId;
  expect(intencao).toEqual(expect.any(String)); expect(api.enviarAnexoWhatsapp).not.toHaveBeenCalled(); expect(api.enviarDocumentoWhatsapp).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "Conferir rascunho da tentativa" }));
  await waitFor(() => expect(api.getRascunhoWhatsapp).toHaveBeenCalledTimes(2));
  fireEvent.click(await screen.findByRole("button", { name: "Manter preparação local" }));
  await waitFor(() => expect(screen.getByRole("button", { name: nomeEnviar, exact: true })).toBeEnabled());
  expect(api.salvarRascunhoWhatsapp).toHaveBeenCalledTimes(1); expect(api.excluirRascunhoWhatsapp).not.toHaveBeenCalled();
  expect(api.enviarAnexoWhatsapp).not.toHaveBeenCalled(); expect(api.enviarDocumentoWhatsapp).not.toHaveBeenCalled();
  if (tipo === "anexo") expect(screen.getByText(/arquivo-local.pdf/)).toBeInTheDocument();
  else expect(screen.getByLabelText("Documento a enviar")).toHaveValue("doc-1");
  // Somente este novo clique solicita CAS; a base vazia lida não garante que
  // o PUT anterior nunca persistirá. Uma chegada tardia deve produzir conflito.
  fireEvent.click(screen.getByRole("button", { name: nomeEnviar, exact: true }));
  await waitFor(() => expect(api.salvarRascunhoWhatsapp).toHaveBeenCalledTimes(2));
  expect(api.salvarRascunhoWhatsapp.mock.calls[1][1]).toEqual(expect.objectContaining({ versao: 0, conteudo: expect.objectContaining({ clientRequestId: intencao }) }));
  await waitFor(() => expect(screen.getByRole("button", { name: nomeEnviar, exact: true })).toBeDisabled());
  expect(await screen.findByRole("button", { name: "Conferir rascunho da tentativa" })).toBeEnabled();
  expect(api.enviarAnexoWhatsapp).not.toHaveBeenCalled(); expect(api.enviarDocumentoWhatsapp).not.toHaveBeenCalled(); expect(api.excluirRascunhoWhatsapp).not.toHaveBeenCalled();
});

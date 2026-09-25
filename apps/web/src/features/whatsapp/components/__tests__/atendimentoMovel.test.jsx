import { act, fireEvent, render, screen, waitFor, renderHook } from "@testing-library/react";
import { CompositorConversa } from "../CompositorConversa";
import { CartaoArquivoMensagem } from "../CartaoArquivoMensagem";
import { BuscaMensagens } from "../BuscaMensagens";
import { RetomarConversa } from "../RetomarConversa";
import { AnexoDaConversa } from "../AnexoDaConversa";
import { FioDaConversa } from "../FioDaConversa";
import { useRascunhoServidor, haRascunhoPendente, limparRascunhosDaSessao } from "../../hooks/useRascunhoServidor";
import { criarAtendimentoMovelMock } from "../../../../api/mock/atendimentoMovelMock";
import { destinoInternoSeguro } from "../../lib/atendimentoPwa";

const conversa = { id: "cv", interlocutorId: "pessoa", contato: { nome: "Contato de teste" }, janela: { situacao: "ABERTA" } };
function apiDraft() {
  let draft = null;
  return {
    getRascunhoWhatsapp: jest.fn(async () => ({ rascunho: draft })),
    salvarRascunhoWhatsapp: jest.fn(async (id, { versao, conteudo }) => { if (versao !== (draft?.versao || 0)) throw Object.assign(new Error("Conflito"), { status: 409 }); draft = { versao: versao + 1, conteudo }; return { rascunho: draft }; }),
    excluirRascunhoWhatsapp: jest.fn(async () => { draft = { versao: (draft?.versao || 0) + 1, conteudo: { texto: "" } }; return { versao: draft.versao }; }),
  };
}
test("destino de login conserva conversa e recusa redirecionamento externo ou disfarçado", () => {
  expect(destinoInternoSeguro("/whatsapp?app=atendimento&conversa=cv")).toBe("/whatsapp?app=atendimento&conversa=cv");
  for (const url of ["//evil.test", "/\\evil.test", "https://evil.test", "/login?redirect=//evil.test", "/nao-existe"]) expect(destinoInternoSeguro(url)).toBe("/companies");
});
test("rascunho recupera servidor e exclusão mantém versão para próxima mensagem", async () => {
  const api = apiDraft(), restaurar = jest.fn();
  const { result } = renderHook(() => useRascunhoServidor({ api, conversaId: "cv", onRestaurar: restaurar }));
  await waitFor(() => expect(result.current.pronto).toBe(true));
  await act(async () => result.current.salvar({ texto: "Primeiro" }, true));
  await act(async () => result.current.excluir());
  await act(async () => result.current.salvar({ texto: "Segundo" }, true));
  expect(api.salvarRascunhoWhatsapp).toHaveBeenLastCalledWith("cv", { modo: "texto", versao: 2, conteudo: { texto: "Segundo" } });
});
test("conflito entre aparelhos preserva texto e exige comparação antes de sobrescrever", async () => {
  const api = apiDraft();
  const { result } = renderHook(() => useRascunhoServidor({ api, conversaId: "cv" }));
  await waitFor(() => expect(result.current.pronto).toBe(true));
  await api.salvarRascunhoWhatsapp("cv", { versao: 0, conteudo: { texto: "Outro aparelho" } });
  await act(async () => result.current.salvar({ texto: "Meu texto" }, true));
  expect(result.current.estado).toBe("conflito"); expect(result.current.pronto).toBe(false);
  expect((await api.getRascunhoWhatsapp("cv")).rascunho.conteudo.texto).toBe("Outro aparelho");
  await act(async () => { expect(await result.current.conferir()).toEqual({ texto: "Outro aparelho" }); });
  await act(async () => result.current.resolverConflito({ texto: "Texto conferido" }));
  expect((await api.getRascunhoWhatsapp("cv")).rascunho.conteudo.texto).toBe("Texto conferido");
});
test.each([null, "INCERTA", "PROCESSANDO", "ACEITA"])("falha %s conserva intenção e consulta resultado sem segundo transporte", async status => {
  const api = { ...apiDraft(), getIntencaoWhatsapp: jest.fn(async () => ({ intencao: { status: "ACEITA" } })) };
  const erro = Object.assign(new Error("Conexão interrompida"), status ? { status: 409, payload: { intencao: { status } } } : {});
  const hook = { api, rascunhosRef: { current: new Map() }, responder: jest.fn(async () => ({ ok: false, erro })), atualizarConversa: jest.fn() };
  render(<CompositorConversa conversa={conversa} hook={hook} />);
  await waitFor(() => expect(screen.getByLabelText("Responder ao cliente")).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Responder ao cliente"), { target: { value: "Vamos conferir suas guias." } });
  fireEvent.click(screen.getByRole("button", { name: "Assumir e responder" }));
  const conferir = await screen.findByRole("button", { name: "Conferir resultado do envio" });
  await waitFor(() => expect(conferir).toBeEnabled());
  expect(hook.responder).toHaveBeenCalledTimes(1);
  const id = hook.responder.mock.calls[0][2].clientRequestId;
  expect(api.salvarRascunhoWhatsapp.mock.calls.some(([, body]) => body.conteudo.clientRequestId === id && body.conteudo.envioIncerto)).toBe(true);
  fireEvent.click(conferir);
  await waitFor(() => expect(screen.getByLabelText("Responder ao cliente")).toHaveValue(""));
  expect(api.getIntencaoWhatsapp).toHaveBeenCalledWith("cv", id); expect(hook.responder).toHaveBeenCalledTimes(1);
});
test("cartões distinguem guia aceita, tentativa incerta e versão legada", () => {
  const guia = { empresa: "Empresa de teste", tipo: "DAS", competencia: "2026-08", valor: 120.34, vencimento: "2026-09-21", origem: "ORIGINAL_REGISTRADO", arquivo: { nomeArquivo: "das.pdf", origem: "ORIGINAL_REGISTRADO", podeAbrir: true } };
  const api = { getArquivoMensagemWhatsapp: jest.fn() };
  const ui = render(<CartaoArquivoMensagem mensagem={{ id: "m", statusEnvio: "enviado", cartaoGuia: guia }} conversaId="cv" api={api} />);
  expect(screen.getByText("Empresa de teste")).toBeVisible(); expect(screen.getByText(/120,34/)).toBeVisible(); expect(screen.getByRole("button", { name: "Abrir PDF enviado" })).toBeEnabled();
  ui.rerender(<CartaoArquivoMensagem mensagem={{ id: "m", statusEnvio: "indeterminado", cartaoGuia: guia }} conversaId="cv" api={api} />);
  expect(screen.queryByRole("button", { name: "Abrir PDF enviado" })).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "Abrir PDF da tentativa" })).toBeEnabled();
  ui.rerender(<CartaoArquivoMensagem mensagem={{ id: "m", cartaoGuia: { ...guia, origem: "RECUPERADO_DO_VINCULO" } }} conversaId="cv" api={api} />);
  expect(screen.getByText(/versão enviada não foi comprovada/)).toBeVisible(); expect(screen.getByRole("button", { name: "Abrir documento associado" })).toBeEnabled();
});
test("retomada só consulta modelo ao pedir e nunca promete janela aberta", async () => {
  const api = { getRetomadaWhatsapp: jest.fn(async () => ({ disponivel: false, motivo: "MODELO_NAO_APROVADO", message: "Modelo não aprovado" })), retomarConversaWhatsapp: jest.fn() };
  render(<RetomarConversa api={api} conversa={conversa} />);
  expect(api.getRetomadaWhatsapp).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "Retomar conversa" }));
  expect(await screen.findByText("Modelo não aprovado")).toBeVisible(); expect(screen.queryByRole("button", { name: "Enviar modelo de retomada" })).not.toBeInTheDocument(); expect(api.retomarConversaWhatsapp).not.toHaveBeenCalled();
});
test("voltar à lista suspende inclusive callback de leitura que já estava na fila", () => {
  let callback; global.IntersectionObserver = jest.fn(cb => { callback = cb; return { observe: jest.fn(), disconnect: jest.fn() }; });
  const hook = { api: {}, marcarLida: jest.fn(), rascunhosRef: { current: new Map() } };
  const fio = { conversa, mensagens: [{ id: "m", direcao: "in", corpo: "Mensagem", registradaEm: "2026-09-25T12:00:00Z" }] };
  const ui = render(<FioDaConversa fio={fio} hook={hook} />), balao = screen.getByTestId("balao-m");
  ui.rerender(<FioDaConversa visivel={false} fio={fio} hook={hook} />);
  act(() => callback([{ target: balao, isIntersecting: true, intersectionRatio: 1 }])); expect(hook.marcarLida).not.toHaveBeenCalled(); delete global.IntersectionObserver;
});
test("mock tem idempotência, isolamento por usuário e tombstone igual ao real", async () => {
  let usuario = "a"; const c = { ...conversa, mensagens: [] }, api = criarAtendimentoMovelMock({ conversas: [c], usuario: () => usuario });
  await api.responderConversaWhatsapp("cv", "Olá", { clientRequestId: "pedido" }); await api.responderConversaWhatsapp("cv", "Olá", { clientRequestId: "pedido" });
  expect(c.mensagens).toHaveLength(1); expect(c.atendidaPor).toBeTruthy();
  await api.salvarRascunhoWhatsapp("cv", { versao: 0, conteudo: { texto: "Privado" } });
  usuario = "b"; expect((await api.getRascunhoWhatsapp("cv")).rascunho).toBeNull(); usuario = "a";
  await api.excluirRascunhoWhatsapp("cv", 1);
  await expect(api.salvarRascunhoWhatsapp("cv", { versao: 1, conteudo: { texto: "Antigo" } })).rejects.toMatchObject({ status: 409 });
});

test("retornar à conversa recupera conflito local sem substituí-lo pelo servidor", async () => {
  const api = apiDraft(), restaurar = jest.fn();
  const um = renderHook(() => useRascunhoServidor({ api, conversaId: "cv", onRestaurar: restaurar }));
  await waitFor(() => expect(um.result.current.pronto).toBe(true));
  await api.salvarRascunhoWhatsapp("cv", { versao: 0, conteudo: { texto: "Servidor" } });
  await act(async () => um.result.current.salvar({ texto: "Local preservado" }, true)); um.unmount();
  const dois = renderHook(() => useRascunhoServidor({ api, conversaId: "cv", onRestaurar: restaurar }));
  expect(dois.result.current.estado).toBe("conflito"); expect(restaurar).toHaveBeenLastCalledWith({ texto: "Local preservado" });
  await act(async () => { await dois.result.current.conferir(); await dois.result.current.resolverConflito(); });
  expect(dois.result.current.estado).toBe("salvo"); limparRascunhosDaSessao(api);
});
test("conclusão tardia da conversa A não apaga o rascunho da conversa B", async () => {
  const api = criarAtendimentoMovelMock({ conversas: [{ id: "a" }, { id: "b" }], usuario: () => "mesmo-usuario" });
  const { result, rerender } = renderHook(({ id }) => useRascunhoServidor({ api, conversaId: id }), { initialProps: { id: "a" } });
  await waitFor(() => expect(result.current.pronto).toBe(true));
  await act(async () => result.current.salvar({ texto: "Mensagem A" }, true)); const antiga = result.current;
  rerender({ id: "b" }); await waitFor(() => expect(result.current.pronto).toBe(true));
  await act(async () => result.current.salvar({ texto: "Rascunho B" }, true));
  await act(async () => antiga.excluir());
  expect((await api.getRascunhoWhatsapp("a")).rascunho.conteudo.texto).toBe("");
  expect((await api.getRascunhoWhatsapp("b")).rascunho.conteudo.texto).toBe("Rascunho B"); limparRascunhosDaSessao(api);
});

test("busca renderiza resultados do contrato real e abre a mensagem encontrada", async () => {
  const mensagem = { id: "antiga", conversaId: "cv", corpo: "Guia do DAS de agosto", registradaEm: "2026-08-20T12:00:00Z" };
  const api = { buscarMensagensWhatsapp: jest.fn(async () => ({ ok: true, resultados: [mensagem], proximoCursor: "continuar" })) }, onIr = jest.fn();
  render(<BuscaMensagens api={api} conversaId="cv" onFechar={jest.fn()} onIr={onIr} />);
  fireEvent.change(screen.getByLabelText("Texto, competência ou documento"), { target: { value: "DAS" } }); fireEvent.click(screen.getByRole("button", { name: "Buscar mensagens" }));
  expect(await screen.findByText("Guia do DAS de agosto")).toBeVisible(); fireEvent.click(screen.getByRole("button", { name: "Ver no histórico" })); expect(onIr).toHaveBeenCalledWith(mensagem);
  expect(screen.getByRole("button", { name: "Mais resultados" })).toBeEnabled();
});

test.each([null, "INCERTA", "PROCESSANDO", "ACEITA"])("retomada %s sobrevive à remontagem e consulta a mesma intenção sem outro template", async status => {
  const api = { ...apiDraft(), getRetomadaWhatsapp: jest.fn(async () => ({ disponivel: true, texto: "Podemos continuar o atendimento?", previaHash: "hash-previa" })), retomarConversaWhatsapp: jest.fn(async () => { throw Object.assign(new Error("Conexão perdida"), status ? { status: 409, payload: { intencao: { status } } } : {}); }), getIntencaoWhatsapp: jest.fn(async () => ({ intencao: { status: "ACEITA" } })) };
  const ui = render(<RetomarConversa api={api} conversa={conversa} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Retomar conversa" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Retomar conversa" })); fireEvent.click(await screen.findByRole("button", { name: "Enviar modelo de retomada" }));
  await waitFor(() => expect(api.retomarConversaWhatsapp).toHaveBeenCalledTimes(1));
  await screen.findByText(/Envio de retomada sem confirmação/); const pedido = api.retomarConversaWhatsapp.mock.calls[0][1]; ui.unmount();
  render(<RetomarConversa api={api} conversa={conversa} />); fireEvent.click(await screen.findByRole("button", { name: "Conferir retomada pendente" }));
  fireEvent.click(screen.getByRole("button", { name: "Conferir resultado da retomada" }));
  await screen.findByText(/Modelo aceito pelo WhatsApp/); expect(api.getIntencaoWhatsapp).toHaveBeenCalledWith("cv", pedido.clientRequestId); expect(api.retomarConversaWhatsapp).toHaveBeenCalledTimes(1); expect(api.getRetomadaWhatsapp).toHaveBeenCalledTimes(1); limparRascunhosDaSessao(api);
});

test.each(["INCERTA", "PROCESSANDO", "ACEITA"])("anexo HTTP409 com intenção %s bloqueia novo arquivo até conferir a mesma chave", async status => {
  const api = { ...apiDraft(), enviarAnexoWhatsapp: jest.fn(async () => { throw Object.assign(new Error("Envio aguardando conferência"), { status: 409, payload: { intencao: { status } } }); }), getIntencaoWhatsapp: jest.fn(async () => ({ intencao: { status: "ACEITA" } })) };
  render(<AnexoDaConversa api={api} conversa={conversa} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Anexar PDF ou imagem" })).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Arquivo para enviar no WhatsApp"), { target: { files: [new File(["%PDF teste"], "guia.pdf", { type: "application/pdf" })] } });
  fireEvent.click(screen.getByRole("button", { name: "Assumir e enviar anexo" }));
  await waitFor(() => expect(api.enviarAnexoWhatsapp).toHaveBeenCalledTimes(1));
  await screen.findByText("Envio aguardando conferência");
  await waitFor(() => expect(screen.getByRole("button", { name: "Assumir e enviar anexo" })).toBeDisabled());
  fireEvent.click(screen.getByText("Fechar", { selector: "button" }));
  expect(screen.getByRole("button", { name: "Anexar PDF ou imagem" })).toBeDisabled();
  const id = api.enviarAnexoWhatsapp.mock.calls[0][3].clientRequestId;
  fireEvent.click(screen.getByRole("button", { name: "Conferir envio do anexo" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Anexar PDF ou imagem" })).toBeEnabled());
  expect(api.getIntencaoWhatsapp).toHaveBeenCalledWith("cv", id); expect(api.enviarAnexoWhatsapp).toHaveBeenCalledTimes(1);
  limparRascunhosDaSessao(api);
});
test("anexo simulado conserva arquivo/card, assume atendimento e deduplica a tentativa", async () => {
  const c = { ...conversa, mensagens: [] }, api = criarAtendimentoMovelMock({ conversas: [c], usuario: () => "equipe" });
  const arquivo = new File(["%PDF-1.4 exemplo"], "guia-teste.pdf", { type: "application/pdf" });
  const r = await api.enviarAnexoWhatsapp("cv", arquivo, "Arquivo para conferência", { clientRequestId: "anexo-1" });
  await api.enviarAnexoWhatsapp("cv", arquivo, "Arquivo para conferência", { clientRequestId: "anexo-1" });
  expect(c.mensagens).toHaveLength(1); expect(c.atendidaPor).toBeTruthy(); expect(r.mensagem.arquivo).toMatchObject({ nomeArquivo: "guia-teste.pdf", podeAbrir: true });
  expect((await api.getArquivoMensagemWhatsapp("cv", r.mensagem.id)).arquivo.base64).toBe(btoa("%PDF-1.4 exemplo"));
  c.janela = { situacao: "EXPIRADA" }; await expect(api.enviarAnexoWhatsapp("cv", arquivo)).rejects.toMatchObject({ status: 409, code: "FORA_DA_JANELA" });
});

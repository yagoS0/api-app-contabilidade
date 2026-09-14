import { act, renderHook, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useConversasWhatsapp } from "../../hooks/useConversasWhatsapp";
import { FioDaConversa } from "../FioDaConversa";

const empresas = [{ id: "a", razao: "Empresa A", cnpj: "12345678000195", conversaId: "ca" }, { id: "b", razao: "Empresa B", cnpj: "11444777000161", conversaId: "cb" }];
const conversa = (id = "ca", selecionado = true) => ({ id, portalClientId: id === "ca" ? "a" : "b", empresa: empresas[id === "ca" ? 0 : 1], contato: { nome: "Responsável teste" }, escopoVerificado: true, janela: { situacao: "ABERTA" }, empresas,
  atendimento: { id: "at", versao: 1, empresaAtualId: "a", empresaAtual: empresas[0], contextoSelecionado: selecionado, aguardandoSelecao: !selecionado } });
const mensagem = (id, empresa) => ({ id, empresa, direcao: "in", tipo: "text", corpo: `Pedido ${id}`, registradaEm: "2026-09-10T12:00:00Z" });
const apiBase = () => ({ listarConversasWhatsapp: jest.fn(async () => ({ conversas: [conversa()], temMais: false })), getMensagensWhatsapp: jest.fn(async id => ({ conversa: conversa(id), mensagens: [], temMais: false })) });

test("histórico por pessoa mostra origem dos balões e empresa selecionada sem seletores", () => {
  const assumir = jest.fn();
  render(<FioDaConversa fio={{ conversa: conversa(), mensagens: [mensagem("m1", empresas[1]), mensagem("m2", null)] }} hook={{ assumir }} />);
  expect(screen.getByTestId("empresa-mensagem-m1")).toHaveTextContent("Empresa B");
  expect(screen.getByTestId("contexto-empresa")).toHaveTextContent("Empresa selecionada no atendimento automático: Empresa A");
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Assumir" })); expect(assumir).toHaveBeenCalledWith("ca");
});
test("sem empresa escolhida o escritório responde, mas ações financeiras continuam indisponíveis", () => {
  render(<FioDaConversa fio={{ conversa: conversa("ca", false), mensagens: [] }} hook={{}} slotAcoes={<button>Enviar guia</button>} />);
  expect(screen.getByRole("textbox", { name: "Responder ao cliente" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Enviar guia" })).not.toBeInTheDocument();
});
test("abrir empresa oferece as empresas sem trocar o contexto da automação", () => {
  const selecionarEmpresa=jest.fn();
  render(<FioDaConversa fio={{ conversa: conversa(), mensagens: [] }} hook={{ selecionarEmpresa }} hrefDaEmpresa={id => "/empresa/"+id} />);
  fireEvent.click(screen.getByRole("button", { name: "Abrir a empresa →" }));
  expect(screen.getByRole("link", { name: "Empresa A" })).toHaveAttribute("href", "/empresa/a");
  expect(screen.getByRole("link", { name: "Empresa B" })).toHaveAttribute("href", "/empresa/b");
  expect(selecionarEmpresa).not.toHaveBeenCalled();
});

test("selecionar empresa abre o segmento retornado pelo servidor e preserva o rascunho da empresa anterior", async () => {
  const api = { ...apiBase(), selecionarEmpresaConversaWhatsapp: jest.fn(async () => ({ ok: true, conversa: conversa("cb") })) };
  const { result } = renderHook(() => useConversasWhatsapp({ api }));
  await waitFor(() => expect(result.current.conversas).toHaveLength(1));
  await act(async () => { await result.current.abrir("ca"); });
  result.current.rascunhosRef.current.set("ca", "Texto somente da empresa A");
  await act(async () => { await result.current.selecionarEmpresa("ca", "b"); });
  expect(result.current.aberta.conversa.id).toBe("cb");
  expect(api.selecionarEmpresaConversaWhatsapp).toHaveBeenCalledWith("ca", "b");
  expect(result.current.rascunhosRef.current.get("ca")).toBe("Texto somente da empresa A");
});

test("histórico não é filtrado por empresa mesmo com chamador legado", async () => {
  const api = apiBase();
  const { result } = renderHook(() => useConversasWhatsapp({ api }));
  await waitFor(() => expect(result.current.conversas).toHaveLength(1));
  await act(async () => { await result.current.abrir("ca"); });
  await act(async () => { await result.current.filtrarHistorico("b"); });
  expect(api.getMensagensWhatsapp).toHaveBeenLastCalledWith("ca");
  await act(async () => { await result.current.abrir("outro"); });
  expect(api.getMensagensWhatsapp).toHaveBeenLastCalledWith("outro");
  expect(result.current.empresaHistorico).toBeNull();
});

test("chat dentro da empresa também mostra o histórico da pessoa", async () => {
  const api = apiBase();
  const { result } = renderHook(() => useConversasWhatsapp({ api, empresa: "a" }));
  await waitFor(() => expect(result.current.conversas).toHaveLength(1));
  await act(async () => { await result.current.abrir("ca"); });
  expect(api.getMensagensWhatsapp).toHaveBeenLastCalledWith("ca");
  render(<FioDaConversa fio={{ conversa: conversa(), mensagens: [] }} hook={result.current} />);
  expect(screen.queryByLabelText("Empresa do atendimento")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Empresa no histórico")).not.toBeInTheDocument();
});

test("paginar segmentos do mesmo responsável mantém uma única linha na lista", async () => {
  const api = apiBase();
  api.listarConversasWhatsapp.mockImplementation(async (_f, { cursor }) => ({ conversas: [conversa(cursor ? "cb" : "ca")], temMais: !cursor, proximoCursor: cursor ? null : "proximo" }));
  const { result } = renderHook(() => useConversasWhatsapp({ api }));
  await waitFor(() => expect(result.current.cursorLista).toBe("proximo"));
  await act(async () => { await result.current.carregarMais(); });
  expect(result.current.conversas).toHaveLength(1);
});

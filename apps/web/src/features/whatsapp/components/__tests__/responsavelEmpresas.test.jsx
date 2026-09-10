import { act, renderHook, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useConversasWhatsapp } from "../../hooks/useConversasWhatsapp";
import { FioDaConversa } from "../FioDaConversa";

const empresas = [{ id: "a", razao: "Empresa A", cnpj: "12345678000195", conversaId: "ca" }, { id: "b", razao: "Empresa B", cnpj: "11444777000161", conversaId: "cb" }];
const conversa = (id = "ca", selecionado = true) => ({ id, portalClientId: id === "ca" ? "a" : "b", empresa: empresas[id === "ca" ? 0 : 1], contato: { nome: "Responsável teste" }, escopoVerificado: true, janela: { situacao: "ABERTA" }, empresas,
  atendimento: { id: "at", versao: 1, empresaAtualId: "a", empresaAtual: empresas[0], contextoSelecionado: selecionado, aguardandoSelecao: !selecionado } });
const mensagem = (id, empresa) => ({ id, empresa, direcao: "in", tipo: "text", corpo: `Pedido ${id}`, registradaEm: "2026-09-10T12:00:00Z" });
const apiBase = () => ({ listarConversasWhatsapp: jest.fn(async () => ({ conversas: [conversa()], temMais: false })), getMensagensWhatsapp: jest.fn(async id => ({ conversa: conversa(id), mensagens: [], temMais: false })) });

test("seletor de empresa, origem dos balões e contexto de resposta são separados do filtro do histórico", () => {
  const selecionarEmpresa = jest.fn(), filtrarHistorico = jest.fn(), assumir = jest.fn();
  render(<FioDaConversa fio={{ conversa: conversa(), mensagens: [mensagem("m1", empresas[1]), mensagem("m2", null)] }} hook={{ selecionarEmpresa, filtrarHistorico, assumir }} />);
  expect(screen.getByTestId("empresa-mensagem-m1")).toHaveTextContent("Empresa B");
  expect(screen.getByTestId("empresa-mensagem-m2")).toHaveTextContent("Empresa ainda não definida");
  expect(screen.getByText(/Resposta vinculada a Empresa A/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Empresa no histórico"), { target: { value: "b" } });
  expect(filtrarHistorico).toHaveBeenCalledWith("b"); expect(selecionarEmpresa).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Empresa do atendimento"), { target: { value: "b" } });
  expect(selecionarEmpresa).toHaveBeenCalledWith("ca", "b");
  fireEvent.click(screen.getByRole("button", { name: "Assumir" })); expect(assumir).toHaveBeenCalledWith("ca");
});

test("empresa ainda não escolhida bloqueia compositor e ações financeiras", () => {
  render(<FioDaConversa fio={{ conversa: conversa("ca", false), mensagens: [] }} hook={{ selecionarEmpresa: jest.fn() }} slotAcoes={<button>Enviar guia</button>} />);
  expect(screen.getByRole("textbox", { name: "Responder ao cliente" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Enviar guia" })).not.toBeInTheDocument();
  expect(screen.getByTestId("resposta-bloqueada")).toHaveTextContent("Escolha a empresa");
});

test("edição de nomes curtos envia apenas o cadastro da empresa ativa", () => {
  const salvarApelidos = jest.fn();
  render(<FioDaConversa fio={{ conversa: conversa(), mensagens: [] }} hook={{ salvarApelidos, selecionarEmpresa: jest.fn() }} />);
  fireEvent.click(screen.getByText("Nomes curtos no WhatsApp"));
  fireEvent.change(screen.getByLabelText("Nomes curtos da empresa"), { target: { value: "Azul, Clínica Azul" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar nomes curtos" }));
  expect(salvarApelidos).toHaveBeenCalledWith("ca", "a", ["Azul", "Clínica Azul"]);
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

test("filtro de histórico vai ao servidor e sair do responsável não mantém filtro de outra carteira", async () => {
  const api = apiBase();
  const { result } = renderHook(() => useConversasWhatsapp({ api }));
  await waitFor(() => expect(result.current.conversas).toHaveLength(1));
  await act(async () => { await result.current.abrir("ca"); });
  await act(async () => { await result.current.filtrarHistorico("b"); });
  expect(api.getMensagensWhatsapp).toHaveBeenLastCalledWith("ca", { empresa: "b" });
  await act(async () => { await result.current.abrir("outro"); });
  expect(api.getMensagensWhatsapp).toHaveBeenLastCalledWith("outro");
  expect(result.current.empresaHistorico).toBeNull();
});

test("chat dentro da empresa fixa filtro de leitura e não oferece trocar para outra empresa", async () => {
  const api = apiBase();
  const { result } = renderHook(() => useConversasWhatsapp({ api, empresa: "a" }));
  await waitFor(() => expect(result.current.conversas).toHaveLength(1));
  await act(async () => { await result.current.abrir("ca"); });
  expect(api.getMensagensWhatsapp).toHaveBeenLastCalledWith("ca", { empresa: "a" });
  render(<FioDaConversa fio={{ conversa: conversa(), mensagens: [] }} hook={result.current} />);
  expect(screen.getByLabelText("Empresa do atendimento")).toHaveTextContent("Empresa A");
  expect(screen.getByLabelText("Empresa do atendimento")).not.toHaveTextContent("Empresa B");
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

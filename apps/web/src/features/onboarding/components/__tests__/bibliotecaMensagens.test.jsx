import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { OrientacoesRapidas } from "../../../whatsapp/components/AtendimentoComercial";
import { BibliotecaComercialPage } from "../../pages/BibliotecaComercialPage";
import { pathToPageName } from "../../../../app/hooks/useManageAuthSession";
import { lerUsosMensagens } from "../../../whatsapp/lib/mensagensRapidas";
beforeEach(() => localStorage.clear());

const mensagem = (versao, aprovadoEm = "2026-09-14") => ({ id: `m${versao}`, tipo: "ORIENTACAO", chave: "guia", versao, titulo: `Guia versão ${versao}`, texto: "Empresa {{cnpj}}", dados: { descricao: "Como autorizar o escritório" }, aprovadoEm });
const conversa = { id: "contato", portalClientId: "empresa", empresa: { cnpj: "11222333000181" } };

test("biblioteca tem rota própria e gestão em nova aba sem montar o editor no chat", async () => {
  expect(pathToPageName("/biblioteca")).toBe("bibliotecaComercial");
  expect(pathToPageName("/biblioteca/")).toBe("bibliotecaComercial");
  const api = { comercial: jest.fn(async () => ({ recursos: [mensagem(1), mensagem(2), mensagem(3, null)] })) };
  render(<OrientacoesRapidas api={api} conversa={conversa} />);
  fireEvent.click(screen.getByRole("button", { name: "Mensagens rápidas" }));
  expect(await screen.findByText("Guia versão 2")).toBeVisible();
  expect(screen.queryByText("Guia versão 1")).not.toBeInTheDocument();
  expect(screen.queryByText("Guia versão 3")).not.toBeInTheDocument();
  const link = screen.getByRole("link", { name: "Gerenciar biblioteca compartilhada (nova aba)" });
  expect(link).toHaveAttribute("href", "/biblioteca"); expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  expect(screen.queryByRole("button", { name: "Nova mensagem" })).not.toBeInTheDocument();
});

test("voltar à conversa relê a biblioteca e descarta a prévia da versão anterior", async () => {
  let recursos = [mensagem(1)];
  const api = { comercial: jest.fn(async path => path === "/recursos" ? { recursos } : { previa: { texto: "Prévia anterior" } }), enviarOrientacaoWhatsapp: jest.fn() };
  render(<OrientacoesRapidas api={api} conversa={conversa} />);
  fireEvent.click(screen.getByRole("button", { name: "Mensagens rápidas" }));
  fireEvent.click(within((await screen.findByText("Guia versão 1")).closest("article")).getByRole("button"));
  await screen.findByText("Prévia anterior");
  recursos = [mensagem(1), mensagem(2)];
  await act(async () => { fireEvent.focus(window); });
  expect(await screen.findByText("Guia versão 2")).toBeVisible();
  expect(screen.queryByText("Guia versão 1")).not.toBeInTheDocument();
  expect(screen.queryByText("Prévia anterior")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Assumir e enviar orientação" })).not.toBeInTheDocument();
  expect(api.enviarOrientacaoWhatsapp).not.toHaveBeenCalled();
});

test("CNPJ já informado no onboarding preenche a orientação de procuração do lead", async () => {
  const api = { comercial: jest.fn(async path => path === "/recursos" ? { recursos: [mensagem(1)] } : path.startsWith("/conversas/") ? { atendimento: { onboarding: { cnpj: "11222333000181", responsavelNome: "Pessoa teste" } } } : { previa: { texto: "Orientação preparada" } }) };
  render(<OrientacoesRapidas api={api} conversa={{ id: "lead" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Mensagens rápidas" }));
  fireEvent.click(within((await screen.findByText("Guia versão 1")).closest("article")).getByRole("button"));
  await screen.findByText("Orientação preparada");
  expect(screen.getByLabelText("CNPJ")).toHaveValue("11222333000181");
  expect(api.comercial).toHaveBeenLastCalledWith("/recursos/m1/previa", { variaveis: { nome: "Pessoa teste", cnpj: "11222333000181", servico: "" } });
});

test("página de gestão carrega os recursos existentes e permite recuperar uma falha", async () => {
  const api = { comercial: jest.fn().mockRejectedValueOnce(new Error("Falha ao carregar" )).mockResolvedValue({ recursos: [mensagem(2)] }) };
  render(<BibliotecaComercialPage api={api} onBack={() => {}} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Falha ao carregar");
  fireEvent.click(screen.getByRole("button", { name: "Atualizar biblioteca" }));
  await screen.findByText("Guia versão 2");
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Nova mensagem" })).toBeVisible();
});

test("Usar mensagem insere no compositor, não envia, e mais usadas usa inserções reais", async () => {
  const onPreparado = jest.fn();
  const outras = { ...mensagem(4), chave: "segunda", titulo: "Outra orientação", dados: { descricao: "Pedir um documento." } };
  const api = { comercial: jest.fn(async path => path === "/recursos" ? { recursos: [mensagem(1), outras] } : path.startsWith("/conversas/") ? { atendimento: null } : { previa: { texto: "Texto preparado para revisão." } }), enviarOrientacaoWhatsapp: jest.fn() };
  const view = render(<OrientacoesRapidas usuarioId="operador" api={api} conversa={conversa} onPreparado={onPreparado} />);
  fireEvent.click(screen.getByRole("button", { name: "Mensagens rápidas" }));
  expect(await screen.findByText("Guia versão 1")).toBeVisible();
  expect(screen.getByText("Outra orientação")).toBeVisible();
  expect(lerUsosMensagens("operador")).toEqual({});
  fireEvent.click(within(screen.getByText("Outra orientação").closest("article")).getByRole("button"));
  fireEvent.click(await screen.findByRole("button", { name: "Usar mensagem" }));
  expect(onPreparado).toHaveBeenCalledWith(expect.objectContaining({ texto: "Texto preparado para revisão.", orientacaoId: "m4", versao: 4 }));
  expect(api.enviarOrientacaoWhatsapp).not.toHaveBeenCalled();
  expect(lerUsosMensagens("operador")).toEqual({ "orientacao:segunda": 1 });
  fireEvent.click(screen.getByRole("button", { name: "Mensagens rápidas" }));
  expect(await screen.findByText("Outra orientação")).toBeVisible();
  expect(screen.queryByText("Guia versão 1")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Todas" }));
  expect(screen.getByText("Guia versão 1")).toBeVisible();
  view.rerender(<OrientacoesRapidas usuarioId="outro-operador" api={api} conversa={conversa} onPreparado={onPreparado} />);
  fireEvent.click(screen.getByRole("button", { name: "Mais usadas" }));
  expect(screen.getByText("Guia versão 1")).toBeVisible();
  expect(lerUsosMensagens("outro-operador")).toEqual({});
});

test("uma falha ao inserir não conta uso nem envia mensagem", async () => {
  const api = { comercial: jest.fn(async path => path === "/recursos" ? { recursos: [mensagem(1)] } : path.startsWith("/conversas/") ? { atendimento: null } : { previa: { texto: "Texto disponível" } }), enviarOrientacaoWhatsapp: jest.fn() };
  render(<OrientacoesRapidas usuarioId="operador" api={api} conversa={conversa} onPreparado={() => { throw Error("Rascunho ocupado"); }} />);
  fireEvent.click(screen.getByRole("button", { name: "Mensagens rápidas" }));
  fireEvent.click(within((await screen.findByText("Guia versão 1")).closest("article")).getByRole("button"));
  fireEvent.click(await screen.findByRole("button", { name: "Usar mensagem" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Rascunho ocupado");
  expect(screen.getByText("Texto disponível")).toBeVisible();
  expect(lerUsosMensagens("operador")).toEqual({}); expect(api.enviarOrientacaoWhatsapp).not.toHaveBeenCalled();
});

test("a prévia substitui a lista e mensagem vazia não pode entrar no compositor", async () => {
  const onPreparado = jest.fn();
  const api = { comercial: jest.fn(async path => path === "/recursos" ? { recursos: [mensagem(1)] } : path.startsWith("/conversas/") ? { atendimento: null } : { previa: { texto: "   " } }) };
  render(<OrientacoesRapidas api={api} conversa={conversa} onPreparado={onPreparado} />);
  fireEvent.click(screen.getByRole("button", { name: "Mensagens rápidas" }));
  fireEvent.click(within((await screen.findByText("Guia versão 1")).closest("article")).getByRole("button"));
  expect(await screen.findByRole("alert")).toHaveTextContent("mensagem está vazia");
  expect(screen.queryByLabelText("Buscar mensagem rápida")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Usar mensagem" })).not.toBeInTheDocument();
  expect(onPreparado).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Voltar às mensagens" }));
  expect(screen.getByLabelText("Buscar mensagem rápida")).toBeVisible();
});

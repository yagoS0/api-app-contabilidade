import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { OrientacoesRapidas } from "../../../whatsapp/components/AtendimentoComercial";
import { BibliotecaComercialPage } from "../../pages/BibliotecaComercialPage";
import { pathToPageName } from "../../../../app/hooks/useManageAuthSession";

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
  expect(screen.queryByRole("button", { name: "Novo recurso" })).not.toBeInTheDocument();
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
  expect(screen.getByRole("button", { name: "Novo recurso" })).toBeVisible();
});

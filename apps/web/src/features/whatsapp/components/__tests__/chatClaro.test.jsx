import { fireEvent, render, screen, within } from "@testing-library/react";
import { FioDaConversa, NomeDaPessoa } from "../FioDaConversa";
import { DetalhesConversa } from "../ConversaVisual";

const conversa = {
  id: "conversa-clara", interlocutorId: "pessoa-clara", contato: { nome: "Maria" },
  relacionamento: { tipo: "CLIENTE" }, portalClientId: "empresa-a", empresa: { razao: "Empresa A" },
  janela: { situacao: "ABERTA" }, escopoVerificado: true,
  empresas: [{ id: "empresa-a", razao: "Empresa A" }, { id: "empresa-b", razao: "Empresa B" }],
};

test("nome mantém origem verificável sem juntar aviso e papel ao texto principal", () => {
  render(<NomeDaPessoa identidade={{ pessoa: "Maria Oliveira", papel: "Sócia", origemDoNome: "PERFIL", avisoDoNome: "nome do perfil do WhatsApp, não do cadastro" }} />);
  const nome = screen.getByTestId("pessoa-da-conversa");
  expect(nome.textContent).toBe("Maria Oliveira");
  expect(nome).toHaveAttribute("data-origem", "PERFIL");
  expect(nome).toHaveAttribute("title", "Maria Oliveira · Sócia · nome do perfil do WhatsApp, não do cadastro");
  expect(screen.getByTestId("aviso-do-nome")).toHaveClass("wa-visually-hidden");
});

test.each([
  ["EMITIR_NFSE", "Emissão de nota"], ["CANCELAR_NFSE", "Cancelamento de nota"],
  ["RECALCULAR_GUIA", "Atualização de guia"], ["OUTRA_OPERACAO", "Operação solicitada"],
])("pedido %s mantém confirmação e prazo em linguagem clara", (tipo, rotulo) => {
  render(<FioDaConversa fio={{ conversa: { ...conversa, pendencia: { tipo, codigo: "X9AB", expiraEm: "2026-09-21T14:00:00Z" } }, mensagens: [] }} hook={{}} />);
  const aviso = screen.getByTestId("pendencia-aberta");
  expect(aviso).toHaveTextContent(rotulo);
  expect(aviso).toHaveTextContent("X9AB");
  expect(aviso).toHaveTextContent("expira");
  expect(aviso).not.toHaveTextContent(tipo);
});

test("Mais abre empresas sem selecionar contexto fiscal e Escape fecha o menu", () => {
  const selecionarEmpresa = jest.fn();
  render(<FioDaConversa fio={{ conversa, mensagens: [] }} hook={{ selecionarEmpresa }} hrefDaEmpresa={id => `/companies/${id}/anotacoes`} />);
  const mais = screen.getByLabelText("Mais ações da conversa");
  fireEvent.click(mais);
  expect(mais.closest("details")).toHaveAttribute("open");
  fireEvent.keyDown(mais, { key: "Escape" });
  expect(mais.closest("details")).not.toHaveAttribute("open");
  expect(mais).toHaveFocus();
  fireEvent.click(mais);
  fireEvent.click(screen.getByRole("button", { name: "Abrir a empresa →" }));
  const modal = screen.getByRole("dialog", { name: "Abrir empresa deste contato" });
  expect(within(modal).getByRole("link", { name: "Empresa B" })).toHaveAttribute("href", "/companies/empresa-b/anotacoes");
  expect(selecionarEmpresa).not.toHaveBeenCalled();
});

test("Atendimento abre o processo comercial diretamente e preserva preenchimento ao recolher", () => {
  const api = { comercial: jest.fn() };
  const atendimento = <label>Informação da solicitação<input /></label>;
  const props = { conversa, atendimento, api, onFechar: jest.fn() };
  const { rerender } = render(<DetalhesConversa {...props} aberto={false} />);
  expect(screen.queryByLabelText("Informação da solicitação")).not.toBeInTheDocument();
  rerender(<DetalhesConversa {...props} aberto />);
  const campo = screen.getByLabelText("Informação da solicitação");
  expect(campo).toBeVisible();
  fireEvent.change(campo, { target: { value: "Atendimento em andamento" } });
  rerender(<DetalhesConversa {...props} aberto={false} />);
  expect(campo).not.toBeVisible();
  rerender(<DetalhesConversa {...props} aberto />);
  expect(screen.getByLabelText("Informação da solicitação")).toHaveValue("Atendimento em andamento");
  expect(api.comercial).not.toHaveBeenCalled();
});

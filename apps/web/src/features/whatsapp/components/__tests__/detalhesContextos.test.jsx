import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { DetalhesConversa } from "../ConversaVisual";

const conversa = { id: "c1", contato: { nome: "Ana" }, telefoneMascarado: "(11) 99999-0000", empresas: [{ id: "e1", razao: "Empresa exemplo" }], portalClientId: "e1" };
function Painel() {
  const [aberto, setAberto] = useState(false);
  return <><button onClick={() => setAberto(true)}>Abrir detalhes</button><DetalhesConversa aberto={aberto} onFechar={() => setAberto(false)} conversa={conversa} api={{ comercial: true }} atendimento={<label>Proposta em edição<input /></label>} /></>;
}

test("alternar contexto e fechar preserva edição comercial e restaura foco por Escape", () => {
  render(<Painel />);
  expect(screen.queryByLabelText("Proposta em edição")).not.toBeInTheDocument();
  const abrir = screen.getByRole("button", { name: "Abrir detalhes" });
  abrir.focus(); fireEvent.click(abrir);
  expect(screen.getByRole("button", { name: "Fechar detalhes" })).toHaveFocus();
  const campo = screen.getByLabelText("Proposta em edição");
  fireEvent.change(campo, { target: { value: "Rascunho mantido" } });
  const contato = screen.getByRole("button", { name: "Contato", exact: true });
  contato.focus(); fireEvent.click(contato);
  expect(contato).toHaveFocus();
  expect(contato).toHaveAttribute("aria-pressed", "true");
  expect(campo).not.toBeVisible();
  expect(campo).toHaveValue("Rascunho mantido");
  expect(screen.getByRole("heading", { name: "Contato", level: 2 })).toBeVisible();
  expect(screen.getByText("Ana")).toBeVisible();
  expect(screen.getByText("Importação de extratos").parentElement).not.toHaveAttribute("open");
  fireEvent.keyDown(contato, { key: "Escape" });
  expect(abrir).toHaveFocus();
  fireEvent.click(abrir);
  fireEvent.click(screen.getByRole("button", { name: "Atendimento", exact: true }));
  expect(screen.getByLabelText("Proposta em edição")).toBe(campo);
  expect(campo).toBeVisible();
  expect(campo).toHaveValue("Rascunho mantido");
});

test("sem comercial mostra contato diretamente e preserva navegação para empresa", () => {
  render(<DetalhesConversa conversa={conversa} onFechar={() => {}} />);
  expect(screen.queryByRole("group", { name: "Contexto dos detalhes" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Contato", level: 2 })).toBeVisible();
  expect(screen.getByRole("link", { name: "Abrir a empresa →" })).toHaveAttribute("href", "/companies/e1/anotacoes");
  const nome = screen.getByText("Ana");
  expect(nome.compareDocumentPosition(screen.getByRole("heading", { name: "Relacionamento" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

import { fireEvent, render, screen } from "@testing-library/react";
import { PainelAtendimento } from "../PainelAtendimento";

test("fechar por Escape preserva o preenchimento e devolve o foco", () => {
  render(<PainelAtendimento><label>Contato<input /></label></PainelAtendimento>);
  const abrir = screen.getByRole("button", { name: "Atendimento e cadastro" });
  expect(screen.getByLabelText("Contato")).not.toBeVisible();
  fireEvent.click(abrir);
  expect(screen.getByRole("button", { name: "Fechar atendimento e cadastro" })).toHaveFocus();
  fireEvent.change(screen.getByLabelText("Contato"), { target: { value: "Rascunho do contato" } });
  fireEvent.keyDown(screen.getByLabelText("Contato"), { key: "Escape" });
  expect(abrir).toHaveFocus();
  fireEvent.click(abrir);
  expect(screen.getByLabelText("Contato")).toHaveValue("Rascunho do contato");
});

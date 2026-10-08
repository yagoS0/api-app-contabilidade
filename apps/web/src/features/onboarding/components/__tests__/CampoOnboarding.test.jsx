import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { CampoOnboarding } from "../CampoOnboarding";

test("consulta auxiliar mantém edição, ajuda e erro associados ao CNPJ", () => {
  const consultar = jest.fn();
  function Formulario() {
    const [valor, setValor] = useState("");
    return <CampoOnboarding descritor={{ campo: "cnpj", tipo: "cnpj", rotulo: "CNPJ", ajuda: "Informe os 14 dígitos" }}
      dados={{}} valor={valor} onChange={setValor} erro="Confira o CNPJ"
      acaoExtra={<button type="button" onClick={consultar}>Consultar novamente</button>} />;
  }
  render(<Formulario />);
  const campo = screen.getByRole("textbox", { name: "CNPJ" });
  fireEvent.change(campo, { target: { value: "12345678901234" } });
  fireEvent.click(screen.getByRole("button", { name: "Consultar novamente" }));
  expect(campo).toHaveValue("12345678901234");
  expect(campo).toHaveAccessibleDescription("Informe os 14 dígitos Confira o CNPJ");
  expect(campo).toHaveAttribute("aria-invalid", "true");
  expect(consultar).toHaveBeenCalledTimes(1);
});

test("campos de sócios mantêm rótulos e valores ao editar, remover e adicionar linhas", () => {
  function Formulario() {
    const [valor, setValor] = useState([{ nome: "Alex", cpf: "123" }, { nome: "Bia", cpf: "456" }]);
    return <CampoOnboarding descritor={{ campo: "socios", tipo: "lista", rotulo: "Sócios", colunas: [{ campo: "nome", rotulo: "Nome" }, { campo: "cpf", rotulo: "CPF" }] }}
      dados={{}} valor={valor} onChange={setValor} />;
  }
  render(<Formulario />);
  fireEvent.change(screen.getByRole("textbox", { name: "Sócios — Nome (linha 2)" }), { target: { value: "Beatriz" } });
  fireEvent.click(screen.getByRole("button", { name: "Remover linha 1" }));
  expect(screen.getByRole("textbox", { name: "Sócios — Nome (linha 1)" })).toHaveValue("Beatriz");
  expect(screen.getByRole("textbox", { name: "Sócios — CPF (linha 1)" })).toHaveValue("456");
  fireEvent.click(screen.getByRole("button", { name: "+ adicionar" }));
  expect(screen.getByRole("textbox", { name: "Sócios — Nome (linha 2)" })).toHaveValue("");
  expect(screen.getAllByText("Nome")).toHaveLength(2);
});

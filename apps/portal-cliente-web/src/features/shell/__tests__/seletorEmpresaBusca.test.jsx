import { fireEvent, render, screen } from "@testing-library/react";
import { SeletorEmpresa } from "../SeletorEmpresa";

const empresas = [
  { companyId: "a", razao: "Vértice Serviços", cnpj: "11222333000181", myRole: "OWNER" },
  { companyId: "b", razao: "Lente", cnpj: "44555666000177", myRole: "OWNER" },
];

function abrir() {
  const aoEscolher = jest.fn();
  const aoFechar = jest.fn();
  render(<SeletorEmpresa empresas={empresas} ativaId="a" aoEscolher={aoEscolher}
    aoFechar={aoFechar} avisoAoTrocar="A planilha em conferência será descartada." />);
  return { aoEscolher, aoFechar };
}

test("encontra empresa por nome sem acento e mantém aviso antes de trocar", () => {
  const { aoEscolher } = abrir();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "vertice" } });
  expect(screen.queryByRole("button", { name: /Lente/ })).not.toBeInTheDocument();
  expect(screen.getByText("A planilha em conferência será descartada.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /Vértice Serviços/ }));
  expect(aoEscolher).toHaveBeenCalledWith("a");
});

test("encontra CNPJ formatado e limpar a busca restaura a lista", () => {
  abrir();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "44.555.666/0001-77" } });
  expect(screen.getByRole("button", { name: /Lente/ })).toBeVisible();
  expect(screen.queryByRole("button", { name: /Vértice/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
  expect(screen.getByText("Empresa atual")).toBeVisible();
  expect(screen.getByRole("button", { name: /Vértice/ })).toHaveAttribute("aria-current", "true");
});

test("busca sem resultado conserva saída pelo teclado", () => {
  const { aoEscolher, aoFechar } = abrir();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "não existe" } });
  expect(screen.getByText(/Nenhuma empresa encontrada/)).toBeVisible();
  expect(aoEscolher).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(aoFechar).toHaveBeenCalledTimes(1);
});

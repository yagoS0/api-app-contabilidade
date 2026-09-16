import { render, screen, fireEvent, within } from "@testing-library/react";
import { PlanejamentoPage } from "../renderPlanejamentoPage";

function preencher(nome, valor) { fireEvent.change(screen.getByLabelText(nome), { target: { value: valor } }); }
function montar() {
  render(<PlanejamentoPage api={{}} />);
  preencher(/Receita anual/i, "120000000");
}

it("simulação livre de 1,2 milhão separa receita, total anual e média mensal", () => {
  montar();
  expect(screen.getByLabelText(/Receita anual/i)).toHaveValue("1.200.000,00");
  expect(screen.getByLabelText("Receita usada no cálculo")).toHaveTextContent("Receita anual: R$ 1.200.000,00 · média mensal: R$ 100.000,00");
  const simples = within(screen.getByRole("region", { name: "Simples Nacional", exact: true }));
  const presumido = within(screen.getByRole("region", { name: "Lucro Presumido", exact: true }));
  expect(simples.getByText("Total estimado no ano")).toBeInTheDocument();
  expect(simples.getByText("R$ 156.360,00")).toBeInTheDocument();
  expect(simples.getByText("Média mensal estimada: R$ 13.030,00")).toBeInTheDocument();
  expect(presumido.getByText("R$ 210.360,00")).toBeInTheDocument();
  expect(presumido.getByText("Média mensal estimada: R$ 17.530,00")).toBeInTheDocument();
  fireEvent.click(simples.getByRole("button", { name: /Ver por tributo/ }));
  expect(simples.getByText("R$ 6.254,40")).toBeInTheDocument();
  expect(simples.getByText("Composição do total anual")).toBeInTheDocument();
  const abrir = presumido.getByRole("button", { name: /Ver por tributo/ });
  expect(abrir).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(abrir);
  const irpj = within(presumido.getByRole("group", { name: "IRPJ", exact: true }));
  expect(irpj.getByText("Alíquota: 15,00%")).toBeInTheDocument();
  expect(irpj.getByText("Base presumida: R$ 384.000,00")).toBeInTheDocument();
  expect(irpj.getByText("R$ 57.600,00")).toBeInTheDocument();
  expect(irpj.getByText("Representa 4,80% da receita")).toBeInTheDocument();
  fireEvent.click(presumido.getByRole("button", { name: /Ocultar detalhamento/ }));
  expect(presumido.queryByRole("group", { name: "IRPJ", exact: true })).toBeNull();
});

it("trocar serviço por comércio retira ISS dos regimes e mantém a alíquota para retomar o serviço", () => {
  montar();
  preencher(/Margem de lucro real/, "20");
  preencher(/Créditos anuais/, "0");
  preencher("Atividade no Lucro Presumido", "comercio");
  const presumido = within(screen.getByRole("region", { name: "Lucro Presumido", exact: true }));
  const real = within(screen.getByRole("region", { name: "Lucro Real", exact: true }));
  expect(presumido.getByText("R$ 71.160,00")).toBeInTheDocument();
  expect(real.getByText("R$ 168.600,00")).toBeInTheDocument();
  expect(screen.getByLabelText("ISS (%)")).toHaveValue("5");
  preencher("Atividade no Lucro Presumido", "servicos");
  expect(presumido.getByText("R$ 210.360,00")).toBeInTheDocument();
  expect(real.getByText("R$ 228.600,00")).toBeInTheDocument();
});

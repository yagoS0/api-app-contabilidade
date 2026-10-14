import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PlanejamentoPage } from "../renderPlanejamentoPage";
import { baixarRelatorioPlanejamento } from "../../lib/pdfPlanejamento";
jest.mock("../../lib/pdfPlanejamento", () => ({ baixarRelatorioPlanejamento: jest.fn(async () => {}) }));
beforeEach(() => jest.clearAllMocks());
const montar = () => {
  const view = render(<PlanejamentoPage api={{}} />);
  fireEvent.change(screen.getByLabelText("Receita anual (R$)"), { target: { value: "30000000" } });
  return view;
};
test("ordena os quatro blocos, imprime no início e deixa IBS/CBS opcional nas premissas", () => {
  const { container } = montar();
  expect([...container.querySelectorAll("h2")].map(h => h.textContent)).toEqual(["Premissas do cenário", "Comparativos e quadros", "Cálculo comparativo de impostos", "Fator R"]);
  expect(screen.queryByRole("navigation", { name: "Etapas do planejamento" })).toBeNull();
  expect(screen.queryByText("As premissas alteram somente este cenário, sem mudar o cadastro fiscal.")).toBeNull();
  const print = screen.getByRole("button", { name: "Imprimir relatório" });
  expect(print.compareDocumentPosition(screen.getByLabelText("Receita anual (R$)")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByRole("region", { name: "IBS e CBS no Simples Nacional" })).toBeNull();
  fireEvent.click(screen.getByLabelText("Incluir IBS e CBS no estudo"));
  expect(screen.queryByText("O que comparar aqui:")).toBeNull();
  expect(screen.getByRole("region", { name: "IBS e CBS no Simples Nacional" }).closest("#premissas-cenario")).not.toBeNull();
  fireEvent.click(screen.getByLabelText("Incluir IBS e CBS no estudo"));
  expect(screen.queryByRole("region", { name: "IBS e CBS no Simples Nacional" })).toBeNull();
  for (const label of ["Estudos adicionais", "Acompanhamento mensal · 2026", "Conclusão do contador e próxima revisão", "Ponto de equilíbrio", "Relatório tributário"]) expect(screen.queryByText(label, { exact: true })).toBeNull();
});
test("gera PDF com resultados e memória mesmo com cards e anexos recolhidos, sem gravar no servidor", async () => {
  montar();
  fireEvent.click(screen.getByRole("button", { name: "Imprimir relatório" }));
  await waitFor(() => expect(baixarRelatorioPlanejamento).toHaveBeenCalledTimes(1));
  const p = baixarRelatorioPlanejamento.mock.calls[0][0];
  expect(p.entradas.receitaAnual).toBe(300000);
  expect(p.comparativo.colunas.length).toBeGreaterThan(2);
  expect(p.comparativo.colunas[0].memoriaPorTributo.irpj).toBeDefined();
  expect(p.formulario.ajustes.incluirIbsCbs).toBeUndefined();
  expect(screen.queryByRole("button", { name: /Ocultar detalhamento/ })).toBeNull();
});
test("mostra erro da geração e permite tentar novamente sem perder as premissas", async () => {
  baixarRelatorioPlanejamento.mockRejectedValueOnce(new Error("falha"));
  montar(); fireEvent.click(screen.getByRole("button", { name: "Imprimir relatório" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível gerar o relatório");
  expect(screen.getByLabelText("Receita anual (R$)")).toHaveValue("300.000,00");
  fireEvent.click(screen.getByRole("button", { name: "Imprimir relatório" }));
  await waitFor(() => expect(baixarRelatorioPlanejamento).toHaveBeenCalledTimes(2));
});

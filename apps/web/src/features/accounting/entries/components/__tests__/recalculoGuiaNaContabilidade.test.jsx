import { render, screen, fireEvent } from "@testing-library/react";
import { AccountRow } from "../renderAccountingEntriesParts";
import { RecalculoGuiaAviso } from "../../../components/RecalculoGuiaAviso";

test("DARF consolidado informa total da guia sem substituir o valor contábil da linha", () => {
  const onUpdate = jest.fn();
  render(<table><tbody><AccountRow accounts={[]} onUpdate={onUpdate} entry={{
    id: "e-pis", data: "2026-08-31", historico: "PIS", origem: "SERPRO", status: "RASCUNHO",
    lines: [{ tipo: "D", conta: "1", valor: 100 }],
    recalculoGuia: { guiaId: "darf", recalculadoEm: "2026-09-18T12:00:00Z", valorAnterior: 1000, valorAtual: 1100, escopoValor: "TOTAL_GUIA" },
  }} /></tbody></table>);
  expect(screen.getByRole("cell", { name: "100,00" })).toBeInTheDocument();
  fireEvent.click(screen.getByText("Guia recalculada"));
  expect(screen.getByText(/Total da guia recalculada: R\$\s*1.100,00/)).toBeVisible();
  expect(screen.getByText(/pode reunir mais de um tributo/)).toBeVisible();
  expect(onUpdate).not.toHaveBeenCalled();
});

test("marca explícita sem variação continua visível e valor ausente não vira zero", () => {
  const { rerender } = render(<RecalculoGuiaAviso entry={{ recalculoGuia: {
    recalculadoEm: "2026-09-18T12:00:00Z", valorAnterior: 100, valorAtual: 100, escopoValor: "TOTAL_GUIA",
  } }} />);
  expect(screen.getByText("Guia recalculada")).toBeInTheDocument();
  rerender(<RecalculoGuiaAviso entry={{ recalculatedAt: "2026-09-18T12:00:00Z" }} />);
  fireEvent.click(screen.getByText("Guia recalculada"));
  expect(screen.queryByText(/R\$/)).toBeNull();
  rerender(<RecalculoGuiaAviso entry={{}} />);
  expect(screen.queryByText("Guia recalculada")).toBeNull();
});

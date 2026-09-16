import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { ComparacaoCenarios } from "../ComparacaoCenarios";
import { CarteiraPlanejamento } from "../CarteiraPlanejamento";

const cenario = (id, total = 12345) => ({ id, competencia: "2026-08", geradoEm: "2026-09-01T12:00:00Z", entradas: { receitaAnual: 1200000, formularioCenario: { ajustes: { nomeCenario: id } } },
  resultado: { anoBase: 2026, regimes: [{ regime: "Lucro Presumido", total, cargaEfetiva: 0.1, cobertura: { estado: "parcial", pendencias: ["Conferir encargos"] } }] } });

test("compara fotos, preserva valores salvos e limita seleção a três", () => {
  const onAbrir = jest.fn();
  render(<ComparacaoCenarios cenarios={[cenario("A"), cenario("B", 999), cenario("C"), cenario("D")]} onAbrir={onAbrir} />);
  const caixas = screen.getAllByRole("checkbox");
  fireEvent.click(caixas[0]); expect(screen.queryByRole("table")).not.toBeInTheDocument();
  fireEvent.click(caixas[1]);
  const tabela = screen.getByRole("table");
  expect(within(tabela).getByText(/12.345,00/)).toBeInTheDocument();
  expect(within(tabela).getByText(/999,00/)).toBeInTheDocument();
  expect(within(tabela).getAllByText("Conferir encargos")).toHaveLength(2);
  expect(onAbrir).not.toHaveBeenCalled();
  fireEvent.click(caixas[2]); expect(caixas[3]).toBeDisabled();
  fireEvent.click(caixas[0]); expect(caixas[3]).toBeEnabled();
  fireEvent.click(screen.getAllByRole("button", { name: /Abrir 2026/ })[0]);
  expect(onAbrir).toHaveBeenCalledWith(expect.objectContaining({ id: "A" }));
});
test("carteira só consulta quando aberta, distingue falha e ausência e abre empresa", async () => {
  const onAbrirEmpresa = jest.fn();
  const api = { listarSimulacoesPlanejamento: jest.fn(async id => id === "a" ? { simulacoes: [cenario("Atual")] } : id === "b" ? { simulacoes: [] } : { ok: false }) };
  render(<CarteiraPlanejamento api={api} empresas={[{ id: "a", razao: "Alfa" }, { id: "b", razao: "Beta" }, { id: "c", razao: "Gama" }]} onAbrirEmpresa={onAbrirEmpresa} />);
  expect(api.listarSimulacoesPlanejamento).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Visão da carteira"));
  await screen.findByText("3 empresas consultadas · 0 com potencial no cenário salvo · 1 falhas");
  expect(screen.getByRole("cell", { name: "Revisar cobertura" })).toBeInTheDocument();
  expect(screen.getByText("Sem cenário salvo")).toBeInTheDocument();
  expect(screen.getByText("Não foi possível consultar")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Planejamento de Alfa" })); expect(onAbrirEmpresa).toHaveBeenCalledWith("a");
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "erro" } });
  expect(screen.queryByText("Alfa")).not.toBeInTheDocument(); expect(screen.getByText("Gama")).toBeInTheDocument();
});
test("resposta tardia da carteira anterior não aparece após troca de escopo", async () => {
  let responder;
  const api = { listarSimulacoesPlanejamento: jest.fn(id => id === "a" ? new Promise(resolve => { responder = resolve; }) : Promise.resolve({ simulacoes: [] })) };
  const { rerender } = render(<CarteiraPlanejamento api={api} empresas={[{ id: "a", razao: "Antiga" }]} />);
  fireEvent.click(screen.getByText("Visão da carteira"));
  rerender(<CarteiraPlanejamento api={api} empresas={[{ id: "b", razao: "Nova" }]} />);
  await waitFor(() => expect(screen.getByText("Nova")).toBeInTheDocument());
  await act(async () => responder({ simulacoes: [cenario("Antigo")] }));
  expect(screen.queryByText("Antiga")).not.toBeInTheDocument();
  expect(screen.queryByText("Antigo")).not.toBeInTheDocument();
});

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PlanejamentoPage } from "../renderPlanejamentoPage";
const campo = valor => ({ valor, apurado: true, origem: "cadastro" });
const dados = { ok: true, empresa: { id: "e1", razao: "Empresa de teste" }, referencia: { competencia: "2026-09" },
  campos: { receitaAnual: campo(1200000), rbt12: campo(1200000), folhaAnual: campo(300000), anexo: campo("III"), sujeitoFatorR: campo(false) },
  historicoMensal: [{ competencia: "2026-01", receita: 98765, folhaContabil: 1234, origem: "lançamentos confirmados" }, { competencia: "2025-01", receita: 87654, folha: 2000 }] };
function montar(empresaDados = dados) {
  const api = { getDadosPlanejamento: jest.fn(async () => empresaDados), listarSimulacoesPlanejamento: jest.fn(async () => ({ simulacoes: [] })),
    salvarSimulacaoPlanejamento: jest.fn(async (_id, payload) => ({ ok: true, simulacao: { id: "c1", ...payload } })) };
  render(<PlanejamentoPage api={api} empresa={{ id: "e1" }} empresaFixa />);
  fireEvent.click(screen.getByRole("button", { name: "Simulação tributária", exact: true }));
  return api;
}
test("salva acompanhamento automático mesmo sem abrir a seção e preserva edição/apagamento", async () => {
  const api = montar();
  await waitFor(() => expect(screen.getByLabelText("Receita anual (R$)")).toHaveValue("1.200.000,00"));
  fireEvent.click(screen.getByRole("button", { name: "Salvar cenário", exact: true }));
  await waitFor(() => expect(api.salvarSimulacaoPlanejamento).toHaveBeenCalled());
  expect(api.salvarSimulacaoPlanejamento.mock.calls[0][1].resultado.acompanhamentoMensal.linhas[0].realizado).toBe(98765);
  fireEvent.click(screen.getByText("Acompanhamento mensal · 2026"));
  expect(screen.getByLabelText("Realizado Jan")).toHaveValue(98765);
  expect(screen.getByLabelText("Folha Jan")).toHaveValue(1234);
  expect(screen.queryByText(/Importar apurações/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Realizado Jan"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("ISS (%)"), { target: { value: "4" } });
  expect(screen.getByLabelText("Realizado Jan")).toHaveValue(null);
  fireEvent.click(screen.getByText("Confirmar folha contábil para este cenário"));
  expect(screen.queryByText("Confirmar folha contábil para este cenário")).not.toBeInTheDocument();
});
test("histórico mensal continua acessível quando não há base para receita anual", async () => {
  montar({ ...dados, campos: { ...dados.campos, receitaAnual: { valor: null, apurado: false } } });
  fireEvent.click(await screen.findByText("Acompanhamento mensal · 2026"));
  expect(screen.getByLabelText("Realizado Jan")).toHaveValue(98765);
  expect(screen.getByLabelText("Plano Jan")).toHaveValue(null);
});

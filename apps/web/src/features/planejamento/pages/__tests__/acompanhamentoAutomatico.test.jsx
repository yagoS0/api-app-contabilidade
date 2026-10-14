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
  return api;
}
test("histórico alimenta as premissas sem reintroduzir acompanhamento na página", async () => {
 const api=montar();
 await waitFor(() => expect(screen.getByLabelText("Receita anual (R$)")).toHaveValue("1.200.000,00"));
 expect(screen.queryByText("Acompanhamento mensal · 2026")).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Salvar cenário",exact:true}));
 await waitFor(() => expect(api.salvarSimulacaoPlanejamento).toHaveBeenCalled());
 expect(api.salvarSimulacaoPlanejamento.mock.calls[0][1].entradas.receitaAnual).toBe(1200000);
});

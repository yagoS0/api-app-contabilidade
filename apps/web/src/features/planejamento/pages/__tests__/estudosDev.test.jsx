import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { PlanejamentoPage } from "../renderPlanejamentoPage";
import { ComparacaoCenarios } from "../../components/ComparacaoCenarios";
import { baixarPdfEstudos } from "../../lib/pdfEstudos";
jest.mock("../../lib/pdfEstudos", () => ({ baixarPdfEstudos: jest.fn(async () => {}) }));
const campo = valor => ({ valor, apurado: true, origem: "cadastro de teste" });
const dados = { ok: true, empresa: { id: "e1", razao: "Empresa de teste" }, referencia: { competencia: "2026-09" },
  campos: { receitaAnual: campo(1200000), rbt12: campo(1200000), folhaAnual: campo(300000), anexo: campo("III"), sujeitoFatorR: campo(false) },
  historicoMensal: [{ competencia: "2026-01", receita: 98765, folha: 2000, origem: "lançamentos confirmados" }] };
function montar(mode = "mock") {
  let foto;
  const api = { mode, getDadosPlanejamento: jest.fn(async () => dados), listarSimulacoesPlanejamento: jest.fn(async () => ({ simulacoes: foto ? [foto] : [] })),
    salvarSimulacaoPlanejamento: jest.fn(async (_id, payload) => { foto = { id: "c1", geradoEm: "2026-09-16", ...payload }; return { ok: true, simulacao: foto }; }) };
  render(<PlanejamentoPage api={api} empresa={{ id: "e1" }} empresaFixa />);
  fireEvent.click(screen.getByRole("button", { name: "Simulação tributária", exact: true }));
  return api;
}
test.each(["real", "real_with_mock_fallback"])("produção exibe e salva estudos com API %s", async mode => {
  const api = montar(mode);
  await waitFor(() => expect(screen.getByLabelText("Receita anual (R$)")).toHaveValue("1.200.000,00"));
  expect(screen.getByText("Estudos adicionais")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Salvar cenário", exact: true }));
  await waitFor(() => expect(api.salvarSimulacaoPlanejamento).toHaveBeenCalled());
  expect(api.salvarSimulacaoPlanejamento.mock.calls[0][1].resultado.estudosAvancados.mensal.resultados).toHaveLength(3);
});
test("mock preenche receita mensal, salva parâmetros/resultados e reabre sem perder o estudo", async () => {
  const api = montar();
  fireEvent.click(await screen.findByText("Tributos mensais, atividades mistas e início de atividade"));
  expect(screen.getByLabelText("Receita do mês (R$)")).toHaveValue(98765);
  fireEvent.change(screen.getByLabelText("Receita do mês (R$)"), { target: { value: "110000" } });
  fireEvent.change(screen.getByLabelText("Receita mensal da atividade 1 (R$)"), { target: { value: "110000" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar cenário", exact: true }));
  await waitFor(() => expect(api.salvarSimulacaoPlanejamento).toHaveBeenCalled());
  const p = api.salvarSimulacaoPlanejamento.mock.calls[0][1];
  expect(p.entradas.formularioCenario.ajustes.estudos.tributos.meses[0].receita).toBe("110000");
  expect(p.resultado.estudosAvancados.mensal.resultados[0].meses[0].receita).toBe(110000);
  fireEvent.change(screen.getByLabelText("Receita do mês (R$)"), { target: { value: "99999" } });
  fireEvent.click(screen.getByRole("button", { name: "Abrir cenário", exact: true }));
  fireEvent.click(await screen.findByRole("button", { name: /Abrir 2026-09/ }));
  await waitFor(() => expect(screen.getByLabelText("Receita do mês (R$)")).toHaveValue(110000));
});
test("editar parâmetros revoga conferência da operação e PDF recebe estudo mesmo fechado", async () => {
  montar();
  fireEvent.click(await screen.findByText("Operações especiais e benefícios"));
  fireEvent.click(screen.getByRole("button", { name: "Adicionar operação", exact: true }));
  fireEvent.change(screen.getByLabelText("Tributo da operação 1"), { target: { value: "ICMS" } });
  fireEvent.change(screen.getByLabelText("Base final (R$)"), { target: { value: "1000" } });
  fireEvent.change(screen.getByLabelText("Alíquota interna / do tributo (%)"), { target: { value: "18" } });
  const check = screen.getByLabelText("Incidência, base final, benefício e crédito conferidos");
  fireEvent.click(check); expect(check).toBeChecked();
  fireEvent.change(screen.getByLabelText("Base final (R$)"), { target: { value: "2000" } });
  expect(check).not.toBeChecked();
  fireEvent.click(screen.getByText("Operações especiais e benefícios"));
  fireEvent.click(screen.getByRole("button", { name: "Baixar relatório dos estudos (PDF)" }));
  await waitFor(() => expect(baixarPdfEstudos).toHaveBeenCalled());
  expect(baixarPdfEstudos.mock.calls.at(-1)[0].estudos.operacoes.operacoes[0].base).toBe("2000");
});
test("PDF conjunto recebe somente as fotos selecionadas, sem abrir ou recalcular", () => {
  const fotos = [1, 2, 3].map(i => ({ id: `c${i}`, competencia: `2026-0${i}`, entradas: { receitaAnual: i * 100000 }, resultado: { anoBase: 2026, regimes: [] } }));
  const onExportar = jest.fn(), onAbrir = jest.fn();
  render(<ComparacaoCenarios cenarios={fotos} onExportar={onExportar} onAbrir={onAbrir} />);
  expect(screen.queryByText("Baixar comparação em PDF")).not.toBeInTheDocument();
  const checks = screen.getAllByRole("checkbox"); fireEvent.click(checks[0]); fireEvent.click(checks[2]);
  expect(within(screen.getByRole("table")).getAllByRole("columnheader")).toHaveLength(3);
  fireEvent.click(screen.getByText("Baixar comparação em PDF"));
  expect(onExportar).toHaveBeenCalledWith([fotos[0], fotos[2]]); expect(onAbrir).not.toHaveBeenCalled();
});

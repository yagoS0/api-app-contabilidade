import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { PlanejamentoPage } from "../renderPlanejamentoPage";
import { ComparacaoCenarios } from "../../components/ComparacaoCenarios";

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
  return api;
}
test.each(["real", "mock"])("não exibe estudos adicionais no Planejamento em %s", async mode => {
 const api = montar(mode);
 await waitFor(() => expect(screen.getByLabelText("Receita anual (R$)")).toHaveValue("1.200.000,00"));
 expect(screen.queryByText("Estudos adicionais")).not.toBeInTheDocument();
 expect(screen.queryByText("Conclusão do contador e próxima revisão")).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button", {name:"Salvar cenário",exact:true}));
 await waitFor(() => expect(api.salvarSimulacaoPlanejamento).toHaveBeenCalled());
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

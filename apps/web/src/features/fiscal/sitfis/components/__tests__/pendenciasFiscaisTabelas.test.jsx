import { render, screen, fireEvent, within } from "@testing-library/react";
import { projetarPendenciasSitfis, valorEmCentavos, subtotalDocumental } from "@contabilidade/shared/pendencias-fiscais";
import { PendenciasFiscaisTabelas } from "../PendenciasFiscaisTabelas";
import { SitfisTab } from "../renderSitfisTab";

const registro = { Receita: "IRPJ", "PA/Exerc.": "01/2026", "Vl. Original": "100,00", "Sdo. Dev. Cons.": "120,10" };
function relatorio() {
  return { emitidoEm: "06/10/2026", diagnosticos: [
    { chave: "RFB", blocos: [
      { titulo: "Pendência - Débito (SIEF)", registros: [registro, { Receita: "PIS", "Sdo. Dev. Cons.": "ilegível" }] },
      { titulo: "Omissão de declaração", registros: [{ Declaração: "DCTFWeb" }] },
      { titulo: "Parcelamento", registros: [{ Parcelamento: "ACORDO-FICTICIO", "Sdo. Dev. Cons.": "999,00" }] },
    ] },
    { chave: "PGFN", semPendencia: true, blocos: [] },
  ] };
}

test.each([["0,00", 0], ["1.234,56", 123456], ["12.34,56", null], ["100,00%", null], ["", null], ["1.2", null]])("valor %s conserva precisão e ausência", (v, esperado) => {
  expect(valorEmCentavos(v)).toBe(esperado);
});
test("normalização é determinística, preserva fonte e exclui acordos da soma de débitos", () => {
  const a = projetarPendenciasSitfis(relatorio());
  expect(a).toEqual(projetarPendenciasSitfis(relatorio()));
  expect(a.fontes[0].linhas[0].evidencia.registro).toEqual(registro);
  expect(subtotalDocumental(a.fontes[0].linhas)).toEqual({ centavos: 12010, semValor: 1, quantidade: 2 });
  expect(a.fontes[1].cobertura).toBe("SEM_REGISTROS");
  expect(a.fontes[2].cobertura).toBe("NAO_CONSULTADO");
});
test("bloco ilegível e órgão desconhecido não desaparecem", () => {
  const a = projetarPendenciasSitfis({ diagnosticos: [{ chave: "NOVA", orgao: "Nova fonte", blocos: [{ titulo: "Pendência", registros: [], naoInterpretado: ["texto"] }] }] });
  expect(a.fontes.at(-1)).toMatchObject({ nome: "Nova fonte", cobertura: "PARCIAL" });
  expect(a.fontes.at(-1).avisos.length).toBeGreaterThan(0);
});
test("ausência de relatório não afirma que os órgãos estão limpos", () => {
  expect(projetarPendenciasSitfis(null).fontes.every(f => f.cobertura === "NAO_CONSULTADO")).toBe(true);
});
test("tabelas, filtros, seleção e evidência trabalham só com relatório salvo", () => {
  render(<PendenciasFiscaisTabelas relatorio={relatorio()} />);
  const rfb = screen.getByRole("region", { name: "Receita Federal" });
  expect(within(rfb).getByRole("table")).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Municipal — ISS e taxas" })).toHaveTextContent("Não consultado");
  expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  fireEvent.click(screen.getByRole("checkbox", { name: /Selecionar IRPJ/ }));
  expect(screen.getByRole("status")).toHaveTextContent("120,10");
  fireEvent.change(screen.getByLabelText("Buscar nas pendências"), { target: { value: "DCTFWeb" } });
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("1 selecionado(s)");
  fireEvent.click(screen.getByRole("button", { name: "Limpar seleção" }));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
test("trocar empresa ou relatório limpa seleção, sem confundir tentativa com relatório válido", () => {
  const painel = { status: { relatorio: relatorio(), ultimoRelatorioEm: "2026-10-01T12:00:00Z", checkedAt: "2026-10-06T12:00:00Z" } };
  const { rerender } = render(<SitfisTab companyId="a" sitfisPanel={painel} />);
  fireEvent.click(screen.getByRole("checkbox", { name: /Selecionar IRPJ/ }));
  expect(screen.getByRole("status")).toBeInTheDocument();
  rerender(<SitfisTab companyId="b" sitfisPanel={painel} />);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByText("Último relatório obtido")).toBeInTheDocument();
  expect(screen.getByText(/Última tentativa:/)).toBeInTheDocument();
});

import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { api } from "../../../api";
import { PainelPage } from "../PainelPage";
jest.mock("../BlocoDeDemonstracao", () => ({ BlocoDeDemonstracao: ({ aoAtualizarFluxo }) => <button onClick={aoAtualizarFluxo}>Atualizar após edição</button> }));
const COMPETENCIA = "2026-08";
const lancamento = (competencia = COMPETENCIA, extras = {}) => ({ competencia, deLancamentos: { situacao: "CALCULADA", base: 20000, impostos: 3000, aliquota: 15, ...extras } });
const props = { empresa: { companyId: "pc-001" }, competencia: COMPETENCIA, aoTrocarCompetencia: jest.fn(), aoNavegar: jest.fn() };
async function abrir({ linhas = [lancamento()], receita = 20000 } = {}) {
  jest.spyOn(api, "getFluxoCaixa").mockRejectedValue(new Error("O resumo não deve consultar o fluxo"));
  jest.spyOn(api, "getInvoices").mockResolvedValue({ summary: { totalAmount: receita, totalInvoices: 4 } });
  jest.spyOn(api, "getAliquotas").mockResolvedValue(linhas);
  const vista = render(<PainelPage {...props} />);
  await act(async () => {});
  return vista;
}
function card(prefixo) {
  const e = [...document.querySelectorAll(".card")].find((c) => c.querySelector(".rotulo")?.textContent.startsWith(prefixo));
  return { rotulo: e.querySelector(".rotulo").textContent, numero: e.querySelector(".numero").textContent, apoio: e.querySelector(".apoio")?.textContent || "" };
}
afterEach(() => jest.restoreAllMocks());
test("três cards na competência selecionada: resultado é faturamento menos imposto", async () => {
  await abrir();
  expect(card("Receita").numero).toMatch(/20\.000,00/);
  expect(card("Imposto líquido").numero).toMatch(/3\.000,00/);
  expect(card("Resultado").numero).toMatch(/17\.000,00/);
  for (const nome of ["Receita", "Imposto líquido", "Resultado"]) expect(card(nome).rotulo).toBe(`${nome} · 08/2026`);
  expect(card("Resultado").apoio).toBe("Receita − impostos lançados na competência");
  expect(api.getInvoices).toHaveBeenCalledWith("pc-001", { competencia: COMPETENCIA, page: 1, limit: 1 });
  expect(api.getAliquotas).toHaveBeenCalledWith("pc-001", { from: COMPETENCIA, to: COMPETENCIA });
  expect(api.getFluxoCaixa).not.toHaveBeenCalled();
});
test("inclui INSS tributário sem subtrair folha salarial ou despesas", async () => {
  await abrir({ linhas: [lancamento(COMPETENCIA, { impostosComFolha: 3500, aliquotaComFolha: 17.5, impostoSobreFolha: 500, folha: 50000, despesas: 70000 })] });
  expect(card("Imposto líquido").numero).toMatch(/3\.500,00/);
  expect(card("Imposto líquido").apoio).toMatch(/INSS incluído/);
  expect(card("Resultado").numero).toMatch(/16\.500,00/);
});
test.each(["SEM_IMPOSTO_LANCADO", "SEM_LANCAMENTO", "SEM_RECEITA_LANCADA"])("ausência %s mantém traço", async (situacao) => {
  await abrir({ linhas: [lancamento(COMPETENCIA, { situacao, impostos: 0 })] });
  expect(card("Imposto líquido").numero).toBe("—"); expect(card("Resultado").numero).toBe("—");
  expect(card("Resultado").apoio).not.toBe("");
});
test.each([null, undefined, ""])("total ausente %s não fabrica zero", async (impostos) => {
  await abrir({ linhas: [lancamento(COMPETENCIA, { impostos })] });
  expect(card("Imposto líquido").numero).toBe("—"); expect(card("Resultado").numero).toBe("—");
});
test("zero explicitamente calculado é preservado", async () => {
  await abrir({ linhas: [lancamento(COMPETENCIA, { impostos: 0, aliquota: 0 })] });
  expect(card("Imposto líquido").numero).toMatch(/0,00/); expect(card("Resultado").numero).toMatch(/20\.000,00/);
});
test("outro mês não substitui imposto ausente", async () => {
  await abrir({ linhas: [lancamento("2026-09")] });
  expect(card("Resultado").numero).toBe("—"); expect(card("Imposto líquido").apoio).toContain("Sem dados para 08/2026");
});
test("seleciona a linha correta fora da primeira posição", async () => {
  await abrir({ linhas: [lancamento("2026-09", { impostos: 9000 }), lancamento()] });
  expect(card("Resultado").numero).toMatch(/17\.000,00/);
});
test("receita ausente não fabrica resultado negativo", async () => {
  await abrir({ receita: null }); expect(card("Receita").numero).toBe("—"); expect(card("Resultado").numero).toBe("—");
});
test("preserva centavos e resultado negativo real", async () => {
  await abrir({ receita: 100.1, linhas: [lancamento(COMPETENCIA, { impostos: 200.2 })] });
  expect(card("Resultado").numero).toMatch(/-.*100,10/);
});
test("troca competência recarrega ambas as fontes inclusive dezembro", async () => {
  const vista = await abrir();
  api.getInvoices.mockResolvedValue({ summary: { totalAmount: 5000, totalInvoices: 1 } });
  api.getAliquotas.mockResolvedValue([lancamento("2026-12", { impostos: 1000 })]);
  vista.rerender(<PainelPage {...props} competencia="2026-12" />);
  await waitFor(() => expect(card("Resultado").numero).toMatch(/4\.000,00/));
  expect(card("Resultado").rotulo).toBe("Resultado · 12/2026");
  expect(api.getAliquotas).toHaveBeenLastCalledWith("pc-001", { from: "2026-12", to: "2026-12" });
});
test("edição atualiza notas e impostos sem caixa duplicado", async () => {
  await abrir();
  api.getInvoices.mockResolvedValue({ summary: { totalAmount: 30000, totalInvoices: 5 } });
  api.getAliquotas.mockResolvedValue([lancamento(COMPETENCIA, { impostos: 4000 })]);
  fireEvent.click(screen.getByRole("button", { name: "Atualizar após edição" }));
  await waitFor(() => expect(card("Resultado").numero).toMatch(/26\.000,00/));
  expect(api.getInvoices).toHaveBeenCalledTimes(2); expect(api.getAliquotas).toHaveBeenCalledTimes(2);
  expect(api.getFluxoCaixa).not.toHaveBeenCalled();
});
test("erro de impostos visível com retentativa sem número antigo", async () => {
  await abrir(); api.getAliquotas.mockRejectedValue(new Error("Indisponível"));
  fireEvent.click(screen.getByRole("button", { name: "Atualizar após edição" }));
  await waitFor(() => expect(screen.getByText(/Não foi possível carregar o resumo do mês/)).toBeInTheDocument());
  expect(card("Resultado").numero).toBe("—");
  api.getAliquotas.mockResolvedValue([lancamento()]);
  fireEvent.click(screen.getByRole("button", { name: /Tentar de novo/i }));
  await waitFor(() => expect(card("Resultado").numero).toMatch(/17\.000,00/));
});

test("lançamentos não classificados deixam ressalva e resultado provisório", async () => {
  await abrir({ linhas: [lancamento(COMPETENCIA, { naoClassificadas: 2 })] });
  expect(card("Imposto líquido").apoio).toMatch(/2 lançamento\(s\) sem conta contábil ficaram de fora/);
  expect(card("Resultado").apoio).toMatch(/Resultado provisório/);
});

test.each([[1000, 20000, "5,00%"], [0, 20000, "0,00%"]])("percentual pago usa pagamentos %s sobre receita %s", async (impostosPagos, faturamento, percentual) => {
  await abrir({ linhas: [{ ...lancamento(), impostosPagos, faturamento, efetiva: 99 }] });
  expect(card("Imposto líquido").apoio).toContain(`Imposto pago: ${percentual} da receita de 08/2026`);
  expect(card("Imposto líquido").apoio).toContain("Alíquota lançada em 08/2026: 15,00%");
  expect(card("Resultado").numero).toMatch(/17\.000,00/);
});
test.each([[null, 20000], [1000, null], [1000, 0], [undefined, undefined]])("pago indisponível não inventa percentual (%s/%s)", async (impostosPagos, faturamento) => {
  await abrir({ receita: faturamento, linhas: [{ ...lancamento(), impostosPagos, faturamento: 20000 }] });
  expect(card("Imposto líquido").apoio).toContain("Imposto pago: percentual indisponível para 08/2026");
});
test("valor do imposto aparece mesmo sem receita contábil para calcular alíquota", async () => {
  await abrir({ linhas: [lancamento(COMPETENCIA, { situacao: "SEM_RECEITA_LANCADA", base: 0, aliquota: null, impostos: 60, impostosComFolha: 60, aliquotaComFolha: null })] });
  expect(card("Imposto líquido").numero).toMatch(/60,00/);
  expect(card("Resultado").numero).toMatch(/19\.940,00/);
  expect(card("Imposto líquido").apoio).toContain("ainda não foi lançada");
});
test("INSS conhecido aparece mesmo sem imposto sobre receita", async () => {
  await abrir({ linhas: [lancamento(COMPETENCIA, { situacao: "SEM_IMPOSTO_LANCADO", aliquota: null, impostos: 0, impostosComFolha: 20, impostoSobreFolha: 20, aliquotaComFolha: null })] });
  expect(card("Imposto líquido").numero).toMatch(/20,00/);
  expect(card("Resultado").numero).toMatch(/19\.980,00/);
  expect(card("Imposto líquido").apoio).toContain("INSS incluído");
  expect(card("Resultado").apoio).toContain("Resultado provisório: tributos sobre receita ainda não lançados");
});
test("contas tributárias com total líquido zero provam valor conhecido", async () => {
  await abrir({ linhas: [lancamento(COMPETENCIA, { situacao: "SEM_IMPOSTO_LANCADO", aliquota: null, impostos: 0, impostosPorConta: [{ conta: "DAS", valor: 0 }] })] });
  expect(card("Imposto líquido").numero).toMatch(/0,00/);
  expect(card("Resultado").numero).toMatch(/20\.000,00/);
});

test("percentual pago usa a receita visível quando os agregados divergem", async () => {
  await abrir({ receita: 10000, linhas: [{ ...lancamento(), impostosPagos: 1000, faturamento: 20000 }] });
  expect(card("Receita").numero).toMatch(/10\.000,00/);
  expect(card("Imposto líquido").apoio).toContain("Imposto pago: 10,00% da receita de 08/2026");
  expect(card("Resultado").numero).toMatch(/7\.000,00/);
});

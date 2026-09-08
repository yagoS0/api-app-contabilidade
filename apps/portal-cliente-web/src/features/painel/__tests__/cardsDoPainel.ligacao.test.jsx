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
  expect(card("Resultado").numero).toBe("—"); expect(card("Imposto líquido").apoio).toBe("Sem dados para 08/2026");
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

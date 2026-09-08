import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SaldoInicial } from "../SaldoInicial";

const api = { salvarSaldoInicial: jest.fn(), excluirSaldoInicial: jest.fn() };
beforeEach(() => { jest.clearAllMocks(); api.salvarSaldoInicial.mockResolvedValue({ ok: true }); api.excluirSaldoInicial.mockResolvedValue({ ok: true }); });
function abrir(saldo = null) {
  const aoMudar = jest.fn();
  render(<SaldoInicial companyId="empresa" competencia="2026-09" saldo={saldo} api={api} aoMudar={aoMudar} />);
  fireEvent.click(screen.getByText(saldo ? "Alterar saldo inicial" : "Informar saldo inicial"));
  return aoMudar;
}
test("saldo zero é informado, não ausência; grava primeiro dia do mês e notifica painel", async () => {
  const mudou = abrir(); fireEvent.change(screen.getByLabelText("Valor inicial (R$)"), { target: { value: "0" } });
  fireEvent.click(screen.getByText("Salvar saldo inicial"));
  await waitFor(() => expect(api.salvarSaldoInicial).toHaveBeenCalledWith("empresa", { dataReferencia: "2026-09-01", valor: "0" }));
  expect(mudou).toHaveBeenCalledTimes(1);
});
test("falha preserva valor negativo e permite nova tentativa explícita", async () => {
  api.salvarSaldoInicial.mockRejectedValueOnce(new Error("Falha ao salvar"));
  const mudou = abrir(); fireEvent.change(screen.getByLabelText("Valor inicial (R$)"), { target: { value: "-125,50" } });
  fireEvent.click(screen.getByText("Salvar saldo inicial"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Falha ao salvar");
  expect(screen.getByLabelText("Valor inicial (R$)")).toHaveValue("-125,50"); expect(mudou).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Salvar saldo inicial")); await waitFor(() => expect(mudou).toHaveBeenCalledTimes(1));
  expect(api.salvarSaldoInicial).toHaveBeenLastCalledWith("empresa", { dataReferencia: "2026-09-01", valor: "-125.50" });
});
test("remoção usa endpoint próprio e comunica recálculo", async () => {
  const mudou = abrir({ dataReferencia: "2026-08-01", valor: 1000 });
  fireEvent.click(screen.getByText("Remover saldo inicial"));
  await waitFor(() => expect(api.excluirSaldoInicial).toHaveBeenCalledWith("empresa"));
  expect(mudou).toHaveBeenCalledTimes(1);
});
test.each(["1.000,00", "NaN", "2,123", "1000000000000"])("não envia valor ambíguo/inválido %s", value => {
  abrir(); fireEvent.change(screen.getByLabelText("Valor inicial (R$)"), { target: { value } });
  fireEvent.click(screen.getByText("Salvar saldo inicial")); expect(api.salvarSaldoInicial).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toBeInTheDocument();
});
test("trocar competência e recarregar a mesma âncora preserva rascunho", () => {
  const props = { companyId: "empresa", competencia: "2026-09", saldo: null, api, aoMudar: jest.fn() };
  const { rerender } = render(<SaldoInicial {...props} />);
  fireEvent.change(screen.getByLabelText("Valor inicial (R$)"), { target: { value: "123,45" } });
  rerender(<SaldoInicial {...props} competencia="2026-08" disponivel={false} />);
  rerender(<SaldoInicial {...props} competencia="2026-08" disponivel />);
  expect(screen.getByLabelText("Valor inicial (R$)")).toHaveValue("123,45");
  expect(screen.getByLabelText("Mês de início")).toHaveValue("2026-09");
});
test("visita do escritório vê valor e não tem controles de escrita", () => {
  render(<SaldoInicial companyId="empresa" saldo={{ dataReferencia: "2026-09-01", valor: 100 }} api={api} aoMudar={jest.fn()} somenteLeitura />);
  expect(screen.getByText(/100,00/)).toBeInTheDocument();
  expect(screen.queryByText("Alterar saldo inicial")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

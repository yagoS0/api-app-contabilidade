import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AcompanhamentoParcelamentos, filtrarAcompanhamento } from "../AcompanhamentoParcelamentos";

const dados = () => ({ contratos: [], indicacoes: [{ id: "ind-1", origem: "SITFIS", parcelasEmAtraso: 3, descricao: "Simples em parcelamento" }], mesOperacional: "2026-09", itens: [{ id: "indicacao:ind-1", estado: "IDENTIFICAR", tipo: "PARCSN" }], resumo: { pendentes: 1 } });
test("indício sem contrato é visível e não exige contabilização", async () => {
  const api = { getAcompanhamentoParcelamentos: jest.fn().mockResolvedValue(dados()), localizarParcelamentos: jest.fn().mockResolvedValue({ ok: true }) };
  render(<AcompanhamentoParcelamentos companyId="c1" api={api} />);
  expect(await screen.findByText("Identificação pendente")).toBeInTheDocument();
  expect(screen.getByText(/3 parcela\(s\) em atraso informadas/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Localizar acordos" }));
  await waitFor(() => expect(api.localizarParcelamentos).toHaveBeenCalledWith("c1", { modalidades: ["PARCSN", "PARCMEI"] }));
});
test("falha na consulta fica visível e não apaga a indicação anterior", async () => {
  const api = { getAcompanhamentoParcelamentos: jest.fn().mockResolvedValue(dados()), localizarParcelamentos: jest.fn().mockRejectedValue(new Error("Procuração inválida")) };
  render(<AcompanhamentoParcelamentos companyId="c1" api={api} />);
  fireEvent.click(await screen.findByRole("button", { name: "Localizar acordos" }));
  expect(await screen.findByText("Procuração inválida", { exact: false })).toBeInTheDocument();
  expect(screen.getByText("Identificação pendente")).toBeInTheDocument();
});
test("pagamento sem guia usa identidade da parcela; não chama baixa", async () => {
  const value = { ...dados(), itens: [{ id: "p1", parcelaId: "parcela-1", estado: "CONSULTAR_PAGAMENTO", tipo: "PARCMEI" }] };
  const api = { getAcompanhamentoParcelamentos: jest.fn().mockResolvedValue(value), consultarPagamentoParcela: jest.fn().mockResolvedValue({ ok: true, message: "Ainda não localizado" }) };
  const baixa = jest.fn();
  render(<AcompanhamentoParcelamentos companyId="c1" api={api} onDarBaixa={baixa} />);
  fireEvent.click(await screen.findByRole("button", { name: "Consultar pagamento" }));
  await waitFor(() => expect(api.consultarPagamentoParcela).toHaveBeenCalledWith("c1", "parcela-1"));
  expect(baixa).not.toHaveBeenCalled();
});
test("cadastro fiscal não solicita valores de provisão", async () => {
  const api = { getAcompanhamentoParcelamentos: jest.fn().mockResolvedValue(dados()), criarAcompanhamentoParcelamento: jest.fn().mockResolvedValue({ ok: true }) };
  render(<AcompanhamentoParcelamentos companyId="c1" api={api} />);
  fireEvent.click(await screen.findByRole("button", { name: "Acompanhar acordo" }));
  fireEvent.change(screen.getByLabelText("Número do parcelamento"), { target: { value: "123" } });
  fireEvent.click(screen.getByRole("button", { name: "Iniciar acompanhamento" }));
  await waitFor(() => expect(api.criarAcompanhamentoParcelamento).toHaveBeenCalledWith("c1", expect.objectContaining({ numeroParcelamento: "123" })));
  expect(api.criarAcompanhamentoParcelamento.mock.calls[0][1].provisaoLines).toBeUndefined();
});
test("anteriores permanecem no filtro de pendências; filtro mensal inclui indício sem data", () => {
  const itens = [{ id: 1, anterior: true, referencia: "2026-08", estado: "OBTER_GUIA" }, { id: 2, estado: "IDENTIFICAR" }, { id: 3, referencia: "2026-09", estado: "RESOLVIDA" }];
  expect(filtrarAcompanhamento(itens, "pendentes", "2026-09").map(i => i.id)).toEqual([1, 2]);
  expect(filtrarAcompanhamento(itens, "mes", "2026-09").map(i => i.id)).toEqual([2, 3]);
});
test("troca de empresa fecha cadastro e descarta resultado de consulta anterior", async () => {
  let concluir;
  const api = { getAcompanhamentoParcelamentos: jest.fn().mockResolvedValue(dados()), localizarParcelamentos: jest.fn(() => new Promise(r => { concluir = r; })) };
  const atualizou = jest.fn();
  const { rerender } = render(<AcompanhamentoParcelamentos companyId="c1" api={api} onAtualizado={atualizou} />);
  fireEvent.click(await screen.findByRole("button", { name: "Localizar acordos" }));
  rerender(<AcompanhamentoParcelamentos companyId="c2" api={api} onAtualizado={atualizou} />);
  concluir({ ok: true, message: "Resultado antigo" });
  await waitFor(() => expect(api.getAcompanhamentoParcelamentos).toHaveBeenCalledWith("c2"));
  expect(atualizou).not.toHaveBeenCalled();
  expect(screen.queryByText("Resultado antigo")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Acompanhar acordo" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  rerender(<AcompanhamentoParcelamentos companyId="c3" api={api} />);
  expect(screen.queryByRole("dialog")).toBeNull();
});

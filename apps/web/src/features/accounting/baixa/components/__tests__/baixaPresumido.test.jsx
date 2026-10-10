import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BaixaModal } from "../renderBaixaModal";

const accounts = [{ codigo: "250", tipo: "PASSIVO", nome: "Imposto a recolher" },
  { codigo: "499", tipo: "DESPESA", nome: "Despesa" }, { codigo: "5", tipo: "ATIVO", nome: "Banco" }];
const entry = { id: "p1", tipo: "PROVISAO", subtipo: "IRPJ", competencia: "2026-09", valor: 3000,
  lines: [{ tipo: "D", conta: "499", valor: 3000 }, { tipo: "C", conta: "250", valor: 3000 }] };
function abrir(over = {}) {
  const props = { entry, accounts, onSave: jest.fn(), onClose: jest.fn(),
    onLoadBaixaTemplate: jest.fn().mockResolvedValue({ template: null, saldoInfo: { principal: 3000, saldo: 2000, abatido: 1000 }, quotaNumero: 2 }), ...over };
  render(<BaixaModal {...props} />);
  return props;
}

test('data declarada pelo cliente preenche a baixa sem lançá-la e continua editável', () => {
  const props = abrir({ onLoadBaixaTemplate: undefined, entry: { ...entry, sourceGuide: { paymentStatus: 'PAID', paymentStatusSource: 'CLIENTE', paymentConfirmedAt: '2026-10-09T00:00:00.000Z' } } });
  const campo = screen.getByLabelText('Data do pagamento');
  expect(campo).toHaveValue('2026-10-09');
  expect(props.onSave).not.toHaveBeenCalled();
  fireEvent.change(campo, { target: { value: '2026-10-08' } });
  expect(campo).toHaveValue('2026-10-08');
});

test('comprovante confiável prevalece sobre declaração e mês diferente continua bloqueado', () => {
  abrir({ onLoadBaixaTemplate: undefined, competenciaPagamento: '2026-09', entry: { ...entry, comprovante: { confiavel: true, dataArrecadacao: '08/10/2026' }, sourceGuide: { paymentStatus: 'PAID', paymentStatusSource: 'CLIENTE', paymentConfirmedAt: '2026-10-09T00:00:00.000Z' } } });
  expect(screen.getByLabelText('Data do pagamento')).toHaveValue('2026-10-08');
  expect(screen.getByRole('button', { name: 'Confirmar Baixa' })).toBeDisabled();
});

test.each(["IRPJ", "CSLL", "PIS", "COFINS"])("%s sem memória baixa o saldo sem inverter a despesa", async (subtipo) => {
  const props = abrir({ entry: { ...entry, subtipo } });
  await waitFor(() => expect(screen.getAllByDisplayValue("2000.00")).toHaveLength(2));
  const contas = screen.getAllByPlaceholderText("Código da conta");
  expect(contas[0]).toHaveValue("250");
  expect(contas[1]).toHaveValue("");
  expect(screen.getByRole("button", { name: "Confirmar Baixa" })).toBeDisabled();
  fireEvent.change(contas[1], { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirmar Baixa" }));
  await waitFor(() => expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({
    historico: expect.stringContaining(`Pagamento ${subtipo}`),
    lines: [expect.objectContaining({ tipo: "D", conta: "250", valor: 2000, papel: "PRINCIPAL" }),
      expect.objectContaining({ tipo: "C", conta: "5", valor: 2000 })],
  })));
});

test("sem template mantém juros e multa separados do principal", async () => {
  abrir({ onLoadBaixaTemplate: jest.fn().mockResolvedValue({ template: null, saldoInfo: { saldo: 2000 }, acrescimo: { juros: 30, multa: 20 } }) });
  await waitFor(() => expect(screen.getAllByPlaceholderText("Código da conta")).toHaveLength(4));
  expect(screen.getByDisplayValue("30.00")).toBeInTheDocument();
  expect(screen.getByDisplayValue("20.00")).toBeInTheDocument();
  expect(screen.getByDisplayValue("2050.00")).toBeInTheDocument();
});

test("falha de carregamento é visível e não preenche a despesa como banco", async () => {
  abrir({ onLoadBaixaTemplate: jest.fn().mockRejectedValue(new Error("offline")) });
  await screen.findByText(/Não foi possível carregar as contas e o saldo/);
  expect(screen.getAllByPlaceholderText("Código da conta")[1]).toHaveValue("");
  expect(screen.getByRole("button", { name: "Confirmar Baixa" })).toBeDisabled();
});

test("regra de pagamento continua preenchendo o par memorizado", async () => {
  abrir({ onLoadBaixaTemplate: jest.fn().mockResolvedValue({ template: { debitAccountCode: "250", creditAccountCode: "5", valor: 3000, historico: "PAGAMENTO IRPJ", scope: "MEMORIA" } }) });
  await waitFor(() => expect(screen.getAllByPlaceholderText("Código da conta")[1]).toHaveValue("5"));
  expect(screen.getByRole("button", { name: "Confirmar Baixa" })).toBeEnabled();
});

test("ISS com juros adicionados exige papel e anuncia lançamentos individuais", async () => {
  abrir({ entry: { ...entry, subtipo: "ISS" } });
  await waitFor(() => expect(screen.getAllByDisplayValue("2000.00")).toHaveLength(2));
  fireEvent.click(screen.getByRole("button", { name: "+ Débito" }));
  const contas = screen.getAllByPlaceholderText("Código da conta");
  fireEvent.change(contas[1], { target: { value: "5" } });
  fireEvent.change(contas[2], { target: { value: "501" } });
  const valores = screen.getAllByRole("spinbutton");
  fireEvent.change(valores[2], { target: { value: "20" } });
  fireEvent.change(valores[1], { target: { value: "2020" } });
  expect(screen.getByRole("button", { name: "Confirmar Baixa" })).toBeDisabled();
  fireEvent.change(screen.getAllByTitle(/Principal amortiza o passivo/)[1], { target: { value: "JUROS" } });
  expect(screen.getByRole("button", { name: "Confirmar Baixa" })).toBeEnabled();
  expect(screen.getByText(/Serão gerados 2 lançamentos individuais/)).toBeInTheDocument();
});

test('pagamento pela aba Lançamentos exige data no mês selecionado', async () => {
  const props = abrir({ competenciaPagamento: '2026-01', onLoadBaixaTemplate: jest.fn().mockResolvedValue({ template: { debitAccountCode: '250', creditAccountCode: '5', valor: 3000 } }) });
  await waitFor(() => expect(screen.getAllByPlaceholderText('Código da conta')[1]).toHaveValue('5'));
  const data = screen.getByLabelText('Data do pagamento');
  fireEvent.change(data, { target: { value: '2026-02-20' } });
  expect(screen.getByRole('button', { name: 'Confirmar Baixa' })).toBeDisabled();
  fireEvent.change(data, { target: { value: '2026-01-20' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar Baixa' }));
  await waitFor(() => expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ data: '2026-01-20' })));
});

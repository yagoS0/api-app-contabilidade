import { act, fireEvent, render, screen } from "@testing-library/react";
import { BaixaManualParcelaModal } from "../BaixaManualParcelaModal";
it("prefill fiscal é aplicado na abertura e não sobrescreve a edição do contador", () => {
  const linha = { parcelaId: "p1", valorPrevisto: 100, pagamentoConfirmado: true, pagamentoEm: "2026-09-10T00:00:00Z", comprovante: { principal: 100, juros: 0, multa: 0 } };
  const { rerender } = render(<BaixaManualParcelaModal linha={linha} />);
  expect(screen.getByText("Pagamento confirmado pela Receita.")).toBeInTheDocument();
  const juros = screen.getByLabelText("Juros (você declara)");
  fireEvent.change(juros, { target: { value: "2,00" } });
  rerender(<BaixaManualParcelaModal linha={{ ...linha, comprovante: { ...linha.comprovante, juros: 8 } }} />);
  expect(juros).toHaveValue("2,00");
});
it("principal confirmado não modifica o contrato que foi consultado depois do pagamento", async () => {
  const corrigir = jest.fn();
  const confirmar = jest.fn().mockResolvedValue({ ok: true });
  render(<BaixaManualParcelaModal linha={{ parcelaId: "p1", valorPrevisto: 110, pagamentoConfirmado: true, pagamentoEm: "2026-09-10", comprovante: { principal: 100, juros: 0, multa: 0 } }} onCorrigirValorContratado={corrigir} onConfirmar={confirmar} />);
  expect(screen.getByLabelText("Principal confirmado")).toBeDisabled();
  expect(screen.getByLabelText("Principal confirmado")).toHaveValue("100,00");
  fireEvent.click(screen.getByRole("button", { name: "Declarar e lançar a baixa" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirmar pagamento declarado" })); });
  expect(corrigir).not.toHaveBeenCalled();
  expect(confirmar).toHaveBeenCalledWith(expect.objectContaining({ totalConferido: 100 }));
});

it("valor contratual salvo sobrevive à falha de baixa e não é reenviado com valor anterior vencido", async () => {
  const onCorrigirValorContratado = jest.fn().mockResolvedValue({ ok: true });
  const onConfirmar = jest.fn().mockRejectedValueOnce(new Error("Mês fechado"));
  const onClose = jest.fn();
  render(<BaixaManualParcelaModal linha={{ parcelaId: "p1", numeroParcela: 1, valorPrevisto: 100, parcelamento: { label: "Acordo", numParcelas: 12 } }} onConfirmar={onConfirmar} onCorrigirValorContratado={onCorrigirValorContratado} onClose={onClose} />);
  fireEvent.change(screen.getByLabelText("Principal (valor contratado)"), { target: { value: "120,00" } });
  fireEvent.click(screen.getByRole("button", { name: "Informar valor e declarar a baixa" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirmar pagamento declarado" })); });
  expect(onCorrigirValorContratado).toHaveBeenCalledWith({ parcelaId: "p1", valorPrevisto: 120, valorAnteriorConferido: 100 });
  expect(screen.getByText(/O valor contratado foi salvo/)).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Declarar e lançar a baixa" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirmar pagamento declarado" })); });
  expect(onCorrigirValorContratado).toHaveBeenCalledTimes(1);
  expect(onConfirmar).toHaveBeenCalledTimes(2);
  expect(onConfirmar.mock.calls[1][0].totalConferido).toBe(120);
});

it("não permite fechar a declaração enquanto a baixa está em processamento", async () => {
  let concluir;
  const onConfirmar = jest.fn(() => new Promise((resolve) => { concluir = resolve; }));
  const onClose = jest.fn();
  render(<BaixaManualParcelaModal linha={{ parcelaId: "p1", valorPrevisto: 100 }} onConfirmar={onConfirmar} onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "Declarar e lançar a baixa" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirmar pagamento declarado" })); });
  expect(screen.queryByRole("button", { name: "Fechar" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => { concluir({ ok: true }); });
});

it("confirmação suspende o formulário; Escape cancela só a confirmação e devolve o foco", async () => {
  const onClose = jest.fn();
  const onConfirmar = jest.fn();
  render(<BaixaManualParcelaModal linha={{ parcelaId: "p1", valorPrevisto: 100 }} onConfirmar={onConfirmar} onClose={onClose} />);
  const acao = screen.getByRole("button", { name: "Declarar e lançar a baixa" });
  acao.focus();
  fireEvent.click(acao);
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(screen.getByRole("dialog")).toHaveAccessibleName("Confirmar declaração de pagamento");
  fireEvent.keyDown(document, { key: "Escape" });
  await act(async () => {});
  expect(screen.getByRole("dialog")).toHaveAccessibleName("Declarar baixa da prestação");
  expect(document.activeElement).toBe(acao);
  expect(onClose).not.toHaveBeenCalled();
  expect(onConfirmar).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});

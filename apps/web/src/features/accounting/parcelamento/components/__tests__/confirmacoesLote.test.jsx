import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { InformarValorEmLoteModal } from "../InformarValorEmLoteModal";
import { ConferenciaParcelasPanel } from "../ParcelamentoModals";

it("valores contratados: Escape conserva formulário e confirmar envia os valores conferidos", async () => {
  const onInformar = jest.fn().mockResolvedValue({});
  const onClose = jest.fn();
  render(<InformarValorEmLoteModal grupo={{ label: "Acordo teste", quantidade: 2, parcelas: [
    { parcelaId: "p1", numeroParcela: 1, competencia: "2026-08", valorPrevisto: 0 },
    { parcelaId: "p2", numeroParcela: 2, competencia: "2026-09", valorPrevisto: 80 },
  ] }} onInformar={onInformar} onClose={onClose} />);
  fireEvent.change(screen.getByLabelText("Valor de todas"), { target: { value: "125,50" } });
  fireEvent.click(screen.getByRole("button", { name: "Informar valor em 2 prestações" }));
  let dialogo = screen.getByRole("dialog", { name: "Confirmar valores contratados" });
  expect(dialogo.textContent).toContain("ISTO ALTERA O CONTRATO");
  expect(dialogo.textContent).toContain("prestação 1");
  expect(dialogo.textContent).toContain("prestação 2");
  expect(onInformar).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Valor de todas").value).toBe("125,50");
  fireEvent.click(screen.getByRole("button", { name: "Informar valor em 2 prestações" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Gravar valores contratados" })); });
  expect(onInformar.mock.calls.map(([body]) => body)).toEqual([
    { parcelaId: "p1", valorPrevisto: 125.5, valorAnteriorConferido: 0 },
    { parcelaId: "p2", valorPrevisto: 125.5, valorAnteriorConferido: 80 },
  ]);
});

it("aprovação de baixas: cancelar mantém seleção e confirmar usa somente as selecionadas", async () => {
  const aprovarConferencia = jest.fn().mockResolvedValue({});
  const listConferencia = jest.fn().mockResolvedValue([
    { guideId: "g1", estado: "PAGA_A_CONFERIR", numeroParcela: 1, competencia: "2026-08", valor: 125.5 },
    { guideId: "g2", estado: "PAGA_A_CONFERIR", numeroParcela: 2, competencia: "2026-09", valor: 100 },
  ]);
  await act(async () => { render(<ConferenciaParcelasPanel listConferencia={listConferencia} aprovarConferencia={aprovarConferencia} />); });
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  fireEvent.click(screen.getByRole("button", { name: "Aprovar (1)" }));
  const dialogo = screen.getByRole("dialog", { name: "Aprovar baixas conferidas" });
  expect(dialogo.textContent).toContain("RASCUNHO para CONFIRMADO");
  expect(dialogo.textContent).toContain("2026-08");
  expect(dialogo.textContent).not.toContain("2026-09");
  fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
  expect(aprovarConferencia).not.toHaveBeenCalled();
  expect(screen.getAllByRole("checkbox")[0].checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Aprovar (1)" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Aprovar baixas" })); });
  expect(aprovarConferencia).toHaveBeenCalledWith(["g1"]);
});

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { CsvExportModal } from "../renderAccountingEntriesParts";

afterEach(() => jest.clearAllMocks());
async function abrir({ jaExportados = 0 } = {}) {
  const onExport = jest.fn().mockResolvedValue({});
  const onReabrir = jest.fn().mockResolvedValue({});
  const onClose = jest.fn();
  render(<CsvExportModal defaultCompetencia="2026-08" onExport={onExport} onReabrir={onReabrir} onClose={onClose}
    onPreflight={async () => ({ totais: { entries: 2, linhas: 4, totalD: 100, totalC: 100, diferenca: 0 }, erros: [], alertas: [{ motivo: "Mês ainda aberto" }], jaExportados })} />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Conferir" })); });
  return { onExport, onClose, onReabrir };
}
it("CSV com alertas aguarda confirmação, cancelar preserva intervalo e não exporta", async () => {
  const { onExport, onClose } = await abrir();
  fireEvent.click(screen.getByRole("button", { name: "Exportar" }));
  const dialogo = screen.getByRole("dialog", { name: "Conferir alertas da exportação" });
  expect(dialogo.textContent).toContain("Mês ainda aberto");
  expect(onExport).not.toHaveBeenCalled();
  fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Exportar" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Exportar com alertas" })); });
  expect(onExport).toHaveBeenCalledWith({ competenciaInicio: "2026-08", competenciaFim: "2026-08" });
  expect(onClose).toHaveBeenCalledTimes(1);
});
it("reabrir exportados explicita competência e consequência; Escape não executa", async () => {
  const { onReabrir } = await abrir({ jaExportados: 2 });
  fireEvent.click(screen.getByRole("button", { name: /Reabrir os lançamentos exportados/ }));
  const dialogo = screen.getByRole("dialog", { name: "Reabrir lançamentos exportados" });
  expect(dialogo.textContent).toContain("2 lançamento(s) de 2026-08");
  expect(dialogo.textContent).toContain("deixam de constar como enviados");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onReabrir).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Reabrir os lançamentos exportados/ }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reabrir lançamentos" })); });
  expect(onReabrir).toHaveBeenCalledWith("2026-08");
});

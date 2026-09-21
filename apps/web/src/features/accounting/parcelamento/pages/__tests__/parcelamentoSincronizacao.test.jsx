import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ParcelamentoTab } from "../renderParcelamentoTab";

const mockListPendentes = jest.fn();
const mockListSemGuia = jest.fn();
const mockBaixa = jest.fn();
jest.mock("../../../../../api/client", () => ({ createApiClient: () => ({
  listParcelasPendentesBaixa: (...args) => mockListPendentes(...args),
  listParcelasSemGuiaPendentes: (...args) => mockListSemGuia(...args),
  lancarBaixaParcela: (...args) => mockBaixa(...args),
}) }));

const contrato = { id: "p1", label: "Acordo Simples 123", status: "ATIVO", tipo: "PARCSN", parcelasTotal: 12, numParcelas: 12, parcelasPagas: 0, guides: [], parcelas: [], parcelasContratadas: [] };
const parcela = (id, numero) => ({ guideId: id, numeroParcela: numero, parcelamentoId: "p1", competencia: "2026-08", valor: 100 });
const hook = () => ({ parcelamentos: [contrato], loading: false, load: jest.fn(), listConferencia: jest.fn().mockResolvedValue([]) });
beforeEach(() => { jest.clearAllMocks(); mockListSemGuia.mockResolvedValue({ parcelas: [] }); Element.prototype.scrollIntoView = jest.fn(); });

it("baixa com guia mantém confirmação visível e atualiza cards, filas e conferência", async () => {
  const state = hook();
  mockListPendentes.mockResolvedValueOnce({ parcelas: [parcela("g1", 1)] }).mockResolvedValue({ parcelas: [] });
  mockBaixa.mockResolvedValue({ ok: true });
  await act(async () => { render(<ParcelamentoTab companyId="A" parcelamentos={state} />); });
  const fila = screen.getByText("Parcelas pagas aguardando lançamento").closest("section");
  expect(within(fila).getByText("Acordo Simples 123")).toBeInTheDocument();
  fireEvent.click(within(fila).getByRole("button", { name: "Dar baixa" }));
  const dialogo = screen.getByRole("dialog", { name: "Confirmar baixa da parcela" });
  expect(dialogo).toHaveTextContent("Acordo Simples 123");
  await act(async () => { fireEvent.click(within(dialogo).getByRole("button", { name: "Dar baixa" })); });
  expect(mockBaixa).toHaveBeenCalledWith("A", "g1", null);
  expect(screen.getByText("Baixa da parcela 1 lançada.")).toBeInTheDocument();
  expect(state.load).toHaveBeenCalledTimes(1);
  expect(state.listConferencia).toHaveBeenCalledTimes(2);
  expect(mockListSemGuia).toHaveBeenCalledTimes(2);
});

it("baixa em lote distingue sucesso de recusa e preserva o motivo da parcela pendente", async () => {
  const state = hook();
  mockListPendentes.mockResolvedValueOnce({ parcelas: [parcela("g1", 1), parcela("g2", 2)] }).mockResolvedValue({ parcelas: [parcela("g2", 2)] });
  mockBaixa.mockImplementation(async (_company, id) => id === "g1" ? { ok: true } : { skipped: true, motivo: "sem_composicao" });
  await act(async () => { render(<ParcelamentoTab companyId="A" parcelamentos={state} />); });
  fireEvent.click(screen.getByRole("button", { name: "Baixa em lote" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirmar baixas" })); });
  expect(screen.getByText(/1 baixa\(s\) lançada\(s\).*1 parcela\(s\) não lançada/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Informar a composição" })).toBeInTheDocument();
  expect(state.load).toHaveBeenCalledTimes(1);
});

it("trocar empresa com confirmação aberta cancela o pedido sem lançar na anterior", async () => {
  mockListPendentes.mockImplementation(async (company) => ({ parcelas: company === "A" ? [parcela("g1", 1)] : [] }));
  const state = hook();
  const { rerender } = render(<ParcelamentoTab companyId="A" parcelamentos={state} />);
  await act(async () => {});
  fireEvent.click(screen.getAllByRole("button", { name: "Dar baixa" })[0]);
  expect(screen.getByRole("dialog", { name: "Confirmar baixa da parcela" })).toBeInTheDocument();
  await act(async () => { rerender(<ParcelamentoTab companyId="B" parcelamentos={{ ...state, parcelamentos: [] }} />); });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(mockBaixa).not.toHaveBeenCalled();
  expect(screen.queryByText("Acordo Simples 123")).not.toBeInTheDocument();
});

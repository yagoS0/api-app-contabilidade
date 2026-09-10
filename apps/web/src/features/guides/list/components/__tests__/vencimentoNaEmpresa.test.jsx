import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CompanyGuidesTable } from "../renderCompanyGuidesTable";
const mockReport = jest.fn();
const mockFechamento = jest.fn();
jest.mock("../../../../../api/client", () => ({ createApiClient: () => ({
  getExpectedGuides: jest.fn().mockResolvedValue({ compliance: {} }),
  getFechamentoContabil: jest.fn().mockResolvedValue({}),
  getFechamento: (...args) => mockFechamento(...args),
  getCompanyGuideDueReport: (...args) => mockReport(...args),
}) }));
jest.mock("../../../capture/components/renderGuideCaptureModal", () => ({ GuideCaptureModal: () => null }));
jest.mock("../GuiaDeParcelamentoModal", () => ({ GuiaDeParcelamentoModal: () => null }));
const guia = (id, competencia, vencimento, extra = {}) => ({
  guideId: id, tipo: id, competencia, vencimento, status: "PROCESSED", paymentStatus: "OPEN", ...extra,
});
const guides = [
  guia("DAS-AGOSTO", "2026-08", "2026-09-20T00:00:00Z"),
  guia("PARCELA-SETEMBRO", "2026-09", "2026-09-01T00:00:00Z"),
  guia("PARCELA-PAGA", "2026-08", "2026-08-20T00:00:00Z", { paymentStatus: "PAID" }),
  guia("ANTIGA", "2026-07", "2026-08-20T00:00:00Z"),
  guia("SEM-DATA", "2026-08", null),
];
beforeEach(() => { jest.clearAllMocks(); mockReport.mockResolvedValue({ outros: [] }); });
function montar(items = guides) {
  const props = { companyId: "c1", competencia: "2026-08", guides: items, loadingGuides: false };
  const result = render(<CompanyGuidesTable {...props} />);
  return { ...result, props };
}
test("vencimento reúne DAS de agosto e parcela de setembro; antigas e sem data ficam fora", async () => {
  const { rerender, props } = montar();
  expect(screen.getByText("DAS-AGOSTO")).toBeInTheDocument();
  expect(screen.getByText("PARCELA-SETEMBRO")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Vencimentos de Setembro 2026" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Mês de vencimento")).toBeNull();
  expect(screen.queryByRole("combobox", { name: "Exibir" })).toBeNull();
  for (const tipo of ["PARCELA-PAGA", "ANTIGA", "SEM-DATA"]) expect(screen.queryByText(tipo)).toBeNull();
  expect(screen.getByRole("button", { name: "Pendências anteriores (1)" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: /Selecionar guia DAS-AGOSTO/ }));
  rerender(<CompanyGuidesTable {...props} competencia="2026-07" />);
  expect(screen.queryByText("DAS-AGOSTO")).toBeNull();
  expect(screen.getByRole("heading", { name: "Vencimentos de Agosto 2026" })).toBeInTheDocument();
  expect(screen.getByText("PARCELA-PAGA")).toBeInTheDocument();
  rerender(<CompanyGuidesTable {...props} />);
  expect(screen.getByRole("checkbox", { name: /Selecionar guia DAS-AGOSTO/ })).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Pendências anteriores (1)" }));
  expect(screen.getByText("ANTIGA")).toBeInTheDocument();
  expect(screen.queryByText("PARCELA-PAGA")).toBeNull();
  await waitFor(() => expect(mockReport).toHaveBeenCalledWith("c1", "2026-09"));
});
test("trocar a competência encerra a consulta auxiliar e dezembro mostra janeiro do ano seguinte", async () => {
  const { rerender, props } = montar([guia("JANEIRO", "2026-12", "2027-01-20")]);
  fireEvent.click(screen.getByText("Outras consultas"));
  fireEvent.click(screen.getByRole("button", { name: "Histórico completo" }));
  rerender(<CompanyGuidesTable {...props} competencia="2026-12" />);
  expect(screen.getByRole("heading", { name: "Vencimentos de Janeiro 2027" })).toBeInTheDocument();
  expect(screen.getByText("JANEIRO")).toBeInTheDocument();
  await waitFor(() => expect(mockReport).toHaveBeenLastCalledWith("c1", "2027-01"));
});
test("mês sem documento mostra parcela faltante sem concluir que não há tributo", async () => {
  mockReport.mockResolvedValue({ outros: [{ faltantes: [{ parcelaId: "p1", acordo: "123", numeroParcela: 9, vencimento: "2026-09-20", motivo: "Guia ainda não disponível" }] }] });
  montar([]);
  expect(await screen.findByText("Atenção: faltam guias de parcelamento neste vencimento")).toBeInTheDocument();
  expect(screen.getByText(/Isso não confirma ausência de tributos/)).toBeInTheDocument();
  expect(mockFechamento).not.toHaveBeenCalled();
});
test("falha de conferência é explícita e permite repetir leitura", async () => {
  mockReport.mockRejectedValue(new Error("Consulta indisponível"));
  montar();
  expect(await screen.findByText("Não foi possível conferir as parcelas previstas")).toBeInTheDocument();
  mockReport.mockResolvedValue({ outros: [] });
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  await waitFor(() => expect(screen.queryByText("Não foi possível conferir as parcelas previstas")).toBeNull());
});

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CompanyGuidesTable } from "../renderCompanyGuidesTable";
const mockVincular = jest.fn();
const mockReport = jest.fn();
jest.mock("../../../../../api/client", () => ({ createApiClient: () => ({
  getExpectedGuides: jest.fn().mockResolvedValue({ compliance: {} }),
  getFechamentoContabil: jest.fn().mockResolvedValue({}),
  getCompanyGuideDueReport: (...args) => mockReport(...args),
  vincularGuiaParcelamento: (...args) => mockVincular(...args),
}) }));
jest.mock("../../../capture/components/renderGuideCaptureModal", () => ({ GuideCaptureModal: () => null }));
jest.mock("../../../../accounting/parcelamento/components/ParcelamentoWizard", () => ({ ParcelamentoWizard: ({ onClose }) => <button onClick={() => onClose({ data: { parcelamentoId: "contrato-novo" } })}>Concluir cadastro</button> }));
jest.mock("../GuiaDeParcelamentoModal", () => ({ GuiaDeParcelamentoModal: props => <div role="dialog" aria-label="Parcela">
  <span>{props.guiaExistente?.id}</span><span>{props.parcelamentoIdInicial}</span>
  <button onClick={() => props.onSalvar({ somenteGuia: true, metadata: { tipo: "SIMPLES", competencia: "2026-09", parcelamentoTipo: "PARCSN" } })}>Salvar avulsa</button>
  <button onClick={() => props.onSalvar({ somenteGuia: false, parcelamentoId: "contrato", numeroParcela: 3, metadata: { tipo: "SIMPLES", competencia: "2026-09", parcelamentoTipo: "PARCSN" } })}>Salvar vínculo</button>
  <button onClick={props.onCriarNovoParcelamento}>Criar contrato</button>
  <button onClick={props.onClose}>Fechar upload</button>
</div> }));
const props = { companyId: "c1", competencia: "2026-08", guides: [], loadingGuides: false };
beforeEach(() => {
  jest.clearAllMocks(); mockVincular.mockResolvedValue({ ok: true });
  mockReport.mockResolvedValue({ conferirVencimento: [{ id: "i1", indicacaoId: "i1", portalClientId: "c1", tipo: "PARCSN", atrasada: true, atrasosInformados: 3 }] });
});
test("indício vira linha sem valor nem vencimento e upload não exige contrato", async () => {
  const upload = jest.fn().mockResolvedValue({ ok: true, guide: { id: "g1" } });
  const refresh = jest.fn();
  render(<CompanyGuidesTable {...props} onUploadGuide={upload} onRefresh={refresh} />);
  expect(await screen.findByText("Falta guia de parcelamento")).toBeInTheDocument();
  expect(screen.getByText("3 parcela(s) em atraso no relatório fiscal.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Subir parcela" }));
  fireEvent.click(screen.getByText("Salvar avulsa"));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(upload).toHaveBeenCalledWith(null, expect.objectContaining({ isParcelamento: true, indicacaoId: "i1" }));
  expect(mockVincular).not.toHaveBeenCalled();
});
test("falha no vínculo conserva guia e repetir não repete upload", async () => {
  mockVincular.mockRejectedValueOnce(new Error("Indisponível"));
  const upload = jest.fn().mockResolvedValue({ ok: true, guide: { id: "g1" } });
  render(<CompanyGuidesTable {...props} onUploadGuide={upload} />);
  fireEvent.click(await screen.findByRole("button", { name: "Subir parcela" }));
  fireEvent.click(screen.getByText("Salvar vínculo"));
  await screen.findByText("g1");
  await waitFor(() => expect(mockVincular).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByText("Salvar vínculo"));
  await waitFor(() => expect(mockVincular).toHaveBeenCalledTimes(2));
  expect(upload).toHaveBeenCalledTimes(1);
  expect(mockVincular).toHaveBeenLastCalledWith("c1", "g1", { parcelamentoId: "contrato", numeroParcela: 3 });
});
test("cadastro do parcelamento retorna ao upload na mesma tela", async () => {
  render(<CompanyGuidesTable {...props} onUploadGuide={jest.fn()} parcelamentos={{ ingest: jest.fn(), parcelamentos: [] }} />);
  fireEvent.click(await screen.findByRole("button", { name: "Subir parcela" }));
  fireEvent.click(screen.getByText("Criar contrato"));
  expect(screen.queryByRole("dialog", { name: "Parcela" })).toBeNull();
  // O modal escondido ainda pode receber Escape; seu fechamento não descarta o upload.
  fireEvent.click(screen.getByText("Fechar upload"));
  fireEvent.click(screen.getByText("Concluir cadastro"));
  expect(screen.getByRole("dialog", { name: "Parcela" })).toBeVisible();
  expect(screen.getByText("contrato-novo")).toBeInTheDocument();
});
test("guia avulsa paga permite vínculo posterior sem novo arquivo nem nova baixa", async () => {
  const upload = jest.fn();
  render(<CompanyGuidesTable {...props} onUploadGuide={upload} guides={[{ id: "paga", parcelamentoId: "avulso", parcelamentoAvulso: true, tipo: "SIMPLES", competencia: "2026-09", vencimento: "2026-09-20", status: "PROCESSED", paymentStatus: "PAID", valor: 100 }]} />);
  fireEvent.click(screen.getByRole("checkbox", { name: /Selecionar guia/ }));
  fireEvent.click(screen.getByText("Vincular parcelamento"));
  fireEvent.click(screen.getByText("Salvar vínculo"));
  await waitFor(() => expect(mockVincular).toHaveBeenCalledWith("c1", "paga", { parcelamentoId: "contrato", numeroParcela: 3 }));
  expect(upload).not.toHaveBeenCalled();
});

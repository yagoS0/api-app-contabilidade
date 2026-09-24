import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GuiaDeParcelamentoModal } from "../GuiaDeParcelamentoModal";
const contrato = { id: "p", status: "ATIVO", tipo: "PARCSN", numeroParcelamento: "123", numParcelas: null, parcelasContratadas: [] };
const arquivo = new File(["%PDF-test"], "parcela.pdf", { type: "application/pdf" });
beforeEach(() => { URL.createObjectURL = jest.fn(() => "blob:pdf"); URL.revokeObjectURL = jest.fn(); });
function preencher() {
  fireEvent.change(screen.getByLabelText("Modalidade"), { target: { value: "PARCSN" } });
  fireEvent.change(screen.getByLabelText("Competência (AAAA-MM)"), { target: { value: "2026-09" } });
  fireEvent.change(screen.getByLabelText("Valor (R$)"), { target: { value: "100,50" } });
  fireEvent.change(screen.getByLabelText("Vencimento"), { target: { value: "2026-09-25" } });
}
test("apenas subir é padrão mesmo com contrato existente, sem criação ou contabilização implícita", async () => {
  const salvar = jest.fn(async () => ({ ok: true })); const criar = jest.fn();
  render(<GuiaDeParcelamentoModal parcelamentosAtivos={[contrato]} arquivo={arquivo} onSalvar={salvar} onCriarNovoParcelamento={criar} />);
  expect(screen.getByLabelText("Como deseja continuar?")).toHaveValue("APENAS");
  preencher(); fireEvent.click(screen.getByRole("button", { name: "Subir parcela" }));
  await waitFor(() => expect(salvar).toHaveBeenCalledWith(expect.objectContaining({ somenteGuia: true, parcelamentoId: null, header: null,
    metadata: expect.objectContaining({ isParcelamento: true, parcelamentoTipo: "PARCSN", valor: 100.5, numeroParcela: null }) })));
  expect(criar).not.toHaveBeenCalled();
});
test("empresa sem contrato também consegue subir o documento", async () => {
  const salvar = jest.fn(async () => ({ ok: true }));
  render(<GuiaDeParcelamentoModal arquivo={arquivo} onSalvar={salvar} indicacaoId="ind" />);
  preencher(); fireEvent.click(screen.getByRole("button", { name: "Subir parcela" }));
  await waitFor(() => expect(salvar).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ indicacaoId: "ind" }) })));
});
test("vincula guia existente sem PDF novo e preserva informações do documento", async () => {
  const salvar = jest.fn(async () => ({ ok: true }));
  render(<GuiaDeParcelamentoModal parcelamentosAtivos={[contrato]} onSalvar={salvar}
    guiaExistente={{ id: "g", tipo: "SIMPLES", competencia: "2026-09", valor: 100, vencimento: "2026-09-25" }} />);
  expect(screen.queryByRole("button", { name: /Escolher PDF/ })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Valor (R$)")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Vincular parcela" }));
  await waitFor(() => expect(salvar).toHaveBeenCalledWith(expect.objectContaining({ somenteGuia: false, guideId: "g", parcelamentoId: "p", numeroParcela: null })));
});
test("contabilizar agora abre somente o fluxo solicitado, sem salvar automaticamente", () => {
  const salvar = jest.fn(); const criar = jest.fn();
  render(<GuiaDeParcelamentoModal onSalvar={salvar} onCriarNovoParcelamento={criar} />);
  fireEvent.click(screen.getByRole("button", { name: "Contabilizar agora" }));
  expect(criar).toHaveBeenCalledTimes(1); expect(salvar).not.toHaveBeenCalled();
});
test("recusa falta de arquivo e competência inválida com mensagem", async () => {
  const salvar = jest.fn(); render(<GuiaDeParcelamentoModal onSalvar={salvar} />);
  preencher(); fireEvent.change(screen.getByLabelText("Competência (AAAA-MM)"), { target: { value: "2026-19" } });
  fireEvent.click(screen.getByRole("button", { name: "Subir parcela" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("competência");
  fireEvent.change(screen.getByLabelText("Competência (AAAA-MM)"), { target: { value: "2026-09" } });
  fireEvent.click(screen.getByRole("button", { name: "Subir parcela" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Selecione o PDF"); expect(salvar).not.toHaveBeenCalled();
});
test("vínculo de guia paga preserva valor e não confirma pagamento novamente", async () => {
  const salvar = jest.fn(async () => ({ ok: true }));
  render(<GuiaDeParcelamentoModal parcelamentosAtivos={[contrato]} onSalvar={salvar}
    guiaExistente={{ id: "paga", tipo: "SIMPLES", competencia: "2026-09", valor: 100, paymentStatus: "PAID", numeroParcela: 3 }} />);
  fireEvent.click(screen.getByRole("button", { name: "Vincular parcela" }));
  await waitFor(() => expect(salvar).toHaveBeenCalledWith(expect.objectContaining({ guideId: "paga", numeroParcela: 3, metadata: expect.objectContaining({ valor: 100 }) })));
  expect(salvar.mock.calls[0][0]).not.toHaveProperty("paymentStatus");
});
test("retentativa após upload preserva modo e documento existente sem pedir novo arquivo", async () => {
  const salvar = jest.fn(async () => ({ ok: false, message: "Tente novamente" }));
  const { rerender } = render(<GuiaDeParcelamentoModal arquivo={arquivo} onSalvar={salvar} />);
  preencher();
  rerender(<GuiaDeParcelamentoModal onSalvar={salvar} guiaExistente={{ id: "criada", tipo: "SIMPLES", competencia: "2026-09", valor: 100.5 }} />);
  fireEvent.click(screen.getByRole("button", { name: "Salvar parcela" }));
  await waitFor(() => expect(salvar).toHaveBeenCalledWith(expect.objectContaining({ guideId: "criada", somenteGuia: true, parcelamentoId: null })));
  expect(screen.queryByRole("button", { name: /Escolher PDF/ })).not.toBeInTheDocument();
});
test("retorno do wizard preserva os dados conferidos da guia mesmo com principal diferente", () => {
  const salvar = jest.fn();
  const { rerender } = render(<GuiaDeParcelamentoModal arquivo={arquivo} onSalvar={salvar} />);
  preencher();
  fireEvent.change(screen.getByLabelText("Valor (R$)"), { target: { value: "110" } });
  fireEvent.change(screen.getByLabelText("Número da parcela (opcional)"), { target: { value: "3" } });
  const novo = { ...contrato, principalPerParcela: 100,
    parcelasContratadas: [{ numeroParcela: 1, competencia: "2026-08", vencimento: "2026-08-20" }] };
  rerender(<GuiaDeParcelamentoModal arquivo={arquivo} onSalvar={salvar} parcelamentosAtivos={[novo]} parcelamentoIdInicial="p" />);
  expect(screen.getByLabelText("Valor (R$)")).toHaveValue("110");
  expect(screen.getByLabelText("Competência (AAAA-MM)")).toHaveValue("2026-09");
  expect(screen.getByLabelText("Vencimento")).toHaveValue("2026-09-25");
  // O número informado continua sendo o valor enviado, mesmo fora do calendário recebido.
  expect(screen.getByLabelText("Número da parcela (opcional)")).toHaveValue("3");
});
test("competência inicial vem da linha, não preenche vencimento e não muda após edição", () => {
  const { rerender } = render(<GuiaDeParcelamentoModal competenciaInicial="2026-09" />);
  expect(screen.getByLabelText("Competência (AAAA-MM)")).toHaveValue("2026-09");
  expect(screen.getByLabelText("Vencimento")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Competência (AAAA-MM)"), { target: { value: "2026-08" } });
  rerender(<GuiaDeParcelamentoModal competenciaInicial="2026-10" />);
  expect(screen.getByLabelText("Competência (AAAA-MM)")).toHaveValue("2026-08");
});

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PainelDeRegras } from "../PainelDeRegras";
const mockGet = jest.fn(), mockPatch = jest.fn();
jest.mock("../../../../api/client", () => ({ createApiClient: () => ({ getConferenciaRegras: (...args) => mockGet(...args), patchConferenciaRegra: (...args) => mockPatch(...args) }) }));
const regra = { id: "r", padraoDescricao: "Serviço sintético", cnpjFornecedor: "", valorMin: 100, valorMax: 200, contaDestino: "411020008", contaCredito: null, ativa: true, lancaSozinha: false, aplicacoes: 3 };
const contas = [{ codigo: "464", codigoCompleto: "411020008", nome: "Serviços PJ", tipo: "DESPESA", analitica: true }];
beforeEach(() => { jest.clearAllMocks(); mockGet.mockResolvedValue({ ok: true, regras: [regra] }); });
test("revisão externa relê o painel sem trocar empresa", async () => {
  const t = render(<PainelDeRegras companyId="c" revisao={0} />);
  expect(await screen.findByText(/Serviço sintético/)).toBeVisible();
  mockGet.mockResolvedValue({ ok: true, regras: [{ ...regra, id: "nova", padraoDescricao: "Regra criada pela linha" }] });
  t.rerender(<PainelDeRegras companyId="c" revisao={1} />);
  expect(await screen.findByText(/Regra criada pela linha/)).toBeVisible(); expect(mockGet).toHaveBeenCalledTimes(2);
});
test("edição exige motivo, envia versão exibida e invalida fila", async () => {
  const aoAlterar = jest.fn(); mockPatch.mockResolvedValue({ ok: true, regra });
  render(<PainelDeRegras companyId="c" contas={contas} aoAlterar={aoAlterar} />);
  fireEvent.click(await screen.findByText("Editar")); expect(screen.getByText("Salvar regra")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Motivo da alteração"), { target: { value: "Faixa conferida" } });
  fireEvent.change(screen.getByLabelText("Valor máximo"), { target: { value: "300" } });
  fireEvent.click(screen.getByText("Salvar regra"));
  await waitFor(() => expect(mockPatch).toHaveBeenCalledWith("c", "r", expect.objectContaining({ acao: "editar", anterior: regra, motivo: "Faixa conferida", campos: expect.objectContaining({ valorMax: 300 }) })));
  await waitFor(() => expect(aoAlterar).toHaveBeenCalledTimes(1));
});
test("revogação confirmada conserva aviso de histórico e invalida projeções", async () => {
  const aoAlterar = jest.fn(); mockPatch.mockResolvedValue({ ok: true, regra: { ...regra, revogadaEm: "2026-10-20" } });
  render(<PainelDeRegras companyId="c" aoAlterar={aoAlterar} />);
  fireEvent.click(await screen.findByText("Revogar"));
  expect(screen.getByRole("dialog")).toHaveTextContent("preserva os lançamentos e o histórico");
  fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Não aplicar novamente" } });
  fireEvent.click(screen.getByRole("button", { name: "Revogar regra" }));
  await waitFor(() => expect(aoAlterar).toHaveBeenCalledTimes(1));
});
test("somente leitura não oferece edição ou revogação", async () => {
  render(<PainelDeRegras companyId="c" podeEscrever={false} />);
  await screen.findByText(/Serviço sintético/);
  expect(screen.queryByText("Editar")).not.toBeInTheDocument(); expect(screen.queryByText("Revogar")).not.toBeInTheDocument();
});
test("resposta da empresa anterior não substitui regras atuais", async () => {
  let liberar; mockGet.mockImplementationOnce(() => new Promise(resolve => { liberar = resolve; }));
  const t = render(<PainelDeRegras companyId="antiga" />);
  t.rerender(<PainelDeRegras companyId="nova" />);
  await screen.findByText(/Serviço sintético/);
  await act(async () => liberar({ ok: true, regras: [{ ...regra, padraoDescricao: "Resposta antiga" }] }));
  expect(screen.queryByText(/Resposta antiga/)).not.toBeInTheDocument();
});
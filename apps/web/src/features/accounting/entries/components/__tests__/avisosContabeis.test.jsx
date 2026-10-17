import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { AvisosContabeis } from "../AvisosContabeis";
const mockLer = jest.fn(), mockRetomar = jest.fn();
jest.mock("../../../../../api/client", () => ({ createApiClient: () => ({ getAvisosContabeis: (...a) => mockLer(...a), retomarBaixaCliente: (...a) => mockRetomar(...a) }) }));
const vazio = { ok: true, total: 0, correcoes: [], pagamentos: [], historico: [] };
beforeEach(() => { jest.clearAllMocks(); mockLer.mockResolvedValue(vazio); });
test("falha não vira ausência de avisos", async () => { mockLer.mockRejectedValue(Error("indisponível")); render(<AvisosContabeis companyId="A" competencia="2026-09" />); expect(await screen.findByRole("alert")).toHaveTextContent("Avisos indisponíveis"); expect(screen.queryByText("0 avisos contábeis")).toBeNull(); });
test("correção mostra motivo, antes/depois e histórico mesmo após resolver", async () => {
 const item = { id: "c", competencia: "2026-09", motivo: "Corrigir conta", autor: "Ana", antes: { entries: [{ id: "e", historico: "DAS setembro", lines: [{ tipo: "D", conta: "1.1", valor: 20 }] }] }, depois: { entries: [{ id: "e", historico: "DAS setembro", lines: [{ tipo: "D", conta: "2.1", valor: 20 }] }] } };
 mockLer.mockResolvedValue({ ...vazio, historico: [item] }); render(<AvisosContabeis companyId="A" myRole="ACCOUNTANT" />);
 await screen.findByText(/Histórico de correções/); expect(screen.getByText(/Corrigir conta/)).toBeInTheDocument(); expect(screen.getByText(/Conta 1.1/)).toBeInTheDocument(); expect(screen.getByText(/Conta 2.1/)).toBeInTheDocument();
});
test("retoma somente confirmação selecionada e conserva pendência negativa", async () => {
 mockLer.mockResolvedValue({ ...vazio, total: 1, pagamentos: [{ id: "p", competenciaPagamento: "2026-09", motivo: "Mês fechado" }] });
 mockRetomar.mockResolvedValue({ ok: true, confirmacao: { estadoBaixa: "PENDENTE", motivo: "Corrija o mês fechado" } });
 render(<AvisosContabeis companyId="A" myRole="ACCOUNTANT" />); fireEvent.click(await screen.findByRole("button", { name: "Retomar baixa" }));
 expect(await screen.findByRole("alert")).toHaveTextContent("Corrija o mês fechado"); expect(mockRetomar).toHaveBeenCalledWith("A", "p");
});
test("resposta antiga não mostra aviso de outra empresa", async () => {
 let resolver; mockLer.mockImplementationOnce(() => new Promise(r => { resolver = r; })).mockResolvedValue(vazio);
 const view = render(<AvisosContabeis companyId="A" myRole="ACCOUNTANT" />); await waitFor(() => expect(mockLer).toHaveBeenCalledTimes(1));
 view.rerender(<AvisosContabeis companyId="B" />); await act(async () => resolver({ ...vazio, total: 1, pagamentos: [{ id: "p", motivo: "SEGREDO A" }] }));
 expect(screen.queryByText("SEGREDO A")).toBeNull();
});

test("perfil de consulta vê pendência sem ação de baixa", async () => {
 mockLer.mockResolvedValue({ ...vazio, total: 1, pagamentos: [{ id: "p", origem: "CLIENTE", motivo: "MES_FECHADO" }] });
 render(<AvisosContabeis companyId="A" myRole="STAFF" />);
 expect(await screen.findAllByText(/A última tentativa encontrou o mês do pagamento fechado/)).not.toHaveLength(0); expect(screen.queryByRole("button", { name: "Retomar baixa" })).toBeNull();
});

test.each(["PENDENTE", "CONCLUIDA"])("recarrega consumidores somente quando a baixa está %s", async estadoBaixa => {
 mockLer.mockResolvedValue({ ...vazio, total: 1, pagamentos: [{ id: "p", origem: "CLIENTE" }] });
 mockRetomar.mockResolvedValue({ ok: true, confirmacao: { id: "p", estadoBaixa } });
 const carregar = jest.fn(); render(<AvisosContabeis companyId="A" myRole="ACCOUNTANT" aoConcluirBaixa={carregar} />);
 fireEvent.click(await screen.findByRole("button", { name: "Retomar baixa" }));
 await waitFor(() => expect(screen.getByRole("button", { name: "Retomar baixa" })).toBeEnabled());
 expect(carregar).toHaveBeenCalledTimes(estadoBaixa === "CONCLUIDA" ? 1 : 0);
});
test("baixa antiga não recarrega outra empresa", async () => {
 let resolver; mockLer.mockResolvedValue({ ...vazio, total: 1, pagamentos: [{ id: "p", origem: "CLIENTE" }] });
 mockRetomar.mockImplementation(() => new Promise(r => { resolver = r; })); const carregar = jest.fn();
 const view = render(<AvisosContabeis companyId="A" myRole="ACCOUNTANT" aoConcluirBaixa={carregar} />);
 fireEvent.click(await screen.findByRole("button", { name: "Retomar baixa" }));
 view.rerender(<AvisosContabeis companyId="B" myRole="ACCOUNTANT" aoConcluirBaixa={carregar} />);
 await act(async () => resolver({ ok: true, confirmacao: { id: "p", estadoBaixa: "CONCLUIDA" } })); expect(carregar).not.toHaveBeenCalled();
});

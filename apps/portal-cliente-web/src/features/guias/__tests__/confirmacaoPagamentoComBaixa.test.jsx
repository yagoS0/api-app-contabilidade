import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api } from "../../../api";
import { GuiasPage } from "../GuiasPage";
const empresa = { companyId: "pc-001", razao: "Demonstração", cnpj: "11222333000181", myRole: "OWNER" };
const guia = { guideId: "g1", tipo: "SIMPLES", competencia: "2026-06", valor: 100, vencimento: "2026-07-20", paymentStatus: "OPEN", canConfirmPayment: true, liberadaCliente: true, versaoPagamento: "revisao-documento-1" };
let originais;
beforeEach(() => { originais = { get: api.getGuides, confirmar: api.confirmarPagamentoDaGuia }; api.getGuides = jest.fn(async () => ({ data: [guia], total: 1, page: 1, limit: 25 })); });
afterEach(() => { api.getGuides = originais.get; api.confirmarPagamentoDaGuia = originais.confirmar; });
async function abrir() {
 render(<GuiasPage empresa={empresa} competencia="2026-06" aoTrocarCompetencia={() => {}} />);
 fireEvent.click(await screen.findByRole("button", { name: "Já paguei" }));
 fireEvent.change(screen.getByLabelText(/Em que dia você pagou/), { target: { value: "2026-07-14" } });
 await act(async () => fireEvent.click(screen.getByRole("button", { name: "Já paguei esta guia" })));
}
test.each(["CONCLUIDA", "PENDENTE"])("envia versão e data explícitas; distingue baixa %s", async estadoBaixa => {
 api.confirmarPagamentoDaGuia = jest.fn(async () => ({ ok: true, confirmacao: { id: "c1", estadoBaixa } }));
 await abrir();
 expect(api.confirmarPagamentoDaGuia).toHaveBeenCalledWith("pc-001", "g1", { pagoEm: "2026-07-14", versaoPagamento: "revisao-documento-1" });
 expect(await screen.findByText(estadoBaixa === "CONCLUIDA" ? /baixa contábil foi concluída/ : /baixa está pendente de ajuste/)).toBeInTheDocument();
});
test.each([undefined, { ok: false }, { ok: true }])("retorno sem confirmação não anuncia baixa: %p", async resposta => {
 api.confirmarPagamentoDaGuia = jest.fn(async () => resposta); await abrir();
 await waitFor(() => expect(screen.getByText(/Não foi possível confirmar o resultado/)).toBeInTheDocument());
 expect(screen.queryByText(/baixa contábil foi concluída/)).toBeNull(); expect(screen.getByRole("button", { name: "Já paguei esta guia" })).toBeInTheDocument();
});

test("reconfirmação exige DTO, mostra valor atual e envia nova data explícita", async () => {
 const corrigida = { ...guia, paymentStatus: "PAID", canConfirmPayment: false, valor: 150, paymentConfirmedAt: "2026-07-01", reconfirmacaoPagamento: { confirmacaoAnteriorId: "c-antiga", versaoPagamento: "revisao-corrigida" } };
 api.getGuides = jest.fn(async () => ({ data: [corrigida], total: 1, page: 1, limit: 25 }));
 api.confirmarPagamentoDaGuia = jest.fn(async () => ({ ok: true, confirmacao: { id: "c-nova", estadoBaixa: "PENDENTE" } }));
 render(<GuiasPage empresa={empresa} competencia="2026-06" aoTrocarCompetencia={() => {}} />);
 fireEvent.click(await screen.findByRole("button", { name: "Reconfirmar guia corrigida" }));
 expect(screen.getByText(/Valor atual:/)).toHaveTextContent("150,00");
 expect(screen.getByText(/Não é um pedido para pagar novamente/)).toBeInTheDocument();
 expect(screen.getByLabelText(/Em que dia você pagou/)).toHaveValue("");
 expect(screen.getByRole("button", { name: "Meu pagamento corresponde à guia corrigida" })).toBeDisabled();
 fireEvent.change(screen.getByLabelText(/Em que dia você pagou/), { target: { value: "2026-07-14" } });
 fireEvent.click(screen.getByRole("button", { name: "Meu pagamento corresponde à guia corrigida" }));
 await waitFor(() => expect(api.confirmarPagamentoDaGuia).toHaveBeenCalledWith("pc-001", "g1", { pagoEm: "2026-07-14", versaoPagamento: "revisao-corrigida", reconfirmaConfirmacaoId: "c-antiga" }));
});
test("PAID legado não oferece reconfirmação por conta própria", async () => {
 api.getGuides = jest.fn(async () => ({ data: [{ ...guia, paymentStatus: "PAID", canConfirmPayment: false }], total: 1, page: 1, limit: 25 }));
 render(<GuiasPage empresa={empresa} competencia="2026-06" aoTrocarCompetencia={() => {}} />);
 await screen.findByText("R$ 100,00"); expect(screen.queryByRole("button", { name: "Reconfirmar guia corrigida" })).toBeNull();
});

import { useState } from "react";
import { AccountingEntriesTab } from "../renderAccountingEntriesTab";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CorrecaoMesContabilModal } from "../CorrecaoMesContabilModal";
test("exige motivo e descreve domínio antes de corrigir", () => {
 const confirmar = jest.fn(); render(<CorrecaoMesContabilModal competencia="2026-09" aoConfirmar={confirmar} aoFechar={() => {}} />);
 const botao = screen.getByRole("button", { name: "Corrigir mês fechado" });
 expect(botao).toBeDisabled(); expect(screen.getByText(/Somente a contabilidade/)).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText("Motivo da correção"), { target: { value: "  Corrigir conta  " } }); fireEvent.click(botao);
 expect(confirmar).toHaveBeenCalledWith("Corrigir conta");
});
test("gravação protege motivo e fechamento do diálogo", () => {
 const fechar = jest.fn(); render(<CorrecaoMesContabilModal competencia="2026-09" ocupado aoConfirmar={() => {}} aoFechar={fechar} />);
 fireEvent.keyDown(document, { key: "Escape" }); expect(fechar).not.toHaveBeenCalled(); expect(screen.getByLabelText("Motivo da correção")).toBeDisabled();
});

const mockAvisos = jest.fn(), mockRetomar = jest.fn(), mockFechamento = jest.fn();
jest.mock("../../../../../api/client", () => ({ createApiClient: () => ({
 getAvisosContabeis: (...a) => mockAvisos(...a), retomarBaixaCliente: (...a) => mockRetomar(...a), getFechamentoContabil: (...a) => mockFechamento(...a),
 getVerificacaoLancamentos: async () => ({ ok: true, resumo: {}, porRegra: [] }),
 getConferenciaPendencias: async () => ({ ok: true, total: 0 }), getGuiasPendentesContabilizacao: async () => ({ itens: [] }),
}) }));
test("retomar pela aba recarrega tabela, total e checklist após baixa concluída", async () => {
 let concluida = false;
 mockAvisos.mockImplementation(async () => ({ ok: true, total: concluida ? 0 : 1, correcoes: [], historico: [], pagamentos: concluida ? [] : [{ id: "p1", origem: "CLIENTE", competenciaPagamento: "2026-09", motivo: "CONTAS_A_CONFERIR" }] }));
 mockFechamento.mockImplementation(async () => ({ ok: true, fechado: false, versao: concluida ? "2" : "1", checklist: { folhaProlabore: true, despesas: true, receitas: true, provisoes: true, pagamentos: concluida } }));
 mockRetomar.mockImplementation(async () => { concluida = true; return { ok: true, confirmacao: { id: "p1", estadoBaixa: "CONCLUIDA" } }; });
 const recarregar = jest.fn();
 function Tela() {
   const [entries, setEntries] = useState([]);
   return <AccountingEntriesTab companyId="A" myRole="ACCOUNTANT" competencia="2026-09" entries={entries} total={entries.length} loading={false} filters={{}} accounts={[]} onLoadAccounts={() => {}} onFilterChange={() => {}} onLoad={() => { recarregar(); setEntries([{ id: "e1", competencia: "2026-09", tipo: "PAGAMENTO", origem: "MANUAL", historico: "Baixa cliente registrada", data: "2026-09-20", lines: [{ tipo: "D", conta: "2.1", valor: 125 }, { tipo: "C", conta: "1.1", valor: 125 }] }]); }} />;
 }
 render(<Tela />);
 await waitFor(() => expect(screen.getByRole("checkbox", { name: "Pagamentos", exact: true })).not.toBeChecked());
 fireEvent.click(await screen.findByRole("button", { name: "Retomar baixa" }));
 expect(await screen.findByText("Baixa cliente registrada")).toBeInTheDocument();
 await waitFor(() => expect(screen.getByRole("checkbox", { name: "Pagamentos", exact: true })).toBeChecked());
 expect(recarregar).toHaveBeenCalledTimes(1); expect(mockFechamento.mock.calls.length).toBeGreaterThan(1);
 expect(screen.getAllByText(/125,00/).length).toBeGreaterThan(0);
});

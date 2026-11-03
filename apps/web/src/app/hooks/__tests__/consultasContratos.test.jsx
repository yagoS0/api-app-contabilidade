import { act, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useManageCompaniesWorkspace } from "../useManageCompaniesWorkspace";
import { resultadoExtrato, resultadoPagamento } from "../../../features/fiscal/serpro/lib/consultaResultado";

test.each([undefined, {}, { ok: true }, { result: {} }, { result: { total: 0 } }])("pagamento não transforma contrato inválido em zero: %j", p => {
  expect(resultadoPagamento(p)).toMatchObject({ ok: false, message: expect.stringMatching(/sem confirmação/) });
});
test("pagamento parcialmente confirmado conserva a falha", () => {
  expect(resultadoPagamento({ result: { total: 2, paid: 1, errors: 1, mensagem: "1 paga; 1 com erro" } })).toEqual({ ok: false, message: "1 paga; 1 com erro" });
});
test.each([
  [{ ok: false, reason: "mes_fechado" }, /Mês contábil fechado/],
  [{ ok: true, skipped: [{ eventType: "RECEITA", reason: "missing_rule" }] }, /Regra contábil ausente/],
  [{ ok: true, divergences: [{ message: "Contas pendentes de classificação" }] }, /Contas pendentes/],
])("extrato preserva motivo da pendência %j", (accounting, texto) => {
  expect(resultadoExtrato({ result: { circular: { serproSyncStatus: "SUCCESS" }, accounting } })).toMatchObject({ ok: false, message: expect.stringMatching(texto) });
});
test("menu executa extrato com reaproveitamento e retorna pendência, sem repetir", async () => {
  const api = { listCompanies: jest.fn(async () => []), getCompanyGuides: jest.fn(async () => []), getSerproSettings: jest.fn(async () => ({})), syncPgdasCircular: jest.fn(async () => ({ result: { reutilizado: true, circular: { serproSyncStatus: "SUCCESS" }, accounting: { ok: false, reason: "mes_fechado" } } })) };
  const feedback = { clearFeedback: jest.fn(), setError: jest.fn(), setMessage: jest.fn() };
  const wrapper = ({ children }) => <MemoryRouter>{children}</MemoryRouter>;
  const { result } = renderHook(() => useManageCompaniesWorkspace({ api, page: "companyDetail", setPage: jest.fn(), feedback }), { wrapper });
  let r;
  await act(async () => { r = await result.current.runSerproOp("extrato", "c", "2026-09"); });
  expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/reaproveitado.*Mês contábil fechado/) });
  expect(api.syncPgdasCircular).toHaveBeenCalledTimes(1);
  expect(api.syncPgdasCircular).toHaveBeenCalledWith("c", "2026-09", { atualizar: false });
});

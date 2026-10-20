import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AccountingEntriesTab } from "../renderAccountingEntriesTab";
import { MemoryRouter } from "react-router-dom";
import { useManageCompaniesWorkspace } from "../../../../../app/hooks/useManageCompaniesWorkspace";
jest.mock("../../../../../api/client", () => ({ createApiClient: () => ({
  getFechamentoContabil: jest.fn(async () => ({ fechado: false, checklist: {}, buscasSerpro: {} })),
  getVerificacaoLancamentos: jest.fn(async () => ({ ok: true, resumo: {}, porRegra: [] })),
  getConferenciaPendencias: jest.fn(async () => ({ ok: true, total: 0 })),
}) }));
async function montar() {
  const onSyncSerproPgdas = jest.fn(async () => ({ reutilizado: true, circular: { serproSyncStatus: "SUCCESS" } }));
  render(<AccountingEntriesTab companyId="c" competencia="2026-09" entries={[]} total={0} filters={{}} accounts={[]} companyRegime="SIMPLES" onSyncSerproPgdas={onSyncSerproPgdas} onFilterChange={jest.fn()} onLoad={jest.fn()} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: /SERPRO/ }));
  return onSyncSerproPgdas;
}
test("reaproveitar envia atualizar false", async () => {
  const sync = await montar(); fireEvent.click(screen.getByText("Extrato do Simples — reaproveitar ou obter"));
  await waitFor(() => expect(sync).toHaveBeenCalledWith("c", { competencia: "2026-09", atualizar: false }));
});
test("cancelar atualização não chama consulta nem altera intenção seguinte", async () => {
  const sync = await montar(); fireEvent.click(screen.getByText("Atualizar extrato na Receita"));
  expect(await screen.findByRole("dialog")).toHaveTextContent("consulta paga");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cancelar" })); }); expect(sync).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /SERPRO/ })); fireEvent.click(screen.getByText("Extrato do Simples — reaproveitar ou obter"));
  await waitFor(() => expect(sync).toHaveBeenCalledWith("c", { competencia: "2026-09", atualizar: false }));
});
test("atualização confirmada envia atualizar true", async () => {
  const sync = await montar(); fireEvent.click(screen.getByText("Atualizar extrato na Receita"));
  fireEvent.click(await screen.findByRole("button", { name: "Consultar novamente" }));
  await waitFor(() => expect(sync).toHaveBeenCalledWith("c", { competencia: "2026-09", atualizar: true }));
});

test.each(["negativa", "falha", "vazia"])("Presumido com hook e aba reais: %s exige nova confirmação, inclusive após cancelar", async caso => {
  const api = {
    listCompanies: jest.fn(async () => []), getCompanyGuides: jest.fn(async () => []),
    getSerproSettings: jest.fn(async () => ({})), getSerproStatus: jest.fn(async () => ({})),
    captureSerproLp: jest.fn(async () => {
      if (caso === "falha") throw new Error("Resultado indisponível");
      return caso === "negativa" ? { ok: false, message: "Declaração não encontrada" } : undefined;
    }),
  };
  const feedback = { clearFeedback: jest.fn(), setError: jest.fn(), setMessage: jest.fn() };
  function Fluxo() {
    const workspace = useManageCompaniesWorkspace({ api, page: "companyDetail", setPage: jest.fn(), feedback });
    return <AccountingEntriesTab companyId="c" competencia="2026-09" entries={[]} total={0}
      filters={{}} accounts={[]} companyRegime="LUCRO_PRESUMIDO"
      onCaptureSerproLp={workspace.handleCaptureSerproLp} onFilterChange={jest.fn()} onLoad={jest.fn()} />;
  }
  render(<MemoryRouter initialEntries={["/companies/c/lancamentos"]}><Fluxo /></MemoryRouter>);
  await act(async () => {});
  async function clicarBusca() {
    fireEvent.click(screen.getByRole("button", { name: /SERPRO/ }));
    fireEvent.click(screen.getByText("Buscar tributos do Presumido"));
    await act(async () => {});
  }
  await clicarBusca();
  expect(api.captureSerproLp).toHaveBeenCalledTimes(1);
  if (caso !== "negativa") expect(feedback.setMessage).not.toHaveBeenCalled();
  await clicarBusca();
  expect(await screen.findByRole("dialog")).toHaveTextContent("consulta paga");
  expect(api.captureSerproLp).toHaveBeenCalledTimes(1);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cancelar" })); });
  await clicarBusca();
  expect(await screen.findByRole("dialog")).toHaveTextContent("sem resultado confirmado");
  expect(api.captureSerproLp).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Consultar novamente" }));
  await waitFor(() => expect(api.captureSerproLp).toHaveBeenCalledTimes(2));
});

test.each([{ reutilizado: true }, { cancelado: true, tentativaEnviada: false }])(
  "Presumido sem nova tentativa não fabrica marca de consulta: %j", async resposta => {
    const sync = jest.fn(async () => resposta);
    render(<AccountingEntriesTab companyId="c" competencia="2026-09" entries={[]} total={0}
      filters={{}} accounts={[]} companyRegime="LUCRO_PRESUMIDO" onCaptureSerproLp={sync}
      onFilterChange={jest.fn()} onLoad={jest.fn()} />);
    await act(async () => {});
    for (let i = 1; i <= 2; i++) {
      fireEvent.click(screen.getByRole("button", { name: /SERPRO/ }));
      fireEvent.click(screen.getByText("Buscar tributos do Presumido"));
      await waitFor(() => expect(sync).toHaveBeenCalledTimes(i));
      await act(async () => {});
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    }
  },
);

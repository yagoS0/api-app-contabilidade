// AS BUSCAS DE HISTÓRICO SÃO DEPENDÊNCIA DE EFEITO — por isso a identidade delas é contrato.
//
// `searchHistoricos` e `getHistoricosByCode` descem inteiras até `AccountCodeInput` e
// `SmartHistoricoInput` (App → aba Lançamentos → linha de rascunho), onde entram no array de deps
// do `useEffect` que busca as sugestões. Como `function` declaration, ganhavam identidade nova a
// CADA render do workspace: o efeito era descartado e remontado, o `clearTimeout` do debounce
// zerava a contagem a cada render, e o dropdown (que na época abria de dentro do efeito) voltava
// sozinho na cara de quem já tinha escolhido a conta.
//
// O teste olha para a IDENTIDADE, não para o retorno. Trocar o `useCallback` de volta por uma
// função solta não quebra nenhum teste de comportamento da lista — quebra este.

import { renderHook } from "@testing-library/react";
import { useManageAccountingWorkspace } from "../useManageAccountingWorkspace.js";

jest.mock("../../../features/accounting/hooks/useManageAccountingEntries", () => ({
  useAccountingEntries: () => ({
    entries: [],
    total: 0,
    loading: false,
    filters: { competencia: "2026-07", tipo: "", origem: "", status: "" },
    setLoading: jest.fn(),
    setEntries: jest.fn(),
    setTotal: jest.fn(),
    setFilter: jest.fn(),
  }),
}));

jest.mock("../../../features/accounting/hooks/useManageChartOfAccounts", () => ({
  useChartOfAccounts: () => ({
    accounts: [],
    loading: false,
    setLoading: jest.fn(),
    setAccounts: jest.fn(),
  }),
}));

// `api` é criado uma vez por módulo no `App.jsx` (`const api = createApiClient()`), então aqui ele
// também é um objeto só — se um dia virar objeto novo a cada render, o `useCallback` deixa de
// segurar nada e este teste é o lugar onde isso aparece.
const api = {
  getChartOfAccounts: jest.fn().mockResolvedValue([]),
  getAccountingEntries: jest.fn().mockResolvedValue({ data: [], total: 0 }),
  searchHistoricos: jest.fn().mockResolvedValue([]),
  getHistoricosByCode: jest.fn().mockResolvedValue([]),
};

// `companyDetailTab: "circular"` de propósito: na aba "lancamentos" o efeito de carga dispararia.
function montar(selectedCompanyId = "company-123") {
  return renderHook(
    (props) => useManageAccountingWorkspace(props),
    {
      initialProps: {
        api,
        page: "companyDetail",
        selectedCompanyId,
        companyDetailTab: "circular",
        feedback: {},
      },
    },
  );
}

describe("identidade das buscas de histórico", () => {
  it("⚠ sobrevive a um re-render sem nada ter mudado", () => {
    const { result, rerender } = montar();
    const antes = {
      search: result.current.searchHistoricos,
      byCode: result.current.getHistoricosByCode,
    };

    rerender({
      api,
      page: "companyDetail",
      selectedCompanyId: "company-123",
      companyDetailTab: "circular",
      feedback: {},
    });

    expect(result.current.searchHistoricos).toBe(antes.search);
    expect(result.current.getHistoricosByCode).toBe(antes.byCode);
  });

  it("muda quando a EMPRESA muda — a memoização não pode congelar a empresa errada", () => {
    // O outro lado do contrato: se a identidade nunca mudasse, o campo continuaria buscando
    // históricos da empresa anterior depois de trocar de cliente.
    const { result, rerender } = montar("company-123");
    const antes = result.current.searchHistoricos;

    rerender({
      api,
      page: "companyDetail",
      selectedCompanyId: "company-999",
      companyDetailTab: "circular",
      feedback: {},
    });

    expect(result.current.searchHistoricos).not.toBe(antes);
  });

  it("continuam funcionando: delegam para a api com a empresa aberta", async () => {
    const { result } = montar("company-123");
    await result.current.searchHistoricos("pro-labore");
    await result.current.getHistoricosByCode("426");

    expect(api.searchHistoricos).toHaveBeenCalledWith("company-123", "pro-labore");
    expect(api.getHistoricosByCode).toHaveBeenCalledWith("company-123", "426");
  });
});

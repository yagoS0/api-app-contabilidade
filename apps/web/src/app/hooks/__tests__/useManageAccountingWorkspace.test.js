// A ABA LANÇAMENTOS NÃO PAGINA — e é isso que este arquivo protege.
//
// A rota `GET /entries` pagina com default 50. `loadAccountingEntries` não mandava page/limit,
// então só a 1ª página chegava: mês com mais de 50 lançamentos mostrava os 50 mais antigos e
// escondia o resto sem aviso (não há controle de paginação na aba, e o `total` não é renderizado).
// O rodapé D/C somava só o que veio, então o balanço do mês também saía errado.
//
// O teste é sobre a QUANTIDADE DE CHAMADAS e o que chega em `setEntries` — não sobre o formato do
// lançamento. Um teste que só olhasse a primeira página passaria com o defeito de volta.
import { renderHook, act } from "@testing-library/react";
import { useManageAccountingWorkspace } from "../useManageAccountingWorkspace.js";

const mockEntriesState = {
  entries: [],
  total: 0,
  loading: false,
  filters: { competencia: "2026-07", tipo: "", origem: "", status: "" },
  setLoading: jest.fn(),
  setEntries: jest.fn(),
  setTotal: jest.fn(),
};

jest.mock("../../../features/accounting/hooks/useManageAccountingEntries", () => ({
  useAccountingEntries: () => mockEntriesState,
}));

jest.mock("../../../features/accounting/hooks/useManageChartOfAccounts", () => ({
  useChartOfAccounts: () => ({
    accounts: [],
    loading: false,
    setLoading: jest.fn(),
    setAccounts: jest.fn(),
  }),
}));

function pagina(quantidade, offset) {
  return Array.from({ length: quantidade }, (_, i) => ({ id: `entry-${offset + i}`, lines: [] }));
}

function montarApi(paginas) {
  const getAccountingEntries = jest.fn();
  paginas.forEach((p) => getAccountingEntries.mockResolvedValueOnce(p));
  return {
    getChartOfAccounts: jest.fn().mockResolvedValue([]),
    getCircular: jest.fn().mockResolvedValue({ months: [] }),
    getCircularAccountingEntries: jest.fn().mockResolvedValue({ entries: [] }),
    getAccountingEntries,
  };
}

// `companyDetailTab: "circular"` de propósito: na aba "lancamentos" o efeito de carga automática
// dispararia e consumiria a fila de páginas antes do teste chamar a função.
function montarHook(api) {
  return renderHook(() =>
    useManageAccountingWorkspace({
      api,
      page: "companyDetail",
      selectedCompanyId: "company-123",
      companyDetailTab: "circular",
      feedback: {},
    })
  );
}

function ultimoSetEntries() {
  const calls = mockEntriesState.setEntries.mock.calls;
  return calls[calls.length - 1][0];
}

// ⚠ F5 NA CIRCULAR DEIXAVA A TELA VAZIA.
//
// O único disparo de `onLoadCircular` era a TROCA DE ABA (`switchTab`, em
// `renderCompanyDetailPage`). Recarregando a página — ou abrindo o link direto — o corpo mostrava
// "Nenhum dado disponível. Clique em Atualizar.". A aba Lançamentos tem um effect de carga
// automática criado exatamente por esse motivo; a Circular ficou sem o irmão, e este é ele.
describe("carga automática da Circular", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("⚠ a aba abre carregada, sem depender da troca de aba", async () => {
    const api = montarApi([]);
    await act(async () => {
      montarHook(api);
    });

    expect(api.getCircular).toHaveBeenCalledTimes(1);
    expect(api.getCircular).toHaveBeenCalledWith("company-123", { year: expect.any(Number) });
    // A revisão da competência viaja junto — é o par que a aba mostra embaixo da matriz.
    expect(api.getCircularAccountingEntries).toHaveBeenCalledWith("company-123", "2026-07");
  });

  it("o plano de contas vem junto — o modal de edição da célula depende dele", async () => {
    const api = montarApi([]);
    await act(async () => {
      montarHook(api);
    });

    expect(api.getChartOfAccounts).toHaveBeenCalledWith("company-123");
  });

  it("outra aba não busca a Circular", async () => {
    const api = montarApi([]);
    await act(async () => {
      renderHook(() =>
        useManageAccountingWorkspace({
          api,
          page: "companyDetail",
          selectedCompanyId: "company-123",
          companyDetailTab: "guides",
          feedback: {},
        })
      );
    });

    expect(api.getCircular).not.toHaveBeenCalled();
  });
});

describe("loadAccountingEntries", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("percorre todas as páginas até completar o total", async () => {
    const api = montarApi([
      { data: pagina(200, 0), total: 450, page: 1, limit: 200 },
      { data: pagina(200, 200), total: 450, page: 2, limit: 200 },
      { data: pagina(50, 400), total: 450, page: 3, limit: 200 },
    ]);

    const { result } = montarHook(api);
    await act(async () => {
      await result.current.loadAccountingEntries("company-123");
    });

    expect(api.getAccountingEntries).toHaveBeenCalledTimes(3);
    expect(ultimoSetEntries()).toHaveLength(450);
    expect(mockEntriesState.setTotal).toHaveBeenLastCalledWith(450);
  });

  it("pede as páginas seguintes com o mesmo filtro e o page incrementado", async () => {
    const api = montarApi([
      { data: pagina(200, 0), total: 250, page: 1, limit: 200 },
      { data: pagina(50, 200), total: 250, page: 2, limit: 200 },
    ]);

    const { result } = montarHook(api);
    await act(async () => {
      await result.current.loadAccountingEntries("company-123");
    });

    // O filtro precisa viajar junto: paginar sem `competencia` traria lançamentos de outro mês.
    expect(api.getAccountingEntries).toHaveBeenNthCalledWith(
      1,
      "company-123",
      expect.objectContaining({ competencia: "2026-07", page: 1, limit: 200 })
    );
    expect(api.getAccountingEntries).toHaveBeenNthCalledWith(
      2,
      "company-123",
      expect.objectContaining({ competencia: "2026-07", page: 2, limit: 200 })
    );
  });

  it("faz UMA chamada só quando o mês cabe numa página", async () => {
    const api = montarApi([{ data: pagina(37, 0), total: 37, page: 1, limit: 200 }]);

    const { result } = montarHook(api);
    await act(async () => {
      await result.current.loadAccountingEntries("company-123");
    });

    expect(api.getAccountingEntries).toHaveBeenCalledTimes(1);
    expect(ultimoSetEntries()).toHaveLength(37);
  });

  it("avisa na tela quando o servidor para de devolver dados antes do total", async () => {
    const api = montarApi([
      { data: pagina(200, 0), total: 450, page: 1, limit: 200 },
      { data: [], total: 450, page: 2, limit: 200 },
    ]);

    const { result } = montarHook(api);
    await act(async () => {
      await result.current.loadAccountingEntries("company-123");
    });

    // Lista incompleta em silêncio é o defeito original; aqui ela precisa aparecer.
    expect(result.current.entriesError).toContain("200 de 450");
    expect(ultimoSetEntries()).toHaveLength(200);
  });

  it("mantém a lista vazia e reporta o erro quando a carga falha", async () => {
    const api = montarApi([]);
    api.getAccountingEntries.mockRejectedValueOnce(new Error("boom"));

    const { result } = montarHook(api);
    await act(async () => {
      await result.current.loadAccountingEntries("company-123");
    });

    expect(result.current.entriesError).toContain("boom");
    expect(ultimoSetEntries()).toEqual([]);
  });
});

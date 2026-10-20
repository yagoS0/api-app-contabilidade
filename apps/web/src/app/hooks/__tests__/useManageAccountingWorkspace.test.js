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

const mockChartState = {
    accounts: [],
    loading: false,
    setLoading: jest.fn(),
    setAccounts: jest.fn(),
};
jest.mock("../../../features/accounting/hooks/useManageChartOfAccounts", () => ({
  useChartOfAccounts: () => mockChartState,
}));

const matrizValida = (extra = {}) => ({ provisoes: [], receitas: {}, extrato: {}, ...extra });

test.each(['planoContas', 'guides', 'parcelamento'])('link direto em %s carrega o plano sem depender da navegação', async companyDetailTab => {
  const api = { getChartOfAccounts: jest.fn().mockResolvedValue([]) };
  const { result } = renderHook(() => useManageAccountingWorkspace({ api, page:'companyDetail', selectedCompanyId:'direta', companyDetailTab }));
  await act(async () => {});
  expect(api.getChartOfAccounts).toHaveBeenCalledTimes(1);
  expect(api.getChartOfAccounts).toHaveBeenCalledWith('direta');
  expect(result.current.chartOfAccountsState.error).toBe('');
});

function pagina(quantidade, offset) {
  return Array.from({ length: quantidade }, (_, i) => ({ id: `entry-${offset + i}`, lines: [] }));
}

function montarApi(paginas) {
  const getAccountingEntries = jest.fn();
  paginas.forEach((p) => getAccountingEntries.mockResolvedValueOnce(p));
  return {
    getChartOfAccounts: jest.fn().mockResolvedValue([]),
    getCircular: jest.fn().mockResolvedValue(matrizValida()),
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

describe('isolamento e falhas da Circular', () => {
  beforeEach(() => jest.clearAllMocks());

  it('descarta matriz tardia da empresa anterior', async () => {
    let resolveA;
    const api = montarApi([]);
    api.getCircular.mockImplementation(id => id === 'A' ? new Promise(resolve => { resolveA = resolve; }) : Promise.resolve(matrizValida({ empresa: 'B' })));
    const { result, rerender } = renderHook(({ id }) => useManageAccountingWorkspace({ api, page: 'companyDetail', selectedCompanyId: id, companyDetailTab: 'circular' }), { initialProps: { id: 'A' } });
    await act(async () => { rerender({ id: 'B' }); });
    expect(result.current.circularData.empresa).toBe('B');
    await act(async () => { resolveA(matrizValida({ empresa: 'A' })); });
    expect(result.current.circularData.empresa).toBe('B');
    expect(result.current.loadingCircular).toBe(false);
  });

  it.each([null, {}, { provisoes: [] }, { provisoes: [], receitas: [], extrato: {} }])('recarga inválida %j mantém a matriz válida e informa falha', async (resposta) => {
    const api = montarApi([]);
    const { result } = montarHook(api);
    await act(async () => {});
    const anterior = result.current.circularData;
    api.getCircular.mockResolvedValueOnce(resposta);
    await act(async () => { await result.current.loadCircular(); });
    expect(result.current.circularData).toBe(anterior);
    expect(result.current.entriesError).toMatch(/Não foi possível atualizar/);
  });

  it('falha da conferência não afirma conferência vazia bem sucedida', async () => {
    const api = montarApi([]);
    api.getCircularAccountingEntries.mockRejectedValue(new Error('Conferência offline'));
    const { result } = montarHook(api);
    await act(async () => {});
    expect(result.current.circularData.accountingReview).toBeNull();
    expect(result.current.circularData.reviewError).toBe('Conferência offline');
    expect(result.current.entriesError).toMatch(/conferência indisponível/);
  });

  it('última recarga vence quando a primeira termina depois', async () => {
    let resolveAntiga;
    const api = montarApi([]);
    api.getCircular.mockImplementationOnce(() => new Promise(resolve => { resolveAntiga = resolve; }))
      .mockResolvedValue(matrizValida({ revisao: 'nova' }));
    const { result } = montarHook(api);
    await act(async () => { await result.current.loadCircular(); });
    await act(async () => { resolveAntiga(matrizValida({ revisao: 'antiga' })); });
    expect(result.current.circularData.revisao).toBe('nova');
  });

  it('troca de ano oculta a matriz anterior e descarta sua resposta tardia', async () => {
    const api = montarApi([]);
    const { result } = montarHook(api);
    await act(async () => {});
    const anoAnterior = result.current.circularYear;
    let resolverAntiga, resolverNova;
    api.getCircular.mockImplementationOnce(() => new Promise(resolve => { resolverAntiga = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolverNova = resolve; }));
    let antiga;
    act(() => { antiga = result.current.loadCircular(); });
    act(() => { result.current.handleCircularYearChange(anoAnterior - 1); });
    expect(result.current.circularData).toBeNull();
    expect(api.getCircular).toHaveBeenLastCalledWith('company-123', { year: anoAnterior - 1 });
    await act(async () => { resolverNova(matrizValida({ year: anoAnterior - 1 })); });
    await act(async () => { resolverAntiga(matrizValida({ year: anoAnterior })); await antiga; });
    expect(result.current.circularData.year).toBe(anoAnterior - 1);
    expect(result.current.loadingCircular).toBe(false);
  });

  it('troca de competência descarta conferência pendente do mês anterior', async () => {
    const filtrosOriginais = mockEntriesState.filters;
    const api = montarApi([]);
    let resolverAnterior;
    api.getCircularAccountingEntries.mockImplementationOnce(() => new Promise(resolve => { resolverAnterior = resolve; }))
      .mockResolvedValue({ entries: [{ id: 'agosto' }] });
    const { result, rerender } = montarHook(api);
    try {
      await act(async () => {});
      mockEntriesState.filters = { ...filtrosOriginais, competencia: '2026-08' };
      await act(async () => { rerender(); });
      expect(api.getCircularAccountingEntries).toHaveBeenLastCalledWith('company-123', '2026-08');
      await act(async () => { resolverAnterior({ entries: [{ id: 'julho' }] }); });
      expect(result.current.circularData.reviewEntries).toEqual([{ id: 'agosto' }]);
    } finally {
      mockEntriesState.filters = filtrosOriginais;
    }
  });
});

describe('leitura do plano de contas', () => {
  beforeEach(() => jest.clearAllMocks());

  it('preserva contas após resposta inválida e limpa somente seu erro na recuperação', async () => {
    const api = montarApi([]);
    const contas = [{ codigo: '1', nome: 'Caixa' }];
    api.getChartOfAccounts.mockResolvedValue(contas);
    api.getCircularAccountingEntries.mockRejectedValue(new Error('Conferência offline'));
    const { result } = montarHook(api);
    await act(async () => {});
    expect(mockChartState.setAccounts).toHaveBeenLastCalledWith(contas);
    mockChartState.setAccounts.mockClear();
    api.getChartOfAccounts.mockResolvedValueOnce({});
    await act(async () => { await result.current.loadChartOfAccounts(); });
    expect(mockChartState.setAccounts).not.toHaveBeenCalled();
    expect(result.current.chartOfAccountsState.error).toMatch(/Resposta inválida/);
    expect(result.current.entriesError).toMatch(/Conferência offline/);
    await act(async () => { await result.current.loadChartOfAccounts(); });
    expect(result.current.chartOfAccountsState.error).toBe('');
    expect(result.current.entriesError).toMatch(/Conferência offline/);
    expect(result.current.entriesError).not.toMatch(/Resposta inválida/);
    expect(mockChartState.setAccounts).toHaveBeenLastCalledWith(contas);
    expect(mockChartState.setLoading).toHaveBeenLastCalledWith(false);
  });

  it('falha tardia de consulta superada não substitui recuperação', async () => {
    const api = montarApi([]);
    const { result } = montarHook(api);
    await act(async () => {});
    let rejeitarAntiga;
    api.getChartOfAccounts.mockImplementationOnce(() => new Promise((_, reject) => { rejeitarAntiga = reject; }))
      .mockResolvedValue([{ codigo: '2' }]);
    let antiga;
    act(() => { antiga = result.current.loadChartOfAccounts(); });
    await act(async () => { await result.current.loadChartOfAccounts(); });
    await act(async () => { rejeitarAntiga(new Error('Falha antiga')); await antiga; });
    expect(result.current.chartOfAccountsState.error).toBe('');
    expect(mockChartState.setAccounts).toHaveBeenLastCalledWith([{ codigo: '2' }]);
  });

  it('resultado da empresa anterior não substitui o plano da empresa atual', async () => {
    const api = montarApi([]);
    let resolverA;
    api.getChartOfAccounts.mockImplementation(id => id === 'A'
      ? new Promise(resolve => { resolverA = resolve; }) : Promise.resolve([{ codigo: 'B' }]));
    const { result, rerender } = renderHook(({ id }) => useManageAccountingWorkspace({
      api, page: 'companyDetail', selectedCompanyId: id, companyDetailTab: 'planoContas',
    }), { initialProps: { id: 'A' } });
    await act(async () => { rerender({ id: 'B' }); });
    await act(async () => { resolverA([{ codigo: 'A' }]); });
    expect(mockChartState.setAccounts).toHaveBeenLastCalledWith([{ codigo: 'B' }]);
    expect(result.current.chartOfAccountsState.error).toBe('');
  });
});

it('salvar seguido de falha de recarga conserva a lista e não repete a gravação', async () => {
  jest.clearAllMocks();
  const api = montarApi([{ data: pagina(2, 0), total: 2 }]);
  api.updateAccountingEntry = jest.fn().mockResolvedValue({ ok: true });
  const { result } = montarHook(api);
  await act(async () => { await result.current.loadAccountingEntries(); });
  mockEntriesState.setEntries.mockClear();
  api.getAccountingEntries.mockRejectedValueOnce(new Error('Rede indisponível'));
  await act(async () => { await result.current.handleUpdateEntry('entry-0', { historico: 'Corrigido' }); });
  expect(api.updateAccountingEntry).toHaveBeenCalledTimes(1);
  expect(mockEntriesState.setEntries).not.toHaveBeenCalled();
  expect(result.current.entriesMessage).toBe('Lançamento atualizado.');
  expect(result.current.entriesError).toMatch(/desatualizados/);
});

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

test("deep link no plano de contas carrega empresa e acompanha mudança de empresa",async()=>{
 const api=montarApi([]);const props={api,page:"companyDetail",selectedCompanyId:"empresa-a",companyDetailTab:"planoContas",feedback:{}};
 const r=renderHook((p)=>useManageAccountingWorkspace(p),{initialProps:props});await act(async()=>{});
 expect(api.getChartOfAccounts).toHaveBeenCalledWith("empresa-a");expect(api.getAccountingEntries).not.toHaveBeenCalled();
 r.rerender({...props,selectedCompanyId:"empresa-b"});await act(async()=>{});expect(api.getChartOfAccounts).toHaveBeenLastCalledWith("empresa-b");
});

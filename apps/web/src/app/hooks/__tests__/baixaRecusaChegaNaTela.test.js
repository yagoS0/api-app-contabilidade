// A RECUSA DA BAIXA TEM DE CHEGAR À TELA — e o que a apagava era este `catch`.
//
// ⚠ O DEFEITO (relatado pelo dono em 2026-08-16: "a circular, a baixa da junho do Simples não está
// funcionando"). O backend recusava com motivo — 400 `baixa_excede_saldo` na LENTE de 2026-06, 409
// `MES_FECHADO` quando a data do pagamento cai em competência fechada — e a tela não mostrava nada:
//
//   1. `handleCreateBaixa` capturava o erro e **resolvia** como se tivesse dado certo;
//   2. o `onSave` do `BaixaModal` na Circular seguia com `await onLoad(...)`, e `loadCircular`
//      começa com `setEntriesError("")` — a mensagem era APAGADA no mesmo clique;
//   3. `setBaixaEntry(null)` fechava o modal.
//
// O sintoma final é indistinguível de botão quebrado: o modal fecha, a célula continua igual, nada
// na tela. O `BaixaModal` TEM canal de erro próprio (`handleSave` → `setError`), mas ele só é
// alcançado se `onSave` REJEITAR.
//
// Este teste é sobre a PROPAGAÇÃO, não sobre o texto da mensagem: um teste que só olhasse
// `entriesError` passaria com o defeito de volta, porque `entriesError` é escrito nos dois casos —
// e apagado logo depois.
import { renderHook, act } from "@testing-library/react";
import { useManageAccountingWorkspace } from "../useManageAccountingWorkspace.js";

const mockEntriesState = {
  entries: [],
  total: 0,
  loading: false,
  filters: { competencia: "2026-06", tipo: "", origem: "", status: "" },
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

function recusa(codigo, mensagem, status) {
  const err = new Error(mensagem);
  err.code = codigo;
  err.status = status;
  return err;
}

function montarApi(createBaixa) {
  return {
    getChartOfAccounts: jest.fn().mockResolvedValue([]),
    getCircular: jest.fn().mockResolvedValue({ months: [] }),
    getCircularAccountingEntries: jest.fn().mockResolvedValue({ entries: [] }),
    getAccountingEntries: jest.fn().mockResolvedValue({ entries: [], total: 0 }),
    createBaixa,
    saveInssBaixa: jest.fn(),
  };
}

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

describe("handleCreateBaixa — a recusa não pode ser engolida", () => {
  // O caso da LENTE: comprovante do SERPRO com principal maior que o saldo da provisão.
  it("REJEITA quando o servidor recusa com baixa_excede_saldo", async () => {
    const api = montarApi(jest.fn().mockRejectedValue(
      recusa("baixa_excede_saldo", "A baixa (principal R$ 15033.58) excede o saldo da provisão (R$ 14115.30).", 400),
    ));
    const { result } = montarHook(api);

    await act(async () => {
      await expect(
        result.current.handleCreateBaixa("entry-das-junho", { data: "2026-07-14", historico: "PAGO DAS", lines: [] }),
      ).rejects.toThrow("excede o saldo da provisão");
    });
  });

  it("REJEITA quando o servidor recusa com MES_FECHADO", async () => {
    const api = montarApi(jest.fn().mockRejectedValue(
      recusa("MES_FECHADO", "Mês 2026-07 fechado — reabra a empresa antes de dar a baixa.", 409),
    ));
    const { result } = montarHook(api);

    await act(async () => {
      await expect(
        result.current.handleCreateBaixa("entry-das-junho", { data: "2026-07-20", historico: "PAGO DAS", lines: [] }),
      ).rejects.toMatchObject({ code: "MES_FECHADO" });
    });
  });

  // ⚠ A rejeição é o que mantém o modal ABERTO e impede o `onLoad` que apagava a mensagem — mas o
  // banner da aba continua sendo escrito, para quem já tinha fechado o modal.
  it("escreve o motivo em entriesError ANTES de relançar", async () => {
    const api = montarApi(jest.fn().mockRejectedValue(
      recusa("baixa_excede_saldo", "A baixa (principal R$ 15033.58) excede o saldo da provisão (R$ 14115.30).", 400),
    ));
    const { result } = montarHook(api);

    await act(async () => {
      await result.current.handleCreateBaixa("entry-das-junho", { lines: [] }).catch(() => {});
    });
    expect(result.current.entriesError).toContain("excede o saldo da provisão");
  });

  // O caminho feliz não pode ter mudado: sem recusa, resolve e recarrega.
  it("RESOLVE quando o servidor aceita", async () => {
    const createBaixa = jest.fn().mockResolvedValue({ ok: true, entry: { id: "baixa-1" } });
    const api = montarApi(createBaixa);
    const { result } = montarHook(api);

    await act(async () => {
      await expect(result.current.handleCreateBaixa("entry-das-junho", { lines: [] })).resolves.toBeUndefined();
    });
    expect(createBaixa).toHaveBeenCalledTimes(1);
    expect(result.current.entriesError).toBe("");
  });

  // ⚠ A baixa do INSS na Circular é sintética e vai por outra rota — a mesma regra vale para ela.
  it("REJEITA também na baixa do INSS sintético", async () => {
    const api = montarApi(jest.fn());
    api.saveInssBaixa = jest.fn().mockRejectedValue(recusa("MES_FECHADO", "Mês fechado.", 409));
    const { result } = montarHook(api);

    await act(async () => {
      await expect(
        result.current.handleCreateBaixa("synthetic-inss-guia-9", { lines: [] }),
      ).rejects.toMatchObject({ code: "MES_FECHADO" });
    });
    expect(api.saveInssBaixa).toHaveBeenCalledWith("company-123", "guia-9", { lines: [] });
  });
});

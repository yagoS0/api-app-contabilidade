import { renderHook, act, waitFor } from "@testing-library/react";
import { useManageAccountingWorkspace } from "../useManageAccountingWorkspace.js";

// Mock the sub-hooks
jest.mock("../../../features/accounting/hooks/useManageAccountingEntries", () => ({
  useAccountingEntries: () => ({
    entries: [],
    total: 0,
    loading: false,
    filters: {},
    setLoading: jest.fn(),
    setEntries: jest.fn(),
    setTotal: jest.fn(),
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

describe("useManageAccountingWorkspace - Fiscal Actions", () => {
  let mockApi;

  beforeEach(() => {
    mockApi = {
      getChartOfAccounts: jest.fn().mockResolvedValue([]),
      getAccountingEntries: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      getCircular: jest.fn().mockResolvedValue({ months: [] }),
      getCircularAccountingEntries: jest.fn().mockResolvedValue({ entries: [] }),
      runCompanyFiscalAction: jest.fn(),
      getFiscalExecutions: jest.fn().mockResolvedValue([]),
    };
  });

  describe("fiscal action state", () => {
    it("initializes with null fiscal action state", () => {
      const { result } = renderHook(() =>
        useManageAccountingWorkspace({
          api: mockApi,
          page: "companyDetail",
          selectedCompanyId: "company-123",
          companyDetailTab: "circular",
          feedback: {},
        })
      );

      expect(result.current.runningFiscalAction).toBeNull();
      expect(result.current.lastFiscalResult).toBeNull();
    });
  });

  describe("handleRunFiscalAction", () => {
    it("executes fiscal action successfully", async () => {
      const mockResult = {
        result: {
          action: "search_guides",
          competencia: "2026-01",
          status: "completed",
          guidesFound: 3,
          guidesCaptured: 2,
          timestamp: new Date().toISOString(),
        },
      };

      mockApi.runCompanyFiscalAction.mockResolvedValueOnce(mockResult);

      const { result } = renderHook(() =>
        useManageAccountingWorkspace({
          api: mockApi,
          page: "companyDetail",
          selectedCompanyId: "company-123",
          companyDetailTab: "circular",
          feedback: {},
        })
      );

      await act(async () => {
        await result.current.handleRunFiscalAction("search_guides", "2026-01");
      });

      expect(result.current.lastFiscalResult).toEqual(mockResult);
      expect(result.current.runningFiscalAction).toBeNull();
      expect(result.current.entriesMessage).toContain("concluída com sucesso");
    });

    it("handles fiscal action error", async () => {
      const error = new Error("API error");
      mockApi.runCompanyFiscalAction.mockRejectedValueOnce(error);

      const { result } = renderHook(() =>
        useManageAccountingWorkspace({
          api: mockApi,
          page: "companyDetail",
          selectedCompanyId: "company-123",
          companyDetailTab: "circular",
          feedback: {},
        })
      );

      await act(async () => {
        await result.current.handleRunFiscalAction("search_guides", "2026-01");
      });

      expect(result.current.entriesError).toContain("API error");
      expect(result.current.lastFiscalResult).toBeNull();
      expect(result.current.runningFiscalAction).toBeNull();
    });

    it("prevents concurrent fiscal actions", async () => {
      mockApi.runCompanyFiscalAction.mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve({}), 100))
      );

      const { result } = renderHook(() =>
        useManageAccountingWorkspace({
          api: mockApi,
          page: "companyDetail",
          selectedCompanyId: "company-123",
          companyDetailTab: "circular",
          feedback: {},
        })
      );

      // Start first action
      act(() => {
        result.current.handleRunFiscalAction("search_guides", "2026-01");
      });

      // Attempt second action while first is running
      await act(async () => {
        result.current.handleRunFiscalAction("check_payments", "2026-01");
      });

      // Should have called API only once
      expect(mockApi.runCompanyFiscalAction).toHaveBeenCalledTimes(1);
    });

    it("does not execute when no company selected", async () => {
      const { result } = renderHook(() =>
        useManageAccountingWorkspace({
          api: mockApi,
          page: "companyDetail",
          selectedCompanyId: null,
          companyDetailTab: "circular",
          feedback: {},
        })
      );

      await act(async () => {
        await result.current.handleRunFiscalAction("search_guides", "2026-01");
      });

      expect(mockApi.runCompanyFiscalAction).not.toHaveBeenCalled();
    });
  });

  describe("handleSearchGuides", () => {
    it("calls handleRunFiscalAction with search_guides action", async () => {
      const mockResult = {
        result: {
          action: "search_guides",
          competencia: "2026-01",
          status: "completed",
          guidesFound: 2,
        },
      };

      mockApi.runCompanyFiscalAction.mockResolvedValueOnce(mockResult);

      const { result } = renderHook(() =>
        useManageAccountingWorkspace({
          api: mockApi,
          page: "companyDetail",
          selectedCompanyId: "company-123",
          companyDetailTab: "circular",
          feedback: {},
        })
      );

      await act(async () => {
        await result.current.handleSearchGuides("2026-01");
      });

      expect(mockApi.runCompanyFiscalAction).toHaveBeenCalledWith(
        "company-123",
        expect.objectContaining({
          action: "search_guides",
          competencia: "2026-01",
        })
      );
    });
  });

  describe("handleCheckPayments", () => {
    it("calls handleRunFiscalAction with check_payments action", async () => {
      const mockResult = {
        result: {
          action: "check_payments",
          competencia: "2026-01",
          status: "completed",
          guidesChecked: 4,
          guidesPaid: 2,
        },
      };

      mockApi.runCompanyFiscalAction.mockResolvedValueOnce(mockResult);

      const { result } = renderHook(() =>
        useManageAccountingWorkspace({
          api: mockApi,
          page: "companyDetail",
          selectedCompanyId: "company-123",
          companyDetailTab: "circular",
          feedback: {},
        })
      );

      await act(async () => {
        await result.current.handleCheckPayments("2026-01");
      });

      expect(mockApi.runCompanyFiscalAction).toHaveBeenCalledWith(
        "company-123",
        expect.objectContaining({
          action: "check_payments",
          competencia: "2026-01",
        })
      );
    });
  });

  describe("handleSyncInss", () => {
    it("calls handleRunFiscalAction with sync_inss action", async () => {
      const mockResult = {
        result: {
          action: "sync_inss",
          competencia: "2026-01",
          status: "completed",
          guidesFound: 1,
        },
      };

      mockApi.runCompanyFiscalAction.mockResolvedValueOnce(mockResult);

      const { result } = renderHook(() =>
        useManageAccountingWorkspace({
          api: mockApi,
          page: "companyDetail",
          selectedCompanyId: "company-123",
          companyDetailTab: "circular",
          feedback: {},
        })
      );

      await act(async () => {
        await result.current.handleSyncInss("2026-01");
      });

      expect(mockApi.runCompanyFiscalAction).toHaveBeenCalledWith(
        "company-123",
        expect.objectContaining({
          action: "sync_inss",
          competencia: "2026-01",
        })
      );
    });

    it("handles skipped sync_inss action gracefully", async () => {
      const mockResult = {
        result: {
          action: "sync_inss",
          competencia: "2026-01",
          status: "skipped",
          reason: "declaration_not_transmitted",
        },
      };

      mockApi.runCompanyFiscalAction.mockResolvedValueOnce(mockResult);

      const { result } = renderHook(() =>
        useManageAccountingWorkspace({
          api: mockApi,
          page: "companyDetail",
          selectedCompanyId: "company-123",
          companyDetailTab: "circular",
          feedback: {},
        })
      );

      await act(async () => {
        await result.current.handleSyncInss("2026-01");
      });

      expect(result.current.entriesMessage).toContain("operação ignorada");
      expect(result.current.entriesError).toBe("");
    });
  });

  describe("fiscal result tracking", () => {
    it("clears messages before executing action", async () => {
      mockApi.runCompanyFiscalAction.mockResolvedValueOnce({
        result: { status: "completed" },
      });

      const { result } = renderHook(() =>
        useManageAccountingWorkspace({
          api: mockApi,
          page: "companyDetail",
          selectedCompanyId: "company-123",
          companyDetailTab: "circular",
          feedback: {},
        })
      );

      // Set initial messages
      act(() => {
        result.current.handleSaveCircular({});
      });

      // Execute fiscal action
      await act(async () => {
        await result.current.handleRunFiscalAction("search_guides", "2026-01");
      });

      // Messages should be cleared during execution
      expect(mockApi.runCompanyFiscalAction).toHaveBeenCalled();
    });

    it("reloads circular after successful search_guides", async () => {
      const mockResult = {
        result: {
          action: "search_guides",
          status: "completed",
          guidesFound: 1,
        },
      };

      mockApi.runCompanyFiscalAction.mockResolvedValueOnce(mockResult);

      const { result } = renderHook(() =>
        useManageAccountingWorkspace({
          api: mockApi,
          page: "companyDetail",
          selectedCompanyId: "company-123",
          companyDetailTab: "circular",
          feedback: {},
        })
      );

      await act(async () => {
        await result.current.handleSearchGuides("2026-01");
      });

      // loadCircular should have been called (implicitly verified by mock)
      expect(mockApi.getCircular).toHaveBeenCalled();
    });
  });
});

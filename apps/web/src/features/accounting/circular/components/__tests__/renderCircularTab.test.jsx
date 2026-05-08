import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { CircularTab } from "../renderCircularTab.jsx";

jest.mock("../../../baixa/components/renderBaixaModal", () => ({
  BaixaModal: () => null,
}));

describe("CircularTab", () => {
  const defaultProps = {
    circularData: {
      circular: {
        receitaBruta: "10000",
        receitaServicos: "",
        receitaVendas: "",
        dasTotal: "500",
        inssTotal: "300",
        inssVencimento: "",
        inssStatus: "",
      },
      provisoes: [],
      entries: [],
    },
    loading: false,
    year: 2026,
    competencia: "2026-01",
    onCompetenciaChange: jest.fn(),
    onYearChange: jest.fn(),
    onLoad: jest.fn(),
    onSaveCircular: jest.fn(),
    savingCircular: false,
    onApproveAccountingEntry: jest.fn(),
    approvingCircularEntryId: null,
    accounts: [],
    onCreateBaixa: jest.fn(),
    savingBaixa: false,
  };

  describe("OperationalBlock", () => {
    it("renders operational block when handlers are provided", () => {
      const props = {
        ...defaultProps,
        runningFiscalAction: null,
        lastFiscalResult: null,
        onSearchGuides: jest.fn(),
        onCheckPayments: jest.fn(),
        onSyncInss: jest.fn(),
      };

      render(<CircularTab {...props} />);

      expect(screen.getByText(/Operações Fiscais/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Buscar Guias/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Verificar Pagtos/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Sincronizar INSS/i })).toBeInTheDocument();
    });

    it("does not render operational block when handlers are not provided", () => {
      const props = {
        ...defaultProps,
        runningFiscalAction: null,
        lastFiscalResult: null,
        onSearchGuides: null,
        onCheckPayments: null,
        onSyncInss: null,
      };

      render(<CircularTab {...props} />);

      expect(screen.queryByText(/Operações Fiscais/i)).not.toBeInTheDocument();
    });

    it("calls onSearchGuides when search button is clicked", () => {
      const mockSearchGuides = jest.fn();
      const props = {
        ...defaultProps,
        runningFiscalAction: null,
        lastFiscalResult: null,
        onSearchGuides: mockSearchGuides,
        onCheckPayments: jest.fn(),
        onSyncInss: jest.fn(),
      };

      render(<CircularTab {...props} />);

      fireEvent.click(screen.getByRole("button", { name: /Buscar Guias/i }));
      expect(mockSearchGuides).toHaveBeenCalled();
    });

    it("calls onCheckPayments when check button is clicked", () => {
      const mockCheckPayments = jest.fn();
      const props = {
        ...defaultProps,
        runningFiscalAction: null,
        lastFiscalResult: null,
        onSearchGuides: jest.fn(),
        onCheckPayments: mockCheckPayments,
        onSyncInss: jest.fn(),
      };

      render(<CircularTab {...props} />);

      fireEvent.click(screen.getByRole("button", { name: /Verificar Pagtos/i }));
      expect(mockCheckPayments).toHaveBeenCalled();
    });

    it("calls onSyncInss when sync button is clicked", () => {
      const mockSyncInss = jest.fn();
      const props = {
        ...defaultProps,
        runningFiscalAction: null,
        lastFiscalResult: null,
        onSearchGuides: jest.fn(),
        onCheckPayments: jest.fn(),
        onSyncInss: mockSyncInss,
      };

      render(<CircularTab {...props} />);

      fireEvent.click(screen.getByRole("button", { name: /Sincronizar INSS/i }));
      expect(mockSyncInss).toHaveBeenCalled();
    });

    it("disables buttons when action is in progress", () => {
      const props = {
        ...defaultProps,
        runningFiscalAction: "search_guides",
        lastFiscalResult: null,
        onSearchGuides: jest.fn(),
        onCheckPayments: jest.fn(),
        onSyncInss: jest.fn(),
      };

      render(<CircularTab {...props} />);

      const buttons = screen.getAllByRole("button").filter((btn) =>
        [/Buscar Guias/i, /Verificar Pagtos/i, /Sincronizar INSS/i].some((regex) =>
          regex.test(btn.textContent)
        )
      );

      buttons.forEach((btn) => {
        expect(btn).toBeDisabled();
      });
    });

    it("shows progress indicator for action in progress", () => {
      const props = {
        ...defaultProps,
        runningFiscalAction: "search_guides",
        lastFiscalResult: null,
        onSearchGuides: jest.fn(),
        onCheckPayments: jest.fn(),
        onSyncInss: jest.fn(),
      };

      render(<CircularTab {...props} />);

      expect(screen.getByText(/⏳ Buscando.../i)).toBeInTheDocument();
    });

    it("displays last fiscal result when available", () => {
      const mockResult = {
        result: {
          action: "search_guides",
          status: "completed",
          guidesFound: 5,
          guidesCaptured: 3,
        },
      };

      const props = {
        ...defaultProps,
        runningFiscalAction: null,
        lastFiscalResult: mockResult,
        onSearchGuides: jest.fn(),
        onCheckPayments: jest.fn(),
        onSyncInss: jest.fn(),
      };

      render(<CircularTab {...props} />);

      expect(screen.getByText(/✓ Concluído/i)).toBeInTheDocument();
      expect(screen.getByText(/Guias encontradas: 5/i)).toBeInTheDocument();
    });

    it("displays check_payments result with payment counts", () => {
      const mockResult = {
        result: {
          action: "check_payments",
          status: "completed",
          guidesChecked: 10,
          guidesPaid: 6,
          guidesOverdue: 2,
          guidesOpen: 2,
        },
      };

      const props = {
        ...defaultProps,
        runningFiscalAction: null,
        lastFiscalResult: mockResult,
        onSearchGuides: jest.fn(),
        onCheckPayments: jest.fn(),
        onSyncInss: jest.fn(),
      };

      render(<CircularTab {...props} />);

      expect(screen.getByText(/Verificadas: 10/i)).toBeInTheDocument();
      expect(screen.getByText(/Pagas: 6/i)).toBeInTheDocument();
    });

    it("displays result with different styling for incomplete status", () => {
      const mockResult = {
        result: {
          action: "sync_inss",
          status: "skipped",
          reason: "declaration_not_transmitted",
        },
      };

      const props = {
        ...defaultProps,
        runningFiscalAction: null,
        lastFiscalResult: mockResult,
        onSearchGuides: jest.fn(),
        onCheckPayments: jest.fn(),
        onSyncInss: jest.fn(),
      };

      render(<CircularTab {...props} />);

      expect(screen.getByText(/⚠ Ignorado/i)).toBeInTheDocument();
    });

    it("accepts competencia in operational block display", () => {
      const props = {
        ...defaultProps,
        competencia: "2026-05",
        runningFiscalAction: null,
        lastFiscalResult: null,
        onSearchGuides: jest.fn(),
        onCheckPayments: jest.fn(),
        onSyncInss: jest.fn(),
      };

      render(<CircularTab {...props} />);

      expect(screen.getByText(/Operações Fiscais para 2026-05/i)).toBeInTheDocument();
    });
  });

  describe("ExecutionHistoryPanel", () => {
    const baseProps = {
      ...defaultProps,
      runningFiscalAction: null,
      lastFiscalResult: null,
      onSearchGuides: jest.fn(),
      onCheckPayments: jest.fn(),
      onSyncInss: jest.fn(),
    };

    it("shows loading state when loadingExecutions is true", () => {
      render(<CircularTab {...baseProps} executions={[]} loadingExecutions={true} />);
      expect(screen.getByText(/Carregando.../i)).toBeInTheDocument();
    });

    it("shows empty state when executions array is empty", () => {
      render(<CircularTab {...baseProps} executions={[]} loadingExecutions={false} />);
      expect(screen.getByText(/Nenhuma execução registrada/i)).toBeInTheDocument();
    });

    it("renders execution entries with status badges", () => {
      const executions = [
        {
          id: "log-1",
          portalClientId: "c1",
          competencia: "2026-01",
          action: "search_guides",
          status: "completed",
          startedAt: "2026-01-15T10:00:00Z",
          completedAt: "2026-01-15T10:00:03Z",
          guidesFound: 3,
          guidesCaptured: 2,
          entriesGenerated: 5,
        },
        {
          id: "log-2",
          portalClientId: "c1",
          competencia: "2026-01",
          action: "check_payments",
          status: "failed",
          startedAt: "2026-01-15T11:00:00Z",
          errorCode: "SERPRO_SERVICE_UNAVAILABLE",
          errorMessage: "Service unavailable",
        },
      ];

      render(<CircularTab {...baseProps} executions={executions} loadingExecutions={false} />);

      expect(screen.getAllByText(/Concluído/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Falhou/i)).toBeInTheDocument();
      // "Buscar Guias" and "Verificar Pagtos" appear in both buttons and history entries
      expect(screen.getAllByText(/Buscar Guias/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Verificar Pagtos/i).length).toBeGreaterThan(0);
    });

    it("shows error message for failed executions", () => {
      const executions = [
        {
          id: "log-fail",
          portalClientId: "c1",
          competencia: "2026-01",
          action: "sync_inss",
          status: "failed",
          startedAt: "2026-01-15T12:00:00Z",
          errorCode: "SERPRO_TIMEOUT",
          errorMessage: "Request timed out",
        },
      ];

      render(<CircularTab {...baseProps} executions={executions} loadingExecutions={false} />);

      expect(screen.getByText(/Request timed out/i)).toBeInTheDocument();
    });

    it("shows skip reason for skipped executions", () => {
      const executions = [
        {
          id: "log-skip",
          portalClientId: "c1",
          competencia: "2026-01",
          action: "sync_inss",
          status: "skipped",
          startedAt: "2026-01-15T12:00:00Z",
          skipReason: "declaration_not_transmitted",
        },
      ];

      render(<CircularTab {...baseProps} executions={executions} loadingExecutions={false} />);

      expect(screen.getByText(/declaration not transmitted/i)).toBeInTheDocument();
    });

    it("shows record count in panel header", () => {
      const executions = [
        {
          id: "log-1", portalClientId: "c1", competencia: "2026-01",
          action: "search_guides", status: "completed", startedAt: "2026-01-15T10:00:00Z",
        },
        {
          id: "log-2", portalClientId: "c1", competencia: "2026-01",
          action: "check_payments", status: "completed", startedAt: "2026-01-15T11:00:00Z",
        },
      ];

      render(<CircularTab {...baseProps} executions={executions} loadingExecutions={false} />);

      expect(screen.getByText(/2 registros/i)).toBeInTheDocument();
    });
  });
});

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { CircularTab } from "../renderCircularTab.jsx";

jest.mock("../../baixa/components/renderBaixaModal", () => ({
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

      expect(screen.getByText(/Guias verificadas: 10/i)).toBeInTheDocument();
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

      expect(screen.getByText(/⚠ Incompleto/i)).toBeInTheDocument();
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
});

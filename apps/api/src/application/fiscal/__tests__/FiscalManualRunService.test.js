import { FiscalManualRunService } from "../FiscalManualRunService.js";

// Mock the prisma client
jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    portalClient: {
      findUnique: jest.fn(),
    },
    guide: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    companyMonthlyCircular: {
      findUnique: jest.fn(),
    },
  },
}));

// Mock the dependent services
jest.mock("../serpro/CaptureSerproGuidesService.js", () => ({
  CaptureSerproGuidesService: jest.fn(() => ({
    captureForCompany: jest.fn(),
  })),
}));

jest.mock("../serpro/SerproDctfwebService.js", () => ({
  SerproDctfwebService: jest.fn(() => ({
    syncForCompany: jest.fn(),
  })),
}));

jest.mock("../../guides/guideContract.js", () => ({
  normalizeCompetencia: jest.fn((comp) => {
    if (!comp || !/^\d{4}-\d{2}$/.test(comp)) return null;
    return comp;
  }),
}));

import { prisma } from "../../../infrastructure/db/prisma.js";
import { CaptureSerproGuidesService } from "../serpro/CaptureSerproGuidesService.js";
import { SerproDctfwebService } from "../serpro/SerproDctfwebService.js";
import { normalizeCompetencia } from "../../guides/guideContract.js";

describe("FiscalManualRunService", () => {
  let service;
  let mockCaptureService;
  let mockDctfwebService;

  beforeEach(() => {
    jest.clearAllMocks();

    mockCaptureService = {
      captureForCompany: jest.fn(),
    };

    mockDctfwebService = {
      syncForCompany: jest.fn(),
    };

    service = new FiscalManualRunService({
      captureService: mockCaptureService,
      dctfwebService: mockDctfwebService,
    });
  });

  describe("executeAction", () => {
    const companyId = "company-123";
    const competencia = "2026-01";

    it("throws error for invalid competencia", async () => {
      normalizeCompetencia.mockReturnValue(null);

      await expect(service.executeAction("search_guides", companyId, "invalid", {})).rejects.toThrow(
        "Invalid competencia format"
      );
    });

    it("throws error when company not found", async () => {
      normalizeCompetencia.mockReturnValue(competencia);
      prisma.portalClient.findUnique.mockResolvedValue(null);

      await expect(service.executeAction("search_guides", companyId, competencia, {})).rejects.toThrow(
        "Company not found"
      );
    });

    it("throws error for unknown action", async () => {
      normalizeCompetencia.mockReturnValue(competencia);
      prisma.portalClient.findUnique.mockResolvedValue({
        id: companyId,
        cnpj: "12.345.678/0001-90",
      });

      await expect(
        service.executeAction("unknown_action", companyId, competencia, {})
      ).rejects.toThrow("Unknown action");
    });

    describe("search_guides action", () => {
      it("successfully executes search_guides", async () => {
        normalizeCompetencia.mockReturnValue(competencia);
        prisma.portalClient.findUnique.mockResolvedValue({
          id: companyId,
          cnpj: "12.345.678/0001-90",
        });

        mockCaptureService.captureForCompany.mockResolvedValue({
          guidesFound: 3,
          guidesCaptured: 2,
          guidesUpdated: 1,
          circularUpdated: true,
          entriesGenerated: 5,
        });

        const result = await service.executeAction("search_guides", companyId, competencia, {
          contratanteCnpj: "98.765.432/0001-01",
        });

        expect(result).toEqual({
          action: "search_guides",
          competencia,
          status: "completed",
          guidesFound: 3,
          guidesCaptured: 2,
          guidesUpdated: 1,
          circularUpdated: true,
          entriesGenerated: 5,
          timestamp: expect.any(String),
        });

        expect(mockCaptureService.captureForCompany).toHaveBeenCalledWith({
          portalClientId: companyId,
          competencia,
          contratanteCnpj: "98.765.432/0001-01",
          serviceId: null,
        });
      });

      it("handles search_guides with no options", async () => {
        normalizeCompetencia.mockReturnValue(competencia);
        prisma.portalClient.findUnique.mockResolvedValue({
          id: companyId,
          cnpj: "12.345.678/0001-90",
        });

        mockCaptureService.captureForCompany.mockResolvedValue({
          guidesFound: 0,
          guidesCaptured: 0,
          guidesUpdated: 0,
          circularUpdated: false,
          entriesGenerated: 0,
        });

        const result = await service.executeAction("search_guides", companyId, competencia);

        expect(result.guidesFound).toBe(0);
        expect(result.status).toBe("completed");
      });
    });

    describe("check_payments action", () => {
      it("successfully checks payments for multiple guides", async () => {
        normalizeCompetencia.mockReturnValue(competencia);
        prisma.portalClient.findUnique.mockResolvedValue({
          id: companyId,
          cnpj: "12.345.678/0001-90",
        });

        const guides = [
          { id: "guide-1", paymentStatus: "PAID" },
          { id: "guide-2", paymentStatus: "PAID" },
          { id: "guide-3", paymentStatus: "OPEN" },
          { id: "guide-4", paymentStatus: "OVERDUE" },
        ];

        prisma.guide.findMany.mockResolvedValue(guides);
        prisma.guide.updateMany.mockResolvedValue({ count: 4 });

        const result = await service.executeAction("check_payments", companyId, competencia);

        expect(result).toEqual({
          action: "check_payments",
          competencia,
          status: "completed",
          guidesChecked: 4,
          guidesPaid: 2,
          guidesOverdue: 1,
          guidesOpen: 1,
          timestamp: expect.any(String),
        });

        expect(prisma.guide.findMany).toHaveBeenCalledWith({
          where: {
            portalClientId: companyId,
            competencia,
            status: "PROCESSED",
          },
          select: {
            id: true,
            paymentStatus: true,
            serproLastCheckedAt: true,
          },
        });
      });

      it("handles no guides found for check_payments", async () => {
        normalizeCompetencia.mockReturnValue(competencia);
        prisma.portalClient.findUnique.mockResolvedValue({
          id: companyId,
          cnpj: "12.345.678/0001-90",
        });

        prisma.guide.findMany.mockResolvedValue([]);

        const result = await service.executeAction("check_payments", companyId, competencia);

        expect(result).toEqual({
          action: "check_payments",
          competencia,
          status: "completed",
          guidesChecked: 0,
          guidesPaid: 0,
          guidesOverdue: 0,
          guidesOpen: 0,
          timestamp: expect.any(String),
        });
      });
    });

    describe("sync_inss action", () => {
      it("successfully syncs INSS", async () => {
        normalizeCompetencia.mockReturnValue(competencia);
        prisma.portalClient.findUnique.mockResolvedValue({
          id: companyId,
          cnpj: "12.345.678/0001-90",
        });

        mockDctfwebService.syncForCompany.mockResolvedValue({
          guidesFound: 1,
          guidesCaptured: 1,
          circularUpdated: true,
        });

        const result = await service.executeAction("sync_inss", companyId, competencia);

        expect(result).toEqual({
          action: "sync_inss",
          competencia,
          status: "completed",
          guidesFound: 1,
          guidesCaptured: 1,
          circularUpdated: true,
          timestamp: expect.any(String),
        });
      });

      it("handles declaration not transmitted error", async () => {
        normalizeCompetencia.mockReturnValue(competencia);
        prisma.portalClient.findUnique.mockResolvedValue({
          id: companyId,
          cnpj: "12.345.678/0001-90",
        });

        const error = new Error("Declaration not transmitted");
        error.code = "SERPRO_DCTFWEB_DECLARATION_NOT_TRANSMITTED";
        mockDctfwebService.syncForCompany.mockRejectedValue(error);

        const result = await service.executeAction("sync_inss", companyId, competencia);

        expect(result).toEqual({
          action: "sync_inss",
          competencia,
          status: "skipped",
          reason: "declaration_not_transmitted",
          message: "Declaration not transmitted",
          timestamp: expect.any(String),
        });
      });

      it("propagates other sync errors", async () => {
        normalizeCompetencia.mockReturnValue(competencia);
        prisma.portalClient.findUnique.mockResolvedValue({
          id: companyId,
          cnpj: "12.345.678/0001-90",
        });

        const error = new Error("Network error");
        error.code = "SERPRO_NETWORK_ERROR";
        mockDctfwebService.syncForCompany.mockRejectedValue(error);

        await expect(service.executeAction("sync_inss", companyId, competencia)).rejects.toThrow(
          "Network error"
        );
      });
    });
  });

  describe("getLastExecution", () => {
    const companyId = "company-123";
    const competencia = "2026-01";

    it("returns null for invalid competencia", async () => {
      normalizeCompetencia.mockReturnValue(null);

      const result = await service.getLastExecution(companyId, "invalid");

      expect(result).toBeNull();
    });

    it("returns null when circular not found", async () => {
      normalizeCompetencia.mockReturnValue(competencia);
      prisma.companyMonthlyCircular.findUnique.mockResolvedValue(null);

      const result = await service.getLastExecution(companyId, competencia);

      expect(result).toBeNull();
    });

    it("returns execution summary when circular exists", async () => {
      normalizeCompetencia.mockReturnValue(competencia);
      const updatedAt = new Date();

      prisma.companyMonthlyCircular.findUnique.mockResolvedValue({
        serproSyncStatus: "SUCCESS",
        inssStatus: "OK",
        dasStatus: "OK",
        updatedAt,
      });

      const result = await service.getLastExecution(companyId, competencia);

      expect(result).toEqual({
        competencia,
        serproSync: "SUCCESS",
        inssStatus: "OK",
        dasStatus: "OK",
        lastUpdated: updatedAt,
      });
    });
  });
});

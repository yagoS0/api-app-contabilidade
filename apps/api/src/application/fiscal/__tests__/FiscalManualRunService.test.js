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
    fiscalExecutionLog: {
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

// Mock the dependent services (actual exported functions, not classes)
jest.mock("../serpro/CaptureSerproGuidesService.js", () => ({
  capturePgdasGuideForCompany: jest.fn(),
}));

jest.mock("../serpro/SerproDctfwebService.js", () => ({
  syncSerproInssForCompany: jest.fn(),
}));

jest.mock("../../guides/guideContract.js", () => ({
  normalizeCompetencia: jest.fn((comp) => {
    if (!comp || !/^\d{4}-\d{2}$/.test(comp)) return null;
    return comp;
  }),
}));

import { prisma } from "../../../infrastructure/db/prisma.js";
import { capturePgdasGuideForCompany } from "../serpro/CaptureSerproGuidesService.js";
import { syncSerproInssForCompany } from "../serpro/SerproDctfwebService.js";
import { normalizeCompetencia } from "../../guides/guideContract.js";

describe("FiscalManualRunService", () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();

    // Default log mock behavior
    prisma.fiscalExecutionLog.create.mockResolvedValue({ id: "log-123" });
    prisma.fiscalExecutionLog.update.mockResolvedValue({});

    // Inject mocked functions directly
    service = new FiscalManualRunService({
      captureGuides: capturePgdasGuideForCompany,
      syncInss: syncSerproInssForCompany,
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

        // Mock real capturePgdasGuideForCompany return shape
        capturePgdasGuideForCompany.mockResolvedValue({
          guide: { id: "guide-1" },
          circular: { id: "circ-1" },
          accounting: { generatedEntries: [{}, {}, {}, {}, {}] },
        });

        const result = await service.executeAction("search_guides", companyId, competencia, {
          contratanteCnpj: "98.765.432/0001-01",
        });

        expect(result).toEqual(expect.objectContaining({
          action: "search_guides",
          competencia,
          status: "completed",
          guidesFound: 1,
          guidesCaptured: 1,
          guidesUpdated: 0,
          circularUpdated: true,
          entriesGenerated: 5,
          timestamp: expect.any(String),
          executionLogId: "log-123",
        }));

        expect(capturePgdasGuideForCompany).toHaveBeenCalledWith({
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

        // No guide returned → all counts zero
        capturePgdasGuideForCompany.mockResolvedValue({});

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

        expect(result).toEqual(expect.objectContaining({
          action: "check_payments",
          competencia,
          status: "completed",
          guidesChecked: 4,
          guidesPaid: 2,
          guidesOverdue: 1,
          guidesOpen: 1,
          timestamp: expect.any(String),
          executionLogId: "log-123",
        }));

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

        expect(result).toEqual(expect.objectContaining({
          action: "check_payments",
          competencia,
          status: "completed",
          guidesChecked: 0,
          guidesPaid: 0,
          guidesOverdue: 0,
          guidesOpen: 0,
          timestamp: expect.any(String),
          executionLogId: "log-123",
        }));
      });
    });

    describe("sync_inss action", () => {
      it("successfully syncs INSS", async () => {
        normalizeCompetencia.mockReturnValue(competencia);
        prisma.portalClient.findUnique.mockResolvedValue({
          id: companyId,
          cnpj: "12.345.678/0001-90",
        });

        // Mock real syncSerproInssForCompany return shape
        syncSerproInssForCompany.mockResolvedValue({
          inss: { pdfFileId: "pdf-1" },
          circular: { id: "circ-1" },
        });

        const result = await service.executeAction("sync_inss", companyId, competencia);

        expect(result).toEqual(expect.objectContaining({
          action: "sync_inss",
          competencia,
          status: "completed",
          guidesFound: 1,
          guidesCaptured: 1,
          circularUpdated: true,
          timestamp: expect.any(String),
          executionLogId: "log-123",
        }));
      });

      it("handles declaration not transmitted (NOT_TRANSMITTED status)", async () => {
        normalizeCompetencia.mockReturnValue(competencia);
        prisma.portalClient.findUnique.mockResolvedValue({
          id: companyId,
          cnpj: "12.345.678/0001-90",
        });

        // Service checks result.inss.status === "NOT_TRANSMITTED" (no exception)
        syncSerproInssForCompany.mockResolvedValue({
          inss: { status: "NOT_TRANSMITTED" },
        });

        const result = await service.executeAction("sync_inss", companyId, competencia);

        expect(result).toEqual(expect.objectContaining({
          action: "sync_inss",
          competencia,
          status: "skipped",
          reason: "declaration_not_transmitted",
          timestamp: expect.any(String),
          executionLogId: "log-123",
        }));

        // Log should be updated as skipped
        expect(prisma.fiscalExecutionLog.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: "skipped" }),
          })
        );
      });

      it("propagates other sync errors", async () => {
        normalizeCompetencia.mockReturnValue(competencia);
        prisma.portalClient.findUnique.mockResolvedValue({
          id: companyId,
          cnpj: "12.345.678/0001-90",
        });

        const error = new Error("Network error");
        error.code = "SERPRO_NETWORK_ERROR";
        syncSerproInssForCompany.mockRejectedValue(error);

        await expect(service.executeAction("sync_inss", companyId, competencia)).rejects.toThrow(
          "Network error"
        );
      });
    });
  });

  describe("execution logging", () => {
    const companyId = "company-123";
    const competencia = "2026-01";

    it("creates a running log before executing the action", async () => {
      normalizeCompetencia.mockReturnValue(competencia);
      prisma.portalClient.findUnique.mockResolvedValue({ id: companyId, cnpj: "12.345.678/0001-90" });
      capturePgdasGuideForCompany.mockResolvedValue({ guide: { id: "g1" } });

      await service.executeAction("search_guides", companyId, competencia);

      expect(prisma.fiscalExecutionLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          portalClientId: companyId,
          competencia,
          action: "search_guides",
          status: "running",
        }),
      });
    });

    it("updates log to completed on success", async () => {
      normalizeCompetencia.mockReturnValue(competencia);
      prisma.portalClient.findUnique.mockResolvedValue({ id: companyId, cnpj: "12.345.678/0001-90" });
      // guide present → guidesFound:1, guidesCaptured:1
      capturePgdasGuideForCompany.mockResolvedValue({ guide: { id: "g1" }, circular: { id: "c1" } });
      prisma.fiscalExecutionLog.create.mockResolvedValue({ id: "log-abc" });

      await service.executeAction("search_guides", companyId, competencia);

      expect(prisma.fiscalExecutionLog.update).toHaveBeenCalledWith({
        where: { id: "log-abc" },
        data: expect.objectContaining({
          status: "completed",
          completedAt: expect.any(Date),
          durationMs: expect.any(Number),
          guidesFound: 1,
          guidesCaptured: 1,
        }),
      });
    });

    it("updates log to failed when action throws", async () => {
      normalizeCompetencia.mockReturnValue(competencia);
      prisma.portalClient.findUnique.mockResolvedValue({ id: companyId, cnpj: "12.345.678/0001-90" });
      prisma.fiscalExecutionLog.create.mockResolvedValue({ id: "log-err" });

      const error = new Error("SERPRO unavailable");
      error.code = "SERPRO_SERVICE_UNAVAILABLE";
      capturePgdasGuideForCompany.mockRejectedValue(error);

      await expect(service.executeAction("search_guides", companyId, competencia)).rejects.toThrow();

      expect(prisma.fiscalExecutionLog.update).toHaveBeenCalledWith({
        where: { id: "log-err" },
        data: expect.objectContaining({
          status: "failed",
          completedAt: expect.any(Date),
          errorCode: "SERPRO_SERVICE_UNAVAILABLE",
          errorMessage: "SERPRO unavailable",
        }),
      });
    });

    it("includes executionLogId in the result", async () => {
      normalizeCompetencia.mockReturnValue(competencia);
      prisma.portalClient.findUnique.mockResolvedValue({ id: companyId, cnpj: "12.345.678/0001-90" });
      prisma.guide.findMany.mockResolvedValue([]);
      prisma.fiscalExecutionLog.create.mockResolvedValue({ id: "log-xyz" });

      const result = await service.executeAction("check_payments", companyId, competencia);

      expect(result.executionLogId).toBe("log-xyz");
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

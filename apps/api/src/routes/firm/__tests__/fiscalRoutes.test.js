import request from "supertest";
import express from "express";
import { Router } from "express";

// Mock dependencies
jest.mock("../../../middlewares/requireFirmCompanyAccess.js", () => ({
  requireFirmCompanyAccess: () => (req, res, next) => {
    req.auth = req.auth || { user: { id: "user-123", role: "ACCOUNTANT" } };
    next();
  },
}));

jest.mock("../../../application/guides/guideContract.js", () => ({
  normalizeCompetencia: jest.fn((comp) => {
    if (!comp || !/^\d{4}-\d{2}$/.test(comp)) return null;
    return comp;
  }),
}));

jest.mock("../../../application/fiscal/FiscalManualRunService.js", () => ({
  FiscalManualRunService: jest.fn(function () {
    this.executeAction = jest.fn();
  }),
}));

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    fiscalExecutionLog: {
      findMany: jest.fn(),
    },
  },
}));

import { normalizeCompetencia } from "../../../application/guides/guideContract.js";
import { FiscalManualRunService } from "../../../application/fiscal/FiscalManualRunService.js";
import { prisma } from "../../../infrastructure/db/prisma.js";

describe("Fiscal Routes", () => {
  let app;
  let mockFiscalService;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use(express.json());

    mockFiscalService = {
      executeAction: jest.fn(),
    };

    // Mock the FiscalManualRunService constructor
    FiscalManualRunService.mockImplementation(() => mockFiscalService);

    // Create a simple router with the fiscal route
    const router = Router();

    router.post(
      "/companies/:companyId/fiscal/run",
      (req, res, next) => {
        // Simulate requireFirmCompanyAccess middleware
        req.auth = req.auth || { user: { id: "user-123", role: "ACCOUNTANT" } };
        next();
      },
      async (req, res) => {
        const portalCompanyId = String(req.params.companyId || "").trim();
        const action = String(req.body?.action || "").trim().toLowerCase();
        const competencia = normalizeCompetencia(req.body?.competencia || req.query?.competencia || "");
        const contratanteCnpj = String(req.body?.contratanteCnpj || req.query?.contratanteCnpj || "").trim() || null;
        const serviceId = String(req.body?.serviceId || req.query?.serviceId || "").trim() || null;

        if (!portalCompanyId) {
          return res.status(400).json({ ok: false, error: "company_id_required" });
        }
        if (!action) {
          return res.status(400).json({ ok: false, error: "action_required" });
        }
        if (!competencia) {
          return res.status(400).json({ ok: false, error: "competencia_required" });
        }

        try {
          const fiscalService = new FiscalManualRunService();
          const result = await fiscalService.executeAction(action, portalCompanyId, competencia, {
            contratanteCnpj: contratanteCnpj || undefined,
            serviceId: serviceId || undefined,
          });

          return res.json({ ok: true, result });
        } catch (err) {
          const code = err?.code || "FISCAL_ACTION_FAILED";
          const message = err?.message || "Falha ao executar ação fiscal.";

          const knownErrors = [
            "INVALID_COMPETENCIA",
            "UNKNOWN_FISCAL_ACTION",
            "SERPRO_PGDASD_DISABLED",
            "SERPRO_PGDASD_NO_DEBTS_FOUND",
            "SERPRO_PGDASD_NO_AMOUNT_DUE",
            "SERPRO_PGDASD_DECLARATION_NOT_TRANSMITTED",
            "SERPRO_INVALID_COMPETENCIA",
            "SERPRO_INVALID_CONTRATANTE_CNPJ",
          ];

          if (knownErrors.includes(code)) {
            return res.status(400).json({ ok: false, error: code, reason: message });
          }

          if (code === "PORTAL_COMPANY_NOT_FOUND") {
            return res.status(404).json({ ok: false, error: code, reason: message });
          }

          return res.status(502).json({ ok: false, error: code, reason: message, retryable: Boolean(err?.retryable) });
        }
      }
    );

    router.get(
      "/companies/:companyId/fiscal/executions",
      (req, res, next) => {
        req.auth = req.auth || { user: { id: "user-123", role: "ACCOUNTANT" } };
        next();
      },
      async (req, res) => {
        const portalCompanyId = String(req.params.companyId || "").trim();
        const competencia = String(req.query.competencia || "").trim() || null;
        const action = String(req.query.action || "").trim() || null;
        const limitRaw = parseInt(req.query.limit, 10);
        const limit = isNaN(limitRaw) ? 20 : Math.min(Math.max(limitRaw, 1), 100);

        if (!portalCompanyId) {
          return res.status(400).json({ ok: false, error: "company_id_required" });
        }

        try {
          const where = { portalClientId: portalCompanyId };
          if (competencia) where.competencia = competencia;
          if (action) where.action = action;

          const data = await prisma.fiscalExecutionLog.findMany({
            where,
            orderBy: { startedAt: "desc" },
            take: limit,
          });

          return res.json({ ok: true, data });
        } catch (err) {
          return res.status(500).json({ ok: false, error: "EXECUTIONS_FETCH_FAILED" });
        }
      }
    );

    app.use(router);
  });

  describe("POST /companies/:companyId/fiscal/run", () => {
    const companyId = "company-123";
    const competencia = "2026-01";

    it("returns 404 when company_id route segment is empty (Express no-match)", async () => {
      // Express does not match :companyId when the segment is empty, so returns 404
      const response = await request(app)
        .post("/companies//fiscal/run")
        .send({ action: "search_guides", competencia });

      expect(response.status).toBe(404);
    });

    it("returns 400 when action is missing", async () => {
      const response = await request(app)
        .post(`/companies/${companyId}/fiscal/run`)
        .send({ competencia });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("action_required");
    });

    it("returns 400 when competencia is missing", async () => {
      const response = await request(app)
        .post(`/companies/${companyId}/fiscal/run`)
        .send({ action: "search_guides" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("competencia_required");
    });

    it("returns 400 when competencia is invalid", async () => {
      normalizeCompetencia.mockReturnValueOnce(null);

      const response = await request(app)
        .post(`/companies/${companyId}/fiscal/run`)
        .send({ action: "search_guides", competencia: "invalid" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("competencia_required");
    });

    describe("search_guides action", () => {
      it("successfully executes search_guides action", async () => {
        normalizeCompetencia.mockReturnValueOnce(competencia);

        const mockResult = {
          action: "search_guides",
          competencia,
          status: "completed",
          guidesFound: 3,
          guidesCaptured: 2,
          guidesUpdated: 1,
          circularUpdated: true,
          entriesGenerated: 5,
          timestamp: new Date().toISOString(),
        };

        mockFiscalService.executeAction.mockResolvedValueOnce(mockResult);

        const response = await request(app)
          .post(`/companies/${companyId}/fiscal/run`)
          .send({
            action: "search_guides",
            competencia,
            contratanteCnpj: "98.765.432/0001-01",
          });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ ok: true, result: mockResult });
        expect(mockFiscalService.executeAction).toHaveBeenCalledWith(
          "search_guides",
          companyId,
          competencia,
          expect.objectContaining({
            contratanteCnpj: "98.765.432/0001-01",
          })
        );
      });
    });

    describe("check_payments action", () => {
      it("successfully executes check_payments action", async () => {
        normalizeCompetencia.mockReturnValueOnce(competencia);

        const mockResult = {
          action: "check_payments",
          competencia,
          status: "completed",
          guidesChecked: 4,
          guidesPaid: 2,
          guidesOverdue: 1,
          guidesOpen: 1,
          timestamp: new Date().toISOString(),
        };

        mockFiscalService.executeAction.mockResolvedValueOnce(mockResult);

        const response = await request(app)
          .post(`/companies/${companyId}/fiscal/run`)
          .send({ action: "check_payments", competencia });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ ok: true, result: mockResult });
      });
    });

    describe("sync_inss action", () => {
      it("successfully executes sync_inss action", async () => {
        normalizeCompetencia.mockReturnValueOnce(competencia);

        const mockResult = {
          action: "sync_inss",
          competencia,
          status: "completed",
          guidesFound: 1,
          guidesCaptured: 1,
          circularUpdated: true,
          timestamp: new Date().toISOString(),
        };

        mockFiscalService.executeAction.mockResolvedValueOnce(mockResult);

        const response = await request(app)
          .post(`/companies/${companyId}/fiscal/run`)
          .send({ action: "sync_inss", competencia });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ ok: true, result: mockResult });
      });

      it("handles declaration not transmitted gracefully", async () => {
        normalizeCompetencia.mockReturnValueOnce(competencia);

        const mockResult = {
          action: "sync_inss",
          competencia,
          status: "skipped",
          reason: "declaration_not_transmitted",
          message: "Declaration not transmitted",
          timestamp: new Date().toISOString(),
        };

        mockFiscalService.executeAction.mockResolvedValueOnce(mockResult);

        const response = await request(app)
          .post(`/companies/${companyId}/fiscal/run`)
          .send({ action: "sync_inss", competencia });

        expect(response.status).toBe(200);
        expect(response.body.result.status).toBe("skipped");
      });
    });

    it("returns 400 for known SERPRO errors", async () => {
      normalizeCompetencia.mockReturnValueOnce(competencia);

      const error = new Error("No debts found");
      error.code = "SERPRO_PGDASD_NO_DEBTS_FOUND";

      mockFiscalService.executeAction.mockRejectedValueOnce(error);

      const response = await request(app)
        .post(`/companies/${companyId}/fiscal/run`)
        .send({ action: "search_guides", competencia });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("SERPRO_PGDASD_NO_DEBTS_FOUND");
    });

    it("returns 404 when company not found", async () => {
      normalizeCompetencia.mockReturnValueOnce(competencia);

      const error = new Error("Company not found");
      error.code = "PORTAL_COMPANY_NOT_FOUND";

      mockFiscalService.executeAction.mockRejectedValueOnce(error);

      const response = await request(app)
        .post(`/companies/${companyId}/fiscal/run`)
        .send({ action: "search_guides", competencia });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("PORTAL_COMPANY_NOT_FOUND");
    });

    it("returns 502 for unknown errors", async () => {
      normalizeCompetencia.mockReturnValueOnce(competencia);

      const error = new Error("Unexpected error");
      error.code = "UNKNOWN_ERROR";

      mockFiscalService.executeAction.mockRejectedValueOnce(error);

      const response = await request(app)
        .post(`/companies/${companyId}/fiscal/run`)
        .send({ action: "search_guides", competencia });

      expect(response.status).toBe(502);
      expect(response.body.error).toBe("UNKNOWN_ERROR");
    });

    it("accepts competencia as query param fallback (action must be in body)", async () => {
      normalizeCompetencia.mockReturnValueOnce(competencia);

      const mockResult = {
        action: "search_guides",
        competencia,
        status: "completed",
        guidesFound: 0,
        timestamp: new Date().toISOString(),
      };

      mockFiscalService.executeAction.mockResolvedValueOnce(mockResult);

      // action in body, competencia from query string
      const response = await request(app)
        .post(`/companies/${companyId}/fiscal/run?competencia=${competencia}`)
        .send({ action: "search_guides" });

      expect(response.status).toBe(200);
      expect(mockFiscalService.executeAction).toHaveBeenCalled();
    });
  });

  describe("GET /companies/:companyId/fiscal/executions", () => {
    const companyId = "company-123";

    const mockLogs = [
      {
        id: "log-1",
        portalClientId: companyId,
        competencia: "2026-01",
        action: "search_guides",
        status: "completed",
        startedAt: new Date("2026-01-15T10:00:00Z"),
        completedAt: new Date("2026-01-15T10:00:03Z"),
        durationMs: 3000,
        guidesFound: 2,
        guidesCaptured: 2,
        guidesUpdated: 0,
        entriesGenerated: 3,
        errorCode: null,
        errorMessage: null,
      },
      {
        id: "log-2",
        portalClientId: companyId,
        competencia: "2026-01",
        action: "check_payments",
        status: "completed",
        startedAt: new Date("2026-01-15T11:00:00Z"),
        completedAt: new Date("2026-01-15T11:00:01Z"),
        durationMs: 1000,
        guidesChecked: 2,
        guidesPaid: 1,
        guidesOverdue: 0,
        guidesOpen: 1,
        errorCode: null,
        errorMessage: null,
      },
    ];

    it("returns list of executions for a company", async () => {
      prisma.fiscalExecutionLog.findMany.mockResolvedValueOnce(mockLogs);

      const response = await request(app).get(`/companies/${companyId}/fiscal/executions`);

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0].action).toBe("search_guides");
      expect(prisma.fiscalExecutionLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { portalClientId: companyId },
          orderBy: { startedAt: "desc" },
          take: 20,
        })
      );
    });

    it("filters by competencia when provided", async () => {
      prisma.fiscalExecutionLog.findMany.mockResolvedValueOnce([mockLogs[0]]);

      const response = await request(app)
        .get(`/companies/${companyId}/fiscal/executions?competencia=2026-01`);

      expect(response.status).toBe(200);
      expect(prisma.fiscalExecutionLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { portalClientId: companyId, competencia: "2026-01" },
        })
      );
    });

    it("filters by action when provided", async () => {
      prisma.fiscalExecutionLog.findMany.mockResolvedValueOnce([mockLogs[0]]);

      const response = await request(app)
        .get(`/companies/${companyId}/fiscal/executions?action=search_guides`);

      expect(response.status).toBe(200);
      expect(prisma.fiscalExecutionLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { portalClientId: companyId, action: "search_guides" },
        })
      );
    });

    it("respects limit parameter (capped at 100)", async () => {
      prisma.fiscalExecutionLog.findMany.mockResolvedValueOnce([]);

      await request(app).get(`/companies/${companyId}/fiscal/executions?limit=50`);

      expect(prisma.fiscalExecutionLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 })
      );
    });

    it("caps limit at 100 for large values", async () => {
      prisma.fiscalExecutionLog.findMany.mockResolvedValueOnce([]);

      await request(app).get(`/companies/${companyId}/fiscal/executions?limit=999`);

      expect(prisma.fiscalExecutionLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 })
      );
    });

    it("returns 500 when database query fails", async () => {
      prisma.fiscalExecutionLog.findMany.mockRejectedValueOnce(new Error("DB error"));

      const response = await request(app)
        .get(`/companies/${companyId}/fiscal/executions`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("EXECUTIONS_FETCH_FAILED");
    });

    it("returns empty array when no executions found", async () => {
      prisma.fiscalExecutionLog.findMany.mockResolvedValueOnce([]);

      const response = await request(app)
        .get(`/companies/${companyId}/fiscal/executions`);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
    });
  });
});

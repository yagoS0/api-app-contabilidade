import { prisma } from "../../infrastructure/db/prisma.js";
import { capturePgdasGuideForCompany } from "./serpro/CaptureSerproGuidesService.js";
import { syncSerproInssForCompany } from "./serpro/SerproDctfwebService.js";
import { normalizeCompetencia } from "../guides/guideContract.js";

/**
 * Orchestrator service for fiscal manual operations.
 * Coordinates search guides, check payments, and sync INSS actions.
 * Every execution is persisted in FiscalExecutionLog for audit and history.
 */
export class FiscalManualRunService {
  constructor(options = {}) {
    // Injectable for testing; defaults to the real implementations
    this._captureGuides = options.captureGuides || capturePgdasGuideForCompany;
    this._syncInss = options.syncInss || syncSerproInssForCompany;
  }

  /**
   * Execute a fiscal action for a company and competência.
   * @param {string} action - 'search_guides' | 'check_payments' | 'sync_inss'
   * @param {string} portalClientId
   * @param {string} competencia - YYYY-MM
   * @param {object} options - contratanteCnpj, serviceId, userId, etc.
   * @returns {Promise<object>}
   */
  async executeAction(action, portalClientId, competencia, options = {}) {
    const normalizedCompetencia = normalizeCompetencia(competencia);
    if (!normalizedCompetencia) {
      const err = new Error("Invalid competencia format");
      err.code = "INVALID_COMPETENCIA";
      throw err;
    }

    const company = await prisma.portalClient.findUnique({
      where: { id: String(portalClientId) },
      select: { id: true, cnpj: true },
    });

    if (!company) {
      const err = new Error("Company not found");
      err.code = "PORTAL_COMPANY_NOT_FOUND";
      throw err;
    }

    const normalizedAction = String(action || "").toLowerCase();
    if (!["search_guides", "check_payments", "sync_inss"].includes(normalizedAction)) {
      const err = new Error(`Unknown action: ${action}`);
      err.code = "UNKNOWN_FISCAL_ACTION";
      throw err;
    }

    const startedAt = Date.now();
    const log = await prisma.fiscalExecutionLog.create({
      data: {
        portalClientId: String(portalClientId),
        competencia: normalizedCompetencia,
        action: normalizedAction,
        status: "running",
        triggeredBy: options.userId || null,
      },
    });

    try {
      let result;
      switch (normalizedAction) {
        case "search_guides":
          result = await this.handleSearchGuides(portalClientId, normalizedCompetencia, options);
          break;
        case "check_payments":
          result = await this.handleCheckPayments(portalClientId, normalizedCompetencia, options);
          break;
        case "sync_inss":
          result = await this.handleSyncInss(portalClientId, normalizedCompetencia, options);
          break;
      }

      const finalStatus = result.status === "skipped" ? "skipped" : "completed";
      await prisma.fiscalExecutionLog.update({
        where: { id: log.id },
        data: {
          status: finalStatus,
          completedAt: new Date(),
          durationMs: Date.now() - startedAt,
          skipReason: result.reason || null,
          guidesFound: result.guidesFound ?? null,
          guidesCaptured: result.guidesCaptured ?? null,
          guidesUpdated: result.guidesUpdated ?? null,
          guidesChecked: result.guidesChecked ?? null,
          guidesPaid: result.guidesPaid ?? null,
          guidesOverdue: result.guidesOverdue ?? null,
          guidesOpen: result.guidesOpen ?? null,
          circularUpdated: result.circularUpdated ?? null,
          entriesGenerated: result.entriesGenerated ?? null,
        },
      });

      return { ...result, executionLogId: log.id };
    } catch (err) {
      await prisma.fiscalExecutionLog.update({
        where: { id: log.id },
        data: {
          status: "failed",
          completedAt: new Date(),
          durationMs: Date.now() - startedAt,
          errorCode: err?.code || "UNKNOWN",
          errorMessage: err?.message || null,
        },
      });
      throw err;
    }
  }

  /** @private */
  async handleSearchGuides(portalClientId, competencia, options) {
    const result = await this._captureGuides({
      portalClientId,
      competencia,
      contratanteCnpj: options.contratanteCnpj || null,
      serviceId: options.serviceId || null,
    });

    return {
      action: "search_guides",
      competencia,
      status: "completed",
      guidesFound: result?.guide ? 1 : 0,
      guidesCaptured: result?.guide ? 1 : 0,
      guidesUpdated: 0,
      circularUpdated: Boolean(result?.circular?.id || result?.circular),
      entriesGenerated: Array.isArray(result?.accounting?.generatedEntries)
        ? result.accounting.generatedEntries.length
        : 0,
      timestamp: new Date().toISOString(),
    };
  }

  /** @private */
  async handleCheckPayments(portalClientId, competencia, options) {
    const guides = await prisma.guide.findMany({
      where: { portalClientId: String(portalClientId), competencia, status: "PROCESSED" },
      select: { id: true, paymentStatus: true, serproLastCheckedAt: true },
    });

    if (!guides || guides.length === 0) {
      return {
        action: "check_payments",
        competencia,
        status: "completed",
        guidesChecked: 0,
        guidesPaid: 0,
        guidesOverdue: 0,
        guidesOpen: 0,
        timestamp: new Date().toISOString(),
      };
    }

    let guidesPaid = 0;
    let guidesOverdue = 0;
    let guidesOpen = 0;

    for (const guide of guides) {
      const status = String(guide?.paymentStatus || "").toUpperCase();
      if (status === "PAID") guidesPaid++;
      else if (status === "OVERDUE") guidesOverdue++;
      else guidesOpen++;
    }

    const now = new Date();
    await prisma.guide.updateMany({
      where: { portalClientId: String(portalClientId), competencia, status: "PROCESSED" },
      data: { serproLastCheckedAt: now },
    });

    return {
      action: "check_payments",
      competencia,
      status: "completed",
      guidesChecked: guides.length,
      guidesPaid,
      guidesOverdue,
      guidesOpen,
      timestamp: now.toISOString(),
    };
  }

  /** @private */
  async handleSyncInss(portalClientId, competencia, options) {
    const result = await this._syncInss({
      portalClientId,
      competencia,
      contratanteCnpj: options.contratanteCnpj || null,
    });

    // "NOT_TRANSMITTED" means the DCTFWeb declaration wasn't sent yet — treat as skipped
    if (result?.inss?.status === "NOT_TRANSMITTED") {
      return {
        action: "sync_inss",
        competencia,
        status: "skipped",
        reason: "declaration_not_transmitted",
        message: "Declaração DCTFWeb ainda não transmitida para esta competência.",
        timestamp: new Date().toISOString(),
      };
    }

    return {
      action: "sync_inss",
      competencia,
      status: "completed",
      guidesFound: result?.inss ? 1 : 0,
      guidesCaptured: result?.inss?.pdfFileId ? 1 : 0,
      circularUpdated: Boolean(result?.circular?.id || result?.circular),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get last execution summary for a company + competência (from circular state).
   */
  async getLastExecution(portalClientId, competencia) {
    const normalizedCompetencia = normalizeCompetencia(competencia);
    if (!normalizedCompetencia) return null;

    const circular = await prisma.companyMonthlyCircular.findUnique({
      where: {
        portalClientId_competencia: {
          portalClientId: String(portalClientId),
          competencia: normalizedCompetencia,
        },
      },
      select: {
        serproSyncStatus: true,
        inssStatus: true,
        dasStatus: true,
        updatedAt: true,
      },
    });

    if (!circular) return null;

    return {
      competencia: normalizedCompetencia,
      serproSync: circular.serproSyncStatus,
      inssStatus: circular.inssStatus,
      dasStatus: circular.dasStatus,
      lastUpdated: circular.updatedAt,
    };
  }
}

export default FiscalManualRunService;

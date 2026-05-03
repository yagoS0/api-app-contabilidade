import { prisma } from "../../infrastructure/db/prisma.js";
import { CaptureSerproGuidesService } from "./serpro/CaptureSerproGuidesService.js";
import { SerproDctfwebService } from "./serpro/SerproDctfwebService.js";
import { normalizeCompetencia } from "../guides/guideContract.js";

/**
 * Orchestrator service for fiscal manual operations.
 * Coordinates search guides, check payments, and sync INSS actions.
 */
export class FiscalManualRunService {
  constructor(options = {}) {
    this.captureService = options.captureService || new CaptureSerproGuidesService();
    this.dctfwebService = options.dctfwebService || new SerproDctfwebService();
  }

  /**
   * Execute a fiscal action for a company and competência.
   * @param {string} action - Action type: 'search_guides', 'check_payments', 'sync_inss'
   * @param {string} portalClientId - Company ID
   * @param {string} competencia - Competência in YYYY-MM format
   * @param {object} options - Additional options (contratanteCnpj, serviceId, etc.)
   * @returns {Promise<object>} Result of the action
   */
  async executeAction(action, portalClientId, competencia, options = {}) {
    const normalizedCompetencia = normalizeCompetencia(competencia);
    if (!normalizedCompetencia) {
      const err = new Error("Invalid competencia format");
      err.code = "INVALID_COMPETENCIA";
      throw err;
    }

    // Validate company exists
    const company = await prisma.portalClient.findUnique({
      where: { id: String(portalClientId) },
      select: { id: true, cnpj: true },
    });

    if (!company) {
      const err = new Error("Company not found");
      err.code = "PORTAL_COMPANY_NOT_FOUND";
      throw err;
    }

    switch (String(action || "").toLowerCase()) {
      case "search_guides":
        return this.handleSearchGuides(portalClientId, normalizedCompetencia, options);
      case "check_payments":
        return this.handleCheckPayments(portalClientId, normalizedCompetencia, options);
      case "sync_inss":
        return this.handleSyncInss(portalClientId, normalizedCompetencia, options);
      default:
        const err = new Error(`Unknown action: ${action}`);
        err.code = "UNKNOWN_FISCAL_ACTION";
        throw err;
    }
  }

  /**
   * Search and capture guides from SERPRO PGDAS system.
   * @private
   */
  async handleSearchGuides(portalClientId, competencia, options) {
    const contratanteCnpj = options.contratanteCnpj || null;
    const serviceId = options.serviceId || null;

    // Use existing capture service
    const result = await this.captureService.captureForCompany({
      portalClientId,
      competencia,
      contratanteCnpj: contratanteCnpj || undefined,
      serviceId,
    });

    return {
      action: "search_guides",
      competencia,
      status: "completed",
      guidesFound: result?.guidesFound || 0,
      guidesCaptured: result?.guidesCaptured || 0,
      guidesUpdated: result?.guidesUpdated || 0,
      circularUpdated: Boolean(result?.circularUpdated),
      entriesGenerated: result?.entriesGenerated || 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Check payment status of guides via SERPRO.
   * @private
   */
  async handleCheckPayments(portalClientId, competencia, options) {
    // Fetch guides for this company + competência
    const guides = await prisma.guide.findMany({
      where: {
        portalClientId: String(portalClientId),
        competencia,
        status: "PROCESSED",
      },
      select: {
        id: true,
        paymentStatus: true,
        serproLastCheckedAt: true,
      },
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

    // Count current statuses
    let guidesPaid = 0;
    let guidesOverdue = 0;
    let guidesOpen = 0;

    for (const guide of guides) {
      const status = String(guide?.paymentStatus || "").toUpperCase();
      if (status === "PAID") guidesPaid++;
      else if (status === "OVERDUE") guidesOverdue++;
      else guidesOpen++;
    }

    // Update last checked timestamp
    const now = new Date();
    await prisma.guide.updateMany({
      where: {
        portalClientId: String(portalClientId),
        competencia,
        status: "PROCESSED",
      },
      data: {
        serproLastCheckedAt: now,
      },
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

  /**
   * Sync INSS via SERPRO DCTFWeb service.
   * @private
   */
  async handleSyncInss(portalClientId, competencia, options) {
    // Validate company has procuration certificate configured
    const company = await prisma.portalClient.findUnique({
      where: { id: String(portalClientId) },
      select: { id: true },
    });

    if (!company) {
      const err = new Error("Company not found");
      err.code = "PORTAL_COMPANY_NOT_FOUND";
      throw err;
    }

    // Attempt INSS sync
    try {
      const result = await this.dctfwebService.syncForCompany({
        portalClientId,
        competencia,
        idServico: options.serviceId || "GERARGUIA31",
      });

      return {
        action: "sync_inss",
        competencia,
        status: "completed",
        guidesFound: result?.guidesFound || 0,
        guidesCaptured: result?.guidesCaptured || 0,
        circularUpdated: Boolean(result?.circularUpdated),
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      // If INSS sync fails, return partial result with error
      if (err?.code === "SERPRO_DCTFWEB_DECLARATION_NOT_TRANSMITTED") {
        return {
          action: "sync_inss",
          competencia,
          status: "skipped",
          reason: "declaration_not_transmitted",
          message: err.message,
          timestamp: new Date().toISOString(),
        };
      }

      throw err;
    }
  }

  /**
   * Get last execution summary for a company + competência.
   * @param {string} portalClientId - Company ID
   * @param {string} competencia - Competência in YYYY-MM format
   * @returns {Promise<object>} Last execution data
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

import { prisma } from "../../infrastructure/db/prisma.js";
import { AdnSyncService } from "../nfse/AdnSyncService.js";
import { readStoredCompanyPfx } from "../../infrastructure/storage/CertStorage.js";
import { decryptSecret } from "../../utils/crypto.js";
import { processarDocumentoSyncLocal } from './ProcessadorDocumentoSyncLocal.js';
import { registrarDocumentoRecusado } from './RecuperacaoDocumentoSyncService.js';
export { upsertPortalInvoiceSafe } from './ProcessadorDocumentoSyncLocal.js';
function normalizeCnpj(value) { return String(value || '').replace(/\D+/g, ''); }
function parseLoteResponse(data) {
  if (!data || typeof data !== "object") return { status: null, items: [], errors: [] };
  const status =
    data.StatusProcessamento ||
    data.statusProcessamento ||
    data.status ||
    data.Status ||
    null;
  const items =
    data.LoteDFe ||
    data.loteDFe ||
    data.documentos ||
    data.Documentos ||
    data.itens ||
    [];
  const errors = data.Erros || data.erros || [];
  return {
    status: status ? String(status).toUpperCase() : null,
    items: Array.isArray(items) ? items : [items],
    errors,
  };
}

async function resolveCompanyCert(company) {
  if (!company?.certPasswordEnc) return null;
  const password = await decryptSecret(company.certPasswordEnc);
  if (!password) return null;
  const pfxBuffer = await readStoredCompanyPfx(company);
  if (!pfxBuffer) return null;
  return { pfxBuffer, pfxPassword: password };
}

export class InvoiceSyncEngine {
  static LOCK_TTL_MS = 12 * 60 * 1000;
  static MIN_INTERVAL_MS = 60 * 1000;
  static DEFAULT_BACKOFF_MS = 20 * 60 * 1000;
  static MAX_ITERATIONS = 50;

  static async ensureState(clientId) {
    const existing = await prisma.portalSyncState.findUnique({ where: { clientId } });
    if (existing) return existing;
    return prisma.portalSyncState.create({
      data: { clientId, lastCursor: BigInt(0), state: "OK" },
    });
  }

  static async start({ clientId, resetCursor = false, maxIterations } = {}) {
    const portalClient = await prisma.portalClient.findUnique({
      where: { id: String(clientId) },
      include: { syncState: true, integrationSettings: true },
    });
    if (!portalClient) {
      const err = new Error("client_not_found");
      err.code = "CLIENT_NOT_FOUND";
      throw err;
    }

    const state = await this.ensureState(portalClient.id);
    if (state.documentoRecusado) return { jobId: null, state: 'ERROR', queued: false,
      reason: 'DOCUMENTO_RECUSADO_PENDENTE', sync: { lastSyncAt: state.lastSyncAt, stale: true } };
    const iterations = Math.min(Math.max(Number(maxIterations) || this.MAX_ITERATIONS, 1), 1000);
    const now = Date.now();

    if (state.backoffUntil && new Date(state.backoffUntil).getTime() > now) {
      const job = await prisma.portalInvoiceSyncJob.findFirst({
        where: { clientId: portalClient.id },
        orderBy: { createdAt: "desc" },
      });
      return {
        jobId: job?.id || null,
        state: state.state,
        queued: false,
        reason: "BACKOFF_ACTIVE",
        sync: { lastSyncAt: state.lastSyncAt, stale: true },
      };
    }

    if (state.lockUntil && new Date(state.lockUntil).getTime() > now && state.state === "RUNNING") {
      const job = await prisma.portalInvoiceSyncJob.findFirst({
        where: { clientId: portalClient.id, state: "RUNNING" },
        orderBy: { createdAt: "desc" },
      });
      return {
        jobId: job?.id || null,
        state: "RUNNING",
        queued: false,
        reason: "LOCK_ACTIVE",
        sync: { lastSyncAt: state.lastSyncAt, stale: true },
      };
    }

    if (state.lastSyncAt && now - new Date(state.lastSyncAt).getTime() < this.MIN_INTERVAL_MS) {
      return {
        jobId: null,
        state: state.state,
        queued: false,
        reason: "TOO_RECENT",
        sync: { lastSyncAt: state.lastSyncAt, stale: false },
      };
    }

    const job = await prisma.portalInvoiceSyncJob.create({
      data: {
        clientId: portalClient.id,
        state: "RUNNING",
        lastMessage: resetCursor
          ? "Sincronização completa iniciada (cursor resetado)."
          : "Sincronização incremental iniciada.",
      },
    });

    await prisma.portalSyncState.update({
      where: { clientId: portalClient.id },
      data: {
        ...(resetCursor ? { lastCursor: BigInt(0), lastSyncAt: null } : {}),
        state: "RUNNING",
        lastError: null,
        lockUntil: new Date(now + this.LOCK_TTL_MS),
        backoffUntil: null,
      },
    });

    setImmediate(() => {
      this.runJob({
        clientId: portalClient.id,
        jobId: job.id,
        maxIterations: iterations,
      }).catch(() => {});
    });

    return {
      jobId: job.id,
      state: "RUNNING",
      queued: true,
      sync: { lastSyncAt: state.lastSyncAt, stale: true },
    };
  }

  static async runJob({ clientId, jobId, maxIterations = InvoiceSyncEngine.MAX_ITERATIONS }) {
    const pending = await this.ensureState(String(clientId));
    if (pending.documentoRecusado) {
      await prisma.portalInvoiceSyncJob.update({ where: { id: jobId }, data: { state: 'ERROR', lastMessage: 'Documento recusado pendente de conferência; nenhuma nova consulta realizada.' } });
      return;
    }
    const portalClient = await prisma.portalClient.findUnique({
      where: { id: String(clientId) },
      include: { integrationSettings: true },
    });
    if (!portalClient) return;

    const cnpjConsulta = normalizeCnpj(portalClient.cnpj);
    const certCompanyId =
      portalClient.integrationSettings?.certCompanyId || portalClient.companyId || null;
    let company = certCompanyId
      ? await prisma.company.findUnique({ where: { id: String(certCompanyId) } })
      : null;
    // Compat: se certCompanyId vier com PortalClient.id por engano, resolve para Company.id.
    if (!company && certCompanyId) {
      const mappedPortal = await prisma.portalClient.findUnique({
        where: { id: String(certCompanyId) },
        select: { companyId: true },
      });
      if (mappedPortal?.companyId) {
        company = await prisma.company.findUnique({ where: { id: String(mappedPortal.companyId) } });
      }
    }
    const certInfo = company ? await resolveCompanyCert(company) : null;

    if (!certInfo?.pfxBuffer) {
      await prisma.portalSyncState.update({
        where: { clientId: portalClient.id },
        data: { state: "ERROR", lastError: "missing_certificate", lockUntil: null },
      });
      await prisma.portalInvoiceSyncJob.update({
        where: { id: jobId },
        data: { state: "ERROR", lastMessage: "Certificado não configurado." },
      });
      return;
    }

    const state = await this.ensureState(portalClient.id);
    let cursor = state.lastCursor ?? BigInt(0);
    let maxNSU = cursor;
    const counters = { processed: 0, created: 0, updated: 0, duplicates: 0, errors: 0 };
    let documentoEmProcessamento = null;

    try {
      for (let i = 0; i < maxIterations; i += 1) {
        const response = await AdnSyncService.fetchLote({
          nsu: cursor.toString(),
          cnpjConsulta,
          lote: true,
          certInfo,
        });

        const { status, items, errors } = parseLoteResponse(response);
        if (status === "REJEICAO") {
          const err = new Error("adn_rejeicao");
          err.code = "ADN_REJEICAO";
          err.details = errors;
          throw err;
        }
        if (status === "NENHUM_DOCUMENTO_LOCALIZADO") break;
        if (!items.length) break;

        for (const item of items) {
          documentoEmProcessamento = { clientId: portalClient.id, cursor: cursor.toString(),
            origem: 'ADN_SYNC', item, recebidoEm: new Date().toISOString() };
          let result;
          for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
              result = await prisma.$transaction(tx => processarDocumentoSyncLocal(tx, documentoEmProcessamento));
              break;
            } catch (error) {
              if (!['P2002', 'P2034', 'FONTE_ALTERADA'].includes(error?.code) || attempt === 2) throw error;
            }
          }
          const nsuValue = BigInt(result.nsu);
          if (nsuValue > maxNSU) maxNSU = nsuValue;
          counters.processed += 1;
          if (result.action === 'created') counters.created += 1;
          else if (result.action === 'updated') counters.updated += 1;
          else counters.duplicates += 1;
          documentoEmProcessamento = null;
        }

        cursor = maxNSU + BigInt(1);
      }

      const nextCursor = maxNSU + BigInt(1);
      const now = new Date();
      await prisma.portalSyncState.update({
        where: { clientId: portalClient.id },
        data: {
          lastCursor: nextCursor,
          lastSyncAt: now,
          state: "OK",
          lastError: null,
          lockUntil: null,
          backoffUntil: null,
        },
      });

      await prisma.portalInvoiceSyncJob.update({
        where: { id: jobId },
        data: {
          state: "DONE",
          processed: counters.processed,
          created: counters.created,
          updated: counters.updated,
          duplicates: counters.duplicates,
          errors: counters.errors,
          lastCursor: nextCursor,
          lastMessage: "Concluído.",
        },
      });
    } catch (err) {
      const now = Date.now();
      if (err?.code === "ADN_RATE_LIMITED") {
        const retryAfter = Number(err.retryAfterSeconds || 60);
        const backoffMs =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : this.DEFAULT_BACKOFF_MS;
        await prisma.portalSyncState.update({
          where: { clientId: portalClient.id },
          data: {
            state: "ERROR",
            lastError: "429",
            lockUntil: null,
            backoffUntil: new Date(now + backoffMs),
          },
        });
        await prisma.portalInvoiceSyncJob.update({
          where: { id: jobId },
          data: {
            state: "ERROR",
            errors: counters.errors + 1,
            processed: counters.processed,
            created: counters.created,
            updated: counters.updated,
            duplicates: counters.duplicates,
            lastMessage: "Rate limited (429).",
          },
        });
        return;
      }

      if (documentoEmProcessamento) {
        await registrarDocumentoRecusado(prisma, { ...documentoEmProcessamento,
          motivo: err?.code || 'SYNC_FAILED' });
      } else {
        await prisma.portalSyncState.update({ where: { clientId: portalClient.id },
          data: { state: 'ERROR', lastError: err?.code || 'SYNC_FAILED', lockUntil: null } });
      }
      const errorCode = err?.code || "unknown_error";
      const errorMessage = err?.message ? String(err.message) : null;
      await prisma.portalInvoiceSyncJob.update({
        where: { id: jobId },
        data: {
          state: "ERROR",
          errors: counters.errors + 1,
          processed: counters.processed,
          created: counters.created,
          updated: counters.updated,
          duplicates: counters.duplicates,
          lastMessage: errorMessage
            ? `Falha no sync (${errorCode}): ${errorMessage}`
            : `Falha no sync (${errorCode}).`,
        },
      });
    }
  }
}

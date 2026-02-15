import fs from "node:fs";
import crypto from "node:crypto";
import { gunzipSync } from "node:zlib";
import { prisma } from "../../infrastructure/db/prisma.js";
import { AdnSyncService } from "../nfse/AdnSyncService.js";
import { parseXmlMetadata } from "../nfse/AdnXmlMetadata.js";
import { parseDate } from "../../utils/date.js";
import { resolveCertificatePath } from "../../infrastructure/storage/CertStorage.js";
import { decryptSecret } from "../../utils/crypto.js";

function normalizeCnpj(value) {
  return String(value || "").replace(/\D+/g, "");
}

function sha256(text) {
  if (!text) return null;
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

function decodeXml(arquivoXml) {
  if (!arquivoXml) return null;
  const raw = Buffer.from(String(arquivoXml), "base64");
  try {
    return gunzipSync(raw).toString("utf-8");
  } catch {
    return raw.toString("utf-8");
  }
}

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

function mapInvoiceStatusFromAdn({ tipoDocumento, tipoEvento, situacao, statusNormalized }) {
  const td = String(tipoDocumento || "").toUpperCase();
  const te = String(tipoEvento || "").toUpperCase();
  const si = String(situacao || "").trim().toLowerCase();
  const st = String(statusNormalized || "").toLowerCase();

  // EVENTOS devem ter prioridade sobre qualquer cStat/situacao do XML.
  if (te.includes("E105102")) return "SUBSTITUIDA";
  if (te.includes("E101101")) return "CANCELADA";
  if (td === "EVENTO") {
    if (te.includes("SUBSTIT")) return "SUBSTITUIDA";
    if (te.includes("CANCEL")) return "CANCELADA";
    if (te.includes("REJEIT") || te.includes("REJECT")) return "REJEITADA";
  }

  if (st === "cancelled_substitution") return "SUBSTITUIDA";
  if (st === "cancelled") return "CANCELADA";
  if (st === "rejected") return "REJEITADA";
  if (st === "authorized") return "EMITIDA";

  // cStat comum em retornos XML transformados
  // 100: autorizada
  // 101/102: cancelamento (varia por implementação/provedor)
  if (si === "100") return "EMITIDA";
  if (si === "101" || si === "102") return "CANCELADA";

  if (si === "2") return "CANCELADA";
  if (si === "1") return "EMITIDA";

  if (si.includes("substit")) return "SUBSTITUIDA";
  if (si.includes("cancel")) return "CANCELADA";
  if (si.includes("rejeit") || si.includes("reject")) return "REJEITADA";
  if (si.includes("autoriz") || si.includes("normal")) return "EMITIDA";

  return "PENDENTE";
}

function mergeStatus(existing, incoming) {
  const ex = String(existing || "").toUpperCase();
  const inc = String(incoming || "").toUpperCase();
  const priority = ["SUBSTITUIDA", "CANCELADA", "REJEITADA", "EMITIDA", "PENDENTE"];
  const exP = priority.indexOf(ex);
  const incP = priority.indexOf(inc);
  if (exP === -1) return inc || existing || "PENDENTE";
  if (incP === -1) return existing || "PENDENTE";
  return exP <= incP ? ex : inc;
}

async function findExistingPortalInvoice({ clientId, data }) {
  if (data.idDps) {
    const byIdDps = await prisma.portalInvoice.findUnique({
      where: { clientId_idDps: { clientId, idDps: data.idDps } },
    });
    if (byIdDps) return byIdDps;
  }
  if (data.chaveAcesso) {
    const byChave = await prisma.portalInvoice.findUnique({
      where: { clientId_chaveAcesso: { clientId, chaveAcesso: data.chaveAcesso } },
    });
    if (byChave) return byChave;
  }
  if (data.idNfse) {
    const byIdNfse = await prisma.portalInvoice.findUnique({
      where: { clientId_idNfse: { clientId, idNfse: data.idNfse } },
    });
    if (byIdNfse) return byIdNfse;
  }
  return null;
}

async function buildSafeUpdateData({ clientId, existing, data }) {
  const update = { ...data };
  const uniqueKeys = ["idDps", "chaveAcesso", "idNfse"];

  for (const key of uniqueKeys) {
    const current = existing?.[key] || null;
    const incoming = data?.[key] || null;

    // Nunca apaga chave única existente
    if (!incoming) {
      delete update[key];
      continue;
    }

    // Se já existe e mudou, não substitui (evita colisões)
    if (current && current !== incoming) {
      delete update[key];
      continue;
    }

    // Se não existe no registro, só seta se não estiver ocupada por outro registro
    if (!current && incoming) {
      let occupiedByAnother = false;
      if (key === "idDps") {
        const found = await prisma.portalInvoice.findUnique({
          where: { clientId_idDps: { clientId, idDps: incoming } },
          select: { id: true },
        });
        occupiedByAnother = Boolean(found && found.id !== existing.id);
      } else if (key === "chaveAcesso") {
        const found = await prisma.portalInvoice.findUnique({
          where: { clientId_chaveAcesso: { clientId, chaveAcesso: incoming } },
          select: { id: true },
        });
        occupiedByAnother = Boolean(found && found.id !== existing.id);
      } else if (key === "idNfse") {
        const found = await prisma.portalInvoice.findUnique({
          where: { clientId_idNfse: { clientId, idNfse: incoming } },
          select: { id: true },
        });
        occupiedByAnother = Boolean(found && found.id !== existing.id);
      }

      if (occupiedByAnother) {
        delete update[key];
      }
    }
  }

  return update;
}

async function upsertPortalInvoiceSafe({ clientId, data }) {
  const existing = await findExistingPortalInvoice({ clientId, data });
  if (existing) {
    const safeUpdate = await buildSafeUpdateData({ clientId, existing, data });
    await prisma.portalInvoice.update({
      where: { id: existing.id },
      data: safeUpdate,
    });
    return { action: "updated", invoiceId: existing.id, invoice: { ...existing, ...safeUpdate } };
  }

  try {
    const created = await prisma.portalInvoice.create({ data });
    return { action: "created", invoiceId: created.id, invoice: created };
  } catch (err) {
    if (err?.code === "P2002") {
      // concorrência de chave única: tenta reaprender o registro algumas vezes
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, 60 * attempt));
        }
        const concurrent = await findExistingPortalInvoice({ clientId, data });
        if (concurrent) {
          await prisma.portalInvoice.update({
            where: { id: concurrent.id },
            data,
          });
          return { action: "updated", invoiceId: concurrent.id, invoice: { ...concurrent, ...data } };
        }
      }
      return { action: "duplicate", invoiceId: null, invoice: null };
    }
    throw err;
  }
}

function resolveCompanyCert(company) {
  if (!company?.certStorageKey || !company?.certPasswordEnc) return null;
  const password = decryptSecret(company.certPasswordEnc);
  if (!password) return null;
  const pfxPath = resolveCertificatePath(company.certStorageKey);
  if (!pfxPath) return null;
  const pfxBuffer = fs.readFileSync(pfxPath);
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
    const certInfo = company ? resolveCompanyCert(company) : null;

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
          const nsuRaw = item.NSU || item.nsu || item.Nsu;
          if (!nsuRaw) continue;
          const nsuValue = BigInt(nsuRaw);
          if (nsuValue > maxNSU) maxNSU = nsuValue;

          const tipoDocumento = item.TipoDocumento || item.tipoDocumento || null;
          const tipoEvento = item.TipoEvento || item.tipoEvento || null;
          const dataHoraGeracao = item.DataHoraGeracao || item.dataHoraGeracao || null;
          const chaveAcesso = item.ChaveAcesso || item.chaveAcesso || null;
          const arquivoXml = item.ArquivoXml || item.arquivoXml || null;

          let xmlRaw = null;
          let metadata = {};
          if (arquivoXml) {
            xmlRaw = decodeXml(arquivoXml);
            metadata = parseXmlMetadata(xmlRaw);
          }

          const invoiceStatus = mapInvoiceStatusFromAdn({
            tipoDocumento,
            tipoEvento,
            situacao: metadata?.situacao,
            statusNormalized: null,
          });

          const baseData = {
            clientId: portalClient.id,
            type: "NFSE",
            numero: metadata?.numeroNfse || null,
            serie: null,
            chaveAcesso: chaveAcesso ? String(chaveAcesso) : null,
            idNfse: metadata?.numeroNfse || null,
            idDps: null,
            competencia: metadata?.competencia || null,
            issueDate: metadata?.dataEmissao || null,
            status: invoiceStatus,
            total: metadata?.valorServicos ?? null,
            emitenteNome: metadata?.prestadorNome || null,
            emitenteDoc: metadata?.cnpjPrestador || null,
            tomadorNome: metadata?.tomadorNome || null,
            tomadorDoc: metadata?.cnpjTomador || null,
            xmlRaw,
            xmlHash: sha256(xmlRaw || ""),
            lastSyncAt: null,
          };

          const isEvento = String(tipoDocumento || "").toUpperCase() === "EVENTO";
          if (isEvento) {
            if (!baseData.chaveAcesso) {
              counters.errors += 1;
              continue;
            }
            const existing = await findExistingPortalInvoice({
              clientId: portalClient.id,
              data: baseData,
            });
            const mergedStatus = mergeStatus(existing?.status, baseData.status);
            const invResult = await upsertPortalInvoiceSafe({
              clientId: portalClient.id,
              data: { ...baseData, status: mergedStatus },
            });
            if (invResult.action === "duplicate" || !invResult.invoiceId) {
              counters.duplicates += 1;
              continue;
            }

            await prisma.portalInvoiceEvent.create({
              data: {
                clientId: portalClient.id,
                invoiceId: invResult.invoiceId,
                type: mergedStatus,
                date: dataHoraGeracao ? parseDate(dataHoraGeracao) : null,
                payloadRaw: { tipoDocumento, tipoEvento, nsu: nsuValue.toString() },
              },
            });

            counters.processed += 1;
            counters.updated += 1;
            continue;
          }

          // Documento NFSe
          const existing = await findExistingPortalInvoice({
            clientId: portalClient.id,
            data: baseData,
          });
          const mergedStatus = mergeStatus(existing?.status, baseData.status);
          const data = { ...baseData, status: mergedStatus };
          const result = await upsertPortalInvoiceSafe({
            clientId: portalClient.id,
            data,
          });
          counters.processed += 1;
          if (result.action === "updated") counters.updated += 1;
          else if (result.action === "created") counters.created += 1;
          else counters.duplicates += 1;
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

      await prisma.portalSyncState.update({
        where: { clientId: portalClient.id },
        data: {
          state: "ERROR",
          lastError: err?.code || err?.message || "sync_failed",
          lockUntil: null,
        },
      });
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


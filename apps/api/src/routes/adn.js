import { Router } from "express";
import { AdnSyncService } from "../application/nfse/AdnSyncService.js";
import { AdnRepository } from "../infrastructure/db/AdnRepository.js";
import { NfseRepository } from "../infrastructure/db/NfseRepository.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { parseDate } from "../utils/date.js";
import PDFDocument from "pdfkit";
import { gunzipSync } from "node:zlib";
import {
  ensureLegacyCompanyAccess,
  ensureLegacyCompanyCnpjAccess,
} from "./middlewares/portalAccess.js";

function normalizeCnpj(value) {
  return String(value || "").replace(/\D+/g, "");
}

function buildUnifiedKey(item) {
  return (
    item.chaveAcesso ||
    item.numeroNfse ||
    item.idDps ||
    (item.rpsSerie && item.rpsNumero ? `${item.rpsSerie}-${item.rpsNumero}` : null) ||
    `${item.cnpjPrestador || ""}-${item.dataEmissao || ""}`
  );
}

function isCancelledItem(item) {
  const values = [item?.status, item?.situacao, item?.tipoEvento]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return values.some((value) => value.includes("cancel"));
}

function isRejectedItem(item) {
  const values = [item?.status, item?.situacao, item?.tipoEvento]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return values.some((value) => value.includes("rejeit") || value.includes("reject"));
}

function mergeUnified(existing, incoming) {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== undefined && value !== null && value !== "") {
      if (merged[key] === undefined || merged[key] === null || merged[key] === "") {
        merged[key] = value;
      }
    }
  }
  merged.sources = Array.from(new Set([...(existing.sources || []), ...(incoming.sources || [])]));
  return merged;
}

function decodeXmlMaybeGzipBase64(value) {
  if (!value) return null;
  if (value.startsWith("<")) return value;
  try {
    const raw = Buffer.from(value, "base64");
    try {
      return gunzipSync(raw).toString("utf-8");
    } catch {
      return raw.toString("utf-8");
    }
  } catch {
    return value;
  }
}

export function createAdnRouter({ ensureAuthorized, log }) {
  const router = Router();
  const syncTracker = new Map();

  function serializeErrorSafe(err) {
    const status = err?.response?.status || err?.status;
    const data = err?.response?.data ?? err?.providerData;
    const message =
      (data && typeof data === "object" && (data.message || data.error || data.descricao || data.detail)) ||
      (typeof data === "string" ? data.slice(0, 2000) : null) ||
      err?.message ||
      String(err);
    return {
      code: err?.code,
      status,
      message,
      retryAfterSeconds: err?.retryAfterSeconds,
    };
  }

  function scheduleAdnSync({ cnpj, maxIterations }) {
    if (!cnpj) return;
    const key = String(cnpj);
    const now = Date.now();
    const state = syncTracker.get(key) || {
      running: false,
      lastAttemptAt: 0,
      lastCompletedAt: 0,
    };
    const throttleMs = 60 * 1000;
    if (state.running) return;
    if (now - state.lastAttemptAt < throttleMs) return;

    state.running = true;
    state.lastAttemptAt = now;
    syncTracker.set(key, state);

    setImmediate(async () => {
      try {
        await AdnSyncService.syncUntilEmpty({
          maxIterations,
          cnpjConsulta: key,
        });
      } catch (err) {
        // Evita poluir logs do app: sync em background é best-effort.
        log.trace(
          { err: serializeErrorSafe(err), cnpj: key },
          "Falha ao sincronizar ADN em background"
        );
      } finally {
        state.running = false;
        state.lastCompletedAt = Date.now();
        syncTracker.set(key, state);
      }
    });
  }

  async function buildUnifiedItems({ cnpj, tipo, inicio, fim, syncMode, syncMax }) {
    const normalizedCnpj = normalizeCnpj(cnpj);
    const company = await prisma.company.findUnique({
      where: { cnpj: normalizedCnpj },
    });
    const companyName = company?.nomeFantasia || company?.razaoSocial || null;

    if (syncMode === "await") {
      try {
        await AdnSyncService.syncUntilEmpty({
          maxIterations: syncMax,
          cnpjConsulta: normalizedCnpj,
        });
      } catch (err) {
        // Sync "await" é best-effort: não deve quebrar a consulta nem poluir logs.
        log.trace(
          { err: serializeErrorSafe(err), cnpj: normalizedCnpj },
          "Falha ao sincronizar ADN antes do unificado"
        );
      }
    } else if (syncMode === "background") {
      scheduleAdnSync({ cnpj: normalizedCnpj, maxIterations: syncMax });
    }

    const items = [];
    const maxFetch = 1000;

    if (tipo !== "recebidas") {
      if (company) {
        const emitidas = await NfseRepository.list({
          companyId: company.id,
          from: inicio,
          to: fim,
          dateField: "competencia",
          limit: maxFetch,
          offset: 0,
        });
        for (const item of emitidas.items || []) {
          items.push({
            source: "sistema",
            sources: ["sistema"],
            chaveAcesso: item.chaveAcesso || null,
            idDps: item.idDps || null,
            numeroNfse: item.numeroNfse || null,
            dataEmissao: item.competencia,
            competencia: item.competencia,
            valorServicos: item.valorServicos,
            cnpjPrestador: normalizedCnpj,
            empresaNome: companyName,
            cnpjTomador: item.tomadorDoc || null,
            tomadorNome: item.tomadorNome || null,
            rpsSerie: item.rpsSerie || null,
            rpsNumero: item.rpsNumero || null,
            situacao: item.status || null,
            _createdAt: item.createdAt || null,
          });
        }
      }

      const adnEmitidas = await AdnRepository.listByPeriodo({
        cnpj: normalizedCnpj,
        tipo: "emitidas",
        inicio,
        fim,
        limit: maxFetch,
        offset: 0,
        includeCancelled: true,
      });
      for (const item of adnEmitidas.items || []) {
        items.push({
          source: "adn",
          sources: ["adn"],
          chaveAcesso: item.chaveAcesso || null,
          numeroNfse: item.numeroNfse || null,
          dataEmissao: item.dataEmissao,
          competencia: item.competencia,
          valorServicos: item.valorServicos,
          cnpjPrestador: item.cnpjPrestador,
          empresaNome: companyName,
          cnpjTomador: item.cnpjTomador,
          tomadorNome: item.tomadorNome || null,
          status: item.status || null,
          situacao: item.situacao || null,
          tipoEvento: item.tipoEvento || null,
        });
      }
    }

    if (tipo !== "emitidas") {
      const adnRecebidas = await AdnRepository.listByPeriodo({
        cnpj: normalizedCnpj,
        tipo: "recebidas",
        inicio,
        fim,
        limit: maxFetch,
        offset: 0,
        includeCancelled: true,
      });
      for (const item of adnRecebidas.items || []) {
        items.push({
          source: "adn",
          sources: ["adn"],
          chaveAcesso: item.chaveAcesso || null,
          numeroNfse: item.numeroNfse || null,
          dataEmissao: item.dataEmissao,
          competencia: item.competencia,
          valorServicos: item.valorServicos,
          cnpjPrestador: item.cnpjPrestador,
          empresaNome: companyName,
          cnpjTomador: item.cnpjTomador,
          tomadorNome: item.tomadorNome || null,
          status: item.status || null,
          situacao: item.situacao || null,
          tipoEvento: item.tipoEvento || null,
        });
      }
    }

    if (!items.length) {
      const adnCancelEvents = await prisma.adnDocument.findMany({
        where: {
          tipoDocumento: "EVENTO",
          cnpjPrestador: normalizedCnpj,
          tipoEvento: { contains: "CANCEL", mode: "insensitive" },
        },
        select: { chaveAcesso: true, numeroNfse: true },
      });
      for (const evt of adnCancelEvents) {
        items.push({
          source: "adn",
          sources: ["adn"],
          chaveAcesso: evt.chaveAcesso || null,
          numeroNfse: evt.numeroNfse || null,
          dataEmissao: null,
          competencia: null,
          valorServicos: null,
          cnpjPrestador: normalizedCnpj,
          empresaNome: companyName,
          cnpjTomador: null,
          tomadorNome: null,
          status: "cancelled",
          situacao: "CANCELAMENTO",
          tipoEvento: "CANCELAMENTO",
        });
      }
    }

    const cancelKeys = new Set();
    const adnOkKeys = new Set();
    for (const item of items) {
      if (!isCancelledItem(item)) continue;
      const key = item.chaveAcesso || item.numeroNfse;
      if (key) cancelKeys.add(key);
    }

    for (const item of items) {
      if (item.source !== "adn") continue;
      if (isCancelledItem(item) || isRejectedItem(item)) continue;
      const key = item.chaveAcesso || item.numeroNfse;
      if (key) adnOkKeys.add(key);
    }

    const recentThresholdMs = 48 * 60 * 60 * 1000;
    const nowMs = Date.now();

    const filteredByCancel = items.filter((item) => {
      if (isCancelledItem(item)) return false;
      const key = item.chaveAcesso || item.numeroNfse;
      if (key && cancelKeys.has(key)) return false;
      if (item.source === "sistema" && key && adnOkKeys.size) {
        if (adnOkKeys.has(key)) return true;
        const createdAt = parseDate(item._createdAt);
        if (!createdAt) return false;
        return nowMs - createdAt.getTime() <= recentThresholdMs;
      }
      return true;
    });

    const deduped = new Map();
    for (const item of filteredByCancel) {
      const key = buildUnifiedKey(item);
      if (!key) continue;
      const existing = deduped.get(key);
      deduped.set(key, existing ? mergeUnified(existing, item) : item);
    }

    const merged = Array.from(deduped.values());
    for (const item of merged) {
      if (item._createdAt !== undefined) delete item._createdAt;
    }

    const filtered = merged.filter((item) => !isCancelledItem(item) && !isRejectedItem(item));
    filtered.sort((a, b) => {
      const da = parseDate(a.dataEmissao)?.getTime?.() || 0;
      const db = parseDate(b.dataEmissao)?.getTime?.() || 0;
      return db - da;
    });

    return filtered;
  }

  router.post("/nfse/sync", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const body = req.body || {};
    const loop = body.loop === true || body.loop === "true";
    const companyId = body.companyId;
    let cnpjConsulta = body.cnpjConsulta;
    const lote = body.lote !== undefined ? Boolean(body.lote) : true;
    const maxIterations = body.maxIterations ? Number(body.maxIterations) : 50;

    try {
      // Preferência: sincronizar por companyId (mais seguro e consistente com o resto do app).
      if (companyId) {
        const access = await ensureLegacyCompanyAccess(req, res, companyId);
        if (!access.ok) return;
        const company = await prisma.company.findUnique({ where: { id: String(companyId) } });
        if (!company) return res.status(404).json({ error: "company_not_found" });
        if (!company.cnpj) return res.status(400).json({ error: "company_cnpj_required" });
        cnpjConsulta = normalizeCnpj(company.cnpj);
      } else if (cnpjConsulta) {
        const access = await ensureLegacyCompanyCnpjAccess(req, res, cnpjConsulta);
        if (!access.ok) return;
      }
      const result = loop
        ? await AdnSyncService.syncUntilEmpty({ lote, maxIterations, cnpjConsulta, companyId })
        : await AdnSyncService.syncOnce({ lote, cnpjConsulta, companyId });
      return res.json({ result });
    } catch (err) {
      if (err.code === "ADN_NOT_CONFIGURED") {
        return res.status(400).json({ error: "adn_not_configured" });
      }
      if (err.code === "ADN_CNPJ_REQUIRED") {
        return res.status(400).json({ error: "adn_cnpj_required", message: "Envie companyId (recomendado) ou cnpjConsulta." });
      }
      if (err.code === "ADN_CERT_REQUIRED") {
        return res.status(400).json({ error: "adn_cert_required" });
      }
      if (err.code === "COMPANY_NOT_FOUND") {
        return res.status(404).json({ error: "company_not_found" });
      }
      if (err.code === "ADN_RATE_LIMITED") {
        const retryAfter = Number(err.retryAfterSeconds || 60);
        if (retryAfter > 0) res.setHeader("Retry-After", String(retryAfter));
        return res.status(429).json({
          error: "adn_rate_limited",
          retryAfterSeconds: retryAfter,
        });
      }
      if (err.code === "ADN_REJEICAO") {
        return res.status(422).json({ error: "adn_rejeicao", details: err.details || [] });
      }
      log.error({ err: serializeErrorSafe(err) }, "Falha ao sincronizar ADN");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  router.post("/nfse/nsu", async (req, res) => {
    if (
      !(await ensureAuthorized(req, res, { allowApiKeyFallback: false, requireRole: "admin" }))
    )
      return;
    const { nsu, cnpj, companyId } = req.body || {};
    if (nsu === undefined || nsu === null || nsu === "") {
      return res.status(400).json({ error: "nsu_required" });
    }
    const nsuValue = Number(nsu);
    if (!Number.isFinite(nsuValue) || nsuValue < 0) {
      return res.status(400).json({ error: "nsu_invalid" });
    }

    try {
      let resolvedCnpj = cnpj ? normalizeCnpj(cnpj) : null;
      if (!resolvedCnpj && companyId) {
        const company = await prisma.company.findUnique({ where: { id: String(companyId) } });
        resolvedCnpj = company?.cnpj ? normalizeCnpj(company.cnpj) : null;
      }
      if (!resolvedCnpj) return res.status(400).json({ error: "cnpj_required" });

      const state = await AdnRepository.updateState(resolvedCnpj, Math.floor(nsuValue));
      return res.json({
        ok: true,
        state: { cnpj: state.cnpj, ultimoNSU: state.ultimoNSU.toString() },
      });
    } catch (err) {
      log.error({ err: serializeErrorSafe(err) }, "Falha ao atualizar NSU");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // Admin-only: apaga todas as notas (sistema + ADN) e zera NSU de todas as empresas.
  // POST /api/nfse/reset-all
  // Body: { "confirm": "RESET_ALL_NFSE", "includeSystem": true, "includeAdn": true }
  router.post("/nfse/reset-all", async (req, res) => {
    if (
      !(await ensureAuthorized(req, res, { allowApiKeyFallback: false, requireRole: "admin" }))
    )
      return;

    const body = req.body || {};
    const confirm = String(body.confirm || "");
    if (confirm !== "RESET_ALL_NFSE") {
      return res.status(400).json({
        error: "confirm_required",
        message: 'Envie { "confirm": "RESET_ALL_NFSE" } para confirmar a limpeza total.',
      });
    }

    const includeSystem = body.includeSystem === undefined ? true : Boolean(body.includeSystem);
    const includeAdn = body.includeAdn === undefined ? true : Boolean(body.includeAdn);

    try {
      const [deletedAdnDocs, deletedAdnStates, deletedSystemNotes] = await prisma.$transaction([
        includeAdn ? prisma.adnDocument.deleteMany({}) : Promise.resolve({ count: 0 }),
        includeAdn ? prisma.adnSyncState.deleteMany({}) : Promise.resolve({ count: 0 }),
        includeSystem ? prisma.serviceInvoice.deleteMany({}) : Promise.resolve({ count: 0 }),
      ]);

      return res.json({
        ok: true,
        deleted: {
          adnDocuments: deletedAdnDocs.count,
          adnSyncStates: deletedAdnStates.count,
          serviceInvoices: deletedSystemNotes.count,
        },
        include: {
          adn: includeAdn,
          system: includeSystem,
        },
      });
    } catch (err) {
      log.error({ err: serializeErrorSafe(err) }, "Falha ao resetar NFSe/ADN");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  router.post("/nfse/sync/force", async (req, res) => {
    if (
      !(await ensureAuthorized(req, res, { allowApiKeyFallback: false, requireRole: "admin" }))
    )
      return;
    const body = req.body || {};
    const cnpjConsulta = body.cnpjConsulta || body.cnpj || null;
    const companyId = body.companyId || null;
    const resetNsu = body.resetNsu === undefined ? true : Boolean(body.resetNsu);
    const maxIterations = body.maxIterations ? Number(body.maxIterations) : 50;

    try {
      let resolvedCnpj = cnpjConsulta ? normalizeCnpj(cnpjConsulta) : null;
      if (!resolvedCnpj && companyId) {
        const company = await prisma.company.findUnique({ where: { id: String(companyId) } });
        resolvedCnpj = company?.cnpj ? normalizeCnpj(company.cnpj) : null;
      }
      if (!resolvedCnpj) return res.status(400).json({ error: "cnpj_required" });

      if (resetNsu) {
        await AdnRepository.updateState(resolvedCnpj, 0);
      }
      const result = await AdnSyncService.syncUntilEmpty({
        maxIterations,
        cnpjConsulta: resolvedCnpj,
        companyId,
      });
      return res.json({ ok: true, resetNsu, result });
    } catch (err) {
      if (err.code === "COMPANY_NOT_FOUND") {
        return res.status(404).json({ error: "company_not_found" });
      }
      if (err.code === "ADN_CERT_REQUIRED") {
        return res.status(400).json({ error: "adn_cert_required" });
      }
      if (err.code === "ADN_NOT_CONFIGURED") {
        return res.status(400).json({ error: "adn_not_configured" });
      }
      if (err.code === "ADN_CNPJ_REQUIRED") {
        return res.status(400).json({ error: "adn_cnpj_required" });
      }
      if (err.code === "ADN_REJEICAO") {
        return res.status(422).json({ error: "adn_rejeicao", details: err.details || [] });
      }
      if (err.code === "ADN_RATE_LIMITED") {
        const retryAfter = Number(err.retryAfterSeconds || 60);
        if (retryAfter > 0) res.setHeader("Retry-After", String(retryAfter));
        return res.status(429).json({
          error: "adn_rate_limited",
          retryAfterSeconds: retryAfter,
        });
      }
      log.error({ err: serializeErrorSafe(err) }, "Falha ao forcar sincronizacao ADN");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  router.get("/nfse", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { cnpj, tipo, inicio, fim, limit, offset, sync, syncMax } = req.query || {};
    if (!cnpj) {
      return res.status(400).json({ error: "cnpj_required" });
    }
    const access = await ensureLegacyCompanyCnpjAccess(req, res, cnpj);
    if (!access.ok) return;
    if (!tipo || !["emitidas", "recebidas"].includes(tipo)) {
      return res.status(400).json({ error: "tipo_required" });
    }

    try {
      const result = await AdnRepository.listByPeriodo({
        cnpj,
        tipo,
        inicio,
        fim,
        limit,
        offset,
      });
      return res.json(result);
    } catch (err) {
      log.error({ err: serializeErrorSafe(err) }, "Falha ao consultar ADN");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // Consulta de notas (ADN) com filtros no banco e paginação por cursor (keyset)
  // GET /api/notas?companyId=...&direcao=todas&competencia=2026-02&status=AUTORIZADA&dateFrom=...&dateTo=...&cursor=...&limit=50
  router.get("/notas", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const {
      companyId,
      cnpj,
      direcao,
      competencia,
      status,
      dateFrom,
      dateTo,
      cursor,
      limit,
    } = req.query || {};

    try {
      let resolvedCnpj = cnpj ? normalizeCnpj(cnpj) : null;
      if (!resolvedCnpj && companyId) {
        const access = await ensureLegacyCompanyAccess(req, res, companyId);
        if (!access.ok) return;
        const company = await prisma.company.findUnique({ where: { id: String(companyId) } });
        resolvedCnpj = company?.cnpj ? normalizeCnpj(company.cnpj) : null;
      }
      if (!resolvedCnpj) return res.status(400).json({ error: "cnpj_required" });
      const accessByCnpj = await ensureLegacyCompanyCnpjAccess(req, res, resolvedCnpj);
      if (!accessByCnpj.ok) return;

      const direction = String(direcao || "todas").toLowerCase();
      if (!["emitidas", "recebidas", "todas"].includes(direction)) {
        return res.status(400).json({ error: "direcao_invalid" });
      }

      const result = await AdnRepository.listNotas({
        cnpj: resolvedCnpj,
        direcao: direction,
        competencia,
        status,
        dateFrom,
        dateTo,
        cursor,
        limit,
      });
      return res.json(result);
    } catch (err) {
      if (err.code === "CNPJ_REQUIRED") return res.status(400).json({ error: "cnpj_required" });
      log.error({ err: serializeErrorSafe(err) }, "Falha ao consultar /api/notas");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  router.get("/nfse/unified", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { cnpj, tipo, inicio, fim, limit, offset, sync, syncMax } = req.query || {};
    if (!cnpj) {
      return res.status(400).json({ error: "cnpj_required" });
    }
    const access = await ensureLegacyCompanyCnpjAccess(req, res, cnpj);
    if (!access.ok) return;
    const tipoLower = String(tipo || "todas").toLowerCase();
    if (!["emitidas", "recebidas", "todas"].includes(tipoLower)) {
      return res.status(400).json({ error: "tipo_invalid" });
    }

    try {
      const syncRaw = String(sync || "").toLowerCase();
      const syncMode =
        syncRaw === "1" || syncRaw === "true"
          ? "await"
          : syncRaw === "0" || syncRaw === "false"
            ? "none"
            : "none"; // default: NÃO sincroniza automaticamente no GET
      const maxIterations = Math.min(Math.max(Number(syncMax) || 2, 1), 10);
      const filtered = await buildUnifiedItems({
        cnpj,
        tipo: tipoLower,
        inicio,
        fim,
        syncMode,
        syncMax: maxIterations,
      });

      const totalValorServicos = filtered.reduce(
        (sum, item) => sum + (Number(item.valorServicos) || 0),
        0
      );

      const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
      const skip = Math.max(Number(offset) || 0, 0);
      const paginated = filtered.slice(skip, skip + take);

      return res.json({
        total: filtered.length,
        limit: take,
        offset: skip,
        summary: { totalValorServicos },
        items: paginated,
      });
    } catch (err) {
      log.error({ err }, "Falha ao consultar notas unificadas");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  router.get("/nfse/unified/summary", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { cnpj, tipo, inicio, fim, tomadorDoc, sync, syncMax } = req.query || {};
    if (!cnpj) {
      return res.status(400).json({ error: "cnpj_required" });
    }
    const access = await ensureLegacyCompanyCnpjAccess(req, res, cnpj);
    if (!access.ok) return;
    const tipoLower = String(tipo || "todas").toLowerCase();
    if (!["emitidas", "recebidas", "todas"].includes(tipoLower)) {
      return res.status(400).json({ error: "tipo_invalid" });
    }

    try {
      const syncRaw = String(sync || "").toLowerCase();
      const syncMode =
        syncRaw === "1" || syncRaw === "true"
          ? "await"
          : syncRaw === "0" || syncRaw === "false"
            ? "none"
            : "none"; // default: NÃO sincroniza automaticamente no GET
      const maxIterations = Math.min(Math.max(Number(syncMax) || 2, 1), 10);
      const filtered = await buildUnifiedItems({
        cnpj,
        tipo: tipoLower,
        inicio,
        fim,
        syncMode,
        syncMax: maxIterations,
      });
      const tomadorFilter = tomadorDoc ? normalizeCnpj(tomadorDoc) : null;
      const items = tomadorFilter
        ? filtered.filter((item) => normalizeCnpj(item.cnpjTomador) === tomadorFilter)
        : filtered;

      const totalValorServicos = items.reduce(
        (sum, item) => sum + (Number(item.valorServicos) || 0),
        0
      );

      const porTomador = new Map();
      for (const item of items) {
        const key = normalizeCnpj(item.cnpjTomador) || "sem_documento";
        const current = porTomador.get(key) || {
          tomadorDoc: item.cnpjTomador || null,
          tomadorNome: item.tomadorNome || null,
          totalNotas: 0,
          totalValorServicos: 0,
        };
        current.totalNotas += 1;
        current.totalValorServicos += Number(item.valorServicos) || 0;
        if (!current.tomadorNome && item.tomadorNome) current.tomadorNome = item.tomadorNome;
        porTomador.set(key, current);
      }

      return res.json({
        totalNotas: items.length,
        totalValorServicos,
        porTomador: Array.from(porTomador.values()),
      });
    } catch (err) {
      log.error({ err }, "Falha ao consultar resumo unificado");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  router.get("/nfse/pdf", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { chave, numeroNfse, idDps } = req.query || {};
    if (!chave && !numeroNfse && !idDps) {
      return res.status(400).json({ error: "chave_or_numero_required" });
    }

    try {
      const systemDoc = await prisma.serviceInvoice.findFirst({
        where: {
          ...(chave ? { chaveAcesso: String(chave) } : {}),
          ...(numeroNfse ? { numeroNfse: String(numeroNfse) } : {}),
          ...(idDps ? { idDps: String(idDps) } : {}),
        },
        select: {
          chaveAcesso: true,
          numeroNfse: true,
          idDps: true,
          tomadorNome: true,
          tomadorDoc: true,
          valorServicos: true,
          xml: true,
        },
      });

      const adnDoc = systemDoc
        ? null
        : await prisma.adnDocument.findFirst({
            where: {
              ...(chave ? { chaveAcesso: String(chave) } : {}),
              ...(numeroNfse ? { numeroNfse: String(numeroNfse) } : {}),
            },
            select: {
              chaveAcesso: true,
              numeroNfse: true,
              cnpjTomador: true,
              valorServicos: true,
              xmlPlain: true,
              xmlBase64Gzip: true,
            },
          });

      const xmlSource =
        systemDoc?.xml || adnDoc?.xmlPlain || adnDoc?.xmlBase64Gzip || null;
      if (systemDoc?.companyId) {
        const access = await ensureLegacyCompanyAccess(req, res, systemDoc.companyId);
        if (!access.ok) return;
      } else if (adnDoc?.cnpjPrestador) {
        const access = await ensureLegacyCompanyCnpjAccess(req, res, adnDoc.cnpjPrestador);
        if (!access.ok) return;
      } else {
        return res.status(404).json({ error: "not_found" });
      }
      const xml = decodeXmlMaybeGzipBase64(xmlSource);
      if (!xml) {
        return res.status(404).json({ error: "xml_not_found" });
      }

      const doc = new PDFDocument({ size: "A4", margin: 40 });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=\"nfse-${chave || numeroNfse || idDps}.pdf\"`
      );

      doc.fontSize(14).text("NFS-e (XML)", { align: "center" });
      doc.moveDown();
      doc.fontSize(10).text(`Chave: ${chave || systemDoc?.chaveAcesso || adnDoc?.chaveAcesso || "-"}`);
      doc.text(`Numero: ${numeroNfse || systemDoc?.numeroNfse || adnDoc?.numeroNfse || "-"}`);
      doc.text(`DPS: ${idDps || systemDoc?.idDps || "-"}`);
      doc.text(`Tomador: ${systemDoc?.tomadorNome || "-"}`);
      doc.text(`Doc Tomador: ${systemDoc?.tomadorDoc || adnDoc?.cnpjTomador || "-"}`);
      doc.text(`Valor Servicos: ${systemDoc?.valorServicos || adnDoc?.valorServicos || "-"}`);
      doc.moveDown();
      doc.font("Courier").fontSize(8).text(xml, { lineBreak: true });
      doc.pipe(res);
      doc.end();
    } catch (err) {
      log.error({ err }, "Falha ao gerar PDF da NFS-e");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}

import { Router } from "express";
import { AdnSyncService } from "../application/nfse/AdnSyncService.js";
import { AdnRepository } from "../infrastructure/db/AdnRepository.js";
import { NfseRepository } from "../infrastructure/db/NfseRepository.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { parseDate } from "../utils/date.js";

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

export function createAdnRouter({ ensureAuthorized, log }) {
  const router = Router();

  router.post("/nfse/sync", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const body = req.body || {};
    const loop = body.loop === true || body.loop === "true";
    const cnpjConsulta = body.cnpjConsulta;
    const lote = body.lote !== undefined ? Boolean(body.lote) : true;
    const maxIterations = body.maxIterations ? Number(body.maxIterations) : 50;

    try {
      const result = loop
        ? await AdnSyncService.syncUntilEmpty({ lote, maxIterations, cnpjConsulta })
        : await AdnSyncService.syncOnce({ lote, cnpjConsulta });
      return res.json({ result });
    } catch (err) {
      if (err.code === "ADN_NOT_CONFIGURED") {
        return res.status(400).json({ error: "adn_not_configured" });
      }
      if (err.code === "ADN_CNPJ_REQUIRED") {
        return res.status(400).json({ error: "adn_cnpj_required" });
      }
      if (err.code === "ADN_REJEICAO") {
        return res.status(422).json({ error: "adn_rejeicao", details: err.details || [] });
      }
      log.error({ err }, "Falha ao sincronizar ADN");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  router.post("/nfse/nsu", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { nsu } = req.body || {};
    if (nsu === undefined || nsu === null || nsu === "") {
      return res.status(400).json({ error: "nsu_required" });
    }
    const nsuValue = Number(nsu);
    if (!Number.isFinite(nsuValue) || nsuValue < 0) {
      return res.status(400).json({ error: "nsu_invalid" });
    }

    try {
      const state = await AdnRepository.updateState(Math.floor(nsuValue));
      return res.json({
        ok: true,
        state: { id: state.id, ultimoNSU: state.ultimoNSU.toString() },
      });
    } catch (err) {
      log.error({ err }, "Falha ao atualizar NSU");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  router.get("/nfse", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { cnpj, tipo, inicio, fim, limit, offset } = req.query || {};
    if (!cnpj) {
      return res.status(400).json({ error: "cnpj_required" });
    }
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
      log.error({ err }, "Falha ao consultar ADN");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  router.get("/nfse/unified", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { cnpj, tipo, inicio, fim, limit, offset } = req.query || {};
    if (!cnpj) {
      return res.status(400).json({ error: "cnpj_required" });
    }
    const tipoLower = String(tipo || "todas").toLowerCase();
    if (!["emitidas", "recebidas", "todas"].includes(tipoLower)) {
      return res.status(400).json({ error: "tipo_invalid" });
    }

    try {
      const normalizedCnpj = normalizeCnpj(cnpj);
      const company = await prisma.company.findUnique({
        where: { cnpj: normalizedCnpj },
      });

      // Sempre sincroniza o ADN antes de unificar, para pegar notas emitidas fora do sistema.
      try {
        await AdnSyncService.syncUntilEmpty({
          maxIterations: 5,
          cnpjConsulta: normalizedCnpj,
        });
      } catch (err) {
        log.warn({ err, cnpj: normalizedCnpj }, "Falha ao sincronizar ADN antes do unificado");
      }

      const items = [];
      const maxFetch = 1000;

      if (tipoLower !== "recebidas") {
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
              cnpjTomador: item.tomadorDoc || null,
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
            cnpjTomador: item.cnpjTomador,
            situacao: item.situacao || null,
            tipoEvento: item.tipoEvento || null,
          });
        }
      }

      if (tipoLower !== "emitidas") {
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
            cnpjTomador: item.cnpjTomador,
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
            cnpjTomador: null,
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

  return router;
}

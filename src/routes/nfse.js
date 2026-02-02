import { Router } from "express";
import { validateNfsePayload } from "../application/validators/nfsePayload.js";
import { NfseService } from "../application/nfse/NfseService.js";
import { NfseRepository } from "../infrastructure/db/NfseRepository.js";

export function createNfseRouter({ ensureAuthorized, log }) {
  const router = Router();

  async function listNfse({ params, limit, offset, shouldSync }) {
    let syncResult = null;
    if (shouldSync) {
      syncResult = await NfseService.syncFromProvider({
        companyId: params.companyId,
        filters: {
          status: params.status,
          numeroNfse: params.numeroNfse,
          chaveAcesso: params.chaveAcesso,
          idDps: params.idDps,
          cnpjPrestador: params.cnpjPrestador,
          cnpjTomador: params.cnpjTomador,
          situacao: params.situacao,
          from: params.from,
          to: params.to,
        },
        log,
      });
    }

    const result = await NfseRepository.list({
      companyId: params.companyId,
      status: params.status,
      numeroNfse: params.numeroNfse,
      chaveAcesso: params.chaveAcesso,
      idDps: params.idDps,
      from: params.from,
      to: params.to,
      dateField: params.dateField,
      limit,
      offset,
    });

    return { ...result, sync: syncResult };
  }

  router.post("/issue", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;

    const validation = validateNfsePayload(req.body);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    try {
      const result = await NfseService.issue({ data: validation.data, log });
      if (result.status === "rejected") {
        return res.status(422).json({
          error: "nfse_rejected",
          message: result.message,
          providerData: result.providerData,
          nfse: result.nfse,
        });
      }
      const statusCode = result.status === "issued" ? 201 : 202;
      return res.status(statusCode).json(result);
    } catch (err) {
      if (err.code === "COMPANY_NOT_FOUND") {
        return res.status(404).json({ error: "company_not_found" });
      }
      if (err.code === "COMPANY_MISSING_FIELDS") {
        return res.status(400).json({
          error: "company_missing_fields",
          missing: err.missing || [],
        });
      }
      log.error({ err }, "Falha ao registrar emissão de NFS-e");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  router.get("/", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const {
      companyId,
      status,
      numeroNfse,
      chaveAcesso,
      idDps,
      cnpjPrestador,
      cnpjTomador,
      situacao,
      from,
      to,
      dateField,
      sync,
    } = req.query || {};
    if (!companyId) {
      return res.status(400).json({ error: "company_id_required" });
    }
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const shouldSync = sync === "1" || sync === "true";

    try {
      const result = await listNfse({
        params: {
          companyId,
          status,
          numeroNfse,
          chaveAcesso,
          idDps,
          cnpjPrestador,
          cnpjTomador,
          situacao,
          from,
          to,
          dateField,
        },
        limit,
        offset,
        shouldSync,
      });
      return res.json(result);
    } catch (err) {
      if (err.code === "COMPANY_NOT_FOUND") {
        return res.status(404).json({ error: "company_not_found" });
      }
      if (err.code === "NFSE_NOT_CONFIGURED") {
        return res.status(400).json({ error: "nfse_not_configured" });
      }
      if (err.code === "NFSE_SYNC_REQUIRES_ID") {
        return res.status(400).json({ error: "nfse_sync_requires_id" });
      }
      log.error({ err }, "Falha ao consultar NFS-e");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  router.post("/consulta", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const body = req.body || {};
    const {
      companyId,
      status,
      numeroNfse,
      chaveAcesso,
      idDps,
      cnpjPrestador,
      cnpjTomador,
      situacao,
      from,
      to,
      dateField,
      limit,
      offset,
      sync,
    } = body;

    if (!companyId) {
      return res.status(400).json({ error: "company_id_required" });
    }

    const shouldSync =
      sync === undefined ? Boolean(from && to) : sync === true || sync === "true" || sync === 1;

    try {
      const result = await listNfse({
        params: {
          companyId,
          status,
          numeroNfse,
          chaveAcesso,
          idDps,
          cnpjPrestador,
          cnpjTomador,
          situacao,
          from,
          to,
          dateField,
        },
        limit,
        offset,
        shouldSync,
      });
      return res.json(result);
    } catch (err) {
      if (err.code === "COMPANY_NOT_FOUND") {
        return res.status(404).json({ error: "company_not_found" });
      }
      if (err.code === "NFSE_NOT_CONFIGURED") {
        return res.status(400).json({ error: "nfse_not_configured" });
      }
      if (err.code === "NFSE_SYNC_REQUIRES_ID") {
        return res.status(400).json({ error: "nfse_sync_requires_id" });
      }
      log.error({ err }, "Falha ao consultar NFS-e");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  router.post("/:chaveAcesso/eventos", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { chaveAcesso } = req.params || {};
    const body = req.body || {};
    const tipoEvento = body.tipoEvento || body.tipo;
    const justificativa = body.justificativa || body.motivo;
    const cMotivo = body.cMotivo || body.codigoMotivo;
    const cnpjAutor = body.cnpjAutor || body.cnpjPrestador;
    const chaveSubstituta = body.chaveSubstituta || body.chaveSubstituida || body.chaveAcessoSubstituta;
    const numeroSubstituta = body.numeroSubstituta || body.numeroNfseSubstituta;

    if (!chaveAcesso) {
      return res.status(400).json({ error: "chave_required" });
    }
    if (!tipoEvento) {
      return res.status(400).json({ error: "tipo_evento_required" });
    }
    if (!["e101101", "e105102"].includes(String(tipoEvento).toLowerCase())) {
      return res.status(400).json({ error: "tipo_evento_invalid" });
    }
    if (!justificativa) {
      return res.status(400).json({ error: "justificativa_required" });
    }

    try {
      const existing = await NfseRepository.findByChaveAcesso(chaveAcesso);
      if (existing) {
        const status = String(existing.status || "").toLowerCase();
        if (status.includes("cancel") || status.includes("reject")) {
          return res.status(422).json({ error: "nfse_not_authorized" });
        }
        if (!status.includes("issued") && !status.includes("autoriz")) {
          return res.status(422).json({ error: "nfse_not_authorized" });
        }
      }

      const result = await NfseService.sendEvent({
        chaveAcesso,
        tipoEvento: String(tipoEvento).toLowerCase(),
        justificativa,
        chaveSubstituta,
        numeroSubstituta,
        cMotivo,
        cnpjAutor,
        log,
      });

      const newStatus =
        String(tipoEvento).toLowerCase() === "e105102"
          ? "cancelled_substitution"
          : "cancelled";
      const updated = await NfseRepository.updateByChaveAcesso(chaveAcesso, {
        status: newStatus,
      });

      return res.json({
        ok: true,
        evento: String(tipoEvento).toLowerCase(),
        status: newStatus,
        nfse: updated,
        providerData: result.providerData,
      });
    } catch (err) {
      if (err.code === "NFSE_NOT_CONFIGURED") {
        return res.status(400).json({ error: "nfse_not_configured" });
      }
      if (err.code === "NFSE_TIPO_EVENTO_REQUIRED") {
        return res.status(400).json({ error: "tipo_evento_required" });
      }
      if (err.code === "NFSE_JUSTIFICATIVA_REQUIRED") {
        return res.status(400).json({ error: "justificativa_required" });
      }
      if (err.code === "NFSE_CNPJ_AUTOR_REQUIRED") {
        return res.status(400).json({ error: "cnpj_autor_required" });
      }
      if (err.code === "NFSE_EVENT_FAILED") {
        return res.status(422).json({ error: "nfse_event_failed", providerData: err.providerData });
      }
      log.error({ err }, "Falha ao registrar evento NFS-e");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}

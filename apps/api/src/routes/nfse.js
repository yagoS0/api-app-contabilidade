import { Router } from "express";
import { validateNfsePayload } from "../application/validators/nfsePayload.js";
import { NfseService } from "../application/nfse/NfseService.js";
import { NfseRepository } from "../infrastructure/db/NfseRepository.js";
import { ensureLegacyCompanyAccess, resolveLegacyCompanyId } from "./middlewares/portalAccess.js";

// ⚠ OS TRÊS CAMINHOS (emissão, consulta e evento) PASSARAM A EXIGIR O A1 DA PRÓPRIA EMPRESA.
// Antes, todos usavam um PFX GLOBAL (`NFSE_CERT_PFX_PATH`) sem conferir de quem ele era. Cada
// código abaixo tem um conserto DIFERENTE — cadastrar o primeiro certificado × trocar o arquivo ×
// redigitar a senha —, e por isso a mensagem do serviço é repassada em vez de virar um texto
// genérico: uma resposta única já mandou o contador cadastrar um certificado que já estava lá.
const CODIGOS_CERT = new Set([
  "NO_COMPANY_CERT",
  "CERT_CNPJ_MISMATCH",
  "CERT_PASSWORD_DECRYPT_FAILED",
  "NFSE_CERT_PFX_ILEGIVEL",
]);

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
    // ⚠ O `companyId` que chega aqui é o **`PortalClient.id`** — é o id que a aba Notas Fiscais
    // tem em mãos e o que o `EmitirNfseWizard` carrega no payload. Tudo daqui pra baixo (a
    // checagem de acesso e o `NfseService.issue`) fala em **Company legada**. Sem esta tradução a
    // rota respondia 403 para o usuário comum e 404 para o admin — nunca emitiu, nunca poderia.
    // Ver `resolveLegacyCompanyId` para o porquê de resolver ANTES de autorizar.
    const legacyCompanyId = await resolveLegacyCompanyId(validation.data?.companyId);
    if (!legacyCompanyId) {
      return res.status(404).json({ error: "company_not_found" });
    }
    const access = await ensureLegacyCompanyAccess(req, res, legacyCompanyId);
    if (!access.ok) return;

    try {
      const result = await NfseService.issue({
        data: { ...validation.data, companyId: legacyCompanyId },
        log,
        retryInvoiceId: req.body?.retryInvoiceId || null,
      });

      // ⚠ RECUSA DA RECEITA E ERRO NOSSO DEIXARAM DE TER A MESMA RESPOSTA. Antes tudo era
      // `422 nfse_rejected`: timeout, DNS, 500 do provedor, validação nossa e recusa fiscal. O
      // cliente não tinha como saber se corrigia a nota, tentava de novo, ou consultava antes.
      if (result.status === "rejected") {
        // Camada RECEITA: o sistema nacional analisou e recusou. Fato fiscal — corrigir a nota.
        return res.status(422).json({
          error: "nfse_rejected",
          camada: result.camada,
          codigo: result.codigo,
          message: result.message,
          correcao: result.correcao,
          numeroReutilizavel: result.numeroReutilizavel,
          providerData: result.providerData,
          nfse: result.nfse,
        });
      }
      if (result.status === "falha_envio") {
        // Camada NOSSA → 400 (o pedido é corrigível pelo chamador; nada saiu da máquina).
        // Camada TRANSPORTE → 502 (o problema é a comunicação com o sistema nacional, e o
        // desfecho é DESCONHECIDO — ver `correcao`, que manda consultar antes de reemitir).
        const statusHttp = result.camada === "TRANSPORTE" ? 502 : 400;
        return res.status(statusHttp).json({
          error: result.camada === "TRANSPORTE" ? "nfse_falha_transporte" : "nfse_falha_local",
          camada: result.camada,
          codigo: result.codigo,
          message: result.message,
          correcao: result.correcao,
          numeroReutilizavel: result.numeroReutilizavel,
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
      if (err.code === "NFSE_NOT_CONFIGURED") {
        return res.status(400).json({ error: "nfse_not_configured", message: err.message });
      }
      // ⚠ Reemitir com um número cujo desfecho é DESCONHECIDO não é um erro de validação: é a
      // recusa que impede tanto a duplicidade (E0014) quanto o buraco permanente de numeração.
      if (err.code === "NFSE_NUMERO_EM_ESTADO_INDETERMINADO") {
        return res.status(409).json({
          error: "nfse_numero_em_estado_indeterminado",
          message: err.message,
        });
      }
      if (err.code === "NFSE_RETRY_INVOICE_NOT_FOUND") {
        return res.status(404).json({ error: "nfse_retry_invoice_not_found" });
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
    const access = await ensureLegacyCompanyAccess(req, res, companyId);
    if (!access.ok) return;
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
      // A consulta ao sistema nacional passou a exigir o A1 da PRÓPRIA empresa (mesma regra do
      // ADN: consultar com o certificado do escritorio traz as notas DELE).
      if (CODIGOS_CERT.has(err.code)) {
        return res.status(422).json({ error: "nfse_sem_certificado", codigo: err.code, message: err.message });
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
    const access = await ensureLegacyCompanyAccess(req, res, companyId);
    if (!access.ok) return;

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
      // A consulta ao sistema nacional passou a exigir o A1 da PRÓPRIA empresa (mesma regra do
      // ADN: consultar com o certificado do escritorio traz as notas DELE).
      if (CODIGOS_CERT.has(err.code)) {
        return res.status(422).json({ error: "nfse_sem_certificado", codigo: err.code, message: err.message });
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
      if (!existing?.companyId) {
        return res.status(404).json({ error: "nfse_not_found" });
      }
      const access = await ensureLegacyCompanyAccess(req, res, existing.companyId);
      if (!access.ok) return;
      const status = String(existing.status || "").toLowerCase();
      if (status.includes("cancel") || status.includes("reject")) {
        return res.status(422).json({ error: "nfse_not_authorized" });
      }
      if (!status.includes("issued") && !status.includes("autoriz")) {
        return res.status(422).json({ error: "nfse_not_authorized" });
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
      // e105102: `chSubstituta` e `cMotivo` são 1-1 no ANEXO_II v1.01 (ver `buildEventoXml`).
      if (err.code === "NFSE_CHAVE_SUBSTITUTA_REQUIRED") {
        return res.status(400).json({ error: "chave_substituta_required" });
      }
      if (err.code === "NFSE_CMOTIVO_REQUIRED") {
        return res.status(400).json({ error: "c_motivo_required" });
      }
      if (err.code === "NFSE_EVENT_FAILED") {
        return res.status(422).json({ error: "nfse_event_failed", providerData: err.providerData });
      }
      // O evento também é assinado pelo certificado do autor (E0718) — sem o A1 da empresa não há
      // pedido de registro válido a montar.
      if (CODIGOS_CERT.has(err.code)) {
        return res.status(422).json({ error: "nfse_sem_certificado", codigo: err.code, message: err.message });
      }
      if (err.code === "NFSE_NOT_FOUND") {
        return res.status(404).json({ error: "nfse_not_found" });
      }
      log.error({ err }, "Falha ao registrar evento NFS-e");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}

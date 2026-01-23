import { Router } from "express";
import { parseNfeXml } from "../utils/nfeParser.js";
import { InvoiceRepository } from "../infrastructure/db/InvoiceRepository.js";

export function createInvoicesRouter({ ensureAuthorized, log }) {
  const router = Router();

  router.post("/import", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { companyId, clientId, xml, fileKey, fileUrl, fileType } = req.body || {};
    if (!companyId) {
      return res.status(400).json({ error: "company_id_required" });
    }
    if (!xml || !xml.toString().trim()) {
      return res.status(400).json({ error: "xml_required" });
    }
    try {
      const parsed = parseNfeXml(xml);
      const invoice = await InvoiceRepository.createFromParsed({
        companyId,
        clientId,
        header: parsed.header,
        items: parsed.items,
        fileKey,
        fileUrl,
        fileType: fileType || "xml",
      });
      return res.status(201).json({ invoice });
    } catch (err) {
      if (err.code === "INVOICE_EXISTS") {
        return res.status(409).json({ error: "invoice_exists" });
      }
      if (err.message === "xml_required" || err.message === "chave_not_found") {
        return res.status(400).json({ error: err.message });
      }
      log.error({ err }, "Falha ao importar NF-e");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  router.get("/", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { companyId, clientId, from, to, emitente, chave } = req.query || {};
    if (!companyId) {
      return res.status(400).json({ error: "company_id_required" });
    }
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    try {
      const result = await InvoiceRepository.listInvoices({
        companyId,
        clientId,
        from,
        to,
        emitente,
        chave,
        limit,
        offset,
      });
      return res.json(result);
    } catch (err) {
      log.error({ err }, "Falha ao listar notas");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  router.get("/:id", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    try {
      const invoice = await InvoiceRepository.getById(req.params.id);
      if (!invoice) {
        return res.status(404).json({ error: "not_found" });
      }
      return res.json({ invoice });
    } catch (err) {
      log.error({ err }, "Falha ao buscar nota");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}


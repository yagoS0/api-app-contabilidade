import { Router } from "express";
import { validateNfsePayload } from "../application/validators/nfsePayload.js";
import { NfseService } from "../application/nfse/NfseService.js";

export function createNfseRouter({ ensureAuthorized, log }) {
  const router = Router();

  router.post("/issue", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;

    const validation = validateNfsePayload(req.body);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    try {
      const result = await NfseService.issue({ data: validation.data, log });
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

  return router;
}

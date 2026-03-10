import { Router } from "express";
import { AuthService } from "../application/auth/AuthService.js";
import multer from "multer";
import forge from "node-forge";
import { prisma } from "../infrastructure/db/prisma.js";
import { deleteCompanyPfx, saveCompanyPfx } from "../infrastructure/storage/CertStorage.js";
import { encryptSecret } from "../utils/crypto.js";

export function createClientsRouter({
  ensureAuthorized,
  validateClientPayload,
  ClientRepository,
  log,
}) {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB
    },
  });

  function parsePfxExpiry(pfxBuffer, password) {
    try {
      const p12Asn1 = forge.asn1.fromDer(pfxBuffer.toString("binary"));
      const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);
      const certBag = p12.getBags({ bagType: forge.pki.oids.certBag })?.[forge.pki.oids.certBag]?.[0];
      const cert = certBag?.cert;
      if (!cert || !cert.validity?.notAfter) return null;
      return cert.validity.notAfter;
    } catch {
      return null;
    }
  }

  async function ensureClientCompanyAccess({ clientId, companyId, authUser }) {
    if (!clientId || !companyId || !authUser) return null;
    if (authUser.role === "admin") {
      // Admin pode operar em qualquer empresa; não dependemos do clientId da URL.
      return prisma.company.findUnique({
        where: { id: String(companyId) },
      });
    }
    if (authUser.role === "client") {
      if (String(clientId) !== String(authUser.id)) return null;
      return prisma.company.findFirst({
        where: { id: String(companyId), clientId: String(clientId) },
      });
    }
    return null;
  }

  router.post("/", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const validation = validateClientPayload(req.body);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }
    try {
      const created = await ClientRepository.createClientWithCompany(validation.data);
      res.status(201).json(created);
    } catch (err) {
      if (err.code === "COMPANY_VALIDATION_ERROR") {
        return res.status(400).json({ error: err.message || "company_validation_error" });
      }
      if (err.code === "P2002") {
        return res.status(409).json({ error: "client_login_or_email_exists" });
      }
      log.error({ err }, "Falha ao cadastrar cliente");
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.post("/login", async (req, res) => {
    const { login, email, password } = req.body || {};
    const identifier = login || email;
    if (!identifier || !password) {
      return res.status(400).json({ error: "login_password_required" });
    }
    try {
      const result = await AuthService.authenticateClient(identifier, password);
      if (!result.ok) {
        return res.status(401).json({ error: "invalid_credentials" });
      }
      const token = AuthService.generateClientToken(result.client);
      return res.json({
        token,
        client: {
          id: result.client.id,
          login: result.client.login,
          email: result.client.email,
          name: result.client.name,
        },
        expiresInMs: AuthService.getExpiresInMs(),
      });
    } catch (err) {
      log.error({ err }, "Falha no login do cliente");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  router.get("/", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    try {
      const result = await ClientRepository.listClients({ limit, offset });
      res.json(result);
    } catch (err) {
      log.error({ err }, "Falha ao listar clientes");
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.get("/:id", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    try {
      const client = await ClientRepository.getClientById(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "not_found" });
      }
      res.json(client);
    } catch (err) {
      log.error({ err, id: req.params.id }, "Falha ao buscar cliente");
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.delete("/:id", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    try {
      await ClientRepository.deleteClient(req.params.id);
      return res.status(200).json({ status: "deleted" });
    } catch (err) {
      if (err.code === "P2025") {
        return res.status(404).json({ error: "not_found" });
      }
      log.error({ err, id: req.params.id }, "Falha ao excluir cliente");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // Upload de certificado A1 (PFX) por empresa
  // POST /clients/:clientId/companies/:companyId/certificate  (multipart/form-data)
  // Fields: pfx (file) e password (text)
  router.post(
    "/:clientId/companies/:companyId/certificate",
    upload.fields([
      { name: "pfx", maxCount: 1 },
      { name: "file", maxCount: 1 },
    ]),
    async (req, res) => {
      if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
      const { clientId, companyId } = req.params || {};
      const password = (req.body?.password || req.body?.pfxPassword || "").toString();
      const file =
        (req.files?.pfx && req.files.pfx[0]) ||
        (req.files?.file && req.files.file[0]) ||
        null;

      if (!file?.buffer) return res.status(400).json({ error: "pfx_required" });
      if (!password) return res.status(400).json({ error: "password_required" });

      try {
        const company = await ensureClientCompanyAccess({
          clientId,
          companyId,
          authUser: req.auth?.user,
        });
        if (!company) return res.status(403).json({ error: "forbidden" });

        const previousStorageKey = company.certStorageKey || null;
        const storageKey = saveCompanyPfx({
          companyId: company.id,
          originalName: file.originalname,
          buffer: file.buffer,
        });
        const expiresAt = parsePfxExpiry(file.buffer, password);
        const now = new Date();
        await prisma.company.update({
          where: { id: company.id },
          data: {
            certStorageKey: storageKey,
            certPasswordEnc: encryptSecret(password),
            certUploadedAt: now,
            certExpiresAt: expiresAt || undefined,
          },
        });

        // Best-effort: remove certificado anterior (evita acumular arquivos)
        if (previousStorageKey && previousStorageKey !== storageKey) {
          try {
            deleteCompanyPfx(previousStorageKey);
          } catch {
            // ignora
          }
        }

        return res.json({
          ok: true,
          companyId: company.id,
          certificate: {
            storageKey,
            uploadedAt: now.toISOString(),
            expiresAt: expiresAt ? expiresAt.toISOString() : null,
          },
        });
      } catch (err) {
        if (err.code === "CERT_STORAGE_NOT_CONFIGURED") {
          return res.status(400).json({ error: "cert_storage_not_configured" });
        }
        if (err.code === "CERT_SECRET_KEY_NOT_CONFIGURED") {
          return res.status(400).json({ error: "cert_secret_key_not_configured" });
        }
        log.error({ err: err.message }, "Falha ao subir certificado");
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.get("/:clientId/companies/:companyId/certificate", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { clientId, companyId } = req.params || {};
    try {
      const company = await ensureClientCompanyAccess({
        clientId,
        companyId,
        authUser: req.auth?.user,
      });
      if (!company) return res.status(403).json({ error: "forbidden" });
      return res.json({
        companyId: company.id,
        certificate: {
          hasCertificate: Boolean(company.certStorageKey),
          uploadedAt: company.certUploadedAt ? company.certUploadedAt.toISOString() : null,
          expiresAt: company.certExpiresAt ? company.certExpiresAt.toISOString() : null,
        },
      });
    } catch (err) {
      log.error({ err: err.message }, "Falha ao consultar certificado");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  router.delete("/:clientId/companies/:companyId/certificate", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { clientId, companyId } = req.params || {};
    try {
      const company = await ensureClientCompanyAccess({
        clientId,
        companyId,
        authUser: req.auth?.user,
      });
      if (!company) return res.status(403).json({ error: "forbidden" });

      const previousStorageKey = company.certStorageKey || null;

      await prisma.company.update({
        where: { id: company.id },
        data: {
          certStorageKey: null,
          certPasswordEnc: null,
          certExpiresAt: null,
          certUploadedAt: null,
        },
      });

      let deletedFile = false;
      if (previousStorageKey) {
        try {
          deletedFile = deleteCompanyPfx(previousStorageKey);
        } catch (err) {
          // Se não conseguir apagar do disco, ainda assim removemos do banco.
          log.warn({ err: err.message }, "Falha ao remover arquivo do certificado");
        }
      }

      return res.json({
        ok: true,
        companyId: company.id,
        deletedFile,
      });
    } catch (err) {
      if (err.code === "CERT_STORAGE_NOT_CONFIGURED") {
        // Mesmo sem storage configurado, conseguimos limpar do banco.
        return res.status(400).json({ error: "cert_storage_not_configured" });
      }
      log.error({ err: err.message }, "Falha ao remover certificado");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}


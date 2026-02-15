import { Router } from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import forge from "node-forge";
import { prisma } from "../../infrastructure/db/prisma.js";
import { requireAuth } from "../../middlewares/requireAuth.js";
import { requireAccountType } from "../../middlewares/requireAccountType.js";
import { requireFirmCompanyAccess } from "../../middlewares/requireFirmCompanyAccess.js";
import { deleteCompanyPfx, saveCompanyPfx } from "../../infrastructure/storage/CertStorage.js";
import { encryptSecret } from "../../utils/crypto.js";
import {
  enderecoToSingleLine,
  validateAndNormalizeCompanyProfile,
} from "../../application/company/companyProfile.js";
import { createPortalInvoicesRouter } from "../portalInvoices.js";
import { createPortalSyncRouter } from "../portalSync.js";

function sanitizeFirmRole(role) {
  const value = String(role || "STAFF").toUpperCase();
  if (!["FIRM_ADMIN", "ACCOUNTANT", "STAFF"].includes(value)) return "STAFF";
  return value;
}

export function createFirmPortalRouter({ ensureAuthorized, log }) {
  const router = Router();
  router.use(requireAuth(), requireAccountType("FIRM"));
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  const invoicesRouter = createPortalInvoicesRouter({ ensureAuthorized, log });
  const syncRouter = createPortalSyncRouter({ ensureAuthorized, log });

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

  async function getLegacyCompanyByPortalId(portalCompanyId) {
    const portal = await prisma.portalClient.findUnique({
      where: { id: String(portalCompanyId) },
      select: { companyId: true },
    });
    if (!portal?.companyId) return null;
    return prisma.company.findUnique({ where: { id: portal.companyId } });
  }

  router.get("/companies", async (req, res) => {
    const userId = String(req.auth.user.id);
    const appRole = String(req.auth.user.role || "").toLowerCase();
    const isAdminLike = appRole === "admin" || appRole === "contador";

    if (isAdminLike) {
      const items = await prisma.portalClient.findMany({
        orderBy: { razao: "asc" },
        select: {
          id: true,
          razao: true,
          cnpj: true,
        },
      });
      return res.json({
        data: items.map((item) => ({
          companyId: item.id,
          portalId: item.id,
          myRole: "FIRM_ADMIN",
          scopes: ["*"],
          razao: item.razao,
          cnpj: item.cnpj,
        })),
      });
    }

    const links = await prisma.companyFirmAccess.findMany({
      where: { userId, status: "ACTIVE" },
      include: {
        company: {
          select: {
            id: true,
            razao: true,
            cnpj: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return res.json({
      data: links.map((link) => ({
        companyId: link.company.id,
        portalId: link.company.id,
        myRole: link.role,
        scopes: link.scopes || [],
        razao: link.company.razao,
        cnpj: link.company.cnpj,
      })),
    });
  });

  router.post("/companies", async (req, res) => {
    const body = req.body || {};
    const ownerEmail = String(body.ownerEmail || "")
      .trim()
      .toLowerCase();
    const ownerName = body.ownerName ? String(body.ownerName).trim() : null;
    const ownerPassword = String(body.ownerPassword || "").trim();
    const companyInput = body.company && typeof body.company === "object" ? body.company : body;
    const parsedCompany = validateAndNormalizeCompanyProfile(companyInput);
    if (!parsedCompany.ok) return res.status(400).json({ error: parsedCompany.error });
    const normalizedCompany = parsedCompany.data;
    const cnpj = normalizedCompany.cnpj;
    const razao = normalizedCompany.razaoSocial;

    if (!ownerEmail) return res.status(400).json({ error: "owner_email_required" });

    try {
      const result = await prisma.$transaction(async (tx) => {
        let ownerUser = await tx.user.findUnique({ where: { email: ownerEmail } });
        if (!ownerUser) {
          if (!ownerPassword || ownerPassword.length < 8) {
            const err = new Error("owner_password_required_min_8");
            err.code = "OWNER_PASSWORD_REQUIRED";
            throw err;
          }
          ownerUser = await tx.user.create({
            data: {
              email: ownerEmail,
              name: ownerName,
              passwordHash: await bcrypt.hash(ownerPassword, 10),
              role: "user",
              status: "active",
              accountType: "CLIENT",
            },
          });
        }

        let legacyClient = await tx.client.findUnique({ where: { email: ownerEmail } });
        if (!legacyClient) {
          const login = ownerEmail;
          legacyClient = await tx.client.create({
            data: {
              name: ownerName || ownerEmail,
              email: ownerEmail,
              login,
              passwordHash: ownerPassword
                ? await bcrypt.hash(ownerPassword, 10)
                : await bcrypt.hash(`tmp-${Date.now()}`, 10),
            },
          });
        }

        const legacyCompany = await tx.company.create({
          data: {
            clientId: legacyClient.id,
            cnpj,
            razaoSocial: razao,
            nomeFantasia: normalizedCompany.nomeFantasia,
            email: normalizedCompany.email,
            telefone: normalizedCompany.telefone,
            endereco: enderecoToSingleLine(normalizedCompany.endereco),
            enderecoJson: normalizedCompany.endereco,
            atividades: [
              normalizedCompany.cnaePrincipal,
              ...normalizedCompany.cnaesSecundarios,
            ],
            tipoTributario: normalizedCompany.regimeTributario,
            regimeTributario: normalizedCompany.regimeTributario,
            anexoSimples: normalizedCompany.simples?.anexo || null,
            simplesAnexo: normalizedCompany.simples?.anexo || null,
            simplesDataOpcao: normalizedCompany.simples?.dataOpcao || null,
            cnaePrincipal: normalizedCompany.cnaePrincipal,
            cnaesSecundarios: normalizedCompany.cnaesSecundarios,
          },
        });

        const portal = await tx.portalClient.create({
          data: {
            companyId: legacyCompany.id,
            razao,
            cnpj,
          },
        });

        await tx.companyClientUser.upsert({
          where: {
            companyId_userId: {
              companyId: portal.id,
              userId: ownerUser.id,
            },
          },
          create: {
            companyId: portal.id,
            userId: ownerUser.id,
            role: "OWNER",
            status: "ACTIVE",
          },
          update: {
            role: "OWNER",
            status: "ACTIVE",
          },
        });

        await tx.companyFirmAccess.upsert({
          where: {
            companyId_userId: {
              companyId: portal.id,
              userId: String(req.auth.user.id),
            },
          },
          create: {
            companyId: portal.id,
            userId: String(req.auth.user.id),
            role: "FIRM_ADMIN",
            status: "ACTIVE",
            scopes: [],
          },
          update: {
            role: "FIRM_ADMIN",
            status: "ACTIVE",
          },
        });

        return { portalId: portal.id, companyId: portal.id, ownerUserId: ownerUser.id };
      });

      return res.status(201).json({ ok: true, ...result });
    } catch (err) {
      if (err?.code === "OWNER_PASSWORD_REQUIRED") {
        return res.status(400).json({ error: "owner_password_required_min_8" });
      }
      log.error({ err }, "Falha ao criar empresa no portal firm");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  router.post(
    "/companies/:companyId/access",
    requireFirmCompanyAccess({ minRole: "FIRM_ADMIN" }),
    async (req, res) => {
      const body = req.body || {};
      const userId = String(body.userId || "").trim();
      if (!userId) return res.status(400).json({ error: "user_id_required" });
      const role = sanitizeFirmRole(body.role);
      const scopes = Array.isArray(body.scopes) ? body.scopes.map((x) => String(x).toUpperCase()) : [];
      const link = await prisma.companyFirmAccess.upsert({
        where: {
          companyId_userId: {
            companyId: String(req.params.companyId),
            userId,
          },
        },
        create: {
          companyId: String(req.params.companyId),
          userId,
          role,
          status: "ACTIVE",
          scopes,
        },
        update: {
          role,
          status: "ACTIVE",
          scopes,
        },
      });
      return res.status(201).json({ ok: true, access: link });
    }
  );

  router.delete(
    "/companies/:companyId/access/:userId",
    requireFirmCompanyAccess({ minRole: "FIRM_ADMIN" }),
    async (req, res) => {
      await prisma.companyFirmAccess.update({
        where: {
          companyId_userId: {
            companyId: String(req.params.companyId),
            userId: String(req.params.userId),
          },
        },
        data: { status: "REMOVED" },
      });
      return res.json({ ok: true });
    }
  );

  router.post(
    "/companies/:companyId/certificate",
    requireFirmCompanyAccess({ minRole: "FIRM_ADMIN" }),
    upload.fields([
      { name: "pfx", maxCount: 1 },
      { name: "file", maxCount: 1 },
    ]),
    async (req, res) => {
      const portalCompanyId = String(req.params.companyId);
      const password = (req.body?.password || req.body?.pfxPassword || "").toString();
      const file =
        (req.files?.pfx && req.files.pfx[0]) ||
        (req.files?.file && req.files.file[0]) ||
        null;
      if (!file?.buffer) return res.status(400).json({ error: "pfx_required" });
      if (!password) return res.status(400).json({ error: "password_required" });

      try {
        const company = await getLegacyCompanyByPortalId(portalCompanyId);
        if (!company) return res.status(404).json({ error: "legacy_company_not_linked" });
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
        if (previousStorageKey && previousStorageKey !== storageKey) {
          try {
            deleteCompanyPfx(previousStorageKey);
          } catch {
            // best effort
          }
        }
        return res.json({
          ok: true,
          companyId: portalCompanyId,
          certificate: {
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
        log.error({ err: err.message }, "Falha ao subir certificado no portal firm");
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.get(
    "/companies/:companyId/certificate",
    requireFirmCompanyAccess(),
    async (req, res) => {
      const company = await getLegacyCompanyByPortalId(req.params.companyId);
      if (!company) return res.status(404).json({ error: "legacy_company_not_linked" });
      return res.json({
        companyId: String(req.params.companyId),
        certificate: {
          hasCertificate: Boolean(company.certStorageKey),
          uploadedAt: company.certUploadedAt ? company.certUploadedAt.toISOString() : null,
          expiresAt: company.certExpiresAt ? company.certExpiresAt.toISOString() : null,
        },
      });
    }
  );

  router.delete(
    "/companies/:companyId/certificate",
    requireFirmCompanyAccess({ minRole: "FIRM_ADMIN" }),
    async (req, res) => {
      try {
        const company = await getLegacyCompanyByPortalId(req.params.companyId);
        if (!company) return res.status(404).json({ error: "legacy_company_not_linked" });
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
          } catch {
            // best effort
          }
        }
        return res.json({ ok: true, deletedFile });
      } catch (err) {
        if (err.code === "CERT_STORAGE_NOT_CONFIGURED") {
          return res.status(400).json({ error: "cert_storage_not_configured" });
        }
        log.error({ err: err.message }, "Falha ao remover certificado no portal firm");
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.use("/companies/:clientId/invoices/sync", syncRouter);
  router.use("/companies/:clientId/invoices", invoicesRouter);

  return router;
}


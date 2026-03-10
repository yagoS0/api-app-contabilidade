import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import multer from "multer";
import forge from "node-forge";
import { prisma } from "../../infrastructure/db/prisma.js";
import { requireAuth } from "../../middlewares/requireAuth.js";
import { requireAccountType } from "../../middlewares/requireAccountType.js";
import { requireClientCompanyAccess } from "../../middlewares/requireClientCompanyAccess.js";
import { deleteCompanyPfx, saveCompanyPfx } from "../../infrastructure/storage/CertStorage.js";
import { encryptSecret } from "../../utils/crypto.js";
import { createPortalInvoicesRouter } from "../portalInvoices.js";
import { createPortalSyncRouter } from "../portalSync.js";
import {
  listGuidesByCompany,
  toGuideResponse,
} from "../../application/guides/GuideService.js";
import { GuideStorageService } from "../../application/guides/GuideStorageService.js";

function sanitizeRole(role) {
  const value = String(role || "CLIENT_USER").toUpperCase();
  if (!["OWNER", "CLIENT_ADMIN", "CLIENT_USER"].includes(value)) return "CLIENT_USER";
  return value;
}

export function createClientPortalRouter({ ensureAuthorized, log }) {
  const router = Router();
  router.use(requireAuth(), requireAccountType("CLIENT"));
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  const invoicesRouter = createPortalInvoicesRouter({ ensureAuthorized, log });
  const syncRouter = createPortalSyncRouter({ ensureAuthorized, log });
  const guideStorage = GuideStorageService.create();

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
    const legacyCompanySelect = {
      id: true,
      razaoSocial: true,
      nomeFantasia: true,
      regimeTributario: true,
      simplesAnexo: true,
      simplesDataOpcao: true,
      cnaePrincipal: true,
      cnaesSecundarios: true,
      enderecoJson: true,
      atividades: true,
      porte: true,
      tipoTributario: true,
      anexoSimples: true,
      endereco: true,
      email: true,
      telefone: true,
      capitalSocial: true,
      dataAbertura: true,
      quantidadeSocios: true,
      inscricaoMunicipal: true,
      codigoServicoNacional: true,
      codigoServicoMunicipal: true,
      rpsSerie: true,
      rpsNumero: true,
      optanteSimples: true,
      regimeEspecialTributacao: true,
      certStorageKey: true,
      certUploadedAt: true,
      certExpiresAt: true,
      createdAt: true,
      updatedAt: true,
    };
    const getEnderecoField = (legacy, field) =>
      legacy?.enderecoJson && typeof legacy.enderecoJson === "object"
        ? legacy.enderecoJson[field] || null
        : null;
    const links = await prisma.companyClientUser.findMany({
      where: { userId, status: "ACTIVE" },
      include: {
        company: {
          select: {
            id: true,
            razao: true,
            cnpj: true,
            inscricaoMunicipal: true,
            uf: true,
            municipio: true,
            createdAt: true,
            updatedAt: true,
            companyId: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    const companyIds = links.map((link) => link.company.companyId).filter(Boolean);
    const legacyCompanies = companyIds.length
      ? await prisma.company.findMany({
          where: { id: { in: companyIds } },
          select: legacyCompanySelect,
        })
      : [];
    const legacyByCompanyId = new Map(legacyCompanies.map((company) => [company.id, company]));
    const ownerLinks = links.length
      ? await prisma.companyClientUser.findMany({
          where: {
            companyId: { in: links.map((link) => link.company.id) },
            role: "OWNER",
            status: "ACTIVE",
          },
          include: { user: { select: { email: true } } },
          orderBy: { createdAt: "asc" },
        })
      : [];
    const ownerEmailByPortalId = new Map();
    for (const link of ownerLinks) {
      if (!ownerEmailByPortalId.has(link.companyId)) {
        ownerEmailByPortalId.set(link.companyId, link.user?.email || null);
      }
    }
    return res.json({
      data: links.map((link) => {
        const legacy = link.company.companyId ? legacyByCompanyId.get(link.company.companyId) || null : null;
        const ownerEmail = ownerEmailByPortalId.get(link.company.id) || null;
        const resolvedEmail = legacy?.email || ownerEmail || null;
        return {
          companyId: link.company.id,
          portalId: link.company.id,
          myRole: link.role,
          razao: link.company.razao,
          cnpj: link.company.cnpj,
          inscricaoMunicipal: link.company.inscricaoMunicipal || legacy?.inscricaoMunicipal || null,
          uf: link.company.uf || getEnderecoField(legacy, "uf"),
          municipio: link.company.municipio || getEnderecoField(legacy, "cidade"),
          email: resolvedEmail,
          telefone: legacy?.telefone || null,
          portalCreatedAt: link.company.createdAt,
          portalUpdatedAt: link.company.updatedAt,
          legacyCompany: legacy ? { ...legacy, email: resolvedEmail } : null,
        };
      }),
    });
  });

  router.get(
    "/companies/:companyId/partners",
    requireClientCompanyAccess(),
    async (req, res) => {
      const portal = await prisma.portalClient.findUnique({
        where: { id: String(req.params.companyId) },
        select: { companyId: true },
      });
      if (!portal?.companyId) return res.json({ data: [] });
      const items = await prisma.partner.findMany({
        where: { companyId: portal.companyId },
        orderBy: { createdAt: "desc" },
      });
      return res.json({ data: items });
    }
  );

  router.post(
    "/companies/:companyId/partners",
    requireClientCompanyAccess("CLIENT_ADMIN"),
    async (req, res) => {
      const portal = await prisma.portalClient.findUnique({
        where: { id: String(req.params.companyId) },
        select: { companyId: true },
      });
      if (!portal?.companyId) return res.status(400).json({ error: "legacy_company_not_linked" });
      const body = req.body || {};
      if (!body.name) return res.status(400).json({ error: "name_required" });
      const created = await prisma.partner.create({
        data: {
          companyId: portal.companyId,
          name: String(body.name),
          phone: body.phone ? String(body.phone) : null,
          email: body.email ? String(body.email).toLowerCase() : null,
          documento: body.documento ? String(body.documento) : null,
          representante: body.representante === true,
          participacao: body.participacao ?? null,
        },
      });
      return res.status(201).json(created);
    }
  );

  router.patch(
    "/companies/:companyId/partners/:partnerId",
    requireClientCompanyAccess("CLIENT_ADMIN"),
    async (req, res) => {
      const portal = await prisma.portalClient.findUnique({
        where: { id: String(req.params.companyId) },
        select: { companyId: true },
      });
      if (!portal?.companyId) return res.status(400).json({ error: "legacy_company_not_linked" });
      const existing = await prisma.partner.findFirst({
        where: { id: String(req.params.partnerId), companyId: portal.companyId },
      });
      if (!existing) return res.status(404).json({ error: "not_found" });
      const body = req.body || {};
      const updated = await prisma.partner.update({
        where: { id: existing.id },
        data: {
          ...(body.name !== undefined ? { name: String(body.name) } : {}),
          ...(body.phone !== undefined ? { phone: body.phone ? String(body.phone) : null } : {}),
          ...(body.email !== undefined
            ? { email: body.email ? String(body.email).toLowerCase() : null }
            : {}),
          ...(body.documento !== undefined
            ? { documento: body.documento ? String(body.documento) : null }
            : {}),
          ...(body.participacao !== undefined ? { participacao: body.participacao } : {}),
          ...(body.representante !== undefined
            ? { representante: Boolean(body.representante) }
            : {}),
        },
      });
      return res.json(updated);
    }
  );

  router.delete(
    "/companies/:companyId/partners/:partnerId",
    requireClientCompanyAccess("CLIENT_ADMIN"),
    async (req, res) => {
      const portal = await prisma.portalClient.findUnique({
        where: { id: String(req.params.companyId) },
        select: { companyId: true },
      });
      if (!portal?.companyId) return res.status(400).json({ error: "legacy_company_not_linked" });
      const existing = await prisma.partner.findFirst({
        where: { id: String(req.params.partnerId), companyId: portal.companyId },
      });
      if (!existing) return res.status(404).json({ error: "not_found" });
      await prisma.partner.delete({ where: { id: existing.id } });
      return res.json({ ok: true });
    }
  );

  router.get("/companies/:companyId/users", requireClientCompanyAccess(), async (req, res) => {
    const items = await prisma.companyClientUser.findMany({
      where: { companyId: String(req.params.companyId) },
      include: { user: { select: { id: true, name: true, email: true, status: true } } },
      orderBy: { createdAt: "desc" },
    });
    return res.json({
      data: items.map((it) => ({
        userId: it.userId,
        name: it.user?.name || null,
        email: it.user?.email || null,
        role: it.role,
        status: it.status,
      })),
    });
  });

  router.post(
    "/companies/:companyId/users/invite",
    requireClientCompanyAccess("CLIENT_ADMIN"),
    async (req, res) => {
      const body = req.body || {};
      const email = String(body.email || "")
        .trim()
        .toLowerCase();
      if (!email) return res.status(400).json({ error: "email_required" });

      const role = sanitizeRole(body.role);
      let user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        const tempPassword = crypto.randomBytes(24).toString("hex");
        const passwordHash = await bcrypt.hash(tempPassword, 10);
        user = await prisma.user.create({
          data: {
            email,
            name: body.name ? String(body.name) : null,
            passwordHash,
            role: "user",
            status: "pending",
            accountType: "CLIENT",
          },
        });
      }

      const link = await prisma.companyClientUser.upsert({
        where: {
          companyId_userId: {
            companyId: String(req.params.companyId),
            userId: user.id,
          },
        },
        create: {
          companyId: String(req.params.companyId),
          userId: user.id,
          role,
          status: "INVITED",
        },
        update: {
          role,
          status: "INVITED",
        },
      });
      return res.status(201).json({ ok: true, invited: true, userId: user.id, role: link.role });
    }
  );

  router.patch(
    "/companies/:companyId/users/:userId",
    requireClientCompanyAccess("CLIENT_ADMIN"),
    async (req, res) => {
      const body = req.body || {};
      const data = {};
      if (body.role !== undefined) data.role = sanitizeRole(body.role);
      if (body.status !== undefined) data.status = String(body.status).toUpperCase();
      const updated = await prisma.companyClientUser.update({
        where: {
          companyId_userId: {
            companyId: String(req.params.companyId),
            userId: String(req.params.userId),
          },
        },
        data,
      });
      return res.json({ ok: true, role: updated.role, status: updated.status });
    }
  );

  router.delete(
    "/companies/:companyId/users/:userId",
    requireClientCompanyAccess("CLIENT_ADMIN"),
    async (req, res) => {
      await prisma.companyClientUser.update({
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
    requireClientCompanyAccess("CLIENT_ADMIN"),
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
        log.error({ err: err.message }, "Falha ao subir certificado no portal client");
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.get(
    "/companies/:companyId/certificate",
    requireClientCompanyAccess(),
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
    requireClientCompanyAccess("CLIENT_ADMIN"),
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
        log.error({ err: err.message }, "Falha ao remover certificado no portal client");
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  // Reuso do módulo atual de notas/sync sob novo prefixo.
  router.use("/companies/:clientId/invoices/sync", syncRouter);
  router.use("/companies/:clientId/invoices", invoicesRouter);

  // Fase 7 (stubs iniciais)
  router.post("/companies/:companyId/ofx/import", requireClientCompanyAccess(), async (_req, res) => {
    return res.status(501).json({ error: "not_implemented_yet" });
  });
  router.get("/companies/:companyId/transactions", requireClientCompanyAccess(), async (_req, res) => {
    return res.status(501).json({ error: "not_implemented_yet" });
  });
  router.get("/companies/:companyId/guides", requireClientCompanyAccess(), async (req, res) => {
    const { companyId } = req.params || {};
    const { competencia, status, page, limit } = req.query || {};
    const result = await listGuidesByCompany({
      portalClientId: companyId,
      competencia,
      status,
      page,
      limit,
    });
    return res.json({
      data: result.items.map(toGuideResponse),
      page: result.page,
      limit: result.limit,
      total: result.total,
    });
  });
  router.get(
    "/companies/:companyId/guides/:guideId/download",
    requireClientCompanyAccess(),
    async (req, res) => {
      const { companyId, guideId } = req.params || {};
      const guide = await prisma.guide.findFirst({
        where: { id: String(guideId), portalClientId: String(companyId) },
      });
      if (!guide) return res.status(404).json({ error: "not_found" });
      if (!guide.storageKey) return res.status(404).json({ error: "file_not_available" });
      const url = await guideStorage.createDownloadUrl({
        key: guide.storageKey,
        expiresInSeconds: 900,
      });
      return res.json({ url, expiresIn: 900 });
    }
  );

  return router;
}


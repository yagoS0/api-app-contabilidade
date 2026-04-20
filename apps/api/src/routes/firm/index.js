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
import { createAccountingEntriesRouter } from "./accountingEntries.js";
import {
  getFriendlyGuideMessage,
  getGuidePdfBuffer,
  hashPdf,
  listPendingGuidesReport,
  listGuidesByCompany,
  toPendingGuideReportItem,
  toGuideResponse,
} from "../../application/guides/GuideService.js";
import { normalizeCompetencia, normalizeGuideType } from "../../application/guides/guideContract.js";
import {
  getGuideRuntimeSettings,
  updateGuideRuntimeSettings,
} from "../../application/guides/GuideRuntimeSettings.js";
import { runGuideEmailWorkerOnce, runGuideEmailWorkerSelected } from "../../workers/guideEmailWorker.js";
import { sendLatestGuidesEmailByCompany } from "../../application/guides/GuideCompanyEmailService.js";
import { listUnidentifiedGuides, processUploadedGuides } from "../../application/guides/GuideUploadService.js";
import {
  getCompanyGuideEmailSchedule,
  isAdminLikeUser,
  listEligiblePortalCompaniesForUser,
  resolveCompanyNotificationEmail,
  runScheduledGuideEmailDispatch,
  setCompanyGuideEmailSchedule,
} from "../../application/guides/GuideScheduledEmailService.js";
import {
  computeGuideComplianceMap,
  getReferenceCompetencia,
} from "../../application/guides/guideCompliance.js";

async function attachGuideComplianceToCompaniesList(data) {
  if (!Array.isArray(data) || !data.length) return data;
  const ref = getReferenceCompetencia();
  const rows = data.map((item) => ({
    portalId: item.companyId,
    hasProlabore: Boolean(item.hasProlabore),
    legacy: item.legacyCompany,
  }));
  const map = await computeGuideComplianceMap(rows, ref);
  return data.map((item) => ({
    ...item,
    guideCompliance: map.get(item.companyId) || {
      competencia: ref,
      inss: { required: false, ok: true },
      das: { required: false, ok: true },
      expected: null,
      ok: true,
    },
  }));
}

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

  const legacyCompanySelect = {
    id: true,
    clientId: true,
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

  function buildFirmCompanyPayload({ portal, myRole, scopes = [], legacy = null, ownerEmail = null }) {
    const resolvedUf = portal.uf || getEnderecoField(legacy, "uf");
    const resolvedMunicipio = portal.municipio || getEnderecoField(legacy, "cidade");
    const resolvedInscricaoMunicipal = portal.inscricaoMunicipal || legacy?.inscricaoMunicipal || null;
    const legacyEmail = legacy?.email || null;
    return {
      companyId: portal.id,
      portalId: portal.id,
      myRole,
      scopes,
      razao: portal.razao,
      cnpj: portal.cnpj,
      inscricaoMunicipal: resolvedInscricaoMunicipal,
      uf: resolvedUf,
      municipio: resolvedMunicipio,
      ownerEmail: ownerEmail || null,
      guideNotificationEmail: portal.guideNotificationEmail || null,
      hasProlabore: Boolean(portal.hasProlabore),
      email: legacyEmail,
      telefone: legacy?.telefone || null,
      portalCreatedAt: portal.createdAt,
      portalUpdatedAt: portal.updatedAt,
      legacyCompany: legacy ? { ...legacy, email: legacyEmail } : null,
    };
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
          guideNotificationEmail: true,
          hasProlabore: true,
          inscricaoMunicipal: true,
          uf: true,
          municipio: true,
          createdAt: true,
          updatedAt: true,
          companyId: true,
        },
      });
      const companyIds = items.map((item) => item.companyId).filter(Boolean);
      const legacyCompanies = companyIds.length
        ? await prisma.company.findMany({
            where: { id: { in: companyIds } },
            select: legacyCompanySelect,
          })
        : [];
      const legacyByCompanyId = new Map(legacyCompanies.map((company) => [company.id, company]));
      const portalIds = items.map((item) => item.id);
      const ownerLinks = portalIds.length
        ? await prisma.companyClientUser.findMany({
            where: {
              companyId: { in: portalIds },
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
      const data = await attachGuideComplianceToCompaniesList(
        items.map((item) =>
          buildFirmCompanyPayload({
            portal: item,
            myRole: "FIRM_ADMIN",
            scopes: ["*"],
            legacy: item.companyId ? legacyByCompanyId.get(item.companyId) || null : null,
            ownerEmail: ownerEmailByPortalId.get(item.id) || null,
          })
        )
      );
      return res.json({ data });
    }

    const links = await prisma.companyFirmAccess.findMany({
      where: { userId, status: "ACTIVE" },
      include: {
        company: {
          select: {
            id: true,
            razao: true,
            cnpj: true,
            guideNotificationEmail: true,
            hasProlabore: true,
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
    const portalIds = links.map((link) => link.company.id);
    const ownerLinks = portalIds.length
      ? await prisma.companyClientUser.findMany({
          where: {
            companyId: { in: portalIds },
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
    const data = await attachGuideComplianceToCompaniesList(
      links.map((link) =>
        buildFirmCompanyPayload({
          portal: link.company,
          myRole: link.role,
          scopes: link.scopes || [],
          legacy: link.company.companyId ? legacyByCompanyId.get(link.company.companyId) || null : null,
          ownerEmail: ownerEmailByPortalId.get(link.company.id) || null,
        })
      )
    );
    return res.json({ data });
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
    const inscricaoMunicipalInput = String(companyInput.inscricaoMunicipal || "").trim() || null;

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
            email: normalizedCompany.email || null,
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
            inscricaoMunicipal: inscricaoMunicipalInput,
          },
        });

        const portal = await tx.portalClient.create({
          data: {
            companyId: legacyCompany.id,
            razao,
            cnpj,
            guideNotificationEmail: normalizedCompany.guideNotificationEmail || null,
            hasProlabore: Boolean(body.hasProlabore),
            inscricaoMunicipal: inscricaoMunicipalInput,
            uf: normalizedCompany.endereco?.uf || null,
            municipio: normalizedCompany.endereco?.cidade || null,
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

  router.patch(
    "/companies/:companyId",
    requireFirmCompanyAccess(),
    async (req, res) => {
      const appRole = String(req.auth?.user?.role || "").toLowerCase();
      if (!["admin", "contador"].includes(appRole)) {
        return res.status(403).json({ error: "forbidden_admin_or_contador_only" });
      }
      const portalCompanyId = String(req.params?.companyId || "").trim();
      if (!portalCompanyId) return res.status(400).json({ error: "company_id_required" });
      const body = req.body || {};
      const companyInput = body.company && typeof body.company === "object" ? body.company : body;
      const parsedCompany = validateAndNormalizeCompanyProfile(companyInput);
      if (!parsedCompany.ok) return res.status(400).json({ error: parsedCompany.error });
      const normalizedCompany = parsedCompany.data;
      const ownerEmailInput = String(body.ownerEmail || "")
        .trim()
        .toLowerCase();
      const inscricaoMunicipalInput = String(companyInput.inscricaoMunicipal || "").trim() || null;
      try {
        const result = await prisma.$transaction(async (tx) => {
          const portal = await tx.portalClient.findUnique({
            where: { id: portalCompanyId },
            select: { id: true, companyId: true },
          });
          if (!portal?.id) {
            const err = new Error("portal_company_not_found");
            err.code = "PORTAL_COMPANY_NOT_FOUND";
            throw err;
          }
          const portalUpdateData = {
            razao: normalizedCompany.razaoSocial,
            cnpj: normalizedCompany.cnpj,
            inscricaoMunicipal: inscricaoMunicipalInput,
            uf: normalizedCompany.endereco?.uf || null,
            municipio: normalizedCompany.endereco?.cidade || null,
          };
          if (Object.prototype.hasOwnProperty.call(companyInput, "guideNotificationEmail")) {
            portalUpdateData.guideNotificationEmail = normalizedCompany.guideNotificationEmail;
          }
          if (Object.prototype.hasOwnProperty.call(body, "hasProlabore")) {
            portalUpdateData.hasProlabore = Boolean(body.hasProlabore);
          }
          const updatedPortal = await tx.portalClient.update({
            where: { id: portalCompanyId },
            data: portalUpdateData,
            select: {
              id: true,
              razao: true,
              cnpj: true,
              guideNotificationEmail: true,
              hasProlabore: true,
              inscricaoMunicipal: true,
              uf: true,
              municipio: true,
              createdAt: true,
              updatedAt: true,
              companyId: true,
            },
          });
          let updatedLegacy = null;
          if (portal.companyId) {
            updatedLegacy = await tx.company.update({
              where: { id: portal.companyId },
              data: {
                razaoSocial: normalizedCompany.razaoSocial,
                cnpj: normalizedCompany.cnpj,
                nomeFantasia: normalizedCompany.nomeFantasia,
                email: normalizedCompany.email || null,
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
                inscricaoMunicipal: inscricaoMunicipalInput,
              },
              select: legacyCompanySelect,
            });
          }
          if (ownerEmailInput) {
            const ownerLink = await tx.companyClientUser.findFirst({
              where: {
                companyId: portalCompanyId,
                role: "OWNER",
                status: "ACTIVE",
              },
              orderBy: { createdAt: "asc" },
              select: { userId: true },
            });
            if (ownerLink?.userId) {
              const existingUser = await tx.user.findUnique({
                where: { email: ownerEmailInput },
                select: { id: true },
              });
              if (existingUser?.id && existingUser.id !== ownerLink.userId) {
                const err = new Error("owner_email_already_in_use");
                err.code = "OWNER_EMAIL_ALREADY_IN_USE";
                throw err;
              }
              await tx.user.update({
                where: { id: ownerLink.userId },
                data: { email: ownerEmailInput },
              });
            }
            if (updatedLegacy?.clientId) {
              await tx.client.update({
                where: { id: updatedLegacy.clientId },
                data: { email: ownerEmailInput, login: ownerEmailInput },
              });
            }
          }
          const ownerLinkAfter = await tx.companyClientUser.findFirst({
            where: {
              companyId: portalCompanyId,
              role: "OWNER",
              status: "ACTIVE",
            },
            include: {
              user: {
                select: { email: true },
              },
            },
            orderBy: { createdAt: "asc" },
          });
          return buildFirmCompanyPayload({
            portal: updatedPortal,
            myRole: req.access?.role || "FIRM_ADMIN",
            scopes: req.access?.scopes || [],
            legacy: updatedLegacy,
            ownerEmail: ownerLinkAfter?.user?.email || null,
          });
        });
        const [company] = await attachGuideComplianceToCompaniesList([result]);
        return res.json({ ok: true, company });
      } catch (err) {
        if (err?.code === "PORTAL_COMPANY_NOT_FOUND") {
          return res.status(404).json({ error: "portal_company_not_found" });
        }
        if (err?.code === "OWNER_EMAIL_ALREADY_IN_USE") {
          return res.status(409).json({ error: "owner_email_already_in_use" });
        }
        if (err?.code === "P2002") {
          return res.status(409).json({ error: "unique_constraint_violation" });
        }
        log.error({ err }, "Falha ao atualizar empresa no portal firm");
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

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

  router.patch(
    "/companies/:companyId/email-schedule",
    requireFirmCompanyAccess({ minRole: "FIRM_ADMIN" }),
    async (req, res) => {
      const portalCompanyId = String(req.params?.companyId || "").trim();
      if (!portalCompanyId) return res.status(400).json({ error: "company_id_required" });
      const portal = await prisma.portalClient.findUnique({
        where: { id: portalCompanyId },
        select: { id: true },
      });
      if (!portal?.id) return res.status(404).json({ error: "portal_company_not_found" });
      const body = req.body || {};
      const saved = await setCompanyGuideEmailSchedule({
        portalCompanyId,
        days: body.days,
        updatedBy: req.auth?.user?.id,
      });
      return res.json({
        ok: true,
        companyId: portalCompanyId,
        schedule: saved,
      });
    }
  );

  router.get(
    "/companies/:companyId/email-schedule",
    requireFirmCompanyAccess(),
    async (req, res) => {
      const portalCompanyId = String(req.params?.companyId || "").trim();
      if (!portalCompanyId) return res.status(400).json({ error: "company_id_required" });
      const portal = await prisma.portalClient.findUnique({
        where: { id: portalCompanyId },
        select: { id: true },
      });
      if (!portal?.id) return res.status(404).json({ error: "portal_company_not_found" });
      const schedule = await getCompanyGuideEmailSchedule(portalCompanyId);
      return res.json({
        ok: true,
        companyId: portalCompanyId,
        schedule,
      });
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

  router.get("/guides/settings", requireAccountType("FIRM"), async (_req, res) => {
    const settings = await getGuideRuntimeSettings();
    const { pdfReaderUrl, ...rest } = settings;
    return res.json({
      ...rest,
      pdfReaderConfigured: Boolean(String(pdfReaderUrl || "").trim()),
    });
  });

  router.patch("/guides/settings", requireAccountType("FIRM"), async (req, res) => {
    const appRole = String(req.auth?.user?.role || "").toLowerCase();
    if (!["admin", "contador"].includes(appRole)) {
      return res.status(403).json({ error: "forbidden_admin_or_contador_only" });
    }
    const settings = await updateGuideRuntimeSettings();
    const { pdfReaderUrl, ...rest } = settings;
    return res.json({
      ok: true,
      settings: {
        ...rest,
        pdfReaderConfigured: Boolean(String(pdfReaderUrl || "").trim()),
      },
    });
  });

  router.post("/guides/upload", upload.array("files", 50), async (req, res) => {
    const appRole = String(req.auth?.user?.role || "").toLowerCase();
    if (!["admin", "contador"].includes(appRole)) {
      return res.status(403).json({ error: "forbidden_admin_or_contador_only" });
    }

    const files = Array.isArray(req.files) ? req.files.filter(Boolean) : [];
    if (!files.length) {
      return res.status(400).json({
        ok: false,
        error: "files_required",
        message: "Selecione pelo menos um PDF para enviar.",
      });
    }

    try {
      const uploadRequestId = req.get("x-request-id") || req.get("X-Request-Id");
      const uploadResult = await processUploadedGuides({
        files,
        requestId: uploadRequestId || undefined,
      });
      let emailDispatch = {
        attempted: false,
        skipped: false,
        reason: null,
        sent: 0,
        failed: 0,
      };

      if (uploadResult.processedGuideIds.length) {
        const emailResult = await runGuideEmailWorkerSelected({
          guideIds: uploadResult.processedGuideIds,
        });

        if (emailResult?.skipped && emailResult?.reason === "lock_active") {
          emailDispatch = {
            attempted: true,
            skipped: true,
            reason: "lock_active",
            message: "As guias foram processadas, mas o envio automático está ocupado no momento.",
            sent: 0,
            failed: 0,
          };
        } else {
          emailDispatch = {
            attempted: true,
            skipped: false,
            reason: null,
            sent: Number(emailResult?.sent || 0),
            failed: Number(emailResult?.errors || 0),
            items: Array.isArray(emailResult?.results) ? emailResult.results : [],
          };
        }
      }

      const emailByGuideId = new Map(
        Array.isArray(emailDispatch.items)
          ? emailDispatch.items.map((item) => [String(item.guideId), item])
          : []
      );

      const items = uploadResult.results.map((item) => {
        if (item.status !== "PROCESSED" || !item.guideId) return item;
        const emailItem = emailByGuideId.get(String(item.guideId));
        if (emailDispatch.skipped) {
          return {
            ...item,
            email: {
              status: "PENDING",
              message: "Guia processada e colocada na fila. O envio automático será tentado depois.",
            },
          };
        }
        if (!emailItem) {
          return {
            ...item,
            email: {
              status: "PENDING",
              message: "Guia processada e aguardando envio.",
            },
          };
        }
        return {
          ...item,
          email: {
            status: emailItem.status,
            reason: emailItem.reason || null,
            code: emailItem.code || null,
            message:
              emailItem.status === "SENT"
                ? "Guia processada e e-mail enviado com sucesso."
                : getFriendlyGuideMessage({
                    code: emailItem.code,
                    reason: emailItem.reason,
                  }),
          },
        };
      });

      return res.json({
        ok: true,
        result: {
          total: uploadResult.total,
          processed: uploadResult.processed,
          errors: uploadResult.errors,
          skipped: uploadResult.skipped,
          sent: emailDispatch.sent,
          failedToSend: emailDispatch.failed,
          emailDispatch: {
            attempted: emailDispatch.attempted,
            skipped: emailDispatch.skipped,
            reason: emailDispatch.reason,
            message: emailDispatch.message || null,
          },
          items,
        },
      });
    } catch (err) {
      log.error({ err }, "Falha ao processar upload de guias");
      return res.status(500).json({
        ok: false,
        error: err?.code || "guide_upload_failed",
        reason: err?.message || "guide_upload_failed",
        message: getFriendlyGuideMessage({
          code: err?.code,
          reason: err?.message,
        }),
      });
    }
  });

  router.get("/guides/unidentified", async (req, res) => {
    const appRole = String(req.auth?.user?.role || "").toLowerCase();
    if (!["admin", "contador"].includes(appRole)) {
      return res.status(403).json({ error: "forbidden_admin_or_contador_only" });
    }
    const result = await listUnidentifiedGuides({
      page: req.query?.page,
      limit: req.query?.limit,
    });
    return res.json({
      data: result.items,
      page: result.page,
      limit: result.limit,
      total: result.total,
    });
  });

  router.get(
    "/companies/:companyId/guides",
    requireFirmCompanyAccess(),
    async (req, res) => {
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
    }
  );

  router.get("/guides/pending-report", requireAccountType("FIRM"), async (req, res) => {
    const appRole = String(req.auth.user.role || "").toLowerCase();
    const isAdminLike = ["admin", "contador"].includes(appRole);
    const query = req.query || {};
    let scopeCompanyIds = null;
    if (!isAdminLike) {
      const links = await prisma.companyFirmAccess.findMany({
        where: { userId: String(req.auth.user.id), status: "ACTIVE" },
        select: { companyId: true },
      });
      scopeCompanyIds = links.map((item) => String(item.companyId)).filter(Boolean);
      if (!scopeCompanyIds.length) {
        return res.json({ data: [], page: 1, limit: 25, total: 0 });
      }
    }
    const result = await listPendingGuidesReport({
      portalClientId: query.companyId,
      portalClientIds: scopeCompanyIds || undefined,
      competencia: query.competencia,
      emailStatus: query.emailStatus,
      page: query.page,
      limit: query.limit,
    });
    return res.json({
      data: result.items.map(toPendingGuideReportItem),
      page: result.page,
      limit: result.limit,
      total: result.total,
    });
  });

  router.get(
    "/companies/:companyId/guides/:guideId/download",
    requireFirmCompanyAccess(),
    async (req, res) => {
      const { companyId, guideId } = req.params || {};
      const guide = await prisma.guide.findFirst({
        where: { id: String(guideId), portalClientId: String(companyId) },
      });
      if (!guide) return res.status(404).json({ error: "not_found" });
      const buf = await getGuidePdfBuffer(guide);
      if (!buf?.length) return res.status(404).json({ error: "file_not_available" });
      const fileName = guide.sourcePath || `guia-${guide.competencia || "sem-competencia"}.pdf`;
      return res.json({
        url: null,
        contentBase64: buf.toString("base64"),
        fileName,
        mimeType: "application/pdf",
        expiresIn: null,
      });
    }
  );

  router.post(
    "/guides/:guideId/manual-assign",
    requireAccountType("FIRM"),
    async (req, res) => {
      const { guideId } = req.params || {};
      const body = req.body || {};
      const portalCompanyId = String(body.companyId || body.portalId || "").trim();
      const competencia = normalizeCompetencia(body.competencia);
      const tipo = normalizeGuideType(body.tipo);
      if (!portalCompanyId) return res.status(400).json({ error: "company_id_required" });
      if (!competencia) return res.status(400).json({ error: "competencia_invalid" });

      const guide = await prisma.guide.findUnique({ where: { id: String(guideId) } });
      if (!guide) return res.status(404).json({ error: "not_found" });
      const portal = await prisma.portalClient.findUnique({
        where: { id: portalCompanyId },
        select: { id: true, razao: true, cnpj: true, companyId: true },
      });
      if (!portal?.id) return res.status(404).json({ error: "portal_company_not_found" });

      const access = await prisma.companyFirmAccess.findUnique({
        where: {
          companyId_userId: {
            companyId: portalCompanyId,
            userId: String(req.auth.user.id),
          },
        },
      });
      const appRole = String(req.auth.user.role || "").toLowerCase();
      if (!access && !["admin", "contador"].includes(appRole)) {
        return res.status(403).json({ error: "forbidden" });
      }

      const fileBuffer = await getGuidePdfBuffer(guide);
      if (!fileBuffer?.length) {
        return res.status(400).json({ error: "guide_pdf_not_available" });
      }

      const updated = await prisma.guide.update({
        where: { id: guide.id },
        data: {
          portalClientId: portal.id,
          legacyCompanyId: portal.companyId || null,
          competencia,
          tipo,
          driveInboxFolderId: null,
          driveFinalFolderId: null,
          driveFinalFileId: null,
          storageProvider: "DATABASE",
          storageKey: null,
          storageUrl: null,
          pdfBytes: fileBuffer,
          hash: hashPdf(fileBuffer),
          status: "PROCESSED",
          emailStatus: "PENDING",
          emailAttempts: 0,
          emailLastError: null,
          emailSentAt: null,
          emailNextRetryAt: null,
          reviewedByUserId: String(req.auth.user.id),
          reviewedAt: new Date(),
          errors: [],
        },
      });

      // Regra de negócio: para empresa + competência + tipo, manter apenas a última PROCESSED.
      await prisma.guide.deleteMany({
        where: {
          portalClientId: portal.id,
          competencia,
          tipo,
          status: "PROCESSED",
          NOT: { id: updated.id },
        },
      });

      return res.json({ ok: true, guide: toGuideResponse(updated) });
    }
  );

  router.post(
    "/guides/:guideId/resend-email",
    requireAccountType("FIRM"),
    async (req, res) => {
      const { guideId } = req.params || {};
      const guide = await prisma.guide.findUnique({
        where: { id: String(guideId) },
        select: { id: true, status: true, portalClientId: true, emailStatus: true },
      });
      if (!guide) return res.status(404).json({ error: "not_found" });
      if (guide.status !== "PROCESSED") {
        return res.status(400).json({
          error: "guide_not_processed",
          reason: "Reenvio de e-mail só é permitido para guias com status PROCESSED",
        });
      }
      if (!guide.portalClientId) {
        return res.status(400).json({ error: "guide_has_no_company", reason: "Guia sem empresa vinculada" });
      }
      const access = await prisma.companyFirmAccess.findUnique({
        where: {
          companyId_userId: {
            companyId: guide.portalClientId,
            userId: String(req.auth.user.id),
          },
        },
      });
      const appRole = String(req.auth.user.role || "").toLowerCase();
      if (!access && !["admin", "contador"].includes(appRole)) {
        return res.status(403).json({ error: "forbidden" });
      }

      const updated = await prisma.guide.update({
        where: { id: guide.id },
        data: {
          emailStatus: "PENDING",
          emailAttempts: 0,
          emailLastError: null,
          emailSentAt: null,
          emailNextRetryAt: null,
        },
      });
      return res.json({
        ok: true,
        guideId: updated.id,
        emailStatus: updated.emailStatus,
        message: "Guia colocada na fila de reenvio de e-mail.",
      });
    }
  );

  router.post(
    "/companies/:companyId/guides/send-email-latest",
    requireAccountType("FIRM"),
    async (req, res) => {
      const portalCompanyId = String(req.params?.companyId || "").trim();
      if (!portalCompanyId) return res.status(400).json({ error: "company_id_required" });
      const portal = await prisma.portalClient.findUnique({
        where: { id: portalCompanyId },
        select: { id: true },
      });
      if (!portal?.id) return res.status(404).json({ error: "portal_company_not_found" });

      const access = await prisma.companyFirmAccess.findUnique({
        where: {
          companyId_userId: {
            companyId: portalCompanyId,
            userId: String(req.auth.user.id),
          },
        },
      });
      const appRole = String(req.auth.user.role || "").toLowerCase();
      if (!access && !["admin", "contador"].includes(appRole)) {
        return res.status(403).json({ error: "forbidden" });
      }

      const to = await resolveCompanyNotificationEmail(portalCompanyId);
      if (!to) {
        return res.status(400).json({
          error: "company_email_not_found",
          reason:
            "Empresa sem e-mail para envio de guias (configure o e-mail das guias no cadastro, ou use Company.email legado, ou e-mail do responsável).",
        });
      }

      try {
        const result = await sendLatestGuidesEmailByCompany({
          portalClientId: portalCompanyId,
          to,
        });
        return res.json({ ok: true, result });
      } catch (err) {
        return res.status(500).json({
          ok: false,
          error: err?.code || "GUIDE_EMAIL_SEND_FAILED",
          reason: err?.message || "Falha ao enviar guias da empresa.",
        });
      }
    }
  );

  router.post(
    "/guides/emails/send-pending",
    requireAccountType("FIRM"),
    async (req, res) => {
      const body = req.body || {};
      const batchSize = Math.min(Math.max(Number(body.batchSize) || 50, 1), 100);
      const maxBatches = Math.min(Math.max(Number(body.maxBatches) || 50, 1), 500);

      const aggregated = {
        totalProcessed: 0,
        sent: 0,
        failed: 0,
        batches: 0,
        failedItems: [],
        batchResults: [],
      };

      for (let i = 0; i < maxBatches; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const batch = await runGuideEmailWorkerOnce({ batchSize });
        if (batch?.skipped && batch?.reason === "lock_active") {
          return res.status(409).json({
            ok: false,
            error: "guide_email_worker_busy",
            reason: "Outro processo de envio de e-mail está em execução.",
          });
        }

        const total = Number(batch?.total || 0);
        const sent = Number(batch?.sent || 0);
        const errors = Number(batch?.errors || 0);
        const results = Array.isArray(batch?.results) ? batch.results : [];
        aggregated.batches += 1;
        aggregated.totalProcessed += total;
        aggregated.sent += sent;
        aggregated.failed += errors;
        aggregated.batchResults.push({
          batch: aggregated.batches,
          total,
          sent,
          errors,
        });
        aggregated.failedItems.push(
          ...results
            .filter((item) => item.status === "ERROR")
            .map((item) => ({
              guideId: item.guideId,
              code: item.code || "GUIDE_EMAIL_SEND_ERROR",
              reason: item.reason || "unknown_error",
              willRetry: Boolean(item.willRetry),
            }))
        );

        // Não há mais itens elegíveis para envio neste momento.
        if (total === 0) break;
      }

      if (aggregated.failed > 0) {
        return res.status(500).json({
          ok: false,
          error: "guide_email_send_failed",
          message: "Alguns e-mails não foram enviados.",
          result: aggregated,
        });
      }

      return res.json({
        ok: true,
        message: "Todos os e-mails pendentes elegíveis foram processados com sucesso.",
        result: aggregated,
      });
    }
  );

  router.post("/guides/emails/send-selected", requireAccountType("FIRM"), async (req, res) => {
    const body = req.body || {};
    const requestedIds = Array.isArray(body.guideIds) ? body.guideIds : [];
    const guideIds = [...new Set(requestedIds.map((id) => String(id || "").trim()).filter(Boolean))];
    if (!guideIds.length) {
      return res.status(400).json({ ok: false, error: "guide_ids_required" });
    }
    const appRole = String(req.auth.user.role || "").toLowerCase();
    const isAdminLike = ["admin", "contador"].includes(appRole);
    if (!isAdminLike) {
      const guides = await prisma.guide.findMany({
        where: { id: { in: guideIds } },
        select: { id: true, portalClientId: true },
      });
      const guideMap = new Map(guides.map((item) => [item.id, item]));
      for (const guideId of guideIds) {
        const guide = guideMap.get(guideId);
        if (!guide?.portalClientId) {
          return res.status(403).json({ ok: false, error: "forbidden" });
        }
        // eslint-disable-next-line no-await-in-loop
        const access = await prisma.companyFirmAccess.findUnique({
          where: {
            companyId_userId: {
              companyId: String(guide.portalClientId),
              userId: String(req.auth.user.id),
            },
          },
          select: { status: true },
        });
        if (!access || access.status !== "ACTIVE") {
          return res.status(403).json({ ok: false, error: "forbidden" });
        }
      }
    }
    const result = await runGuideEmailWorkerSelected({ guideIds });
    if (result?.skipped && result?.reason === "lock_active") {
      return res.status(409).json({
        ok: false,
        error: "guide_email_worker_busy",
        reason: "Outro processo de envio de e-mail está em execução.",
      });
    }
    return res.json({
      ok: true,
      result: {
        totalRequested: guideIds.length,
        sent: Number(result?.sent || 0),
        failed: Number(result?.errors || 0),
        items: Array.isArray(result?.results) ? result.results : [],
      },
    });
  });

  router.post("/guides/emails/run-scheduled", requireAccountType("FIRM"), async (req, res) => {
    const dryRun =
      String(req.query?.dryRun || "").toLowerCase() === "1" ||
      String(req.query?.dryRun || "").toLowerCase() === "true" ||
      req.body?.dryRun === true;
    const requestedDay = Number(req.body?.day || req.query?.day || 0);
    const today = requestedDay >= 1 && requestedDay <= 31 ? requestedDay : new Date().getDate();

    const maxFilesPerCompany = Math.min(
      100,
      Math.max(1, Number(req.body?.maxFilesPerCompany || req.query?.maxFilesPerCompany || 15))
    );
    const companies = await listEligiblePortalCompaniesForUser({
      userId: String(req.auth.user.id),
      adminLike: isAdminLikeUser(req.auth.user),
    });
    const result = await runScheduledGuideEmailDispatch({
      companies,
      referenceDay: today,
      dryRun,
      maxFilesPerCompany,
    });
    if (result?.skipped && result?.reason === "lock_active") {
      return res.status(409).json(result);
    }
    return res.json(result);
  });

  // Rota utilitária para ambiente de desenvolvimento: limpa hashes para reprocessar guias.
  router.post("/dev/guides/reset-hash", requireAccountType("FIRM"), async (req, res) => {
    if (String(process.env.NODE_ENV || "").toLowerCase() === "production") {
      return res.status(404).json({ error: "not_found" });
    }
    const appRole = String(req.auth?.user?.role || "").toLowerCase();
    if (appRole !== "admin") {
      return res.status(403).json({ error: "forbidden_admin_only" });
    }

    const beforeCount = await prisma.guide.count();
    const deleted = await prisma.guide.deleteMany({});
    const afterCount = await prisma.guide.count();

    return res.json({
      ok: true,
      guidesDeleted: deleted.count,
      before: beforeCount,
      after: afterCount,
      message: "Todos os registros de guias foram apagados do banco.",
    });
  });

  const accountingEntriesRouter = createAccountingEntriesRouter({ log });
  router.use("/companies/:companyId", accountingEntriesRouter);

  router.use("/companies/:clientId/invoices/sync", syncRouter);
  router.use("/companies/:clientId/invoices", invoicesRouter);

  return router;
}


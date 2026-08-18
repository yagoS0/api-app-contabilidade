import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import multer from "multer";
import { prisma } from "../../infrastructure/db/prisma.js";
import { requireAuth } from "../../middlewares/requireAuth.js";
import { requireAccountType } from "../../middlewares/requireAccountType.js";
import { requireClientCompanyAccess } from "../../middlewares/requireClientCompanyAccess.js";
import {
  COMPANY_DB_CERT_STORAGE_KEY,
  deleteCompanyPfx,
} from "../../infrastructure/storage/CertStorage.js";
import { encryptSecret, encryptBytes } from "../../utils/crypto.js";
import { inspectPfx, formatCnpj } from "../../application/security/inspectPfx.js";
import { createPortalInvoicesRouter } from "../portalInvoices.js";
import { createPortalSyncRouter } from "../portalSync.js";
import {
  getGuidePdfBuffer,
  listGuidesByCompany,
  toGuideResponse,
} from "../../application/guides/GuideService.js";
import { buildCompanyDashboard } from "../../application/dashboard/buildCompanyDashboard.js";
// ── A EMISSÃO DE NFS-e PELO CLIENTE — tudo REUSADO, nada reimplementado ──────────────────────
// Ver o bloco `POST /companies/:companyId/nfse`, no fim deste arquivo, para o porquê de a fachada
// existir. Estes cinco imports SÃO o desenho: validador, resolução dos dois ids, portão do ato
// fiscal, serviço de emissão e o mapa de desfechos — todos os mesmos de `POST /nfse/issue`.
import { validateNfsePayload } from "../../application/validators/nfsePayload.js";
import { NfseService } from "../../application/nfse/NfseService.js";
import { resolveLegacyCompanyId } from "../middlewares/portalAccess.js";
import { ensureEmissaoNfseAutorizada } from "../middlewares/emissaoNfseGate.js";
import { responderResultadoEmissao, responderErroEmissao } from "../nfseEmissaoHttp.js";

function sanitizeRole(role) {
  const value = String(role || "FINANCEIRO").toUpperCase();
  // FINANCEIRO é o piso ofertado no app; CLIENT_USER aceito só por compatibilidade legada.
  if (!["OWNER", "CLIENT_ADMIN", "FINANCEIRO", "CLIENT_USER"].includes(value)) return "FINANCEIRO";
  return value;
}

// Lista de competências 'YYYY-MM' (ascendente) para a série de alíquotas.
// Padrão: 12 meses até o mês antecedente (mês fechado anterior). Aceita from/to 'YYYY-MM'.
function buildCompetenciaRange(from, to) {
  const parse = (s) => {
    const m = /^(\d{4})-(\d{2})$/.exec(String(s || ""));
    return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)) : null;
  };
  const now = new Date();
  const defEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = parse(to) || defEnd;
  const start =
    parse(from) || new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1));
  const out = [];
  const cur = new Date(start);
  let guard = 0;
  while (cur <= end && guard < 60) {
    out.push(`${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, "0")}`);
    cur.setUTCMonth(cur.getUTCMonth() + 1);
    guard += 1;
  }
  return out;
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
            guideNotificationEmail: true,
            inscricaoMunicipal: true,
            uf: true,
            municipio: true,
            createdAt: true,
            updatedAt: true,
            companyId: true,
            // ⚠ O PORTÃO DE EMISSÃO PRECISA VIAJAR ATÉ O APP DO CLIENTE. A coluna existe desde
            // 18/08/2026 e **não aparecia aqui** — o app só descobria o portão pela RECUSA, depois
            // de o usuário preencher a nota inteira. Ver `emissaoNfseLiberada`, abaixo.
            //
            // ⚠ **SÓ A FLAG.** `emissaoClienteLiberadaEm`/`...Por` respondem *"quem autorizou este
            // cliente a emitir?"* — é registro de AUDITORIA do contador, e o id/instante de um
            // usuário do escritório não é dado do cliente. Ampliar este `select` é o caminho por
            // onde vazamento entre lados acontece sem ninguém notar.
            emissaoClienteLiberada: true,
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
        const legacyEmail = legacy?.email || null;
        return {
          companyId: link.company.id,
          portalId: link.company.id,
          myRole: link.role,
          razao: link.company.razao,
          cnpj: link.company.cnpj,
          inscricaoMunicipal: link.company.inscricaoMunicipal || legacy?.inscricaoMunicipal || null,
          uf: link.company.uf || getEnderecoField(legacy, "uf"),
          municipio: link.company.municipio || getEnderecoField(legacy, "cidade"),
          ownerEmail,
          // O portão de emissão de NFS-e desta empresa, do ponto de vista do cliente: *"o contador
          // liberou a emissão para nós?"*. ⚠ **Isto NÃO é a permissão** — quem decide continua
          // sendo `ensureEmissaoNfseAutorizada` (empresa liberada **e** papel ≥ CLIENT_ADMIN), no
          // servidor, a cada emissão. Aqui é só o que a tela precisa para não oferecer um botão que
          // vai ser recusado. `=== true` porque autorização não se abre por coerção de tipo.
          emissaoNfseLiberada: link.company.emissaoClienteLiberada === true,
          guideNotificationEmail: link.company.guideNotificationEmail || null,
          email: legacyEmail,
          telefone: legacy?.telefone || null,
          portalCreatedAt: link.company.createdAt,
          portalUpdatedAt: link.company.updatedAt,
          legacyCompany: legacy ? { ...legacy, email: legacyEmail } : null,
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
    requireClientCompanyAccess("OWNER"),
    async (req, res) => {
      const body = req.body || {};
      const email = String(body.email || "")
        .trim()
        .toLowerCase();
      if (!email) return res.status(400).json({ error: "email_required" });

      const role = sanitizeRole(body.role);
      // Só OWNER convida, e não é possível criar outro OWNER por aqui (transferência é à parte).
      if (role === "OWNER") return res.status(400).json({ error: "cannot_assign_owner" });
      // Q8.A.5: select restritivo — não precisamos de passwordHash aqui (só id pra criar link).
      let user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true, name: true, role: true },
      });
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
    requireClientCompanyAccess("OWNER"),
    async (req, res) => {
      const companyId = String(req.params.companyId);
      const userId = String(req.params.userId);
      const existing = await prisma.companyClientUser.findUnique({
        where: { companyId_userId: { companyId, userId } },
        select: { role: true },
      });
      if (!existing) return res.status(404).json({ error: "member_not_found" });
      // OWNER é protegido: não pode ser rebaixado/alterado por aqui.
      if (String(existing.role).toUpperCase() === "OWNER") {
        return res.status(403).json({ error: "cannot_modify_owner" });
      }
      const body = req.body || {};
      const data = {};
      if (body.role !== undefined) {
        const role = sanitizeRole(body.role);
        if (role === "OWNER") return res.status(400).json({ error: "cannot_assign_owner" });
        data.role = role;
      }
      if (body.status !== undefined) data.status = String(body.status).toUpperCase();
      const updated = await prisma.companyClientUser.update({
        where: { companyId_userId: { companyId, userId } },
        data,
      });
      return res.json({ ok: true, role: updated.role, status: updated.status });
    }
  );

  router.delete(
    "/companies/:companyId/users/:userId",
    requireClientCompanyAccess("OWNER"),
    async (req, res) => {
      const companyId = String(req.params.companyId);
      const userId = String(req.params.userId);
      const existing = await prisma.companyClientUser.findUnique({
        where: { companyId_userId: { companyId, userId } },
        select: { role: true },
      });
      if (!existing) return res.status(404).json({ error: "member_not_found" });
      if (String(existing.role).toUpperCase() === "OWNER") {
        return res.status(403).json({ error: "cannot_remove_owner" });
      }
      await prisma.companyClientUser.update({
        where: { companyId_userId: { companyId, userId } },
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

        // Q52: valida senha do PFX e se o certificado pertence à empresa (CNPJ) ANTES de salvar.
        let inspected;
        try {
          inspected = inspectPfx(file.buffer, password);
        } catch (inspectErr) {
          if (inspectErr?.code === "CERT_SENHA_INVALIDA" || inspectErr?.code === "CERT_ARQUIVO_INVALIDO") {
            return res.status(400).json({ error: inspectErr.code.toLowerCase(), message: inspectErr.message });
          }
          throw inspectErr;
        }
        if (!inspected.cnpj) {
          return res.status(400).json({
            error: "cert_sem_cnpj",
            message: "O certificado não contém CNPJ (parece ser e-CPF/pessoa física). Envie o certificado A1 e-CNPJ da empresa.",
          });
        }
        const portalClient = await prisma.portalClient.findUnique({
          where: { id: portalCompanyId },
          select: { cnpj: true },
        });
        const empresaCnpj = String(portalClient?.cnpj || company.cnpj || "").replace(/\D/g, "");
        if (empresaCnpj && inspected.cnpj !== empresaCnpj) {
          return res.status(400).json({
            error: "cert_cnpj_mismatch",
            message: `O certificado pertence ao CNPJ ${formatCnpj(inspected.cnpj)}, mas esta empresa é ${formatCnpj(empresaCnpj)}. Envie o certificado correto.`,
          });
        }
        const expiresAt = inspected.notAfter;
        const now = new Date();
        await prisma.company.update({
          where: { id: company.id },
          data: {
            certStorageKey: COMPANY_DB_CERT_STORAGE_KEY,
            certPfxBytes: await encryptBytes(file.buffer), // Q30/Q35: PFX cifrado em repouso
            certPasswordEnc: await encryptSecret(password),
            certUploadedAt: now,
            certExpiresAt: expiresAt || undefined,
          },
        });
        if (previousStorageKey && previousStorageKey !== COMPANY_DB_CERT_STORAGE_KEY) {
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
            certPfxBytes: null,
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
      // Portal Cliente (#3.1): o cliente só vê guias liberadas pelo contador.
      apenasLiberadas: true,
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
        // Portal Cliente (#3.1): cliente só baixa guia liberada.
        where: { id: String(guideId), portalClientId: String(companyId), liberadaCliente: true },
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

  // Portal Cliente (#3.2): fontes da ALÍQUOTA por competência. O portal expõe os valores brutos;
  // o app calcula: de-receita = das/faturamento; efetiva = impostosPagos.total/faturamento.
  router.get("/companies/:companyId/aliquota", requireClientCompanyAccess(), async (req, res) => {
    const { companyId } = req.params || {};
    const competencia = String(req.query?.competencia || "").trim();
    if (!/^\d{4}-\d{2}$/.test(competencia)) {
      return res.status(400).json({ error: "competencia_required" });
    }
    try {
      const cid = String(companyId);
      const [y, m] = competencia.split("-").map(Number);
      const gte = new Date(Date.UTC(y, m - 1, 1));
      const lt = new Date(Date.UTC(y, m, 1));

      const [notas, ultimoExtrato, guiasPagas] = await Promise.all([
        // Faturamento da competência: notas EMIT autorizadas (mesma fonte do dashboard).
        prisma.portalInvoice.aggregate({
          where: { clientId: cid, papel: "EMIT", statusEfetivo: "autorizada", competencia: { gte, lt } },
          _sum: { total: true },
        }),
        // Imposto do "último extrato" disponível (DAS do PGDAS-D).
        prisma.companyMonthlyCircular.findFirst({
          where: { portalClientId: cid, dasTotal: { not: null } },
          orderBy: { competencia: "desc" },
          select: { competencia: true, dasTotal: true },
        }),
        // Impostos PAGOS da competência, por tipo (inclui INSS).
        prisma.guide.groupBy({
          by: ["tipo"],
          where: { portalClientId: cid, competencia, paymentStatus: "PAID" },
          _sum: { valor: true },
        }),
      ]);

      const porTipo = {};
      let totalPagos = 0;
      for (const g of guiasPagas) {
        const v = Number(g._sum?.valor || 0);
        porTipo[String(g.tipo || "OUTRA").toUpperCase()] = v;
        totalPagos += v;
      }

      return res.json({
        competencia,
        faturamento: { valor: Number(notas._sum?.total || 0) },
        impostoUltimoExtrato: ultimoExtrato
          ? { competencia: ultimoExtrato.competencia, das: Number(ultimoExtrato.dasTotal || 0) }
          : { competencia: null, das: 0 },
        impostosPagos: { total: totalPagos, porTipo },
      });
    } catch (err) {
      log.error({ err: err.message, companyId }, "client aliquota falhou");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // Portal Cliente (Fase 3): SÉRIE de alíquotas por competência (drill-down no app).
  // Reusa as MESMAS fontes do /aliquota, mas com o DAS do extrato DAQUELE mês (não o último).
  router.get("/companies/:companyId/aliquotas", requireClientCompanyAccess(), async (req, res) => {
    const cid = String(req.params.companyId);
    try {
      const list = buildCompetenciaRange(req.query?.from, req.query?.to);
      if (!list.length) return res.json({ data: [] });

      const [circulares, guiasPagas] = await Promise.all([
        prisma.companyMonthlyCircular.findMany({
          where: { portalClientId: cid, competencia: { in: list } },
          select: { competencia: true, dasTotal: true },
        }),
        prisma.guide.groupBy({
          by: ["competencia"],
          where: { portalClientId: cid, competencia: { in: list }, paymentStatus: "PAID" },
          _sum: { valor: true },
        }),
      ]);
      const dasByComp = new Map(circulares.map((c) => [c.competencia, Number(c.dasTotal || 0)]));
      const pagosByComp = new Map(
        guiasPagas.map((g) => [g.competencia, Number(g._sum?.valor || 0)])
      );
      const pct = (n, d) => (d > 0 ? Number(((n / d) * 100).toFixed(2)) : 0);

      const data = [];
      for (const comp of list) {
        const [y, m] = comp.split("-").map(Number);
        const gte = new Date(Date.UTC(y, m - 1, 1));
        const lt = new Date(Date.UTC(y, m, 1));
        const notas = await prisma.portalInvoice.aggregate({
          where: {
            clientId: cid,
            papel: "EMIT",
            statusEfetivo: "autorizada",
            competencia: { gte, lt },
          },
          _sum: { total: true },
        });
        const faturamento = Number(notas._sum?.total || 0);
        const impostosPagos = pagosByComp.get(comp) || 0;
        const dasExtrato = dasByComp.get(comp) || 0;
        data.push({
          competencia: comp,
          faturamento,
          impostosPagos,
          dasExtrato,
          efetiva: pct(impostosPagos, faturamento),
          deReceita: pct(dasExtrato, faturamento),
        });
      }
      // Mais recente primeiro (bom para lista no app).
      data.reverse();
      return res.json({ data });
    } catch (err) {
      log.error({ err: err.message, companyId: cid }, "client aliquotas (série) falhou");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // Portal Cliente (Fase 4): FLUXO de caixa futuro a partir das obrigações fiscais.
  // Fonte = guias LIBERADAS ao cliente ainda EM ABERTO (OPEN/OVERDUE) com vencimento.
  // INSS/DAS/parcelas do Simples são todos Guides. Sem lançamento manual nesta fase.
  router.get("/companies/:companyId/fluxo", requireClientCompanyAccess(), async (req, res) => {
    const cid = String(req.params.companyId);
    try {
      const guias = await prisma.guide.findMany({
        where: {
          portalClientId: cid,
          liberadaCliente: true,
          vencimento: { not: null },
          paymentStatus: { in: ["OPEN", "OVERDUE"] },
        },
        select: {
          id: true,
          tipo: true,
          competencia: true,
          valor: true,
          vencimento: true,
          paymentStatus: true,
          numeroParcela: true,
        },
        orderBy: { vencimento: "asc" },
      });
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const data = guias.map((g) => ({
        id: g.id,
        tipo: g.tipo || "OUTRA",
        competencia: g.competencia || null,
        valor: Number(g.valor || 0),
        vencimento: g.vencimento ? g.vencimento.toISOString().slice(0, 10) : null,
        paymentStatus: g.paymentStatus || "OPEN",
        vencida: g.vencimento ? new Date(g.vencimento) < hoje : false,
        numeroParcela: g.numeroParcela ?? null,
      }));
      const total = data.reduce((s, i) => s + i.valor, 0);
      return res.json({ data, total });
    } catch (err) {
      log.error({ err: err.message, companyId: cid }, "client fluxo falhou");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // Dashboard do app (faturamento do mês + extrato do Simples). Consumido pelo BFF
  // do app mobile com o JWT do cliente; o escopo por empresa é garantido aqui.
  router.get(
    "/companies/:companyId/dashboard",
    requireClientCompanyAccess(),
    async (req, res) => {
      const { companyId } = req.params || {};
      try {
        const data = await buildCompanyDashboard({ portalClientId: String(companyId) });
        return res.json(data);
      } catch (err) {
        log.error({ err: err.message, companyId }, "client dashboard falhou");
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  // ── EMISSÃO DE NFS-e PELO APP DO CLIENTE ───────────────────────────────────────────────────
  //
  // ⚠ ISTO É UMA FACHADA, E A PALAVRA IMPORTA: **nenhuma regra de emissão mora aqui**. O app do
  // cliente fala tudo por `/client/...`; a emissão vive em `POST /nfse/issue`, em outro router,
  // que **não sabe distinguir escritório de cliente** — foi essa indistinção que criou o buraco de
  // autorização fechado em 18/08/2026 (qualquer membro ATIVO alcançava o ato fiscal). Em vez de
  // ensinar aquele router a falar duas línguas, o lado do cliente ganha a própria porta, e ela
  // delega:
  //
  //   validação  → `validateNfsePayload`            (o MESMO validador; nada é reconferido aqui)
  //   os dois ids → `resolveLegacyCompanyId`        (a MESMA resolução de `/nfse/issue`)
  //   permissão  → `ensureEmissaoNfseAutorizada`    (o MESMO portão, com os mesmos códigos)
  //   emissão    → `NfseService.issue`              (o MESMO serviço)
  //   resposta   → `nfseEmissaoHttp.js`             (os MESMOS desfechos das três camadas)
  //
  // ⚠ Escrever uma segunda resolução, uma segunda validação ou um segundo mapa de resposta é o
  // defeito que este desenho existe para impedir — as duas portas discordariam na primeira
  // correção, e a que o cliente usa é a que ninguém do escritório testa.
  router.post(
    "/companies/:companyId/nfse",
    // Primeiro passo: esta pessoa é membro ATIVO desta empresa? (é o equivalente, do lado
    // `/client`, ao `ensureLegacyCompanyAccess` de `/nfse/issue` — VÍNCULO, não permissão.)
    // O papel mínimo NÃO é declarado aqui de propósito: quem responde "este papel emite?" é o
    // portão, com código e mensagem próprios. Um `minRole` aqui devolveria `insufficient_role`
    // genérico e o cliente não saberia se o problema é o papel dele ou a liberação do contador.
    requireClientCompanyAccess(),
    async (req, res) => {
      const portalClientId = String(req.params.companyId || "").trim();

      // ⚠ O PATH VENCE O CORPO, e o spread vem ANTES. `{ ...body, companyId: path }` — invertido,
      // um `companyId` no corpo apontaria a emissão para OUTRA empresa depois de a permissão ter
      // sido conferida nesta. É literalmente o furo de multi-tenancy medido na F1 do WhatsApp.
      const validation = validateNfsePayload({ ...(req.body || {}), companyId: portalClientId });
      if (!validation.ok) {
        return res.status(400).json({ error: validation.error });
      }

      // ⚠ RESOLVER ANTES DE AUTORIZAR O ATO. `/client` fala em `PortalClient.id`; `NfseService`
      // fala em `Company` legada, e o id de uma nunca encontra a outra. Inverter a ordem
      // autorizaria uma empresa e emitiria por outra.
      const legacyCompanyId = await resolveLegacyCompanyId(portalClientId);
      if (!legacyCompanyId) {
        return res.status(404).json({ error: "company_not_found" });
      }

      // ATO FISCAL: além de enxergar a empresa, é preciso estar autorizado a emitir por ela —
      // empresa liberada pelo contador **e** papel ≥ CLIENT_ADMIN. A recusa (403) sai daqui com o
      // motivo nomeado, idêntica à de `/nfse/issue`.
      const portao = await ensureEmissaoNfseAutorizada(req, res, legacyCompanyId, { log });
      if (!portao.ok) return;

      try {
        const result = await NfseService.issue({
          data: { ...validation.data, companyId: legacyCompanyId },
          log,
          // Reaproveita a linha da tentativa anterior em vez de queimar um número novo — não
          // existe inutilização na NFS-e. O serviço confere que a linha é DESTA empresa e recusa
          // quando o desfecho anterior foi TRANSPORTE (número em estado indeterminado).
          retryInvoiceId: req.body?.retryInvoiceId || null,
        });
        return responderResultadoEmissao(res, result);
      } catch (err) {
        return responderErroEmissao(res, err, { log });
      }
    }
  );

  return router;
}

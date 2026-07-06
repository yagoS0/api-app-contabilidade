import { Router } from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import { prisma } from "../../infrastructure/db/prisma.js";
import { requireAuth } from "../../middlewares/requireAuth.js";
import { requireAccountType } from "../../middlewares/requireAccountType.js";
import { requireFirmCompanyAccess } from "../../middlewares/requireFirmCompanyAccess.js";
import {
  COMPANY_DB_CERT_STORAGE_KEY,
  deleteCompanyPfx,
} from "../../infrastructure/storage/CertStorage.js";
import { encryptSecret, encryptBytes } from "../../utils/crypto.js";
import { inspectPfx, formatCnpj } from "../../application/security/inspectPfx.js";
import { auditCertAccess } from "../../application/security/CertAccessAudit.js";
import {
  enderecoToSingleLine,
  validateAndNormalizeCompanyProfile,
} from "../../application/company/companyProfile.js";
import {
  companyCreateSchema,
  companyUpdateSchema,
  validateCompanyInput,
} from "../../application/validators/companySchemas.js";
import { sanitizeFilename } from "../../lib/httpHeaders.js";
import { safeLogError } from "../../lib/safeLogError.js";
import { createPortalInvoicesRouter } from "../portalInvoices.js";
import { createPortalSyncRouter } from "../portalSync.js";
import { createAccountingEntriesRouter } from "./accountingEntries.js";
import { createNotasRouter } from "./notas.js";
import { createApuracaoV2Router } from "./apuracaoV2.js";
import { criarBatchJob, runApuracaoBatchOnce } from "../../workers/apuracaoBatchWorker.js";
// Q48: download de notas em lote (ZIP em segundo plano)
import fsNotasDownload from "node:fs";
import {
  criarNotasDownloadJob,
  cleanupNotasDownloadJobs,
  jobToResponse as notasDownloadJobToResponse,
} from "../../application/notas/download/NotasDownloadService.js";
import { createAccountingEntryRulesRouter } from "./accountingEntryRules.js";
import { importChartOfAccountsFromBuffer } from "../../application/accounting/chartOfAccountsImport.js";
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
import { isMonthClosed } from "../../application/accounting/fechamentoContabil.js";
import {
  getGuideRuntimeSettings,
  updateGuideRuntimeSettings,
} from "../../application/guides/GuideRuntimeSettings.js";
import { runGuideEmailWorkerOnce, runGuideEmailWorkerSelected } from "../../workers/guideEmailWorker.js";
import { runSerproPgdasdWorkerOnce } from "../../workers/serproPgdasdWorker.js";
import { runSerproDctfwebWorkerOnce } from "../../workers/serproDctfwebWorker.js";
import { sendCompanyGuidesEmail, sendLatestGuidesEmailByCompany } from "../../application/guides/GuideCompanyEmailService.js";
import { listUnidentifiedGuides, processUploadedGuides, uploadGuideForPortalClient } from "../../application/guides/GuideUploadService.js";
import {
  getCompanyGuideEmailSchedule,
  isAdminLikeUser,
  listEligiblePortalCompaniesForUser,
  resolveCompanyNotificationEmail,
  runScheduledGuideEmailDispatch,
  setCompanyGuideEmailSchedule,
} from "../../application/guides/GuideScheduledEmailService.js";
import {
  deleteSerproCertificate,
  getSerproRuntimeSettings,
  updateSerproRuntimeSettings,
  uploadSerproCertificate,
} from "../../application/fiscal/serpro/SerproRuntimeSettings.js";
import { capturePgdasGuideForCompany } from "../../application/fiscal/serpro/CaptureSerproGuidesService.js";
import { syncSerproInssForCompany } from "../../application/fiscal/serpro/SerproDctfwebService.js";
import { capturarParcelaGuideForCompany } from "../../application/fiscal/serpro/CaptureSerproParcelaService.js";
import { getStoredProcurationStatus, SerproProcurationService } from "../../application/fiscal/serpro/SerproProcurationService.js";
// Q40: confirmação de pagamento (PAGTOWEB) + SITFIS.
import { runPaymentConfirmationOnce } from "../../application/fiscal/serpro/SerproPaymentConfirmationService.js";
import { runSerproPaymentConfirmationWorkerOnce } from "../../workers/serproPaymentConfirmationWorker.js";
import { obterRelatorio as obterSitfisRelatorio } from "../../application/fiscal/serpro/SerproSitfisService.js";
import { GuideStorageService } from "../../application/guides/GuideStorageService.js";
import { FiscalManualRunService } from "../../application/fiscal/FiscalManualRunService.js";
import {
  computeGuideComplianceMap,
  getReferenceCompetencia,
} from "../../application/guides/guideCompliance.js";
import {
  canGuideRecalculate,
  isGuideOverdue,
  isGuidePaid,
  markGuideOpenBySerpro,
  markGuidePaidManual,
} from "../../application/guides/GuidePaymentStatusService.js";
import {
  SERPRO_PGDASD_SERVICE_COBRANCA,
  SERPRO_PGDASD_SERVICE_NORMAL,
} from "../../application/fiscal/serpro/SerproPgdasdService.js";

// Plano de contas global precisa cobrir os 5 tipos básicos antes de qualquer empresa ser criada.
// Lançamentos automáticos (DAS, faturamento, etc) dependem desse plano mínimo configurado.
const REQUIRED_GLOBAL_TIPOS = ["ATIVO", "PASSIVO", "RECEITA", "DESPESA", "PATRIMONIO"];

// Q41: deriva a situação fiscal (SITFIS) por palavra-chave no relatório retornado pelo SERPRO.
// ⚠ Best-effort — o formato do relatório SITFIS ainda não foi validado no sandbox (verificadoTrial:false);
// esta heurística é aproximada e serve só para sinalizar na UI (não é fonte fiscal definitiva).
// Sinais fortes de pendência (RFB + PGFN). "devedor"/"saldo devedor consolidado ... DEVEDOR"
// aparece na coluna "Sdo. Dev. Cons. Situação" do relatório quando há débito.
const SITFIS_PENDENCIA_REGEX = /pend[êe]ncia|d[ée]bito|em aberto|parcelamento em atraso|irregular|div[íi]da ativa|inscri[çc][ãa]o em d[íi]vida|devedor|saldo devedor|exig[íi]vel/i;
// Frases de "nada consta" — removidas antes de aplicar a regex para não gerar falso-positivo
// (ex.: "não há débitos" contém "débitos"). Um relatório pode ter uma seção "sem débitos" na RFB
// e ainda assim ter débito na PGFN; ao remover só as frases negativas, o "DEVEDOR" da PGFN dispara.
const SITFIS_NEGACAO_REGEX = /n[ãa]o\s+(?:h[áa]|constam?|possui|exist[eê]m?|foram\s+localizad[oa]s?)\s+(?:d[ée]bitos?|pend[êe]ncias?|inscri[çc][õo]es?)[^.;\n]*/gi;

async function extractSitfisPdfText(buffer) {
  if (!buffer?.length) return "";
  try {
    const pdfParse = (await import("pdf-parse")).default;
    const data = await pdfParse(buffer);
    return String(data?.text || "");
  } catch (err) {
    log.warn({ err: err?.message }, "SITFIS: falha ao extrair texto do PDF (segue sem heurística de texto)");
    return "";
  }
}

function deriveSituacaoFiscal(result, extraText = "") {
  if (result?.processando) return "PROCESSANDO";
  const haystack = [
    result?.relatorioTexto || "",
    extraText || "",
    result?.rawPayload ? JSON.stringify(result.rawPayload) : "",
  ].join(" ");
  const semNegacoes = haystack.replace(SITFIS_NEGACAO_REGEX, " ");
  if (SITFIS_PENDENCIA_REGEX.test(semNegacoes)) return "COM_PENDENCIA";
  return "REGULAR";
}

// Q29: traduz os códigos de erro do SERPRO no recálculo do DAS Simples em mensagens
// legíveis para o contador (a UI mostrava só "Falha ao recalcular guia").
function formatCompetenciaBR(competencia) {
  const m = String(competencia || "").match(/^(\d{4})-(\d{2})$/);
  return m ? `${m[2]}/${m[1]}` : String(competencia || "");
}
function friendlyRecalcMessage(code, { competencia } = {}, fallback) {
  const comp = formatCompetenciaBR(competencia);
  switch (code) {
    case "SERPRO_PGDASD_DECLARATION_NOT_TRANSMITTED":
      return `Não há declaração PGDAS-D transmitida para ${comp}. Transmita a apuração antes de recalcular o DAS.`;
    case "SERPRO_PGDASD_NO_DEBTS_FOUND":
      return `O SERPRO não encontrou débito para ${comp} (nada a recolher nesta competência).`;
    case "SERPRO_PGDASD_NO_AMOUNT_DUE":
      return `Não foi gerado DAS: sem valor devido para ${comp}.`;
    case "SERPRO_PGDASD_PDF_NOT_FOUND":
    case "SERPRO_PGDASD_PDF_INVALID":
      return "O SERPRO não retornou o documento. Confirme que a declaração foi transmitida e que há débito em aberto.";
    default:
      return fallback || "Falha ao recalcular guia PGDAS-D no SERPRO.";
  }
}

async function getGlobalChartStatus() {
  const counts = await prisma.chartOfAccount.groupBy({
    by: ["tipo"],
    where: { portalClientId: null },
    _count: { _all: true },
  });
  const presentTipos = new Set(
    counts.map((c) => String(c.tipo || "").toUpperCase()).filter(Boolean)
  );
  const missingTipos = REQUIRED_GLOBAL_TIPOS.filter((t) => !presentTipos.has(t));
  const totalAccounts = counts.reduce((s, c) => s + Number(c._count?._all || 0), 0);
  return {
    isConfigured: missingTipos.length === 0,
    totalAccounts,
    tiposPresentes: [...presentTipos],
    tiposFaltantes: missingTipos,
  };
}

async function attachGuideComplianceToCompaniesList(data, competenciaArg) {
  if (!Array.isArray(data) || !data.length) return data;
  const ref = competenciaArg || getReferenceCompetencia();
  const rows = data.map((item) => ({
    portalId: item.companyId,
    hasProlabore: Boolean(item.hasProlabore),
    legacy: item.legacyCompany,
  }));
  const map = await computeGuideComplianceMap(rows, ref);

  // Q16: selo "e-mail do mês enviado" — empresa com ao menos 1 guia SENT na competência ref.
  const portalIds = [...new Set(data.map((item) => item.companyId).filter(Boolean))];
  const emailSentSet = new Set();
  if (portalIds.length) {
    const sent = await prisma.guide.findMany({
      where: { portalClientId: { in: portalIds }, competencia: ref, emailStatus: "SENT" },
      select: { portalClientId: true },
      distinct: ["portalClientId"],
    });
    for (const s of sent) emailSentSet.add(s.portalClientId);
  }

  return data.map((item) => ({
    ...item,
    guideCompliance: map.get(item.companyId) || {
      competencia: ref,
      inss: { required: false, ok: true },
      das: { required: false, ok: true },
      expected: null,
      ok: true,
    },
    monthEmailSent: emailSentSet.has(item.companyId),
    monthEmailCompetencia: ref,
  }));
}

// Q17: anexa o estado do FECHAMENTO CONTÁBIL da competência por empresa (card "Fechada").
async function attachFechamentoContabilToCompaniesList(data, competenciaArg) {
  if (!Array.isArray(data) || !data.length) return data;
  const competencia = competenciaArg || getReferenceCompetencia();
  const portalIds = [...new Set(data.map((item) => item.companyId).filter(Boolean))];
  const byPortal = new Map();
  if (portalIds.length) {
    const circs = await prisma.companyMonthlyCircular.findMany({
      where: { portalClientId: { in: portalIds }, competencia },
      select: { portalClientId: true, fechadoContabilEm: true, fechadoContabilPor: true },
    });
    for (const c of circs) byPortal.set(c.portalClientId, c);
  }
  return data.map((item) => {
    const c = byPortal.get(item.companyId);
    return {
      ...item,
      fechamentoContabil: {
        competencia,
        fechado: Boolean(c?.fechadoContabilEm),
        fechadoEm: c?.fechadoContabilEm || null,
        fechadoPor: c?.fechadoContabilPor || null,
      },
    };
  });
}

// Q52: anexa ao card do dashboard o total de notas emitidas e o estado da apuração da competência.
// - notasEmitidas: soma de PortalInvoice EMIT autorizadas do mês (1 groupBy pra lista toda).
// - apuracao: ApuracaoSnapshot com estado transmitida/confirmada ("confirmada" = pós-conferência
//   de apuração já transmitida — conta como apurada). Model legado Apuracao é ignorado (fluxo v2).
async function attachNotasApuracaoToCompaniesList(data, competenciaArg) {
  if (!Array.isArray(data) || !data.length) return data;
  const competencia = competenciaArg || getReferenceCompetencia();
  const m = String(competencia).match(/^(\d{4})-(\d{2})$/);
  const portalIds = [...new Set(data.map((item) => item.companyId).filter(Boolean))];
  const notasByPortal = new Map();
  const apuracaoByPortal = new Map();
  if (portalIds.length && m) {
    const inicioMes = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
    const mesSeguinte = new Date(Date.UTC(Number(m[1]), Number(m[2]), 1));
    const [notas, snapshots] = await Promise.all([
      prisma.portalInvoice.groupBy({
        by: ["clientId"],
        where: {
          clientId: { in: portalIds },
          papel: "EMIT",
          statusEfetivo: "autorizada",
          competencia: { gte: inicioMes, lt: mesSeguinte },
        },
        _sum: { total: true },
        _count: { _all: true },
      }),
      prisma.apuracaoSnapshot.findMany({
        where: {
          portalClientId: { in: portalIds },
          competencia,
          estado: { in: ["transmitida", "confirmada"] },
        },
        select: { portalClientId: true, estado: true, transmitidoEm: true },
      }),
    ]);
    for (const n of notas) {
      notasByPortal.set(n.clientId, {
        total: Number(n._sum?.total || 0),
        quantidade: Number(n._count?._all || 0),
      });
    }
    for (const s of snapshots) apuracaoByPortal.set(s.portalClientId, s);
  }
  return data.map((item) => {
    const notas = notasByPortal.get(item.companyId) || { total: 0, quantidade: 0 };
    const snap = apuracaoByPortal.get(item.companyId) || null;
    return {
      ...item,
      notasEmitidas: { competencia, total: notas.total, quantidade: notas.quantidade },
      apuracao: {
        competencia,
        apurada: Boolean(snap),
        estado: snap?.estado || null,
        transmitidoEm: snap?.transmitidoEm || null,
      },
    };
  });
}

async function attachSerproStatusToCompaniesList(data) {
  if (!Array.isArray(data) || !data.length) return data;

  const settings = await getSerproRuntimeSettings();
  const runtimeReady =
    Boolean(settings.enabled) &&
    Boolean(String(settings.baseUrl || "").trim()) &&
    Boolean(String(settings.consumerKey || "").trim()) &&
    Boolean(settings.consumerSecretConfigured) &&
    Boolean(settings.certificate?.hasCertificate);

  const portalIds = data.map((item) => String(item.companyId || "").trim()).filter(Boolean);
  const procurationKeys = portalIds.map((id) => `serpro_procuration_status:${id}`);
  const procurationSettings = procurationKeys.length
    ? await prisma.appSetting.findMany({
        where: { key: { in: procurationKeys } },
        select: { key: true, value: true },
      })
    : [];
  const procurationByPortalId = new Map(
    procurationSettings.map((item) => [item.key.replace("serpro_procuration_status:", ""), item.value && typeof item.value === "object" ? item.value : {}])
  );

  return data.map((item) => {
    const cnpj = String(item.cnpj || "").replace(/\D+/g, "");
    const email = String(item.guideNotificationEmail || item.email || item.ownerEmail || "").trim().toLowerCase();
    const procuration = procurationByPortalId.get(String(item.companyId)) || {};
    const procurationStatus = String(procuration.status || "DESCONHECIDA").trim().toUpperCase();
    const reasons = [];

    if (!settings.enabled) reasons.push("integracao_desabilitada");
    if (!settings.baseUrl) reasons.push("base_url_ausente");
    if (!settings.consumerKey) reasons.push("consumer_key_ausente");
    if (!settings.consumerSecretConfigured) reasons.push("consumer_secret_ausente");
    if (!settings.certificate?.hasCertificate) reasons.push("certificado_ausente");
    if (!cnpj || cnpj.length !== 14) reasons.push("cnpj_invalido");
    if (!email) reasons.push("email_guias_ausente");
    if (procurationStatus !== "ATIVA") reasons.push("procuracao_inativa_ou_nao_validada");

    return {
      ...item,
      serproStatus: {
        eligible: runtimeReady && reasons.length === 0,
        status: runtimeReady && reasons.length === 0 ? "APTA" : "NAO_APTA",
        procurationStatus,
        checkedAt: procuration.checkedAt || null,
        reasons,
      },
    };
  });
}

async function getGuideWithFirmAccess({ guideId, user }) {
  const guide = await prisma.guide.findUnique({
    where: { id: String(guideId) },
  });
  if (!guide) return { guide: null, error: "not_found", status: 404 };
  if (!guide.portalClientId) return { guide: null, error: "guide_has_no_company", status: 400 };

  const access = await prisma.companyFirmAccess.findUnique({
    where: {
      companyId_userId: {
        companyId: guide.portalClientId,
        userId: String(user.id),
      },
    },
  });
  const appRole = String(user.role || "").toLowerCase();
  if (!access && !["admin", "contador"].includes(appRole)) {
    return { guide: null, error: "forbidden", status: 403 };
  }

  return { guide, error: null, status: 200 };
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
      // Q11.1: estado de suspensão exibido na UI (badge + bloqueio de ações).
      status: portal.status || "ATIVA",
      suspendedAt: portal.suspendedAt || null,
      suspendedReason: portal.suspendedReason || null,
      legacyCompany: legacy ? { ...legacy, email: legacyEmail } : null,
    };
  }

  router.get("/companies", async (req, res) => {
    const userId = String(req.auth.user.id);
    const appRole = String(req.auth.user.role || "").toLowerCase();
    const isAdminLike = appRole === "admin" || appRole === "contador";
    // Q17: dashboard filtra por competência (default = mês anterior).
    const competenciaRef = normalizeCompetencia(req.query?.competencia || "") || getReferenceCompetencia();

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
          status: true,           // Q11.1
          suspendedAt: true,
          suspendedReason: true,
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
      const dataWithCompliance = await attachGuideComplianceToCompaniesList(
        items.map((item) =>
          buildFirmCompanyPayload({
            portal: item,
            myRole: "FIRM_ADMIN",
            scopes: ["*"],
            legacy: item.companyId ? legacyByCompanyId.get(item.companyId) || null : null,
            ownerEmail: ownerEmailByPortalId.get(item.id) || null,
          })
        ),
        competenciaRef
      );
      const dataWithSerpro = await attachSerproStatusToCompaniesList(dataWithCompliance);
      const dataWithFechamento = await attachFechamentoContabilToCompaniesList(dataWithSerpro, competenciaRef);
      const data = await attachNotasApuracaoToCompaniesList(dataWithFechamento, competenciaRef);
      return res.json({ data, competencia: competenciaRef });
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
            status: true,           // Q11.1
            suspendedAt: true,
            suspendedReason: true,
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
    const dataWithCompliance = await attachGuideComplianceToCompaniesList(
      links.map((link) =>
        buildFirmCompanyPayload({
          portal: link.company,
          myRole: link.role,
          scopes: link.scopes || [],
          legacy: link.company.companyId ? legacyByCompanyId.get(link.company.companyId) || null : null,
          ownerEmail: ownerEmailByPortalId.get(link.company.id) || null,
        })
      ),
      competenciaRef
    );
    const dataWithSerpro = await attachSerproStatusToCompaniesList(dataWithCompliance);
    const dataWithFechamento = await attachFechamentoContabilToCompaniesList(dataWithSerpro, competenciaRef);
    const data = await attachNotasApuracaoToCompaniesList(dataWithFechamento, competenciaRef);
    return res.json({ data, competencia: competenciaRef });
  });

  // Q41: lista das empresas com a última situação fiscal (SITFIS) gravada — alimenta a página Pendências.
  // Não chama o SERPRO (lê CompanyFiscalStatus). Ordena COM_PENDENCIA primeiro.
  router.get("/pendencias/fiscal", async (req, res) => {
    const userId = String(req.auth.user.id);
    const appRole = String(req.auth.user.role || "").toLowerCase();
    const isAdminLike = appRole === "admin" || appRole === "contador";
    const fiscalSelect = { situacao: true, checkedAt: true, protocolo: true, relatorioPdfFileId: true };

    let portals;
    if (isAdminLike) {
      portals = await prisma.portalClient.findMany({
        where: { status: { not: "SUSPENSA" } },
        orderBy: { razao: "asc" },
        select: { id: true, razao: true, cnpj: true, fiscalStatus: { select: fiscalSelect } },
      });
    } else {
      const links = await prisma.companyFirmAccess.findMany({
        where: { userId, status: "ACTIVE" },
        include: {
          company: { select: { id: true, razao: true, cnpj: true, status: true, fiscalStatus: { select: fiscalSelect } } },
        },
        orderBy: { createdAt: "desc" },
      });
      portals = links.map((l) => l.company).filter((c) => c && c.status !== "SUSPENSA");
    }

    const items = portals.map((p) => ({
      companyId: p.id,
      razao: p.razao,
      cnpj: p.cnpj,
      situacao: p.fiscalStatus?.situacao || null,
      checkedAt: p.fiscalStatus?.checkedAt || null,
      protocolo: p.fiscalStatus?.protocolo || null,
      relatorioPdfFileId: p.fiscalStatus?.relatorioPdfFileId || null,
    }));
    const rank = (s) => (s === "COM_PENDENCIA" ? 0 : s === "PROCESSANDO" ? 1 : s === "REGULAR" ? 2 : 3);
    items.sort((a, b) => rank(a.situacao) - rank(b.situacao) || String(a.razao).localeCompare(String(b.razao)));
    return res.json({ items });
  });

  router.post("/companies", async (req, res) => {
    const body = req.body || {};

    // Q8.A.4: validação rigorosa via Zod ANTES da lógica de negócio.
    // Roda em paralelo com a normalização legada — Zod rejeita formatos ruins (CNPJ inválido,
    // senha fraca, email inválido) antes do código alcançar Prisma.
    const zodResult = validateCompanyInput(companyCreateSchema, body);
    if (!zodResult.ok) return res.status(zodResult.status).json(zodResult.body);

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

    // Plano de contas global é PRÉ-REQUISITO para criar empresas.
    // Lançamentos automáticos (DAS, faturamento, etc) dependem de um plano mínimo.
    try {
      const globalStatus = await getGlobalChartStatus();
      if (!globalStatus.isConfigured) {
        return res.status(400).json({
          ok: false,
          error: "global_chart_of_accounts_not_configured",
          message: `Configure o plano de contas global antes de criar empresas. Faltam contas dos tipos: ${globalStatus.tiposFaltantes.join(", ")}.`,
          missingTipos: globalStatus.tiposFaltantes,
        });
      }
    } catch (chartErr) {
      log.warn({ err: chartErr }, "Falha ao verificar plano global (seguindo o fluxo)");
    }

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

      // Q8.A.4: validação Zod rigorosa ANTES da lógica.
      const zodResult = validateCompanyInput(companyUpdateSchema, body);
      if (!zodResult.ok) return res.status(zodResult.status).json(zodResult.body);

      const companyInput = body.company && typeof body.company === "object" ? body.company : body;
      const parsedCompany = validateAndNormalizeCompanyProfile(companyInput);
      if (!parsedCompany.ok) return res.status(400).json({ error: parsedCompany.error });
      const normalizedCompany = parsedCompany.data;
      const ownerEmailInput = String(body.ownerEmail || "")
        .trim()
        .toLowerCase();
      const inscricaoMunicipalInput = String(companyInput.inscricaoMunicipal || "").trim() || null;
      // CNPJ é IMUTÁVEL após criação — vinculado ao certificado A1, SERPRO, NFS-e, validação de PDFs.
      // Para "trocar" CNPJ, contador deve excluir a empresa e criar uma nova.
      try {
        const currentForCnpjCheck = await prisma.portalClient.findUnique({
          where: { id: portalCompanyId },
          select: { cnpj: true },
        });
        if (currentForCnpjCheck) {
          const onlyDigits = (s) => String(s || "").replace(/\D+/g, "");
          if (normalizedCompany.cnpj && onlyDigits(normalizedCompany.cnpj) !== onlyDigits(currentForCnpjCheck.cnpj)) {
            return res.status(400).json({
              ok: false,
              error: "cnpj_imutavel",
              message: "CNPJ não pode ser alterado. Para trocar o CNPJ, exclua a empresa e crie uma nova.",
            });
          }
        }
      } catch (cnpjCheckErr) {
        log.warn({ err: cnpjCheckErr }, "Falha ao checar imutabilidade do CNPJ (seguindo o fluxo)");
      }

      try {
        const result = await prisma.$transaction(async (tx) => {
          const portal = await tx.portalClient.findUnique({
            where: { id: portalCompanyId },
            select: { id: true, companyId: true, cnpj: true },
          });
          if (!portal?.id) {
            const err = new Error("portal_company_not_found");
            err.code = "PORTAL_COMPANY_NOT_FOUND";
            throw err;
          }
          // CNPJ imutável: ignoramos qualquer cnpj vindo do body e mantemos o atual.
          const portalUpdateData = {
            razao: normalizedCompany.razaoSocial,
            cnpj: portal.cnpj,
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
                cnpj: portal.cnpj, // imutável — herda do PortalClient atual

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

  // Q11.1: SUSPENDER empresa — workers SERPRO param de processar; reversível via /resume.
  router.post(
    "/companies/:companyId/suspend",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalCompanyId = String(req.params?.companyId || "").trim();
      if (!portalCompanyId) return res.status(400).json({ error: "company_id_required" });
      const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 500) : null;
      try {
        const updated = await prisma.portalClient.update({
          where: { id: portalCompanyId },
          data: { status: "SUSPENSA", suspendedAt: new Date(), suspendedReason: reason },
          select: { id: true, status: true, suspendedAt: true, suspendedReason: true },
        });
        log.info({ portalCompanyId, reason }, "Empresa suspensa");
        return res.json({ ok: true, company: updated });
      } catch (err) {
        log.error({ err, portalCompanyId }, "Falha ao suspender empresa");
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  // Q11.1: REATIVAR empresa suspensa.
  router.post(
    "/companies/:companyId/resume",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalCompanyId = String(req.params?.companyId || "").trim();
      if (!portalCompanyId) return res.status(400).json({ error: "company_id_required" });
      try {
        const updated = await prisma.portalClient.update({
          where: { id: portalCompanyId },
          data: { status: "ATIVA", suspendedAt: null, suspendedReason: null },
          select: { id: true, status: true },
        });
        log.info({ portalCompanyId }, "Empresa reativada");
        return res.json({ ok: true, company: updated });
      } catch (err) {
        log.error({ err, portalCompanyId }, "Falha ao reativar empresa");
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  // Q11.1: EXCLUIR empresa — exige confirmCnpj no body. Hard delete (cascata Prisma).
  router.delete(
    "/companies/:companyId",
    requireFirmCompanyAccess({ minRole: "FIRM_ADMIN" }),
    async (req, res) => {
      const portalCompanyId = String(req.params?.companyId || "").trim();
      if (!portalCompanyId) return res.status(400).json({ error: "company_id_required" });
      const { confirmCnpj } = req.body || {};

      try {
        const portal = await prisma.portalClient.findUnique({
          where: { id: portalCompanyId },
          select: { id: true, cnpj: true, razao: true, companyId: true },
        });
        if (!portal) return res.status(404).json({ ok: false, error: "company_not_found" });

        const onlyDigits = (s) => String(s || "").replace(/\D+/g, "");
        if (onlyDigits(confirmCnpj) !== onlyDigits(portal.cnpj)) {
          return res.status(400).json({
            ok: false,
            error: "cnpj_confirmation_mismatch",
            message: "Digite o CNPJ exato da empresa para confirmar a exclusão.",
          });
        }

        await prisma.$transaction(async (tx) => {
          // Cascade Prisma apaga: Guides, AccountingEntries, Parcelamentos, Circular,
          // ChartOfAccounts, AccountingFunctions, AccountingEntryRule, FiscalExecutionLog,
          // CompanyFirmAccess, CompanyClientUser, PortalIntegrationSettings, PortalSyncState,
          // PortalInvoice (e relacionados), TaxDocument.
          await tx.portalClient.delete({ where: { id: portalCompanyId } });
          // Company legacy (legacy 1:1) — apaga em separado se houver.
          if (portal.companyId) {
            await tx.company.delete({ where: { id: portal.companyId } }).catch(() => null);
          }
        });
        log.warn({ portalCompanyId, razao: portal.razao, cnpj: portal.cnpj }, "Empresa excluída");
        return res.json({ ok: true, deleted: { id: portalCompanyId, razao: portal.razao } });
      } catch (err) {
        log.error({ err, portalCompanyId }, "Falha ao excluir empresa");
        return res.status(500).json({ ok: false, error: "internal_error" });
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
            certPfxBytes: await encryptBytes(file.buffer), // Q30/Q35: PFX cifrado em repouso (expiry lido do buffer em claro acima)
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
        await auditCertAccess({
          portalClientId: portalCompanyId, certKind: "COMPANY_A1", action: "UPLOAD",
          consumer: "firm:upload", actorUserId: req.auth?.user?.id || null,
        });
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
        // Q8.A.7: safeLogError redacta `password` em qualquer profundidade do err/ctx.
        safeLogError(log, { portalCompanyId }, err, "Falha ao subir certificado no portal firm");
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
        await auditCertAccess({
          portalClientId: req.params.companyId, certKind: "COMPANY_A1", action: "DELETE",
          consumer: "firm:delete", actorUserId: req.auth?.user?.id || null,
        });
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

  // Q30 Fase 1: auditoria de acesso a certificados (LGPD). Filtros opcionais: companyId, action, certKind.
  router.get("/cert-audit", requireAccountType("FIRM"), async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const where = {};
    if (req.query.companyId) where.portalClientId = String(req.query.companyId);
    if (req.query.action) where.action = String(req.query.action).toUpperCase();
    if (req.query.certKind) where.certKind = String(req.query.certKind).toUpperCase();
    try {
      const [items, total] = await Promise.all([
        prisma.certAccessLog.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
        prisma.certAccessLog.count({ where }),
      ]);
      return res.json({ ok: true, total, limit, offset, items });
    } catch (err) {
      log.error({ err: err?.message }, "Falha ao listar auditoria de certificados");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

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

  router.get("/serpro/settings", requireAccountType("FIRM"), async (_req, res) => {
    const settings = await getSerproRuntimeSettings();
    return res.json({
      enabled: Boolean(settings.enabled),
      environment: settings.environment,
      authUrl: settings.authUrl,
      baseUrl: settings.baseUrl,
      consumerKey: settings.consumerKey,
      consumerSecretConfigured: Boolean(settings.consumerSecretConfigured),
      scope: settings.scope,
      timeoutMs: settings.timeoutMs,
      fetchDay: settings.fetchDay,
      fetchHour: settings.fetchHour,
      fetchCron: settings.fetchCron,
      // Q40: cron próprio de confirmação de pagamento (PAGTOWEB).
      paymentConfirmationEnabled: Boolean(settings.paymentConfirmationEnabled),
      paymentConfirmationDay: settings.paymentConfirmationDay,
      paymentConfirmationHour: settings.paymentConfirmationHour,
      paymentConfirmationCron: settings.paymentConfirmationCron,
      certificate: settings.certificate,
      source: settings.source,
    });
  });

  router.get("/serpro/status", requireAccountType("FIRM"), async (_req, res) => {
    const latestRun = await prisma.appSetting.findFirst({
      where: { key: { startsWith: "serpro_pgdasd_log:" } },
      orderBy: { updatedAt: "desc" },
      select: { key: true, value: true, updatedAt: true },
    });

    return res.json({
      ok: true,
      workerEnabled: Boolean(process.env.SERPRO_PGDASD_WORKER_ENABLED === "1"),
      lastRun: latestRun
        ? {
            key: latestRun.key,
            updatedAt: latestRun.updatedAt,
            value: latestRun.value,
          }
        : null,
    });
  });

  // Dispara manualmente o cron do SERPRO (DAS PGDAS-D + INSS DCTFWeb).
  // Usado quando o cron automático ainda não rodou e precisamos forçar.
  router.post("/serpro/cron/run", requireAccountType("FIRM"), async (req, res) => {
    const appRole = String(req.auth?.user?.role || "").toLowerCase();
    if (!["admin", "contador"].includes(appRole)) {
      return res.status(403).json({ error: "forbidden_admin_or_contador_only" });
    }

    const competencia = normalizeCompetencia(req.body?.competencia || req.query?.competencia || "") || undefined;

    const startedAt = Date.now();

    // Roda os dois workers em paralelo. Cada um já itera todas as empresas elegíveis.
    const [pgdasResult, dctfwebResult] = await Promise.allSettled([
      runSerproPgdasdWorkerOnce({ competencia }),
      runSerproDctfwebWorkerOnce({ competencia }),
    ]);

    function unpack(settled, label) {
      if (settled.status === "fulfilled") return { ok: true, ...settled.value };
      log.error({ err: settled.reason?.message || settled.reason, label }, "Cron SERPRO falhou");
      return { ok: false, error: settled.reason?.code || "WORKER_ERROR", message: settled.reason?.message || "Erro desconhecido" };
    }

    return res.json({
      ok: true,
      competencia: competencia || "default_reference",
      durationMs: Date.now() - startedAt,
      pgdasd: unpack(pgdasResult, "pgdasd"),
      dctfweb: unpack(dctfwebResult, "dctfweb"),
    });
  });

  // Q40: dispara manualmente o cron de confirmação de pagamento (PAGTOWEB) para TODAS as guias OPEN.
  router.post("/serpro/payment-confirmation/run-now", requireAccountType("FIRM"), async (req, res) => {
    const appRole = String(req.auth?.user?.role || "").toLowerCase();
    if (!["admin", "contador"].includes(appRole)) {
      return res.status(403).json({ error: "forbidden_admin_or_contador_only" });
    }
    const competencia = normalizeCompetencia(req.body?.competencia || req.query?.competencia || "") || undefined;
    try {
      const result = await runSerproPaymentConfirmationWorkerOnce({ competencia });
      return res.json({ ok: true, result });
    } catch (err) {
      log.error({ err: err?.message || err }, "Falha no run-now de confirmação de pagamento SERPRO");
      return res.status(502).json({ ok: false, error: err?.code || "SERPRO_PAYMENT_CONFIRMATION_FAILED", reason: err?.message });
    }
  });

  router.patch("/serpro/settings", requireAccountType("FIRM"), async (req, res) => {
    const appRole = String(req.auth?.user?.role || "").toLowerCase();
    if (!["admin", "contador"].includes(appRole)) {
      return res.status(403).json({ error: "forbidden_admin_or_contador_only" });
    }
    const settings = await updateSerproRuntimeSettings(req.body || {});
    return res.json({
      ok: true,
      settings: {
        enabled: Boolean(settings.enabled),
        environment: settings.environment,
        authUrl: settings.authUrl,
        baseUrl: settings.baseUrl,
        consumerKey: settings.consumerKey,
        consumerSecretConfigured: Boolean(settings.consumerSecretConfigured),
        scope: settings.scope,
        timeoutMs: settings.timeoutMs,
        // Importante: incluir fetchDay/fetchHour para que o form do frontend
        // re-hidrate com o valor recém-salvo. Sem eles, o useEffect cairia no
        // fallback do parse do fetchCron (que é diário e não preserva o dia).
        fetchDay: settings.fetchDay,
        fetchHour: settings.fetchHour,
        fetchCron: settings.fetchCron,
        // Q40: cron próprio de confirmação de pagamento — re-hidrata o form.
        paymentConfirmationEnabled: Boolean(settings.paymentConfirmationEnabled),
        paymentConfirmationDay: settings.paymentConfirmationDay,
        paymentConfirmationHour: settings.paymentConfirmationHour,
        paymentConfirmationCron: settings.paymentConfirmationCron,
        certificate: settings.certificate,
        source: settings.source,
      },
    });
  });

  router.post("/serpro/settings/certificate", requireAccountType("FIRM"), upload.fields([{ name: "pfx", maxCount: 1 }, { name: "file", maxCount: 1 }]), async (req, res) => {
    const appRole = String(req.auth?.user?.role || "").toLowerCase();
    if (!["admin", "contador"].includes(appRole)) {
      return res.status(403).json({ error: "forbidden_admin_or_contador_only" });
    }

    const password = (req.body?.password || req.body?.pfxPassword || "").toString();
    const file = (req.files?.pfx && req.files.pfx[0]) || (req.files?.file && req.files.file[0]) || null;

    try {
      const settings = await uploadSerproCertificate({ file, password });
      return res.json({ ok: true, settings: { certificate: settings.certificate } });
    } catch (err) {
      if (err.code === "PFX_REQUIRED") return res.status(400).json({ error: "pfx_required" });
      if (err.code === "PASSWORD_REQUIRED") return res.status(400).json({ error: "password_required" });
      if (err.code === "CERT_STORAGE_NOT_CONFIGURED") return res.status(400).json({ error: "cert_storage_not_configured" });
      if (err.code === "CERT_SECRET_KEY_NOT_CONFIGURED") return res.status(400).json({ error: "cert_secret_key_not_configured" });
      // Q8.A.7: safeLogError redacta password do contexto/err antes de logar.
      safeLogError(log, {}, err, "Falha ao subir certificado SERPRO");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  router.delete("/serpro/settings/certificate", requireAccountType("FIRM"), async (req, res) => {
    const appRole = String(req.auth?.user?.role || "").toLowerCase();
    if (!["admin", "contador"].includes(appRole)) {
      return res.status(403).json({ error: "forbidden_admin_or_contador_only" });
    }
    try {
      const result = await deleteSerproCertificate();
      return res.json({ ok: true, deletedFile: result.deletedFile, settings: { certificate: result.settings.certificate } });
    } catch (err) {
      if (err.code === "CERT_STORAGE_NOT_CONFIGURED") return res.status(400).json({ error: "cert_storage_not_configured" });
      log.error({ err: err.message }, "Falha ao remover certificado SERPRO");
      return res.status(500).json({ error: "internal_error" });
    }
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
      // Auto-send REMOVIDO. Guias processadas ficam em emailStatus=PENDING aguardando
      // envio em lote via página `Envio de e-mails em lote`.
      const emailDispatch = {
        attempted: false,
        skipped: true,
        reason: "batch_email_only",
        sent: 0,
        failed: 0,
      };

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

  router.post(
    "/companies/:companyId/guides/upload",
    requireFirmCompanyAccess(),
    upload.single("file"),
    async (req, res) => {
      const appRole = String(req.auth?.user?.role || "").toLowerCase();
      if (!["admin", "contador"].includes(appRole)) {
        return res.status(403).json({ error: "forbidden_admin_or_contador_only" });
      }
      const { companyId } = req.params || {};
      const file = req.file;
      if (!file?.buffer?.length) {
        return res.status(400).json({ ok: false, error: "file_required", message: "Selecione um PDF para enviar." });
      }
      let metadata = null;
      if (req.body?.metadata) {
        try { metadata = JSON.parse(req.body.metadata); } catch { metadata = null; }
      }
      try {
        const result = await uploadGuideForPortalClient({
          portalClientId: companyId,
          fileBuffer: file.buffer,
          fileName: file.originalname || "guia.pdf",
          metadata,
        });
        if (result.needsMetadata) {
          return res.json({ ok: false, needsMetadata: true, parsed: result.parsed });
        }
        // Auto-send REMOVIDO. Guia fica em emailStatus=PENDING aguardando envio em lote
        // via página `Envio de e-mails em lote` (endpoint POST /firm/guides/batch-send).
        return res.json({
          ok: true,
          guide: toGuideResponse(result.guide),
          emailStatus: "PENDING",
          emailMessage: "Guia processada e aguardando envio manual em lote.",
        });
      } catch (err) {
        log.error({ err }, "Falha ao processar upload de guia para empresa");
        return res.status(500).json({
          ok: false,
          error: err?.code || "guide_upload_failed",
          message: getFriendlyGuideMessage({ code: err?.code, reason: err?.message }),
        });
      }
    }
  );

  router.delete("/guides/:guideId", requireAccountType("FIRM"), async (req, res) => {
    const appRole = String(req.auth?.user?.role || "").toLowerCase();
    if (!["admin", "contador"].includes(appRole)) {
      return res.status(403).json({ error: "forbidden_admin_or_contador_only" });
    }
    const { guideId } = req.params;
    try {
      const guide = await prisma.guide.findFirst({
        where: { id: String(guideId) },
        select: { id: true, portalClientId: true },
      });
      if (!guide) {
        return res.status(404).json({ ok: false, error: "guide_not_found" });
      }
      await prisma.guide.delete({ where: { id: guide.id } });
      return res.json({ ok: true, guideId: guide.id });
    } catch (err) {
      log.error({ err }, "Falha ao excluir guia");
      return res.status(500).json({ ok: false, error: "guide_delete_failed", message: err?.message });
    }
  });

  // Q17: marcar "não há guia neste mês" (Vazio) — ausência confirmada (campo amarelo).
  // Cria/garante uma Guide marcadora status="VAZIO" (sem PDF) por (empresa, tipo, competência).
  router.post("/guides/vazio", requireAccountType("FIRM"), async (req, res) => {
    const appRole = String(req.auth?.user?.role || "").toLowerCase();
    if (!["admin", "contador"].includes(appRole)) {
      return res.status(403).json({ error: "forbidden_admin_or_contador_only" });
    }
    const portalClientId = String(req.body?.portalClientId || "").trim();
    const tipo = normalizeGuideType(req.body?.tipo);
    const competencia = normalizeCompetencia(req.body?.competencia || "");
    if (!portalClientId) return res.status(400).json({ ok: false, error: "portal_client_id_required" });
    if (!competencia) return res.status(400).json({ ok: false, error: "competencia_invalida" });
    if (await isMonthClosed(portalClientId, competencia)) {
      return res.status(409).json({ ok: false, error: "mes_fechado", message: "Mês fechado — reabra a empresa para alterar guias desta competência." });
    }
    try {
      // Idempotente: se já existe guia (qualquer status) pra (empresa, tipo, competência),
      // não sobrescreve uma guia real PROCESSED; só cria o marcador VAZIO quando não há guia real.
      const existing = await prisma.guide.findFirst({
        where: { portalClientId, tipo, competencia },
        select: { id: true, status: true },
      });
      if (existing && existing.status === "PROCESSED") {
        return res.status(409).json({ ok: false, error: "guide_already_present" });
      }
      const guide = existing
        ? await prisma.guide.update({
            where: { id: existing.id },
            data: { status: "VAZIO", source: "MANUAL", reviewedByUserId: req.auth?.user?.id || null, reviewedAt: new Date() },
          })
        : await prisma.guide.create({
            data: {
              portalClientId, tipo, competencia,
              status: "VAZIO", source: "MANUAL",
              reviewedByUserId: req.auth?.user?.id || null, reviewedAt: new Date(),
            },
          });
      return res.json({ ok: true, guideId: guide.id, status: guide.status });
    } catch (err) {
      log.error({ err }, "Falha ao marcar guia como Vazio");
      return res.status(500).json({ ok: false, error: "guide_vazio_failed", message: err?.message });
    }
  });

  // Desfaz o "Vazio" (volta a faltar): remove o marcador VAZIO da competência/tipo.
  router.delete("/guides/vazio", requireAccountType("FIRM"), async (req, res) => {
    const appRole = String(req.auth?.user?.role || "").toLowerCase();
    if (!["admin", "contador"].includes(appRole)) {
      return res.status(403).json({ error: "forbidden_admin_or_contador_only" });
    }
    const portalClientId = String(req.body?.portalClientId || req.query?.portalClientId || "").trim();
    const tipo = normalizeGuideType(req.body?.tipo || req.query?.tipo);
    const competencia = normalizeCompetencia(req.body?.competencia || req.query?.competencia || "");
    if (!portalClientId || !competencia) {
      return res.status(400).json({ ok: false, error: "params_required" });
    }
    try {
      const result = await prisma.guide.deleteMany({
        where: { portalClientId, tipo, competencia, status: "VAZIO" },
      });
      return res.json({ ok: true, removed: result.count });
    } catch (err) {
      log.error({ err }, "Falha ao desfazer Vazio");
      return res.status(500).json({ ok: false, error: "guide_vazio_undo_failed", message: err?.message });
    }
  });

  // Q17: guias ESPERADAS da competência (por regime/prolabore) + estado de cada uma
  // (present/vazio/missing) — alimenta a aba de Guias (lista pré-preenchida + botão Vazio).
  router.get("/companies/:companyId/guides/expected", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const competencia = normalizeCompetencia(req.query?.competencia || "") || getReferenceCompetencia();
    try {
      const portal = await prisma.portalClient.findUnique({
        where: { id: portalClientId },
        select: { id: true, hasProlabore: true, companyId: true },
      });
      if (!portal) return res.status(404).json({ ok: false, error: "company_not_found" });
      const legacy = portal.companyId
        ? await prisma.company.findUnique({
            where: { id: portal.companyId },
            select: { regimeTributario: true, tipoTributario: true },
          })
        : null;
      const map = await computeGuideComplianceMap(
        [{ portalId: portal.id, hasProlabore: Boolean(portal.hasProlabore), legacy }],
        competencia,
      );
      const compliance = map.get(portal.id) || null;
      return res.json({ ok: true, competencia, compliance });
    } catch (err) {
      log.error({ err }, "Falha ao listar guias esperadas");
      return res.status(500).json({ ok: false, error: "expected_guides_failed", message: err?.message });
    }
  });

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

  // GET /guides/batch-report
  // Retorna a matriz "empresa x tipo de guia" para a competência informada (default = referência atual).
  // Cada empresa traz `tiposGuias` indicando, por tipo (DAS/INSS/IRPJ/CSLL/PIS_COFINS/ISS/FGTS/PARC_DAS),
  // se há guia pendente de envio (presente = capturada/pendente, null = não capturada).
  // Frontend separa as empresas em 2 seções (Simples × Presumidos) e mostra colunas por regime.
  router.get("/guides/batch-report", requireAccountType("FIRM"), async (req, res) => {
    const appRole = String(req.auth.user.role || "").toLowerCase();
    const isAdminLike = ["admin", "contador"].includes(appRole);
    // Q10.3: competência é OPCIONAL. Sem filtro, retorna todas as guides pending de qualquer
    // competência. Default mantido como `getReferenceCompetencia()` quando precisamos de um
    // contexto (parcelamentos por competência), mas as guides não filtram mais.
    const competenciaFilter = String(req.query.competencia || "").trim();
    const ref = competenciaFilter || getReferenceCompetencia();

    // Escopo de acesso: admin/contador vê todas as PortalClient; demais só as com CompanyFirmAccess ativo.
    let scopeWhere = {};
    if (!isAdminLike) {
      const links = await prisma.companyFirmAccess.findMany({
        where: { userId: String(req.auth.user.id), status: "ACTIVE" },
        select: { companyId: true },
      });
      const portalIds = links.map((l) => String(l.companyId)).filter(Boolean);
      if (!portalIds.length) {
        return res.json({ competencia: ref, simples: [], presumidos: [] });
      }
      scopeWhere = { id: { in: portalIds } };
    }

    // PortalClient não tem relação direta com Company no Prisma — só `companyId` (FK).
    // Fazemos 2 queries e damos merge em memória por companyId.
    const portalRows = await prisma.portalClient.findMany({
      where: scopeWhere,
      select: { id: true, razao: true, cnpj: true, companyId: true },
      orderBy: { razao: "asc" },
    });
    if (!portalRows.length) {
      return res.json({ competencia: ref, simples: [], presumidos: [] });
    }
    const legacyCompanyIds = portalRows.map((p) => p.companyId).filter(Boolean);
    const legacyCompanies = legacyCompanyIds.length > 0
      ? await prisma.company.findMany({
          where: { id: { in: legacyCompanyIds } },
          select: { id: true, regimeTributario: true, tipoTributario: true },
        })
      : [];
    const legacyMap = new Map(legacyCompanies.map((c) => [c.id, c]));
    const companies = portalRows.map((p) => ({
      id: p.id,
      razao: p.razao,
      cnpj: p.cnpj,
      company: p.companyId ? legacyMap.get(p.companyId) || null : null,
    }));
    const portalIds = companies.map((c) => c.id);

    // Q10.3: guides PROCESSED pending. Filtro de competência só quando explicitamente passado.
    // Sem filtro, vem TODAS as guides pending de QUALQUER competência (incluindo emailStatus=null
    // pra retrocompat com guides antigos que ficaram sem o campo).
    // Q16: inclui ENVIADAS (SENT) também — pra a matriz mostrar 3 estados
    // (ausente=X / contendo guia / enviado). SENT é display-only (não selecionável).
    const guides = await prisma.guide.findMany({
      where: {
        portalClientId: { in: portalIds },
        // Q17: inclui marcadores VAZIO (ausência confirmada) — a matriz mostra "vazio"
        // amarelo distinto de "sem guia" (X), pra ficar claro que foi marcado vazio.
        status: { in: ["PROCESSED", "VAZIO"] },
        OR: [
          { emailStatus: { in: ["PENDING", "ERROR", "SENT"] } },
          { emailStatus: null },
        ],
        ...(competenciaFilter ? { competencia: competenciaFilter } : {}),
      },
      select: {
        id: true, portalClientId: true, tipo: true, competencia: true, valor: true, vencimento: true,
        status: true, emailStatus: true, emailSentAt: true, extracted: true,
      },
    });

    // Q10.3: lista de competências presentes nas guides (pra dropdown no frontend).
    const competenciasPresentes = [
      ...new Set(guides.map((g) => g.competencia).filter(Boolean)),
    ].sort().reverse(); // mais recente primeiro

    // Parcelamentos Simples Nacional ABERTOS — filtra pela competência se especificada,
    // senão pega TODAS abertas das mesmas competências que vieram nas guides.
    const competenciasParaParc = competenciaFilter
      ? [competenciaFilter]
      : competenciasPresentes.length > 0 ? competenciasPresentes : [ref];
    // Q16: parcelas em aberto vêm do model novo (Parcelamento) — linhas leves tipo="PARCELA"
    // de parcelamentos ATIVOS, com parcela aberta na competência.
    const parcelamentos = await prisma.accountingEntry.findMany({
      where: {
        portalClientId: { in: portalIds },
        tipo: "PARCELA",
        statusPagamento: "ABERTO",
        competencia: { in: competenciasParaParc },
        parcelamento: { is: { status: "ATIVO" } },
      },
      select: { id: true, portalClientId: true, competencia: true },
    });

    // Códigos DARF → coluna na matriz. PIS+COFINS agrupam na coluna "PIS_COFINS".
    const PIS_COFINS_CODES = new Set(["2172", "8109"]);
    const IRPJ_CODES = new Set(["2089", "2362", "2456", "0220"]);
    const CSLL_CODES = new Set(["2372", "2484", "6012"]);

    // Q10.3: chave agora é (companyId + competencia) — uma linha por empresa POR competência.
    function makeRow(c, competencia) {
      const regime = String(c.company?.regimeTributario || c.company?.tipoTributario || "").toUpperCase();
      return {
        portalClientId: c.id,
        razao: c.razao,
        cnpj: c.cnpj,
        regimeTributario: regime,
        competencia,
        tiposGuias: {
          DAS: null, INSS: null, IRPJ: null, CSLL: null,
          PIS_COFINS: null, ISS: null, FGTS: null, PARC_DAS: null,
        },
        pendingGuideIds: [],
      };
    }
    const companyById = new Map(companies.map((c) => [c.id, c]));
    const rowKey = (companyId, competencia) => `${companyId}::${competencia}`;
    const byKey = new Map();

    for (const g of guides) {
      const c = companyById.get(g.portalClientId);
      if (!c) continue;
      const key = rowKey(g.portalClientId, g.competencia);
      let row = byKey.get(key);
      if (!row) {
        row = makeRow(c, g.competencia);
        byKey.set(key, row);
      }
      // Q16: a guia de Simples é gravada como tipo "SIMPLES"; a coluna da matriz é "DAS".
      const rawUpper = String(g.tipo || "").toUpperCase();
      const upper = rawUpper === "SIMPLES" ? "DAS" : rawUpper;
      const isVazio = g.status === "VAZIO";
      const stamp = {
        guideId: g.id,
        valor: g.valor != null ? Number(g.valor) : null,
        vencimento: g.vencimento,
        // Q17: vazio = ausência confirmada (sem PDF). Frontend mostra amarelo "vazio".
        vazio: isVazio,
        emailStatus: g.emailStatus || null,
        emailSentAt: g.emailSentAt || null,
      };

      if (upper === "DARF") {
        const composicao = Array.isArray(g.extracted?.composicao) ? g.extracted.composicao : [];
        for (const c2 of composicao) {
          const codigo = String(c2.codigo || "");
          if (PIS_COFINS_CODES.has(codigo)) row.tiposGuias.PIS_COFINS = { ...stamp, codigo };
          else if (IRPJ_CODES.has(codigo)) row.tiposGuias.IRPJ = { ...stamp, codigo };
          else if (CSLL_CODES.has(codigo)) row.tiposGuias.CSLL = { ...stamp, codigo };
        }
      } else if (upper === "PIS" || upper === "COFINS") {
        row.tiposGuias.PIS_COFINS = stamp;
      } else if (row.tiposGuias[upper] !== undefined) {
        row.tiposGuias[upper] = stamp;
      }
      // Só guias REAIS ainda NÃO enviadas entram na seleção de envio em lote.
      // Marcadores VAZIO não são enviáveis (não têm PDF).
      if (g.emailStatus !== "SENT" && !isVazio) row.pendingGuideIds.push(g.id);
    }

    // Parcelamentos só são exibidos se existe ao menos 1 linha pra (empresa, competência).
    // Senão adicionar (cria linha só pra parcelamento) seria ruído visual.
    for (const p of parcelamentos) {
      const key = rowKey(p.portalClientId, p.competencia);
      const row = byKey.get(key);
      if (row) row.tiposGuias.PARC_DAS = { entryId: p.id, isParcelamento: true };
    }

    // Separa por regime, agora mantendo as múltiplas linhas (empresa+competência) por grupo.
    const simples = [];
    const presumidos = [];
    const outros = [];
    for (const row of byKey.values()) {
      if (row.regimeTributario === "SIMPLES") simples.push(row);
      else if (row.regimeTributario === "LUCRO_PRESUMIDO" || row.regimeTributario === "LUCRO_REAL") presumidos.push(row);
      else outros.push(row);
    }
    // Ordena cada grupo por competência desc, depois razão asc
    const sortRows = (arr) => arr.sort((a, b) => {
      if (a.competencia !== b.competencia) return b.competencia.localeCompare(a.competencia);
      return String(a.razao).localeCompare(String(b.razao));
    });
    sortRows(simples); sortRows(presumidos); sortRows(outros);

    return res.json({
      competencia: ref, // mantém pra retrocompat com clients antigos
      competenciasPresentes, // Q10.3: lista pra dropdown
      competenciaFiltro: competenciaFilter || null,
      simples, presumidos, outros,
    });
  });

  // POST /guides/batch-send
  // Recebe { items: [{ portalClientId, competencia }] } e dispara 1 e-mail por empresa
  // com todas as guias da competência anexadas (via sendCompanyGuidesEmail).
  router.post("/guides/batch-send", requireAccountType("FIRM"), async (req, res) => {
    const appRole = String(req.auth?.user?.role || "").toLowerCase();
    if (!["admin", "contador"].includes(appRole)) {
      return res.status(403).json({ error: "forbidden_admin_or_contador_only" });
    }
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) {
      return res.status(400).json({ ok: false, error: "items_required" });
    }
    const results = [];
    for (const it of items) {
      const portalClientId = String(it?.portalClientId || "").trim();
      const competencia = String(it?.competencia || "").trim();
      if (!portalClientId || !competencia) {
        results.push({ portalClientId, competencia, ok: false, error: "invalid_input" });
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await sendCompanyGuidesEmail({ portalClientId, competencia });
        results.push({ portalClientId, competencia, ok: true, ...r });
      } catch (err) {
        log.error({ err: err?.message || err, portalClientId, competencia }, "Falha no batch-send de e-mail");
        results.push({
          portalClientId, competencia, ok: false,
          error: err?.code || "GUIDE_EMAIL_SEND_FAILED",
          message: err?.message,
        });
      }
    }
    const sent = results.filter((r) => r.ok && r.status === "sent").length;
    return res.json({ ok: true, total: items.length, sent, results });
  });

  // Endpoint binário inline para visualização em iframe (modal de captura).
  // Diferente do /download (que retorna JSON com base64), este retorna o PDF cru
  // com Content-Type application/pdf — ideal para <iframe src=...>.
  router.get(
    "/companies/:companyId/guides/:guideId/file",
    requireFirmCompanyAccess(),
    async (req, res) => {
      const { companyId, guideId } = req.params || {};
      const guide = await prisma.guide.findFirst({
        where: { id: String(guideId), portalClientId: String(companyId) },
      });
      if (!guide) return res.status(404).json({ error: "not_found" });
      const buf = await getGuidePdfBuffer(guide);
      if (!buf?.length) return res.status(404).json({ error: "file_not_available" });
      res.setHeader("Content-Type", "application/pdf");
      // Q8.A.6: sanitiza filename pra evitar header injection (CRLF, aspas).
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${sanitizeFilename(guide.sourcePath || `guia-${guideId}.pdf`)}"`
      );
      res.setHeader("Cache-Control", "private, max-age=300");
      return res.send(buf);
    },
  );

  // Identifica/completa metadados de uma guia já no banco (status ERROR ou incompleta).
  // Usado quando o parser falhou e o contador precisa preencher tipo/competência/valor/vencimento.
  router.post(
    "/companies/:companyId/guides/:guideId/identify",
    requireFirmCompanyAccess(),
    async (req, res) => {
      const appRole = String(req.auth?.user?.role || "").toLowerCase();
      if (!["admin", "contador"].includes(appRole)) {
        return res.status(403).json({ error: "forbidden_admin_or_contador_only" });
      }
      const { companyId, guideId } = req.params || {};
      const guide = await prisma.guide.findFirst({
        where: { id: String(guideId), portalClientId: String(companyId) },
      });
      if (!guide) return res.status(404).json({ ok: false, error: "guide_not_found" });

      const body = req.body || {};
      const tipo = String(body.tipo || "").trim().toUpperCase() || null;
      const competencia = String(body.competencia || "").trim() || null;
      const valor = body.valor != null && body.valor !== "" ? Number(body.valor) : null;
      const vencimentoStr = body.vencimento ? String(body.vencimento).slice(0, 10) : null;
      const vencimento = vencimentoStr ? new Date(`${vencimentoStr}T00:00:00.000Z`) : null;

      if (!tipo || !competencia) {
        return res.status(400).json({ ok: false, error: "tipo_e_competencia_required" });
      }

      // Promove para PROCESSED quando os obrigatórios estão preenchidos.
      const updated = await prisma.guide.update({
        where: { id: guide.id },
        data: {
          tipo,
          competencia,
          ...(Number.isFinite(valor) ? { valor } : {}),
          ...(vencimento && !Number.isNaN(vencimento.getTime()) ? { vencimento } : {}),
          status: "PROCESSED",
          errors: [],
          // Marca como pendente de envio para o worker pegar (caso já tenha sido enviado errado, o user reabilita).
          emailStatus: guide.emailStatus === "SENT" ? guide.emailStatus : "PENDING",
        },
      });

      // Q5: gera provisão (DARF/IRPJ/CSLL/PIS/COFINS/ISS) a partir da guia identificada.
      // Best-effort: se falhar, só loga e segue.
      try {
        const { generateProvisionsFromGuide } = await import("../../application/accounting/GuideToProvisionService.js");
        await generateProvisionsFromGuide({ guideId: updated.id });
      } catch (provErr) {
        log.warn({ err: provErr?.message || provErr, guideId: updated.id }, "Falha ao gerar provisão pós-identify");
      }

      // Auto-send REMOVIDO. Guia fica em PENDING aguardando envio em lote.
      return res.json({ ok: true, guide: toGuideResponse(updated), emailDispatch: null });
    },
  );

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

      // Q5: gera provisão a partir da guia recém-atribuída.
      try {
        const { generateProvisionsFromGuide } = await import("../../application/accounting/GuideToProvisionService.js");
        await generateProvisionsFromGuide({ guideId: updated.id });
      } catch (provErr) {
        log.warn({ err: provErr?.message || provErr, guideId: updated.id }, "Falha ao gerar provisão pós-manual-assign");
      }

      return res.json({ ok: true, guide: toGuideResponse(updated) });
    }
  );

  router.post(
    "/guides/:guideId/confirm-payment",
    requireAccountType("FIRM"),
    async (req, res) => {
      const { guideId } = req.params || {};
      const scoped = await getGuideWithFirmAccess({ guideId, user: req.auth.user });
      if (!scoped.guide) return res.status(scoped.status).json({ error: scoped.error });
      if (scoped.guide.status !== "PROCESSED") {
        return res.status(400).json({ error: "guide_not_processed" });
      }

      // Q23/Q34: guia de parcela OU de INSS gera lançamento de BAIXA ao marcar como paga. Se o mês
      // contábil do pagamento (hoje) estiver fechado, BLOQUEIA o "pago" inteiro (não marca, não lança).
      const isParcela = Boolean(scoped.guide.parcelamentoId);
      const isInss = !isParcela && String(scoped.guide.tipo || "").toUpperCase() === "INSS";
      const now = new Date();
      const competenciaPagamento = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
      if ((isParcela || isInss) && (await isMonthClosed(scoped.guide.portalClientId, competenciaPagamento))) {
        return res.status(409).json({ error: "MES_FECHADO", competencia: competenciaPagamento });
      }

      const updated = await markGuidePaidManual({
        guideId: scoped.guide.id,
        userId: req.auth.user.id,
      });

      // Q23: para guia de parcela, gera a BAIXA (juros LIDO da composição), data = hoje. Best-effort:
      // falha aqui não desfaz o pagamento marcado, mas o aviso vai no payload.
      let parcelaBaixa = null;
      if (isParcela) {
        try {
          const { gerarPagamentoParcelaFromGuide } = await import(
            "../../application/accounting/parcelamento/ParcelamentoV2Service.js"
          );
          parcelaBaixa = await gerarPagamentoParcelaFromGuide({
            portalClientId: scoped.guide.portalClientId,
            guideId: scoped.guide.id,
            userId: req.auth.user.id,
          });
        } catch (err) {
          if (err?.code === "MES_FECHADO") {
            return res.status(409).json({ error: "MES_FECHADO", competencia: competenciaPagamento });
          }
          log.warn({ err: err?.message, guideId: scoped.guide.id }, "Falha ao gerar baixa de parcela (não crítico)");
          parcelaBaixa = { skipped: true, reason: err?.message || "erro" };
        }
      }

      // Q34: para guia de INSS, gera a BAIXA (D INSS a Recolher / C Caixa) — conta da folha do mês.
      let inssBaixa = null;
      if (isInss) {
        try {
          const { gerarPagamentoInssFromGuide } = await import(
            "../../application/accounting/InssPagamentoService.js"
          );
          inssBaixa = await gerarPagamentoInssFromGuide({
            portalClientId: scoped.guide.portalClientId,
            guideId: scoped.guide.id,
            userId: req.auth.user.id,
          });
        } catch (err) {
          if (err?.code === "MES_FECHADO") {
            return res.status(409).json({ error: "MES_FECHADO", competencia: competenciaPagamento });
          }
          log.warn({ err: err?.message, guideId: scoped.guide.id }, "Falha ao gerar baixa do INSS (não crítico)");
          inssBaixa = { skipped: true, reason: err?.message || "erro" };
        }
      }

      return res.json({ ok: true, guide: toGuideResponse(updated), parcelaBaixa, inssBaixa });
    }
  );

  router.post(
    "/guides/:guideId/recalculate",
    requireAccountType("FIRM"),
    async (req, res) => {
      const { guideId } = req.params || {};
      const scoped = await getGuideWithFirmAccess({ guideId, user: req.auth.user });
      if (!scoped.guide) return res.status(scoped.status).json({ error: scoped.error });
      if (scoped.guide.status !== "PROCESSED") {
        return res.status(400).json({ error: "guide_not_processed" });
      }
      if (!canGuideRecalculate(scoped.guide)) {
        return res.status(400).json({ error: "guide_recalculation_not_available" });
      }

      // Q29: vencida → DAS de cobrança (juros/multa); em aberto → DAS normal.
      const serviceId = isGuideOverdue(scoped.guide, new Date())
        ? SERPRO_PGDASD_SERVICE_COBRANCA
        : SERPRO_PGDASD_SERVICE_NORMAL;

      try {
        const result = await capturePgdasGuideForCompany({
          portalClientId: scoped.guide.portalClientId,
          competencia: scoped.guide.competencia,
          existingGuideId: scoped.guide.id,
          serviceId,
        });
        await markGuideOpenBySerpro({ guideId: result.guide.guideId });

        const emailResult = await runGuideEmailWorkerSelected({
          guideIds: [result.guide.guideId],
        });

        return res.json({
          ok: true,
          result,
          emailDispatch: emailResult,
        });
      } catch (err) {
        const code = err?.code || "SERPRO_PGDASD_RECALCULATE_FAILED";
        const message = err?.message || "Falha ao recalcular guia PGDAS-D no SERPRO.";

        if (
          [
            "SERPRO_PGDASD_DISABLED",
            "SERPRO_PGDASD_NO_DEBTS_FOUND",
            "SERPRO_PGDASD_NO_AMOUNT_DUE",
            "SERPRO_PGDASD_DECLARATION_NOT_TRANSMITTED",
            "SERPRO_INVALID_COMPETENCIA",
            "SERPRO_INVALID_CONTRATANTE_CNPJ",
            "SERPRO_INVALID_CONTRIBUINTE_CNPJ",
            "SERPRO_PROCURADOR_CNPJ_NOT_CONFIGURED",
            "SERPRO_AUTH_URL_NOT_CONFIGURED",
            "SERPRO_BASE_URL_NOT_CONFIGURED",
            "SERPRO_CONSUMER_KEY_NOT_CONFIGURED",
            "SERPRO_CONSUMER_SECRET_NOT_CONFIGURED",
            "SERPRO_CERTIFICATE_NOT_CONFIGURED",
            "SERPRO_CERT_FILE_NOT_FOUND",
            "SERPRO_CERT_PASSWORD_NOT_FOUND",
            "SERPRO_PGDASD_PDF_NOT_FOUND",
            "SERPRO_PGDASD_PDF_INVALID",
          ].includes(code)
        ) {
          const friendly = friendlyRecalcMessage(code, { competencia: scoped.guide.competencia }, message);
          return res.status(400).json({ ok: false, error: code, reason: friendly, message: friendly });
        }

        log.error({ err: err?.message || err, code, guideId }, "Falha no recalculo manual PGDAS-D");
        return res.status(502).json({ ok: false, error: code, reason: message, retryable: Boolean(err?.retryable) });
      }
    }
  );

  router.post(
    "/guides/:guideId/resend-email",
    requireAccountType("FIRM"),
    async (req, res) => {
      const { guideId } = req.params || {};
      const scoped = await getGuideWithFirmAccess({ guideId, user: req.auth.user });
      if (!scoped.guide) return res.status(scoped.status).json({ error: scoped.error });
      const guide = scoped.guide;
      if (guide.status !== "PROCESSED") {
        return res.status(400).json({
          error: "guide_not_processed",
          reason: "Reenvio de e-mail só é permitido para guias com status PROCESSED",
        });
      }
      if (!guide.portalClientId) {
        return res.status(400).json({ error: "guide_has_no_company", reason: "Guia sem empresa vinculada" });
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

      // Q10.2: reenvio é SÍNCRONO — não depende do worker rodar em background.
      // Permite ao contador clicar "Reenviar" e ter feedback imediato (SENT ou ERROR).
      try {
        const result = await runGuideEmailWorkerSelected({ guideIds: [updated.id] });
        const guideResult = Array.isArray(result?.guides) ? result.guides[0] : null;
        const sent = guideResult?.emailStatus === "SENT";
        return res.json({
          ok: true,
          guideId: updated.id,
          emailStatus: guideResult?.emailStatus || "PENDING",
          sent,
          message: sent
            ? "Guia reenviada com sucesso."
            : (guideResult?.emailLastError
              ? `Falha no reenvio: ${guideResult.emailLastError}`
              : "Tentativa de reenvio realizada. Verifique o status."),
        });
      } catch (err) {
        log.warn({ err: err?.message || err, guideId: updated.id }, "Falha no reenvio síncrono");
        return res.json({
          ok: true,
          guideId: updated.id,
          emailStatus: "PENDING",
          sent: false,
          message: "Reenvio em fila — não foi possível enviar agora. Verifique os logs.",
        });
      }
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
    "/companies/:companyId/serpro/pgdasd/capture",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalCompanyId = String(req.params.companyId || "").trim();
      const competencia = normalizeCompetencia(req.body?.competencia || req.query?.competencia || "");
      const contratanteCnpj = String(req.body?.contratanteCnpj || req.query?.contratanteCnpj || "").trim();
      const serviceId = String(req.body?.serviceId || req.query?.serviceId || "").trim() || null;

      if (!portalCompanyId) {
        return res.status(400).json({ ok: false, error: "company_id_required" });
      }
      if (!competencia) {
        return res.status(400).json({ ok: false, error: "competencia_required" });
      }

      try {
        const result = await capturePgdasGuideForCompany({
          portalClientId: portalCompanyId,
          competencia,
          contratanteCnpj: contratanteCnpj || undefined,
          serviceId,
        });

        // Auto-send REMOVIDO. Guia capturada do SERPRO fica em emailStatus=PENDING
        // aguardando envio em lote via página `Envio de e-mails em lote`.
        return res.json({ ok: true, result, emailDispatch: null });
      } catch (err) {
        const code = err?.code || "SERPRO_PGDASD_CAPTURE_FAILED";
        const message = err?.message || "Falha ao capturar guia PGDAS-D no SERPRO.";

        if (
          [
            "SERPRO_PGDASD_DISABLED",
            "SERPRO_PGDASD_NO_DEBTS_FOUND",
            "SERPRO_PGDASD_NO_AMOUNT_DUE",
            "SERPRO_PGDASD_DECLARATION_NOT_TRANSMITTED",
            "SERPRO_INVALID_COMPETENCIA",
            "SERPRO_INVALID_CONTRATANTE_CNPJ",
            "SERPRO_INVALID_CONTRIBUINTE_CNPJ",
            "SERPRO_PROCURADOR_CNPJ_NOT_CONFIGURED",
            "SERPRO_AUTH_URL_NOT_CONFIGURED",
            "SERPRO_BASE_URL_NOT_CONFIGURED",
            "SERPRO_CONSUMER_KEY_NOT_CONFIGURED",
            "SERPRO_CONSUMER_SECRET_NOT_CONFIGURED",
            "SERPRO_CERTIFICATE_NOT_CONFIGURED",
            "SERPRO_CERT_FILE_NOT_FOUND",
            "SERPRO_CERT_PASSWORD_NOT_FOUND",
          ].includes(code)
        ) {
          return res.status(400).json({ ok: false, error: code, reason: message });
        }

        if (code === "PORTAL_COMPANY_NOT_FOUND") {
          return res.status(404).json({ ok: false, error: code, reason: message });
        }

        log.error({ err: err?.message || err, code, portalCompanyId, competencia }, "Falha na captura manual PGDAS-D");
        return res.status(502).json({ ok: false, error: code, reason: message, retryable: Boolean(err?.retryable) });
      }
    }
  );

  router.post(
    "/companies/:companyId/serpro/inss/sync",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalCompanyId = String(req.params.companyId || "").trim();
      const competencia = String(req.body?.competencia || req.query?.competencia || "").trim();
      const contratanteCnpj = String(req.body?.contratanteCnpj || req.query?.contratanteCnpj || "").trim();

      if (!portalCompanyId) {
        return res.status(400).json({ ok: false, error: "company_id_required" });
      }
      if (!competencia) {
        return res.status(400).json({ ok: false, error: "competencia_required" });
      }

      try {
        // Q53: recálculo explícito NÃO pode sobrescrever guia já paga (o SERPRO devolveria o valor
        // com juros/multa, mesmo que o cliente tenha pago no prazo). Bloqueia antes de sincronizar.
        const existingInss = await prisma.guide.findFirst({
          where: { portalClientId: portalCompanyId, tipo: "INSS", competencia, status: "PROCESSED" },
          select: { paymentStatus: true },
        });
        if (existingInss && isGuidePaid(existingInss)) {
          return res.status(409).json({
            ok: false,
            error: "guia_inss_ja_paga",
            message: "Guia de INSS desta competência já está paga — recálculo bloqueado para não alterar o valor.",
          });
        }

        const result = await syncSerproInssForCompany({
          portalClientId: portalCompanyId,
          competencia,
          contratanteCnpj: contratanteCnpj || undefined,
        });

        // Auto-send REMOVIDO. Guia INSS fica em emailStatus=PENDING aguardando
        // envio em lote via página `Envio de e-mails em lote`.
        return res.json({ ok: true, result, emailDispatch: null });
      } catch (err) {
        const code = err?.code || "SERPRO_DCTFWEB_SYNC_FAILED";
        const message = err?.message || "Falha ao sincronizar INSS no SERPRO.";

        if (
          [
            "SERPRO_INVALID_COMPETENCIA",
            "SERPRO_PROCURADOR_CNPJ_NOT_CONFIGURED",
            "SERPRO_AUTH_URL_NOT_CONFIGURED",
            "SERPRO_BASE_URL_NOT_CONFIGURED",
            "SERPRO_CONSUMER_KEY_NOT_CONFIGURED",
            "SERPRO_CONSUMER_SECRET_NOT_CONFIGURED",
            "SERPRO_CERTIFICATE_NOT_CONFIGURED",
            "SERPRO_CERT_FILE_NOT_FOUND",
            "SERPRO_CERT_PASSWORD_NOT_FOUND",
            "SERPRO_DCTFWEB_PDF_NOT_FOUND",
            "SERPRO_DCTFWEB_PDF_INVALID",
          ].includes(code)
        ) {
          return res.status(400).json({ ok: false, error: code, reason: message });
        }

        if (code === "PORTAL_COMPANY_NOT_FOUND") {
          return res.status(404).json({ ok: false, error: code, reason: message });
        }

        log.error({ err: err?.message || err, code, portalCompanyId, competencia }, "Falha na sincronização de INSS SERPRO");
        return res.status(502).json({ ok: false, error: code, reason: message, retryable: Boolean(err?.retryable) });
      }
    }
  );

  // Q36: captura manual de parcelamento — itera os parcelamentos ATIVOS da empresa (mesmo where do
  // worker Stage 4). Ação explícita do contador → roda independente da flag INTEGRACAO_SERPRO_PARCELAMENTO.
  // Sem competência (o serviço itera internamente as parcelas geráveis).
  router.post(
    "/companies/:companyId/serpro/parcelamento/capture",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalCompanyId = String(req.params.companyId || "").trim();
      if (!portalCompanyId) {
        return res.status(400).json({ ok: false, error: "company_id_required" });
      }
      try {
        const parcelamentos = await prisma.parcelamento.findMany({
          where: {
            portalClientId: portalCompanyId,
            status: "ATIVO",
            numeroParcelamento: { not: null },
            aberturaEntryId: { not: null },
            grupo: { not: "outros" },
          },
          select: { id: true, tipo: true, numeroParcelamento: true, totalValue: true, principalTotal: true, valorMulta: true, jurosTotal: true, numParcelas: true },
        });
        if (!parcelamentos.length) {
          return res.json({ ok: true, parcelamentos: [], skipped: "sem_parcelamento_ativo" });
        }
        const results = [];
        for (const parc of parcelamentos) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const r = await capturarParcelaGuideForCompany({ portalClientId: portalCompanyId, parcelamento: parc });
            results.push({ id: parc.id, numeroParcelamento: parc.numeroParcelamento, parcelas: r?.parcelas || [], reason: r?.reason || null });
          } catch (err) {
            results.push({ id: parc.id, numeroParcelamento: parc.numeroParcelamento, status: "erro", reason: err?.code || err?.message });
          }
        }
        return res.json({ ok: true, parcelamentos: results });
      } catch (err) {
        const code = err?.code || "SERPRO_PARCELAMENTO_CAPTURE_FAILED";
        const message = err?.message || "Falha ao capturar parcelamento no SERPRO.";
        if (code === "PORTAL_COMPANY_NOT_FOUND") {
          return res.status(404).json({ ok: false, error: code, reason: message });
        }
        log.error({ err: err?.message || err, code, portalCompanyId }, "Falha na captura de parcelamento SERPRO");
        return res.status(502).json({ ok: false, error: code, reason: message });
      }
    }
  );

  // Q40 Fase A/B: confirmação de pagamento por empresa (PAGTOWEB). Ação manual do contador —
  // consulta o comprovante das guias OPEN (com numeroDocumento) e marca as pagas + gera a baixa.
  router.post(
    "/companies/:companyId/serpro/payment-confirmation",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalCompanyId = String(req.params.companyId || "").trim();
      const competencia = String(req.body?.competencia || req.query?.competencia || "").trim() || null;
      if (!portalCompanyId) {
        return res.status(400).json({ ok: false, error: "company_id_required" });
      }
      try {
        const result = await runPaymentConfirmationOnce({
          portalClientId: portalCompanyId,
          competencia,
          userId: req.auth?.user?.id || null,
          logger: log,
        });
        return res.json({ ok: true, result });
      } catch (err) {
        const code = err?.code || "SERPRO_PAYMENT_CONFIRMATION_FAILED";
        const message = err?.message || "Falha ao confirmar pagamento no SERPRO.";
        if (code === "SERPRO_PAGTOWEB_DISABLED") {
          return res.status(400).json({ ok: false, error: code, reason: "Confirmação de pagamento (PAGTOWEB) desabilitada. Ligue INTEGRACAO_SERPRO_PAGTOWEB após validar no sandbox." });
        }
        log.error({ err: err?.message || err, code, portalCompanyId }, "Falha na confirmação de pagamento SERPRO");
        return res.status(502).json({ ok: false, error: code, reason: message });
      }
    }
  );

  // Q41: leitura do último status fiscal gravado (SEM chamar o SERPRO). Usado pela aba Situação Fiscal
  // e pela página Pendências para exibir a última consulta sem custo de requisição.
  router.get(
    "/companies/:companyId/serpro/sitfis",
    requireFirmCompanyAccess(),
    async (req, res) => {
      const portalCompanyId = String(req.params.companyId || "").trim();
      if (!portalCompanyId) {
        return res.status(400).json({ ok: false, error: "company_id_required" });
      }
      const status = await prisma.companyFiscalStatus.findUnique({
        where: { portalClientId: portalCompanyId },
        select: { situacao: true, protocolo: true, relatorioPdfFileId: true, texto: true, checkedAt: true },
      });
      return res.json({ ok: true, status: status || null });
    }
  );

  // Q43.4: serve o PDF do relatório SITFIS (inline) para visualização/download. Sem chamar o SERPRO.
  router.get(
    "/companies/:companyId/serpro/sitfis/pdf",
    requireFirmCompanyAccess(),
    async (req, res) => {
      const portalCompanyId = String(req.params.companyId || "").trim();
      if (!portalCompanyId) return res.status(400).json({ error: "company_id_required" });
      const status = await prisma.companyFiscalStatus.findUnique({
        where: { portalClientId: portalCompanyId },
        select: { relatorioPdfFileId: true },
      });
      if (!status?.relatorioPdfFileId) return res.status(404).json({ error: "pdf_not_available" });
      try {
        const buf = await GuideStorageService.create().downloadBuffer({ key: status.relatorioPdfFileId });
        if (!buf?.length) return res.status(404).json({ error: "pdf_not_available" });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${sanitizeFilename(`situacao-fiscal-${portalCompanyId}.pdf`)}"`);
        res.setHeader("Cache-Control", "private, max-age=300");
        return res.send(buf);
      } catch (err) {
        log.warn({ err: err?.message, portalCompanyId }, "SITFIS: falha ao ler PDF do storage");
        return res.status(404).json({ error: "pdf_not_available" });
      }
    }
  );

  // Q40 Fase C: relatório de situação fiscal (SITFIS) por empresa. Resolve o polling inline (≤~28s);
  // grava a última consulta em CompanyFiscalStatus. Se não ficar pronto, responde processando=true.
  router.post(
    "/companies/:companyId/serpro/sitfis/relatorio",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalCompanyId = String(req.params.companyId || "").trim();
      if (!portalCompanyId) {
        return res.status(400).json({ ok: false, error: "company_id_required" });
      }
      try {
        const portal = await prisma.portalClient.findUnique({
          where: { id: portalCompanyId },
          select: { id: true, cnpj: true },
        });
        if (!portal) return res.status(404).json({ ok: false, error: "company_not_found" });

        // Q43.7: reusa o protocolo do dia (evita novo /Apoiar → reduz o limite AV02 por contratante).
        let protocoloExistente = null;
        try {
          const prev = await prisma.companyFiscalStatus.findUnique({
            where: { portalClientId: portal.id },
            select: { protocolo: true, checkedAt: true },
          });
          if (prev?.protocolo && prev.checkedAt) {
            const spDay = (d) => new Intl.DateTimeFormat("en-CA", {
              timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
            }).format(d);
            if (spDay(prev.checkedAt) === spDay(new Date())) protocoloExistente = prev.protocolo;
          }
        } catch { /* best-effort: sem reuso, segue com /Apoiar */ }

        const result = await obterSitfisRelatorio({ contribuinteCnpj: portal.cnpj, tipo: 2, protocoloExistente, logger: log });
        // Q43.5: o relatório SITFIS vem só como PDF (dados.pdf) — extrai o texto para a heurística
        // de pendência funcionar (senão a situação cairia sempre em REGULAR por falta de texto).
        const pdfText = result.relatorioTexto ? "" : await extractSitfisPdfText(result.relatorioPdfBuffer);
        // Q41: deriva a situação fiscal por palavra-chave (best-effort — verificadoTrial:false).
        const situacao = deriveSituacaoFiscal(result, pdfText);
        // Guarda o texto extraído (trunca para não inflar a linha) — alimenta a página Pendências.
        const textoRelatorio = result.relatorioTexto || (pdfText ? pdfText.slice(0, 20000) : null);

        let relatorioPdfFileId = null;
        if (result.relatorioPdfBuffer?.length) {
          try {
            const storage = GuideStorageService.create();
            const key = `serpro/sitfis/${portal.id}/${Date.now()}.pdf`;
            const uploaded = await storage.upload({ key, buffer: result.relatorioPdfBuffer, contentType: "application/pdf" });
            relatorioPdfFileId = uploaded.key;
          } catch (err) {
            log.warn({ err: err?.message, portalCompanyId }, "SITFIS: falha ao salvar PDF (segue)");
          }
        }

        // Q43.7: quando a consulta ainda está "processando" (sem relatório novo), PRESERVAMOS o último
        // relatório/situação já gravados e só atualizamos o protocolo (se obtido) + checkedAt — assim o
        // protocolo do dia fica salvo para reuso até expirar, e não apagamos o relatório anterior.
        const temRelatorioNovo = Boolean(relatorioPdfFileId || textoRelatorio);
        const updateData = {
          tipo: 2,
          // protocolo: só sobrescreve quando temos um novo; senão mantém o salvo (|| undefined = não altera).
          protocolo: result.protocolo || undefined,
          checkedAt: new Date(),
        };
        if (temRelatorioNovo || !result.processando) {
          // Consulta concluída (com relatório) ou sem indicação de processando → atualiza o resultado.
          updateData.situacao = situacao;
          updateData.relatorioPdfFileId = relatorioPdfFileId;
          updateData.texto = textoRelatorio;
          updateData.rawPayload = result.rawPayload || undefined;
        }
        // (processando sem relatório novo → não toca em situacao/pdf/texto: mantém o último conhecido)

        await prisma.companyFiscalStatus.upsert({
          where: { portalClientId: portal.id },
          create: {
            portalClientId: portal.id,
            tipo: 2,
            situacao,
            protocolo: result.protocolo || null,
            relatorioPdfFileId,
            texto: textoRelatorio,
            rawPayload: result.rawPayload || undefined,
            checkedAt: new Date(),
          },
          update: updateData,
        });

        return res.json({
          ok: true,
          processando: Boolean(result.processando),
          situacao,
          protocolo: result.protocolo || null,
          relatorioPdfFileId,
          relatorioTexto: textoRelatorio,
          mensagem: result.mensagem || null,
          verificadoTrial: result.verificadoTrial,
        });
      } catch (err) {
        const code = err?.code || "SERPRO_SITFIS_FAILED";
        const message = err?.message || "Falha ao consultar a situação fiscal (SITFIS).";
        if (code === "SERPRO_SITFIS_DISABLED") {
          return res.status(400).json({ ok: false, error: code, reason: "Situação fiscal (SITFIS) desabilitada. Ligue INTEGRACAO_SERPRO_SITFIS após validar no sandbox." });
        }
        log.error({ err: err?.message || err, code, portalCompanyId }, "Falha na consulta SITFIS");
        return res.status(502).json({ ok: false, error: code, reason: message });
      }
    }
  );

  router.get(
    "/companies/:companyId/serpro/procuration",
    requireFirmCompanyAccess(),
    async (req, res) => {
      const portalCompanyId = String(req.params.companyId || "").trim();
      if (!portalCompanyId) {
        return res.status(400).json({ ok: false, error: "company_id_required" });
      }
      const result = await getStoredProcurationStatus(portalCompanyId);
      return res.json({ ok: true, result });
    }
  );

  router.post(
    "/companies/:companyId/serpro/procuration/check",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalCompanyId = String(req.params.companyId || "").trim();
      const contratanteCnpj = String(req.body?.contratanteCnpj || req.query?.contratanteCnpj || "").trim();

      if (!portalCompanyId) {
        return res.status(400).json({ ok: false, error: "company_id_required" });
      }

      try {
        const service = new SerproProcurationService();
        const result = await service.checkCompanyProcuration({
          portalClientId: portalCompanyId,
          contratanteCnpj: contratanteCnpj || undefined,
        });
        return res.json({ ok: true, result });
      } catch (err) {
        const code = err?.code || "SERPRO_PROCURATION_CHECK_FAILED";
        const message = err?.message || "Falha ao consultar procuração no SERPRO.";

        if (
          [
            "SERPRO_PGDASD_DISABLED",
            "SERPRO_PROCURADOR_CNPJ_NOT_CONFIGURED",
            "SERPRO_AUTH_URL_NOT_CONFIGURED",
            "SERPRO_BASE_URL_NOT_CONFIGURED",
            "SERPRO_CONSUMER_KEY_NOT_CONFIGURED",
            "SERPRO_CONSUMER_SECRET_NOT_CONFIGURED",
            "SERPRO_CERTIFICATE_NOT_CONFIGURED",
            "SERPRO_CERT_FILE_NOT_FOUND",
            "SERPRO_CERT_PASSWORD_NOT_FOUND",
          ].includes(code)
        ) {
          return res.status(400).json({ ok: false, error: code, reason: message });
        }

        if (code === "PORTAL_COMPANY_NOT_FOUND") {
          return res.status(404).json({ ok: false, error: code, reason: message });
        }

        log.error({ err: err?.message || err, code, portalCompanyId }, "Falha na consulta manual de procuração SERPRO");
        return res.status(502).json({ ok: false, error: code, reason: message, retryable: Boolean(err?.retryable) });
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

  // Q8.B: rota POST /dev/guides/reset-hash removida (apagava TODAS as guides do banco;
  // perigoso mesmo em dev — admin distraído destruía o estado de testes).

  router.post(
    "/companies/:companyId/fiscal/run",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalCompanyId = String(req.params.companyId || "").trim();
      const action = String(req.body?.action || "").trim().toLowerCase();
      const competencia = normalizeCompetencia(req.body?.competencia || req.query?.competencia || "");
      const contratanteCnpj = String(req.body?.contratanteCnpj || req.query?.contratanteCnpj || "").trim() || null;
      const serviceId = String(req.body?.serviceId || req.query?.serviceId || "").trim() || null;

      if (!portalCompanyId) {
        return res.status(400).json({ ok: false, error: "company_id_required" });
      }
      if (!action) {
        return res.status(400).json({ ok: false, error: "action_required" });
      }
      if (!competencia) {
        return res.status(400).json({ ok: false, error: "competencia_required" });
      }

      try {
        const fiscalService = new FiscalManualRunService();
        const result = await fiscalService.executeAction(action, portalCompanyId, competencia, {
          contratanteCnpj: contratanteCnpj || undefined,
          serviceId: serviceId || undefined,
        });

        return res.json({ ok: true, result });
      } catch (err) {
        const code = err?.code || "FISCAL_ACTION_FAILED";
        const message = err?.message || "Falha ao executar ação fiscal.";

        const knownErrors = [
          "INVALID_COMPETENCIA",
          "UNKNOWN_FISCAL_ACTION",
          "SERPRO_PGDASD_DISABLED",
          "SERPRO_PGDASD_NO_DEBTS_FOUND",
          "SERPRO_PGDASD_NO_AMOUNT_DUE",
          "SERPRO_PGDASD_DECLARATION_NOT_TRANSMITTED",
          "SERPRO_INVALID_COMPETENCIA",
          "SERPRO_INVALID_CONTRATANTE_CNPJ",
          "SERPRO_INVALID_CONTRIBUINTE_CNPJ",
          "SERPRO_PROCURADOR_CNPJ_NOT_CONFIGURED",
          "SERPRO_AUTH_URL_NOT_CONFIGURED",
          "SERPRO_BASE_URL_NOT_CONFIGURED",
          "SERPRO_CONSUMER_KEY_NOT_CONFIGURED",
          "SERPRO_CONSUMER_SECRET_NOT_CONFIGURED",
          "SERPRO_CERTIFICATE_NOT_CONFIGURED",
          "SERPRO_CERT_FILE_NOT_FOUND",
          "SERPRO_CERT_PASSWORD_NOT_FOUND",
        ];

        if (knownErrors.includes(code)) {
          return res.status(400).json({ ok: false, error: code, reason: message });
        }

        if (code === "PORTAL_COMPANY_NOT_FOUND") {
          return res.status(404).json({ ok: false, error: code, reason: message });
        }

        log.error(
          { err: err?.message || err, code, portalCompanyId, competencia, action },
          "Falha na execução da ação fiscal manual"
        );
        return res.status(502).json({ ok: false, error: code, reason: message, retryable: Boolean(err?.retryable) });
      }
    }
  );

  router.get(
    "/companies/:companyId/fiscal/executions",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalCompanyId = String(req.params.companyId || "").trim();
      const competencia = String(req.query.competencia || "").trim() || null;
      const action = String(req.query.action || "").trim() || null;
      const limitRaw = parseInt(req.query.limit, 10);
      const limit = isNaN(limitRaw) ? 20 : Math.min(Math.max(limitRaw, 1), 100);

      if (!portalCompanyId) {
        return res.status(400).json({ ok: false, error: "company_id_required" });
      }

      try {
        const where = { portalClientId: portalCompanyId };
        if (competencia) where.competencia = competencia;
        if (action) where.action = action;

        const data = await prisma.fiscalExecutionLog.findMany({
          where,
          orderBy: { startedAt: "desc" },
          take: limit,
        });

        return res.json({ ok: true, data });
      } catch (err) {
        log.error({ err: err?.message || err, portalCompanyId }, "Falha ao buscar histórico de execuções fiscais");
        return res.status(500).json({ ok: false, error: "EXECUTIONS_FETCH_FAILED" });
      }
    }
  );

  const accountingEntriesRouter = createAccountingEntriesRouter({ log });
  router.use("/companies/:companyId", accountingEntriesRouter);

  // Q12.A.3: módulo Notas Fiscais (procurações, competências, pendências)
  const notasRouter = createNotasRouter({ log });
  router.use("/companies/:companyId", notasRouter);

  // Q14.2.d: Apuração v2 — cadastro fiscal, produtos/serviços, pendências, classificar v2
  const apuracaoV2Router = createApuracaoV2Router({ log });
  router.use("/companies/:companyId", apuracaoV2Router);

  // Q12.C.2: Apuração global — todas as empresas em uma página
  // GET /firm/apuracao?competencia=YYYY-MM&search=...
  router.get("/apuracao", async (req, res) => {
    const userId = String(req.auth.user.id);
    const appRole = String(req.auth.user.role || "").toLowerCase();
    const isAdminLike = appRole === "admin" || appRole === "contador";
    const competencia = String(req.query.competencia || "").trim();
    const search = String(req.query.search || "").trim();

    if (!/^\d{4}-\d{2}$/.test(competencia)) {
      return res.status(400).json({ ok: false, error: "invalid_competencia", message: "competência YYYY-MM obrigatória" });
    }

    // Lista empresas que o usuário pode ver
    const companiesWhere = isAdminLike
      ? { status: { not: "SUSPENSA" } }
      : { status: { not: "SUSPENSA" }, firmAccess: { some: { userId } } };

    if (search) {
      companiesWhere.OR = [
        { razao: { contains: search, mode: "insensitive" } },
        { cnpj: { contains: search.replace(/\D+/g, "") } },
      ];
    }

    const companies = await prisma.portalClient.findMany({
      where: companiesWhere,
      orderBy: { razao: "asc" },
      select: { id: true, razao: true, cnpj: true },
      take: 500,
    });
    const ids = companies.map((c) => c.id);
    if (ids.length === 0) return res.json({ ok: true, competencia, items: [] });

    // Q15: estado/DAS vêm do ApuracaoSnapshot (fluxo novo). Circular fica só pra rb12 legado.
    const snapshots = await prisma.apuracaoSnapshot.findMany({
      where: { portalClientId: { in: ids }, competencia },
      select: {
        portalClientId: true, estado: true, dasCalculadoLocal: true, dasRetornadoSerpro: true,
        rbt12: true, fatorR: true, receitaInterna: true, receitaExterna: true,
        numeroDeclaracao: true, fechadaEm: true,
      },
    });
    const snapByPc = new Map(snapshots.map((s) => [s.portalClientId, s]));
    // Estados de competência (legado — mantido só pra compat de rb12)
    const circulars = await prisma.companyMonthlyCircular.findMany({
      where: { portalClientId: { in: ids }, competencia },
      select: {
        portalClientId: true, estado: true, lockedAt: true,
        rb12: true, fs12Manual: true, fatorR: true,
      },
    });
    const byPc = new Map(circulars.map((c) => [c.portalClientId, c]));

    // Range do mês pra contar notas/somar receita
    const [yy, mm] = competencia.split("-").map(Number);
    const start = new Date(Date.UTC(yy, mm - 1, 1));
    const end = new Date(Date.UTC(yy, mm, 1));

    // Notas agregadas por empresa (mês corrente)
    const notas = await prisma.portalInvoice.findMany({
      where: { clientId: { in: ids }, competencia: { gte: start, lt: end } },
      select: { clientId: true, papel: true, type: true, total: true, statusEfetivo: true },
    });
    const aggByPc = new Map();
    for (const n of notas) {
      const agg = aggByPc.get(n.clientId) || { totalNotas: 0, receitaEmitida: 0, comprasRecebidas: 0, byType: { NFE: 0, NFSE: 0 } };
      agg.totalNotas++;
      agg.byType[n.type] = (agg.byType[n.type] || 0) + 1;
      const v = n.total ? Number(n.total) : 0;
      if (n.papel === "EMIT") agg.receitaEmitida += v;
      else if (n.papel === "DEST") agg.comprasRecebidas += v;
      aggByPc.set(n.clientId, agg);
    }

    // Pendências
    const pends = await prisma.pendenciaPosFechamento.groupBy({
      by: ["portalClientId"],
      where: { portalClientId: { in: ids }, competencia, resolvida: false },
      _count: { _all: true },
    });
    const pendByPc = new Map(pends.map((p) => [p.portalClientId, p._count._all]));

    // Q12.B+++.7: lastSync DFe/ADN pra mostrar staleness na tabela
    const syncStates = await prisma.portalSyncState.findMany({
      where: { clientId: { in: ids } },
      select: { clientId: true, dfeLastSyncAt: true, adnLastSyncAt: true },
    });
    const syncByPc = new Map(syncStates.map((s) => [s.clientId, s]));

    const items = companies.map((c) => {
      const circ = byPc.get(c.id);
      const snap = snapByPc.get(c.id);
      const agg = aggByPc.get(c.id) || { totalNotas: 0, receitaEmitida: 0, comprasRecebidas: 0, byType: {} };
      const syncState = syncByPc.get(c.id);
      return {
        portalClientId: c.id,
        razao: c.razao,
        cnpj: c.cnpj,
        regime: null,
        // Q15: estado vem do snapshot (aberta/configurando/calculada/fechada/transmitida)
        estado: snap?.estado || "aberta",
        dasCalculado: snap?.dasCalculadoLocal != null ? Number(snap.dasCalculadoLocal) : null,
        dasTransmitido: snap?.dasRetornadoSerpro != null ? Number(snap.dasRetornadoSerpro) : null,
        numeroDeclaracao: snap?.numeroDeclaracao || null,
        fechadaEm: snap?.fechadaEm || null,
        rbt12: snap?.rbt12 != null ? Number(snap.rbt12) : (circ?.rb12 ? Number(circ.rb12) : null),
        fatorR: snap?.fatorR != null ? Number(snap.fatorR) : (circ?.fatorR ? Number(circ.fatorR) : null),
        totalNotas: agg.totalNotas,
        receitaEmitida: agg.receitaEmitida,
        comprasRecebidas: agg.comprasRecebidas,
        nfeCount: agg.byType.NFE || 0,
        nfseCount: agg.byType.NFSE || 0,
        pendenciasAbertas: pendByPc.get(c.id) || 0,
        dfeLastSyncAt: syncState?.dfeLastSyncAt || null,
        adnLastSyncAt: syncState?.adnLastSyncAt || null,
      };
    });

    return res.json({ ok: true, competencia, items });
  });

  // Q15.6: fila de transmissão em lote ao SERPRO
  // POST /firm/apuracao/batch  body: { portalClientIds:[], competencia }
  router.post("/apuracao/batch", async (req, res) => {
    const { portalClientIds, competencia } = req.body || {};
    if (!/^\d{4}-\d{2}$/.test(String(competencia || ""))) {
      return res.status(400).json({ ok: false, error: "invalid_competencia" });
    }
    try {
      const result = await criarBatchJob({
        portalClientIds, competencia, userId: req.auth?.user?.id,
      });
      return res.json({ ok: true, ...result });
    } catch (err) {
      log.warn({ err: err?.message }, "Falha ao criar batch de apuração");
      return res.status(err?.code === "NO_COMPANIES" || err?.code === "NONE_CLOSED" ? 400 : 500)
        .json({ ok: false, error: err?.code || "batch_failed", message: err?.message });
    }
  });

  // GET /firm/apuracao/batch/:jobId — progresso (polling)
  router.get("/apuracao/batch/:jobId", async (req, res) => {
    const jobId = String(req.params.jobId);
    try {
      const job = await prisma.apuracaoBatchJob.findUnique({ where: { id: jobId } });
      if (!job) return res.status(404).json({ ok: false, error: "job_not_found" });
      const items = await prisma.apuracaoBatchItem.findMany({
        where: { jobId },
        select: { portalClientId: true, status: true, dasValor: true, numeroDeclaracao: true, erroMensagem: true },
      });
      // enriquece com razão social
      const ids = items.map((i) => i.portalClientId);
      const empresas = await prisma.portalClient.findMany({ where: { id: { in: ids } }, select: { id: true, razao: true } });
      const razaoById = new Map(empresas.map((e) => [e.id, e.razao]));
      return res.json({
        ok: true,
        job: {
          id: job.id, status: job.status, competencia: job.competencia,
          totalEmpresas: job.totalEmpresas, okCount: job.okCount,
          errorCount: job.errorCount, pendenteCount: job.pendenteCount,
          concluidoEm: job.concluidoEm,
        },
        items: items.map((i) => ({ ...i, razao: razaoById.get(i.portalClientId) || i.portalClientId })),
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "batch_status_failed", message: err?.message });
    }
  });

  // Q44: POST /firm/apuracao/batch/:jobId/run-now — processa a fila SOB DEMANDA.
  // Antes o lote só era processado pelo worker de fundo (APURACAO_BATCH_WORKER_ENABLED); com a flag
  // OFF os itens ficavam "pendente" pra sempre (modal preso). Aqui drenamos os itens pendentes do job
  // inline (com teto de tempo/ciclos), pra o lote andar mesmo sem o worker ligado. Idempotente
  // (o worker faz consulta-antes-de-transmitir; item já "ok" é ignorado). ⚠ Transmite de verdade.
  router.post("/apuracao/batch/:jobId/run-now", async (req, res) => {
    const jobId = String(req.params.jobId);
    try {
      const job = await prisma.apuracaoBatchJob.findUnique({ where: { id: jobId } });
      if (!job) return res.status(404).json({ ok: false, error: "job_not_found" });

      const deadline = Date.now() + 20000; // teto inline; o front continua o polling/run-now se sobrar
      let ciclos = 0;
      for (;;) {
        const pendentes = await prisma.apuracaoBatchItem.count({
          where: { jobId, status: { in: ["pendente", "processando"] } },
        });
        if (pendentes === 0) break;
        if (Date.now() >= deadline || ciclos >= 50) break;
        // eslint-disable-next-line no-await-in-loop
        const { processados } = await runApuracaoBatchOnce();
        ciclos += 1;
        if (!processados) break; // nada pronto agora (ex.: itens em backoff) — evita loop quente
      }

      const atualizado = await prisma.apuracaoBatchJob.findUnique({ where: { id: jobId } });
      return res.json({
        ok: true,
        job: atualizado && {
          id: atualizado.id, status: atualizado.status, competencia: atualizado.competencia,
          totalEmpresas: atualizado.totalEmpresas, okCount: atualizado.okCount,
          errorCount: atualizado.errorCount, pendenteCount: atualizado.pendenteCount,
          concluidoEm: atualizado.concluidoEm,
        },
      });
    } catch (err) {
      log.warn({ err: err?.message, jobId }, "Falha ao processar batch de apuração (run-now)");
      return res.status(500).json({ ok: false, error: "batch_run_failed", message: err?.message });
    }
  });

  // ===========================================================================
  // Q48 — Download de notas em lote (ZIP em segundo plano)
  // O POST cria o job e responde na hora (processamento fire-and-forget no serviço);
  // o front acompanha por polling no GET e baixa o arquivo pronto em /arquivo.
  // ===========================================================================

  // POST /firm/notas-download  body: { companyIds:[], competenciaDe, competenciaAte, tipo?, papel? }
  router.post("/notas-download", async (req, res) => {
    const { companyIds, competenciaDe, competenciaAte, tipo, papel } = req.body || {};
    try {
      // Só empresas que existem (evita ids inventados no payload).
      const ids = Array.isArray(companyIds) ? companyIds.map(String).filter(Boolean) : [];
      const existentes = await prisma.portalClient.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      const validIds = existentes.map((c) => c.id);
      const result = await criarNotasDownloadJob({
        companyIds: validIds,
        competenciaDe,
        competenciaAte,
        tipo,
        papel,
        userId: req.auth?.user?.id,
      });
      return res.json(result);
    } catch (err) {
      const badCodes = ["COMPANIES_REQUIRED", "PERIODO_INVALIDO", "PERIODO_MUITO_LONGO"];
      log.warn({ err: err?.message }, "Falha ao criar download de notas");
      return res.status(badCodes.includes(err?.code) ? 400 : 500)
        .json({ ok: false, error: err?.code || "notas_download_failed", message: err?.message });
    }
  });

  // GET /firm/notas-download — últimos jobs ("Downloads recentes")
  router.get("/notas-download", async (_req, res) => {
    try {
      await cleanupNotasDownloadJobs();
      const jobs = await prisma.notasDownloadJob.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
      });
      return res.json({ ok: true, jobs: jobs.map(notasDownloadJobToResponse) });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "notas_download_list_failed", message: err?.message });
    }
  });

  // GET /firm/notas-download/:jobId — progresso (polling)
  router.get("/notas-download/:jobId", async (req, res) => {
    try {
      const job = await prisma.notasDownloadJob.findUnique({ where: { id: String(req.params.jobId) } });
      if (!job) return res.status(404).json({ ok: false, error: "job_not_found" });
      return res.json({ ok: true, job: notasDownloadJobToResponse(job) });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "notas_download_status_failed", message: err?.message });
    }
  });

  // GET /firm/notas-download/:jobId/arquivo — stream do ZIP pronto
  router.get("/notas-download/:jobId/arquivo", async (req, res) => {
    try {
      const job = await prisma.notasDownloadJob.findUnique({ where: { id: String(req.params.jobId) } });
      if (!job) return res.status(404).json({ ok: false, error: "job_not_found" });
      if (job.status === "expirado") return res.status(410).json({ ok: false, error: "expirado" });
      if (job.status !== "concluido" || !job.arquivoPath) {
        return res.status(409).json({ ok: false, error: "nao_concluido", status: job.status });
      }
      if (job.expiresAt && new Date(job.expiresAt) < new Date()) {
        return res.status(410).json({ ok: false, error: "expirado" });
      }
      if (!fsNotasDownload.existsSync(job.arquivoPath)) {
        return res.status(410).json({ ok: false, error: "arquivo_removido" });
      }
      res.setHeader("Content-Type", "application/zip");
      // Q8.A.6: sanitiza filename (defesa contra header injection).
      res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFilename(job.arquivoNome || `notas-${job.id}.zip`)}"`);
      if (job.arquivoBytes) res.setHeader("Content-Length", String(job.arquivoBytes));
      const stream = fsNotasDownload.createReadStream(job.arquivoPath);
      stream.on("error", () => { if (!res.headersSent) res.status(500).end(); else res.end(); });
      return stream.pipe(res);
    } catch (err) {
      log.warn({ err: err?.message }, "Falha no download do zip de notas");
      if (!res.headersSent) return res.status(500).json({ ok: false, error: "notas_download_file_failed" });
      return res.end();
    }
  });

  const accountingEntryRulesRouter = createAccountingEntryRulesRouter({ log });
  router.use("/accounting-entry-rules", accountingEntryRulesRouter);
  router.use("/companies/:companyId/accounting-entry-rules", accountingEntryRulesRouter);

  // ===========================================================================
  // Plano de Contas Global
  // ===========================================================================
  function requireAdminForGlobal(req, res) {
    if (!isAdminLikeUser(req.auth?.user)) {
      res.status(403).json({ error: "forbidden" });
      return false;
    }
    return true;
  }
  const VALID_TIPOS = ["ATIVO", "PASSIVO", "RECEITA", "DESPESA", "PATRIMONIO"];

  // GET /firm/chart-of-accounts/global/status
  // Indica se o plano de contas global tem cobertura mínima (5 tipos básicos) — pré-requisito para criar empresas.
  router.get("/chart-of-accounts/global/status", async (_req, res) => {
    try {
      const status = await getGlobalChartStatus();
      return res.json({ ok: true, ...status });
    } catch (err) {
      log.error({ err }, "Falha ao obter status do plano global");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  // GET /firm/chart-of-accounts/global
  router.get("/chart-of-accounts/global", async (req, res) => {
    if (!requireAdminForGlobal(req, res)) return;
    const accounts = await prisma.chartOfAccount.findMany({
      where: { portalClientId: null },
      orderBy: [{ tipo: "asc" }, { codigo: "asc" }],
    });
    return res.json({ data: accounts.map((a) => ({ ...a, scope: "GLOBAL" })) });
  });

  // POST /firm/chart-of-accounts/global
  router.post("/chart-of-accounts/global", async (req, res) => {
    if (!requireAdminForGlobal(req, res)) return;
    const body = req.body || {};
    const codigo = String(body.codigo || "").trim();
    const nome = String(body.nome || "").trim();
    const tipo = String(body.tipo || "DESPESA").toUpperCase();
    const natureza = String(body.natureza || "DEVEDORA").toUpperCase();

    if (!codigo) return res.status(400).json({ error: "codigo_required" });
    if (!nome) return res.status(400).json({ error: "nome_required" });
    if (!VALID_TIPOS.includes(tipo)) return res.status(400).json({ error: "tipo_invalido" });

    // Override semantic: empresa sempre vence sobre global. Não bloqueamos
    // criação global mesmo que alguma empresa já tenha o mesmo código —
    // a empresa simplesmente não verá esta conta global enquanto a sua existir.
    try {
      const account = await prisma.chartOfAccount.create({
        data: { portalClientId: null, codigo, nome, tipo, natureza, status: "PENDENTE_ERP" },
      });
      return res.status(201).json({ ok: true, account });
    } catch (err) {
      if (err?.code === "P2002") return res.status(409).json({ error: "codigo_ja_existe" });
      log.error({ err }, "Erro ao criar conta global");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // PATCH /firm/chart-of-accounts/global/:codigo
  router.patch("/chart-of-accounts/global/:codigo", async (req, res) => {
    if (!requireAdminForGlobal(req, res)) return;
    const codigo = String(req.params.codigo);
    const body = req.body || {};
    const existing = await prisma.chartOfAccount.findFirst({
      where: { portalClientId: null, codigo },
    });
    if (!existing) return res.status(404).json({ error: "conta_nao_encontrada" });

    const data = {};
    if (body.nome !== undefined) data.nome = String(body.nome).trim();
    if (body.tipo !== undefined) data.tipo = String(body.tipo).toUpperCase();
    if (body.natureza !== undefined) data.natureza = String(body.natureza).toUpperCase();
    if (body.status !== undefined && ["CONFIRMADA", "PENDENTE_ERP"].includes(String(body.status))) {
      data.status = String(body.status);
    }

    const updated = await prisma.chartOfAccount.update({
      where: { id: existing.id },
      data,
    });
    return res.json({ ok: true, account: updated });
  });

  // DELETE /firm/chart-of-accounts/global/:codigo
  router.delete("/chart-of-accounts/global/:codigo", async (req, res) => {
    if (!requireAdminForGlobal(req, res)) return;
    const codigo = String(req.params.codigo);
    const existing = await prisma.chartOfAccount.findFirst({
      where: { portalClientId: null, codigo },
    });
    if (!existing) return res.status(404).json({ error: "conta_nao_encontrada" });
    await prisma.chartOfAccount.delete({ where: { id: existing.id } });
    return res.json({ ok: true });
  });

  // POST /firm/chart-of-accounts/global/import (CSV ou PDF)
  router.post("/chart-of-accounts/global/import", upload.single("file"), async (req, res) => {
    if (!requireAdminForGlobal(req, res)) return;
    if (!req.file?.buffer) return res.status(400).json({ error: "file_required" });

    const result = await importChartOfAccountsFromBuffer({
      portalClientId: null,
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
    });
    if (!result.ok) {
      const status = result.error === "pdf_no_accounts_found" ? 422 : 500;
      if (result.error === "pdf_import_failed") log.error({ message: result.message }, "Erro ao importar plano global via PDF");
      return res.status(status).json(result);
    }
    return res.json(result);
  });

  router.use("/companies/:clientId/invoices/sync", syncRouter);
  router.use("/companies/:clientId/invoices", invoicesRouter);

  return router;
}

import { Router } from "express";
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
  // ⚠ A MESMA normalização que o PATCH do cadastro usa — ver a rota `emissao-nfse` mais abaixo.
  normalizeCamposEmissaoNfse,
} from "../../application/company/companyProfile.js";
import {
  companyUpdateSchema,
  validateCompanyInput,
} from "../../application/validators/companySchemas.js";
import { sanitizeFilename } from "../../lib/httpHeaders.js";
import { safeLogError } from "../../lib/safeLogError.js";
import { createPortalInvoicesRouter } from "../portalInvoices.js";
import { createPortalSyncRouter } from "../portalSync.js";
import { createAccountingEntriesRouter } from "./accountingEntries.js";
import { createConferenciaRouter } from "./conferencia.js";
import { createRecorrenciaRouter } from "./recorrencia.js";
import { createNotasRouter } from "./notas.js";
import { createApuracaoV2Router } from "./apuracaoV2.js";
import { createPlanejamentoRouter } from "./planejamento.js";
import { createCompanyDocumentsRouter } from "./companyDocuments.js";
import { createCompanyCredentialsRouter } from "./companyCredentials.js";
import { createPortalAccessRouter } from "./portalAccess.js";
import { createCalendarioRouter } from "./calendario.js";
import { createObrigacoesRouter } from "./obrigacoes.js";
import { createOnboardingsRouter } from "./onboardings.js";
import { createWhatsappGuiasRouter } from "./whatsappGuias.js";
import { empresasVisiveis } from "./empresasVisiveis.js";
import { mesclarAtividades } from "../../application/company/atividadesDaEmpresa.js";
import {
  DECISAO,
  decidirTrocaDeEmail,
  hashDeSenhaInutilizavel,
  STATUS_DA_CONTA_NOVA,
} from "../../application/companies/acessoDoResponsavel.js";
import { normalizarEmail } from "@contabilidade/shared/email";
import { comContextoSerpro, podeForcarSerpro } from "../../application/fiscal/serpro/serproCallContext.js";
import { consumoDoMes } from "../../application/fiscal/serpro/SerproCallGuard.js";
// Mesma definição de faturamento da apuração — a recusa de "marcar guia vazia" precisa concordar
// com a de "mês sem faturamento", senão as duas telas divergem sobre se o mês teve receita.
import { faturamentoEmitDaCompetencia } from "../../application/notas/apuracao/v2/FechamentoService.js";
import {
  computeFechamentoBlockers, SELECT_PARA_BLOQUEIOS, CHECKLIST_SELECT, checklistPendentes,
} from "../../application/accounting/fechamentoBlockers.js";
import { criarBatchJob, runApuracaoBatchOnce } from "../../workers/apuracaoBatchWorker.js";
// Q48: download de notas em lote (ZIP em segundo plano)
import fsNotasDownload from "node:fs";
import {
  criarNotasDownloadJob,
  cleanupNotasDownloadJobs,
  jobToResponse as notasDownloadJobToResponse,
} from "../../application/notas/download/NotasDownloadService.js";
import {
  criarNotasCapturaJob,
  getNotasCapturaJob,
  listNotasCapturaJobs,
} from "../../application/notas/captura/NotasCapturaService.js";
import {
  listarContatos, salvarContato, removerContato, ContatoWhatsappError, CANAL_PADRAO,
} from "../../application/whatsapp/ContatoWhatsappService.js";
import { capturaParadaPorEmpresa } from "../../application/notas/capturaParada.js";
import {
  criarSitfisDownloadJob,
  sitfisJobToResponse,
} from "../../application/fiscal/serpro/SitfisDownloadService.js";
import { createAccountingEntryRulesRouter } from "./accountingEntryRules.js";
import { importChartOfAccountsFromBuffer } from "../../application/accounting/chartOfAccountsImport.js";
import { rederivarAnaliticaDoEscopo } from "../../application/accounting/chartOfAccountsAnalitica.js";
// Plano de contas global: pré-requisito para criar empresa. Mora em `application/accounting`
// porque o provisionamento (chamado também pela conversão de onboarding) precisa da MESMA guarda.
import { getGlobalChartStatus } from "../../application/accounting/globalChartStatus.js";
// Criar empresa é UM ato com DUAS portas (botão "Nova empresa" e conversão de onboarding).
// O corpo mora no service; aqui fica só a porta HTTP.
import {
  CompanyProvisioningError,
  aplicarPosCriacao,
  provisionarEmpresa,
} from "../../application/companies/CompanyProvisioningService.js";
import {
  getFriendlyGuideMessage,
  getGuidePdfBuffer,
  hashPdf,
  listPendingGuidesReport,
  listGuidesByCompany,
  toPendingGuideReportItem,
  toGuideResponse,
  PUBLICO,
} from "../../application/guides/GuideService.js";
import { normalizeCompetencia, normalizeGuideType, colunaMatrizDaGuia, envioDeEmailFalhou } from "../../application/guides/guideContract.js";
// ⚠ As mensagens de "não foi enviado" moram no domínio, não aqui: era escrevendo-as no lugar de uso
// que a promessa de uma fila inexistente ganhou quatro cópias. Ver `guideEmailCopy.js`.
import {
  GUIA_AGUARDA_ENVIO_MANUAL,
  mensagemEnvioFalhou,
  mensagemEnvioNaoFeitoPorLock,
} from "../../application/guides/guideEmailCopy.js";
import { isMonthClosed } from "../../application/accounting/fechamentoContabil.js";
import {
  getGuideRuntimeSettings,
  updateGuideRuntimeSettings,
} from "../../application/guides/GuideRuntimeSettings.js";
import { runGuideEmailWorkerOnce, runGuideEmailWorkerSelected } from "../../workers/guideEmailWorker.js";
import { runSerproPgdasdWorkerOnce } from "../../workers/serproPgdasdWorker.js";
import { runSerproDctfwebWorkerOnce } from "../../workers/serproDctfwebWorker.js";
import { sendCompanyGuidesEmail, sendLatestGuidesEmailByCompany } from "../../application/guides/GuideCompanyEmailService.js";
import { liberarGuiasCliente, liberarGuiaCliente, revogarLiberacaoCliente } from "../../application/guides/GuideLiberacaoService.js";
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
  ROTINA_KEYS,
} from "../../application/fiscal/serpro/SerproRuntimeSettings.js";
import {
  listCompanyRotinas,
  saveCompanyRotinas,
  ROTINA_LABELS,
} from "../../application/fiscal/serpro/CompanyRotinasService.js";
import { capturePgdasGuideForCompany } from "../../application/fiscal/serpro/CaptureSerproGuidesService.js";
import { syncSerproInssForCompany, probeConsultarDeclaracaoCompleta, probeEmitirDarfDctfweb } from "../../application/fiscal/serpro/SerproDctfwebService.js";
import { SERPRO_DCTFWEB_LP_PROBE_ENABLED, INTEGRACAO_SERPRO_DCTFWEB_LP } from "../../config.js";
import { capturarLpDaCompetencia, reemitirDarfLp } from "../../application/fiscal/lp/LucroPresumidoProvisaoService.js";
import { capturarParcelaGuideForCompany } from "../../application/fiscal/serpro/CaptureSerproParcelaService.js";
import { getStoredProcurationStatus, SerproProcurationService } from "../../application/fiscal/serpro/SerproProcurationService.js";
// Q40: confirmação de pagamento (PAGTOWEB) + SITFIS.
import { runPaymentConfirmationOnce } from "../../application/fiscal/serpro/SerproPaymentConfirmationService.js";
import { runSerproPaymentConfirmationWorkerOnce } from "../../workers/serproPaymentConfirmationWorker.js";
import { obterRelatorio as obterSitfisRelatorio } from "../../application/fiscal/serpro/SerproSitfisService.js";
// ⚠ AS DUAS LEITURAS DO RELATÓRIO SITFIS ENTRAM POR AQUI.
// `parseSitfisRelatorio.js` continua VIVO e continua rodando em produção — ele deixou de ser
// importado direto nesta rota porque quem o chama agora é `montarRelatorioSitfis`, que o confronta
// com a leitura POSICIONAL do PDF. Ele é a SEGUNDA OPINIÃO, e o confronto é uma das três provas de
// fidelidade da posicional. Posicional vence quando fecha; cai para o texto quando não fecha.
import {
  lerLeituraPosicionalGravada,
  lerSitfisPosicional,
  montarRawPayloadComLeitura,
  montarRelatorioSitfis,
} from "../../application/fiscal/serpro/lerRelatorioSitfis.js";
// Heurística da situação fiscal: mora num módulo próprio porque o script de reclassificação usa
// exatamente a mesma regra (duplicar geraria situações divergentes).
import { deriveSituacaoFiscal } from "../../application/fiscal/serpro/sitfisSituacao.js";
import { GuideStorageService } from "../../application/guides/GuideStorageService.js";
import { FiscalManualRunService } from "../../application/fiscal/FiscalManualRunService.js";
import {
  computeGuideComplianceMap,
  getReferenceCompetencia,
} from "../../application/guides/guideCompliance.js";
import {
  canGuideRecalculate,
  isGuideOverdue,
  especieDoRecalculo,
  ESPECIE_RECALCULO,
  leituraDosAcrescimos,
  isGuidePaid,
  markGuideOpenBySerpro,
  markGuidePaidManual,
} from "../../application/guides/GuidePaymentStatusService.js";
import {
  SERPRO_PGDASD_SERVICE_COBRANCA,
  SERPRO_PGDASD_SERVICE_NORMAL,
} from "../../application/fiscal/serpro/SerproPgdasdService.js";

// C11: intervalo mínimo entre duas consultas SITFIS da MESMA empresa (4h). Abrir a aba mostra o
// relatório salvo; só o botão "Consultar" chama o SERPRO, e mesmo assim respeitando esta janela.
const SITFIS_MIN_INTERVALO_MS = 4 * 60 * 60 * 1000;

// Extrai o texto de mensagem que o SERPRO devolveu no envelope (formato: mensagens[] com
// { codigo, texto }). Serve pra mostrar ao contador POR QUE a consulta falhou, em vez do
// código interno. Retorna null quando não há mensagem reconhecível.
function extrairMensagemSerpro(details) {
  const msgs = details?.mensagens;
  const lista = Array.isArray(msgs) ? msgs : (msgs ? [msgs] : []);
  const textos = lista
    .map((m) => (typeof m === "string" ? m : [m?.codigo, m?.texto].filter(Boolean).join(" ")))
    .map((t) => String(t || "").trim())
    .filter(Boolean);
  return textos.length ? textos.join(" | ").slice(0, 400) : null;
}

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
  // C6: além disso contamos guias PROCESSED x enviadas, porque o card agora TROCA as tags de
  // guia pelo selo "Enviado" só quando TODAS foram enviadas. Guia nova/recalculada/retificada
  // volta pra PENDING (ver reset de flags na retificação) → enviadas < total → as tags reaparecem.
  const portalIds = [...new Set(data.map((item) => item.companyId).filter(Boolean))];
  const emailSentSet = new Set();
  const envioByPortal = new Map();
  if (portalIds.length) {
    const guiasDoMes = await prisma.guide.findMany({
      where: { portalClientId: { in: portalIds }, competencia: ref, status: "PROCESSED" },
      select: { portalClientId: true, emailStatus: true },
    });
    for (const g of guiasDoMes) {
      const cur = envioByPortal.get(g.portalClientId) || { total: 0, enviadas: 0 };
      cur.total += 1;
      if (String(g.emailStatus || "").toUpperCase() === "SENT") {
        cur.enviadas += 1;
        emailSentSet.add(g.portalClientId);
      }
      envioByPortal.set(g.portalClientId, cur);
    }
  }

  return data.map((item) => {
    const envio = envioByPortal.get(item.companyId) || { total: 0, enviadas: 0 };
    return {
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
      // C6: só é "Enviado" quando existe guia e todas foram enviadas.
      guidesEnvio: {
        competencia: ref,
        total: envio.total,
        enviadas: envio.enviadas,
        todasEnviadas: envio.total > 0 && envio.enviadas === envio.total,
      },
    };
  });
}

// QUEM LIBEROU A EMISSÃO PELO CLIENTE, por NOME.
//
// `PortalClient.emissaoClienteLiberadaPor` guarda o **userId** (mesmo padrão de
// `fechadoContabilPor`) — nome copiado na coluna envelheceria no dia em que a pessoa trocasse de
// e-mail. Mas um uuid na tela não responde "quem autorizou este cliente a emitir?", que é a única
// razão de a coluna existir. Então o nome é resolvido na LEITURA, em **uma** query para a lista
// inteira (mesmo molde de `attachFiscalParcelamentoToCompaniesList`).
//
// ⚠ Usuário apagado NÃO vira "ninguém": o payload mantém o `liberadaPor` cru e o `liberadaPorNome`
// fica nulo — a tela mostra o id em vez de dizer que a liberação não teve autor.
async function anexarQuemLiberouEmissao(data) {
  if (!Array.isArray(data) || !data.length) return data;
  const userIds = [...new Set(data.map((item) => item.emissaoCliente?.liberadaPor).filter(Boolean))];
  if (!userIds.length) return data;
  const users = await prisma.user
    .findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
    .catch(() => []);
  const nomePorId = new Map(users.map((u) => [u.id, u.name || u.email || null]));
  return data.map((item) =>
    item.emissaoCliente?.liberadaPor
      ? {
          ...item,
          emissaoCliente: {
            ...item.emissaoCliente,
            liberadaPorNome: nomePorId.get(item.emissaoCliente.liberadaPor) || null,
          },
        }
      : item
  );
}

// C6: anexa ao card (a) a situação fiscal do SITFIS — pra avisar pendência ao lado de "apurada" —
// e (b) se a empresa tem parcelamento ATIVO (selo "PARC" junto das guias). Duas queries pra lista
// inteira, no molde de attachFechamentoContabilToCompaniesList.
async function attachFiscalParcelamentoToCompaniesList(data) {
  if (!Array.isArray(data) || !data.length) return data;
  const portalIds = [...new Set(data.map((item) => item.companyId).filter(Boolean))];
  const situacaoByPortal = new Map();
  const comParcelamento = new Set();
  if (portalIds.length) {
    const [status, parcs] = await Promise.all([
      prisma.companyFiscalStatus.findMany({
        where: { portalClientId: { in: portalIds } },
        select: { portalClientId: true, situacao: true, checkedAt: true },
      }),
      prisma.parcelamento.findMany({
        where: { portalClientId: { in: portalIds }, status: "ATIVO" },
        select: { portalClientId: true },
        distinct: ["portalClientId"],
      }),
    ]);
    for (const s of status) situacaoByPortal.set(s.portalClientId, s);
    for (const p of parcs) comParcelamento.add(p.portalClientId);
  }
  // "A captura de notas desta empresa parou?" — a pergunta que ficou 29 dias sem ser feita, porque
  // captura travada e empresa quieta davam exatamente a mesma resposta na tela.
  const captura = await capturaParadaPorEmpresa(portalIds).catch(() => new Map());

  return data.map((item) => {
    const s = situacaoByPortal.get(item.companyId) || null;
    return {
      ...item,
      // null = nunca consultada (card não mostra selo nenhum — não afirmamos nada sobre o fisco).
      fiscalSituacao: s?.situacao || null,
      fiscalCheckedAt: s?.checkedAt || null,
      temParcelamento: comParcelamento.has(item.companyId),
      capturaNotas: captura.get(item.companyId) || null,
    };
  });
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

  /**
   * O gate de ATO DE CONSEQUÊNCIA, na forma que este arquivo já usa em `/guides/batch-send`,
   * `/guides/liberar-cliente` e `/guides/vazio` — mesma leitura de papel (`isAdminLikeUser`) e
   * mesmo código de erro. Devolve `false` DEPOIS de responder, para o chamador só dar `return`.
   */
  function somenteAdminOuContador(req, res) {
    if (isAdminLikeUser(req.auth?.user)) return true;
    res.status(403).json({ ok: false, error: "forbidden_admin_or_contador_only" });
    return false;
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
    // ⚠ MESMO MOTIVO DA LINHA ABAIXO (`codigoMunicipioIbge`): sem isto a lista de serviços não
    // volta para a tela, o formulário reabre vazio e o contador reescolhe tudo a cada edição.
    codigosServicoNacional: true,
    codigoServicoMunicipal: true,
    rpsSerie: true,
    rpsNumero: true,
    // ⚠ SEM ISTO O CAMPO NÃO VOLTA PRA TELA. O `select` é explícito, então coluna nova que não
    // entre aqui simplesmente não existe para o frontend: o formulário abriria sempre vazio e o
    // contador reescolheria o município a cada edição, achando que nada foi salvo.
    codigoMunicipioIbge: true,
    // ⚠ MESMO MOTIVO DAS LINHAS ACIMA. A carga tributária aproximada (Lei 12.741/2012) da empresa
    // NÃO OPTANTE é DIGITADA pelo contador neste formulário — sem estas três linhas ela não volta
    // para a tela, o bloco reabre vazio e o contador redigita a cada edição, achando que não
    // salvou. E aqui o preço é maior que nos outros campos: o percentual vai IMPRESSO ao tomador.
    pTotTribFed: true,
    pTotTribEst: true,
    pTotTribMun: true,
    // ⚠ MESMO MOTIVO DAS LINHAS ACIMA, e esta já mordeu QUATRO vezes esta semana: coluna nova que
    // não entre neste `select` volta `undefined` SEM ERRO — a rota responde 200 e a tela "só não
    // mostra", o contador recadastra o benefício a cada edição achando que não salvou.
    beneficioMunicipalNumero: true,
    beneficioMunicipalTipoReducao: true,
    beneficioMunicipalPRedBC: true,
    optanteSimples: true,
    regimeEspecialTributacao: true,
    // ── Ficha de cadastro ──
    abriuCom: true,
    numeroRegistro: true,
    tipoRegistro: true,
    inscricaoMunicipalData: true,
    inscricaoEstadual: true,
    inscricaoEstadualData: true,
    naturezaJuridica: true,
    diarioNumero: true,
    desoneracao: true,
    alteracaoNumero: true,
    alteracaoData: true,
    partners: {
      select: {
        id: true, name: true, documento: true, participacao: true,
        rg: true, rgOrgaoEmissor: true, dataNascimento: true, dataSaida: true,
        representante: true, email: true, phone: true,
      },
      orderBy: { createdAt: "asc" },
    },
    regimeHistorico: {
      select: {
        id: true, regime: true, vigenciaInicio: true, vigenciaFim: true,
        impostos: true, desoneracao: true, observacao: true,
      },
      orderBy: { vigenciaInicio: "asc" },
    },
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

  function buildFirmCompanyPayload({ portal, myRole, scopes = [], legacy = null, ownerEmail = null, ownerName = null }) {
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
      ownerName: ownerName || null,
      guideNotificationEmail: portal.guideNotificationEmail || null,
      hasProlabore: Boolean(portal.hasProlabore),
      temFolha: Boolean(portal.temFolha),
      empresaZerada: Boolean(portal.empresaZerada),
      email: legacyEmail,
      telefone: legacy?.telefone || null,
      portalCreatedAt: portal.createdAt,
      portalUpdatedAt: portal.updatedAt,
      // Q11.1: estado de suspensão exibido na UI (badge + bloqueio de ações).
      status: portal.status || "ATIVA",
      suspendedAt: portal.suspendedAt || null,
      suspendedReason: portal.suspendedReason || null,
      // ⚠ O PORTÃO DA EMISSÃO PELO CLIENTE precisa VOLTAR para a tela — campo que não entra no
      // `select` volta `undefined` e o controle reabre desligado, como se o contador nunca tivesse
      // liberado nada. Este projeto já pagou isso três vezes (`legacyCompanySelect`,
      // `codigoMunicipioIbge`, os campos de NFS-e), e aqui o erro seria pior: o contador clicaria
      // de novo achando que não salvou.
      // O NOME de quem liberou é resolvido depois (`anexarQuemLiberouEmissao`); a coluna guarda o
      // userId, e nome copiado no payload envelheceria.
      emissaoCliente: {
        liberada: Boolean(portal.emissaoClienteLiberada),
        liberadaEm: portal.emissaoClienteLiberadaEm || null,
        liberadaPor: portal.emissaoClienteLiberadaPor || null,
        liberadaPorNome: null,
      },
      legacyCompany: legacy ? { ...legacy, email: legacyEmail } : null,
    };
  }

  // F2: O QUE TRAVA A CARTEIRA numa competência ─────────────────────────────
  //
  // A pergunta "quais empresas eu já posso fechar?" só tinha uma resposta: abrir empresa por
  // empresa e olhar o cadeado. Numa carteira de quarenta isso é quarenta abas.
  //
  // Mesmo truque do `/companies/annual`: DUAS queries para a carteira inteira, não uma por empresa.
  // A regra de bloqueio é a MESMA da aba Lançamentos — `computeFechamentoBlockers` — porque duas
  // cópias divergiriam e as duas telas passariam a discordar sobre a mesma empresa.
  //
  // ⚠ O peso está na segunda query: ela traz as LINHAS dos lançamentos do mês de toda a carteira
  // (o balanço D≠C não sai de agregado, precisa do detalhe). Por isso o `select` é enxuto e a rota
  // é por UMA competência — nunca por ano, como a anual.
  router.get("/companies/fechamento", async (req, res) => {
    const competencia = String(req.query?.competencia || "").trim();
    if (!/^\d{4}-\d{2}$/.test(competencia)) {
      return res.status(400).json({ ok: false, error: "competencia_invalida" });
    }
    const portalIds = await empresasVisiveis(req);
    if (!portalIds.length) return res.json({ ok: true, competencia, empresas: [] });

    const empresas = await prisma.portalClient.findMany({
      where: { id: { in: portalIds } },
      select: { id: true, razao: true, cnpj: true },
      orderBy: { razao: "asc" },
    });

    const [circulares, lancamentos] = await Promise.all([
      prisma.companyMonthlyCircular.findMany({
        where: { portalClientId: { in: portalIds }, competencia },
        select: { portalClientId: true, fechadoContabilEm: true, ...CHECKLIST_SELECT },
      }),
      prisma.accountingEntry.findMany({
        where: { portalClientId: { in: portalIds }, competencia, tipo: { not: "PARCELA" } },
        select: SELECT_PARA_BLOQUEIOS,
      }),
    ]);

    const circularPor = new Map(circulares.map((c) => [c.portalClientId, c]));
    const lancamentosPor = new Map();
    for (const e of lancamentos) {
      if (!lancamentosPor.has(e.portalClientId)) lancamentosPor.set(e.portalClientId, []);
      lancamentosPor.get(e.portalClientId).push(e);
    }

    const linhas = empresas.map((e) => {
      const circular = circularPor.get(e.id) || null;
      const fechado = Boolean(circular?.fechadoContabilEm);
      const pendentes = checklistPendentes(circular);
      const { blockers } = computeFechamentoBlockers(lancamentosPor.get(e.id) || [], competencia);
      return {
        companyId: e.id,
        razao: e.razao,
        cnpj: e.cnpj,
        fechado,
        fechadoEm: circular?.fechadoContabilEm || null,
        // Empresa já fechada não "pode fechar" — ela ESTÁ fechada. Misturar os dois faria a
        // contagem de "prontas para fechar" incluir quem não tem mais nada a fazer.
        podeFechar: !fechado && blockers.length === 0 && pendentes.length === 0,
        checklistPendentes: pendentes,
        blockers,
        totalLancamentos: (lancamentosPor.get(e.id) || []).length,
      };
    });

    return res.json({ ok: true, competencia, empresas: linhas });
  });

  // C8: visão ANUAL — 12 meses × empresas, com DOIS indicadores por célula:
  // fechamento contábil (CompanyMonthlyCircular.fechadoContabilEm) e apuração transmitida
  // (ApuracaoSnapshot.estado). Duas queries pro ano inteiro — NÃO 12 chamadas por empresa.
  router.get("/companies/annual", async (req, res) => {
    const userId = String(req.auth.user.id);
    const appRole = String(req.auth.user.role || "").toLowerCase();
    const isAdminLike = appRole === "admin" || appRole === "contador";
    const ano = Number(req.query?.ano) || new Date().getFullYear();
    if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) {
      return res.status(400).json({ ok: false, error: "ano_invalido" });
    }

    // Escopo multi-tenant: admin/contador vê a carteira toda; os demais, só o que têm acesso.
    let empresas;
    if (isAdminLike) {
      empresas = await prisma.portalClient.findMany({
        orderBy: { razao: "asc" },
        select: { id: true, razao: true, cnpj: true },
      });
    } else {
      const links = await prisma.companyFirmAccess.findMany({
        where: { userId, status: "ACTIVE" },
        include: { company: { select: { id: true, razao: true, cnpj: true } } },
      });
      empresas = links.map((l) => l.company).filter(Boolean);
      empresas.sort((a, b) => String(a.razao || "").localeCompare(String(b.razao || "")));
    }
    const portalIds = empresas.map((e) => e.id);
    if (!portalIds.length) return res.json({ ok: true, ano, empresas: [] });

    // As competências do ano são strings YYYY-MM nos dois modelos → range simples.
    const de = `${ano}-01`;
    const ate = `${ano}-12`;
    const [circulares, snapshots] = await Promise.all([
      prisma.companyMonthlyCircular.findMany({
        where: { portalClientId: { in: portalIds }, competencia: { gte: de, lte: ate } },
        select: { portalClientId: true, competencia: true, fechadoContabilEm: true },
      }),
      prisma.apuracaoSnapshot.findMany({
        where: { portalClientId: { in: portalIds }, competencia: { gte: de, lte: ate } },
        select: { portalClientId: true, competencia: true, estado: true },
      }),
    ]);

    const chave = (portalId, comp) => `${portalId}|${comp}`;
    const fechadoPor = new Map();
    for (const c of circulares) {
      if (c.fechadoContabilEm) fechadoPor.set(chave(c.portalClientId, c.competencia), c.fechadoContabilEm);
    }
    const apuracaoPor = new Map();
    for (const s of snapshots) apuracaoPor.set(chave(s.portalClientId, s.competencia), s.estado);

    const APURADA = new Set(["transmitida", "confirmada"]);
    const linhas = empresas.map((e) => ({
      companyId: e.id,
      razao: e.razao,
      cnpj: e.cnpj,
      meses: Array.from({ length: 12 }, (_, i) => {
        const competencia = `${ano}-${String(i + 1).padStart(2, "0")}`;
        const k = chave(e.id, competencia);
        const estado = apuracaoPor.get(k) || null;
        return {
          competencia,
          mes: i + 1,
          fechado: fechadoPor.has(k),
          fechadoEm: fechadoPor.get(k) || null,
          apurada: APURADA.has(String(estado || "")),
          estadoApuracao: estado,
        };
      }),
    }));

    return res.json({ ok: true, ano, empresas: linhas });
  });

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
          temFolha: true,
          empresaZerada: true,
          inscricaoMunicipal: true,
          uf: true,
          municipio: true,
          createdAt: true,
          updatedAt: true,
          companyId: true,
          status: true,           // Q11.1
          suspendedAt: true,
          suspendedReason: true,
          // ⚠ SEM ISTO O PORTÃO NÃO VOLTA PARA A TELA. O `select` é explícito: coluna nova que não
          // entre aqui simplesmente não existe para o frontend, e o controle de liberação abriria
          // sempre desligado — o contador clicaria de novo achando que não tinha salvado.
          emissaoClienteLiberada: true,
          emissaoClienteLiberadaEm: true,
          emissaoClienteLiberadaPor: true,
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
            include: { user: { select: { email: true, name: true } } },
            orderBy: { createdAt: "asc" },
          })
        : [];
      const ownerEmailByPortalId = new Map();
      const ownerNameByPortalId = new Map();
      for (const link of ownerLinks) {
        if (!ownerEmailByPortalId.has(link.companyId)) {
          ownerEmailByPortalId.set(link.companyId, link.user?.email || null);
          ownerNameByPortalId.set(link.companyId, link.user?.name || null);
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
            ownerName: ownerNameByPortalId.get(item.id) || null,
          })
        ),
        competenciaRef
      );
      const dataWithSerpro = await attachSerproStatusToCompaniesList(dataWithCompliance);
      const dataWithFechamento = await attachFechamentoContabilToCompaniesList(dataWithSerpro, competenciaRef);
      const dataWithNotas = await attachNotasApuracaoToCompaniesList(dataWithFechamento, competenciaRef);
      const dataComParcelamento = await attachFiscalParcelamentoToCompaniesList(dataWithNotas);
      const data = await anexarQuemLiberouEmissao(dataComParcelamento);
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
            temFolha: true,
            empresaZerada: true,
            inscricaoMunicipal: true,
            uf: true,
            municipio: true,
            createdAt: true,
            updatedAt: true,
            companyId: true,
            status: true,           // Q11.1
            suspendedAt: true,
            suspendedReason: true,
            // ⚠ Mesmo motivo do bloco acima: `select` explícito, coluna que falta volta `undefined`.
            emissaoClienteLiberada: true,
            emissaoClienteLiberadaEm: true,
            emissaoClienteLiberadaPor: true,
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
          include: { user: { select: { email: true, name: true } } },
          orderBy: { createdAt: "asc" },
        })
      : [];
    const ownerEmailByPortalId = new Map();
    const ownerNameByPortalId = new Map();
    for (const link of ownerLinks) {
      if (!ownerEmailByPortalId.has(link.companyId)) {
        ownerEmailByPortalId.set(link.companyId, link.user?.email || null);
        ownerNameByPortalId.set(link.companyId, link.user?.name || null);
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
          ownerName: ownerNameByPortalId.get(link.company.id) || null,
        })
      ),
      competenciaRef
    );
    const dataWithSerpro = await attachSerproStatusToCompaniesList(dataWithCompliance);
    const dataWithFechamento = await attachFechamentoContabilToCompaniesList(dataWithSerpro, competenciaRef);
    const dataWithNotas = await attachNotasApuracaoToCompaniesList(dataWithFechamento, competenciaRef);
    const dataComParcelamento = await attachFiscalParcelamentoToCompaniesList(dataWithNotas);
    const data = await anexarQuemLiberouEmissao(dataComParcelamento);
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

  // A criação de empresa mora em `application/companies/CompanyProvisioningService.js`. Esta rota
  // é a PORTA HTTP: resolve quem chamou, resolve o escopo multi-tenant (que precisa de `req`) e
  // traduz o erro de domínio em resposta. A conversão de onboarding chama o mesmo service — foi
  // para isso que ele saiu daqui.
  router.post("/companies", async (req, res) => {
    const body = req.body || {};
    let criada;
    try {
      criada = await provisionarEmpresa({
        body,
        actorUserId: String(req.auth?.user?.id || ""),
        log,
      });
    } catch (err) {
      if (err instanceof CompanyProvisioningError) {
        // O código do Prisma vai junto na resposta: sem ele, diagnosticar exige acesso ao log do
        // container — foi exatamente o que travou este caso. A mensagem interna continua fora.
        if (err.status >= 500) {
          log.error(
            { err: err.cause || err, code: err.cause?.code, meta: err.cause?.meta },
            "Falha ao criar empresa no portal firm"
          );
        }
        return res.status(err.status).json(err.body);
      }
      log.error({ err }, "Falha ao criar empresa no portal firm");
      return res.status(500).json({ error: "internal_error", code: err?.code || null });
    }

    // `empresasVisiveis` fica AQUI: é a única parte que depende de `req`.
    let regrasAplicadas = null;
    try {
      const portalIds = await empresasVisiveis(req);
      ({ regrasAplicadas } = await aplicarPosCriacao({
        portalClientId: criada.portalId,
        portalIds,
        regime: criada.regime,
        log,
      }));
    } catch (err) {
      log.warn(
        { err: err?.message || err, companyId: criada.portalId },
        "Pós-criação da empresa nova falhou"
      );
    }

    // ⚠ Os campos são listados um a um de propósito: `provisionarEmpresa` devolve mais coisa
    // (regime, cnpj, razão) para o pós-criação e para o onboarding, e espalhar o retorno mudaria
    // o contrato deste endpoint sem ninguém notar.
    return res.status(201).json({
      ok: true,
      portalId: criada.portalId,
      companyId: criada.companyId,
      ownerUserId: criada.ownerUserId,
      regrasAplicadas,
    });
  });

  // QUAIS EMPRESAS ESTE E-MAIL DE RESPONSÁVEL JÁ ATENDE — leitura, para a tela AVISAR na hora.
  //
  // ⚠ AVISA, NÃO PROÍBE. Grupo de empresas com o mesmo dono é legítimo e existe na base (medido:
  // um e-mail com 3 construtoras, outro com 2, os dois aparentemente reais). O que não pode é a
  // consequência ser invisível — **um login, todas as empresas daquele e-mail** —, e foi ela que
  // produziu o defeito de 19/08/2026. Esta rota é o que permite dizer isso ANTES de salvar.
  //
  // ⚠ NENHUMA AUTORIDADE NOVA. O gate é o MESMO do `PATCH /companies/:companyId` (`admin` ou
  // `contador`), e medido: `GET /firm/companies` já devolve a carteira INTEIRA para esses dois
  // papéis (`isAdminLike`). Ou seja, nada aqui é visível a quem não podia ver — e afrouxar o gate
  // transformaria isto num enumerador de e-mails de clientes.
  //
  // ⚠ Caminho literal FORA de `/companies/*`, de propósito: `/companies/por-responsavel` seria
  // lido como `/companies/:companyId` se registrado depois — armadilha que este projeto já pagou
  // com `/notas/summary` e `/companies/annual`.
  router.get("/responsavel/empresas", async (req, res) => {
    const appRole = String(req.auth?.user?.role || "").toLowerCase();
    if (!["admin", "contador"].includes(appRole)) {
      return res.status(403).json({ error: "forbidden_admin_or_contador_only" });
    }
    const email = String(req.query?.email || "").trim().toLowerCase();
    // ⚠ Sem e-mail a resposta é LISTA VAZIA, nunca 400: a tela consulta enquanto o contador digita,
    // e um erro vermelho a cada campo apagado seria ruído em cima de trabalho normal.
    if (!email) return res.json({ ok: true, email: "", empresas: [] });
    try {
      const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (!user?.id) return res.json({ ok: true, email, empresas: [] });
      const vinculos = await prisma.companyClientUser.findMany({
        where: { userId: user.id, role: "OWNER", status: "ACTIVE" },
        select: { companyId: true },
      });
      if (!vinculos.length) return res.json({ ok: true, email, empresas: [] });
      const empresas = await prisma.portalClient.findMany({
        where: { id: { in: vinculos.map((v) => v.companyId) } },
        select: { id: true, razao: true, cnpj: true },
        orderBy: { razao: "asc" },
      });
      return res.json({ ok: true, email, empresas });
    } catch (err) {
      log.error({ err }, "Falha ao listar empresas do responsável");
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
      if (!parsedCompany.ok) // ⚠⚠ O `details` VIAJA. `company_endereco_required_fields_missing` sempre carregou os campos
        // exatos que faltam (`companyProfile.normalizeEndereco`), e a rota os DESCARTAVA — o front
        // nao "ignorava" o detalhe, ele nunca recebia. Com ele, a tela diz "Faltam CEP e Numero"
        // em vez de "o endereco esta incompleto", que manda procurar em seis campos.
        return res.status(400).json({
          error: parsedCompany.error,
          ...(parsedCompany.details ? { details: parsedCompany.details } : {}),
        });
      const normalizedCompany = parsedCompany.data;
      const ownerEmailInput = String(body.ownerEmail || "")
        .trim()
        .toLowerCase();
      // Nome do responsável (owner) — antes era ignorado no PATCH (só o e-mail era atualizado).
      const ownerNameInput = Object.prototype.hasOwnProperty.call(body, "ownerName")
        ? String(body.ownerName || "").trim()
        : null;
      // ⚠ `=== true` EXATO, como o `confirmado` da senha do portal. Trocar o e-mail de um
      // responsável cuja conta atende VÁRIAS empresas cria um acesso novo — ato de consequência,
      // e a tela tem de tê-lo mostrado antes. Um truthy solto (`"false"`, `1`, `{}`) transformaria
      // qualquer chamador desatento em confirmação.
      const confirmarNovoAcessoInput = body.confirmarNovoAcesso === true;
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
        // ⚠ Declarado FORA da transação de propósito: o `$transaction` devolve o payload da
        // empresa (que já tem forma de contrato e passa por `attachGuideCompliance...`), e
        // pendurar um segundo valor no retorno mudaria essa forma para todos os consumidores.
        // Uma transação que aborta LANÇA — então não há caminho em que este valor sobreviva a um
        // rollback e vá parar na resposta.
        let acessoNovo = null;
        let acessoVinculado = null;
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
          if (Object.prototype.hasOwnProperty.call(body, "temFolha")) {
            portalUpdateData.temFolha = Boolean(body.temFolha);
          }
          if (Object.prototype.hasOwnProperty.call(body, "empresaZerada")) {
            portalUpdateData.empresaZerada = Boolean(body.empresaZerada);
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
              temFolha: true,
              empresaZerada: true,
              inscricaoMunicipal: true,
              uf: true,
              municipio: true,
              createdAt: true,
              updatedAt: true,
              companyId: true,
              // ⚠ O PATCH do cadastro NÃO altera o portão (ele tem rota própria), mas precisa
              // DEVOLVÊ-LO: sem estas três linhas a resposta do "Salvar alterações" traria
              // `emissaoCliente.liberada: false` e a tela desligaria o controle sozinha, sem
              // ninguém ter clicado nele.
              emissaoClienteLiberada: true,
              emissaoClienteLiberadaEm: true,
              emissaoClienteLiberadaPor: true,
            },
          });
          let updatedLegacy = null;
          if (portal.companyId) {
            // ⚠⚠ AS ATIVIDADES DE HOJE, LIDAS DENTRO DA TRANSACAO. Sem isto o `update` abaixo
            // gravava `[cnaePrincipal, ...cnaesSecundarios]` — codigos NUS — e APAGAVA a descricao
            // das linhas que a tinham. Medido em producao (30/08/2026): 12 de 34 empresas perdiam
            // texto a cada "Salvar alteracoes", e esse texto e a unica fonte do `xDescServ` da DPS
            // (`features/notas/lib/descricaoSugerida.js`, o unico consumidor).
            const legacyAtual = await tx.company.findUnique({
              where: { id: portal.companyId },
              select: { atividades: true },
            });
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
                // ⚠ MESCLA, nao sobrescreve: `mesclarAtividades` preserva a linha inteira
                // ("46.19-2-00 - Representantes comerciais…") do codigo que continua na lista, e
                // deixa nu o codigo que nao tinha texto. ⚠⚠ NUNCA completa descricao que nao
                // existe — `CnaeAnexo` cobre ~10% da CNAE 2.3, e inventar texto no cadastro poria
                // uma descricao nao conferida na nota fiscal do cliente.
                atividades: mesclarAtividades(
                  legacyAtual?.atividades,
                  [normalizedCompany.cnaePrincipal, ...normalizedCompany.cnaesSecundarios],
                  // ⚠ O que a CONSULTA ao CNPJ trouxe nesta edicao, se trouxe. E texto de terceiro
                  //   (BrasilAPI), entao ele so ENTRA junto do codigo — nunca decide qual codigo a
                  //   empresa tem, que continua saindo de `cnaePrincipal`/`cnaesSecundarios`.
                  {
                    descritas: [
                      // ⚠⚠ AS DESCRICOES QUE VINHAM GRUDADAS NO PROPRIO `cnaePrincipal`. Em 12 das
                      //   34 empresas a coluna do CODIGO guardava "codigo - descricao"; o
                      //   normalizador passou a separar os dois, e sem esta linha a descricao
                      //   sumiria no primeiro salvamento que finalmente funciona.
                      ...(normalizedCompany.descricoesEmbutidas || []),
                      // O que a consulta ao CNPJ trouxe agora vence, por ser mais nova.
                      ...(Array.isArray(body?.atividadesDescritas) ? body.atividadesDescritas : []),
                    ],
                  }
                ),
                tipoTributario: normalizedCompany.regimeTributario,
                regimeTributario: normalizedCompany.regimeTributario,
                // ⚠⚠ SPREAD CONDICIONAL, e antes eram tres atribuicoes secas com `|| null`.
                // O formulario NAO envia o bloco `simples`, entao TODO "Salvar alteracoes" gravava
                // `null` nas tres colunas e APAGAVA o anexo do Simples da empresa, em silencio —
                // tres linhas abaixo do comentario que explica exatamente por que isso apaga dado.
                // Hoje `undefined` (payload sem a chave) nao entra no `data`; `null` explicito sim.
                ...(normalizedCompany.simples !== undefined
                  ? {
                      anexoSimples: normalizedCompany.simples?.anexo || null,
                      simplesAnexo: normalizedCompany.simples?.anexo || null,
                      simplesDataOpcao: normalizedCompany.simples?.dataOpcao || null,
                    }
                  : {}),
                cnaePrincipal: normalizedCompany.cnaePrincipal,
                cnaesSecundarios: normalizedCompany.cnaesSecundarios,
                // A rota já aceitava `inscricaoMunicipal` solto no body; agora o form também
                // manda pelo perfil normalizado. Mantém a precedência do body por compat.
                inscricaoMunicipal: inscricaoMunicipalInput ?? normalizedCompany.inscricaoMunicipal,
                // ⚠ Município EMISSOR da NFS-e (`cLocEmi`). A rota lista os campos aceitos um a um:
                // enquanto ele não estava nesta lista, o valor vinha no corpo, passava pelo Zod
                // (`.passthrough()`) e era DESCARTADO EM SILÊNCIO no `update` — salvar respondia
                // 200 e o campo voltava vazio na recarga.
                codigoMunicipioIbge: normalizedCompany.codigoMunicipioIbge,
                // ⚠ OS TRÊS QUE FALTAVAM. `codigoServicoNacional`, `codigoServicoMunicipal` e
                // `rpsSerie` já existiam na coluna e já voltavam pelo `legacyCompanySelect` — mas
                // não havia NENHUM caminho de escrita a partir do portal: o corpo passava pelo Zod
                // (`.passthrough()`) e morria aqui, nesta lista. `buildMissingFields` recusava a
                // emissão por eles e o contador não tinha por onde preenchê-los.
                codigoServicoNacional: normalizedCompany.codigoServicoNacional,
                // ⚠ SPREAD CONDICIONAL, e é essencial. `undefined` aqui significa "o payload não
                // trouxe a lista" — e mandar `codigosServicoNacional: undefined` para o Prisma é
                // inofensivo, mas mandar `[]` APAGARIA o cadastro de serviços de toda tela que
                // salva a empresa sem enviar o campo. O `!== undefined` mantém as duas intenções
                // distintas ("não mexer" × "apagar") até a última linha.
                ...(normalizedCompany.codigosServicoNacional !== undefined
                  ? { codigosServicoNacional: normalizedCompany.codigosServicoNacional }
                  : {}),
                codigoServicoMunicipal: normalizedCompany.codigoServicoMunicipal,
                rpsSerie: normalizedCompany.rpsSerie,
                // ⚠ CARGA TRIBUTÁRIA APROXIMADA (Lei 12.741/2012) — pedido do dono, 18/08/2026.
                // Sem estas três linhas o valor chega no corpo, passa pelo Zod e MORRE AQUI, nesta
                // lista: 200 na resposta e campo vazio na recarga. É o defeito que
                // `codigoServicoNacional` já cometeu, e neste campo ele seria pior — a empresa
                // continuaria sem emitir e o contador teria acabado de configurar a carga.
                // `null` é gravável de propósito: desfazer uma configuração errada tem de ser
                // possível pela tela, e NULL é o estado que a emissão RECUSA com motivo, em vez de
                // declarar 0,00 ao tomador.
                //
                // ⚠ SPREAD CONDICIONAL, pelo mesmo motivo de `codigosServicoNacional`:
                // `undefined` significa "o payload não trouxe o campo" e mandar `undefined` ao
                // Prisma é inofensivo — mas achatar isso em `null` APAGARIA a carga tributária em
                // toda rota que salva a empresa sem este bloco. As duas intenções ("não mexer" ×
                // "apagar") ficam distintas até a última linha.
                ...(normalizedCompany.pTotTribFed !== undefined
                  ? { pTotTribFed: normalizedCompany.pTotTribFed }
                  : {}),
                ...(normalizedCompany.pTotTribEst !== undefined
                  ? { pTotTribEst: normalizedCompany.pTotTribEst }
                  : {}),
                ...(normalizedCompany.pTotTribMun !== undefined
                  ? { pTotTribMun: normalizedCompany.pTotTribMun }
                  : {}),
                // ⚠ BENEFÍCIO MUNICIPAL DO ISSQN — spread condicional pelo mesmo motivo dos três
                // percentuais acima: `undefined` é "o payload não trouxe o campo", e achatar isso
                // em `null` APAGARIA o benefício em toda rota que salva a empresa sem este bloco.
                // Benefício apagado por engano é a nota saindo com o imposto cheio sem ninguém
                // ter pedido — e ninguém veria, porque a tela não mudaria de aparência.
                ...(normalizedCompany.beneficioMunicipalNumero !== undefined
                  ? { beneficioMunicipalNumero: normalizedCompany.beneficioMunicipalNumero }
                  : {}),
                ...(normalizedCompany.beneficioMunicipalTipoReducao !== undefined
                  ? { beneficioMunicipalTipoReducao: normalizedCompany.beneficioMunicipalTipoReducao }
                  : {}),
                ...(normalizedCompany.beneficioMunicipalPRedBC !== undefined
                  ? { beneficioMunicipalPRedBC: normalizedCompany.beneficioMunicipalPRedBC }
                  : {}),
                // ── Ficha de cadastro ──
                inscricaoMunicipalData: normalizedCompany.inscricaoMunicipalData,
                inscricaoEstadual: normalizedCompany.inscricaoEstadual,
                inscricaoEstadualData: normalizedCompany.inscricaoEstadualData,
                porte: normalizedCompany.porte,
                naturezaJuridica: normalizedCompany.naturezaJuridica,
                capitalSocial: normalizedCompany.capitalSocial,
                dataAbertura: normalizedCompany.dataAbertura,
                abriuCom: normalizedCompany.abriuCom,
                numeroRegistro: normalizedCompany.numeroRegistro,
                tipoRegistro: normalizedCompany.tipoRegistro,
                diarioNumero: normalizedCompany.diarioNumero,
                desoneracao: normalizedCompany.desoneracao,
                alteracaoNumero: normalizedCompany.alteracaoNumero,
                alteracaoData: normalizedCompany.alteracaoData,
                ...(normalizedCompany.socios
                  ? { quantidadeSocios: normalizedCompany.socios.filter((s) => !s.dataSaida).length }
                  : {}),
              },
              select: legacyCompanySelect,
            });

            // Sócios e histórico: só mexe se vieram no payload (null = campo ausente).
            // Substitui o conjunto inteiro — é como o form edita (uma lista).
            if (normalizedCompany.socios) {
              await tx.partner.deleteMany({ where: { companyId: portal.companyId } });
              if (normalizedCompany.socios.length > 0) {
                await tx.partner.createMany({
                  data: normalizedCompany.socios.map((s) => ({ ...s, companyId: portal.companyId })),
                });
              }
            }
            if (normalizedCompany.regimeHistorico) {
              await tx.regimeHistorico.deleteMany({ where: { companyId: portal.companyId } });
              if (normalizedCompany.regimeHistorico.length > 0) {
                await tx.regimeHistorico.createMany({
                  data: normalizedCompany.regimeHistorico.map((r) => ({ ...r, companyId: portal.companyId })),
                });
              }
            }
            // Re-lê pra devolver sócios/histórico já atualizados (o update acima é anterior a eles).
            updatedLegacy = await tx.company.findUnique({
              where: { id: portal.companyId },
              select: legacyCompanySelect,
            });
          }
          // Atualiza o responsável (owner): e-mail E/OU nome. Antes só o e-mail era gravado —
          // por isso o "Nome do responsável" não salvava.
          //
          // ⚠⚠ E ANTES, TROCAR O E-MAIL RENOMEAVA A CONTA — inclusive quando ela era de VÁRIAS
          // empresas, arrastando todos os vínculos para o login novo. Defeito de produção
          // (19/08/2026): um login enxergando NOVE empresas. A regra que decide está em
          // `application/companies/acessoDoResponsavel.js`; aqui fica só a orquestração.
          if (ownerEmailInput || ownerNameInput) {
            const ownerLink = await tx.companyClientUser.findFirst({
              where: {
                companyId: portalCompanyId,
                role: "OWNER",
                status: "ACTIVE",
              },
              orderBy: { createdAt: "asc" },
              select: { id: true, userId: true },
            });
            if (ownerLink?.userId) {
              // O e-mail/nome de HOJE — a confirmação REPETE OS DADOS do ato, nunca "tem certeza?".
              const contaAtual = await tx.user.findUnique({
                where: { id: ownerLink.userId },
                select: { email: true, name: true },
              });

              let decisao = DECISAO.RENOMEAR;
              let vinculosDaConta = 1;
              let contaDestino = null;
              if (ownerEmailInput) {
                // ⚠⚠ AQUI HAVIA UM `throw owner_email_already_in_use`, E ELE FOI REVOGADO pelo
                // dono em 30/08/2026: *"podemos usar o mesmo email para mais de uma empresa,
                // assim damos o acesso da mesma pessoa a todas as suas empresas"*.
                //
                // ⚠ A recusa virou um CAMINHO, não um sumiço. O motivo de 19/08 — *"reaproveitar
                // a conta alheia é como este problema começou"* — continua valendo contra assumir
                // conta de outro **em silêncio**, e é a confirmação que o repõe.
                //
                // ⚠ Medido em produção (30/08/2026): a assimetria era real e o dono batia nela
                // toda vez. `CompanyProvisioningService` SEMPRE reusou o `User` ao CRIAR empresa;
                // só a EDIÇÃO recusava. E a carteira já tem dono compartilhado legítimo:
                // `vssouzaempreiteira@gmail.com` com 3 empresas e outro com 2.
                contaDestino = await tx.user.findUnique({
                  where: { email: ownerEmailInput },
                  select: { id: true, email: true, name: true },
                });
                const contaDestinoExiste = Boolean(
                  contaDestino?.id && contaDestino.id !== ownerLink.userId
                );
                // ⚠ A CONTAGEM MORA DENTRO DA TRANSAÇÃO. Contá-la fora abriria a janela em que
                // uma empresa é vinculada entre a contagem e o update — e o arrasto voltaria por
                // essa fresta, com a tela tendo dito que a conta era de uma empresa só.
                vinculosDaConta = await tx.companyClientUser.count({
                  where: { userId: ownerLink.userId, status: "ACTIVE" },
                });
                decisao = decidirTrocaDeEmail({
                  vinculosDaConta,
                  confirmado: confirmarNovoAcessoInput,
                  contaDestinoExiste,
                  // ⚠⚠ O E-MAIL MUDOU? — a pergunta que faltava (02/09/2026). A tela SEMPRE manda
                  //   `ownerEmail` (semeia o campo com o valor gravado), então sem esta linha todo
                  //   salvar de empresa cujo dono atende 2+ empresas caía em
                  //   `owner_email_conta_compartilhada` com `emailAtual === emailNovo`, e a
                  //   transação inteira voltava atrás — "não salva nada", medido no KLAUS NIGRO.
                  //   Comparação NORMALIZADA (`normalizarEmail`), a mesma dos dois lados.
                  emailMudou: normalizarEmail(ownerEmailInput) !== normalizarEmail(contaAtual?.email),
                });
              }

              if (decisao === DECISAO.PEDIR_CONFIRMACAO_VINCULO) {
                // ⚠ RECUSA ANTES DO ATO — o `throw` aborta a transação inteira, então nem o
                // cadastro é salvo. Mesma disciplina do `PEDIR_CONFIRMACAO` logo abaixo.
                const doDestino = await tx.companyClientUser.findMany({
                  where: {
                    userId: contaDestino.id,
                    status: "ACTIVE",
                    companyId: { not: portalCompanyId },
                  },
                  select: { companyId: true },
                  take: 50,
                });
                const empresasDoDestino = doDestino.length
                  ? await tx.portalClient.findMany({
                      where: { id: { in: doDestino.map((o) => o.companyId) } },
                      select: { id: true, razao: true, cnpj: true },
                      orderBy: { razao: "asc" },
                    })
                  : [];
                const err = new Error("owner_email_conta_existente");
                err.code = "OWNER_EMAIL_CONTA_EXISTENTE";
                // ⚠ A CONFIRMAÇÃO REPETE OS DADOS — de quem é a conta e o que ela já atende.
                // *"Tem certeza?"* não é confirmação: aprende-se a clicar sem ler.
                err.detalhes = {
                  emailAtual: contaAtual?.email || null,
                  nomeAtual: contaAtual?.name || null,
                  emailNovo: ownerEmailInput,
                  nomeDaContaDestino: contaDestino.name || null,
                  empresasDoDestino: doDestino.length,
                  outras: empresasDoDestino,
                  // ⚠ A TELA PRECISA DIZER AS DUAS CONSEQUÊNCIAS, e elas são diferentes da
                  // confirmação irmã: ninguém ganha senha nova (a conta destino já tem a dela),
                  // e o acesso ANTIGO a esta empresa acaba.
                  contaDestinoJaTemSenha: true,
                  acessoAntigoPerdeEstaEmpresa: true,
                };
                throw err;
              }

              if (decisao === DECISAO.VINCULAR_CONTA_EXISTENTE) {
                // ⚠ `upsert`, não `create`: a conta destino pode já ter tido um vínculo com esta
                // empresa e estar `REMOVED`. `create` bateria no `@@unique([companyId, userId])`
                // e devolveria `unique_constraint_violation` — erro técnico no lugar do ato.
                await tx.companyClientUser.upsert({
                  where: {
                    companyId_userId: { companyId: portalCompanyId, userId: contaDestino.id },
                  },
                  create: {
                    companyId: portalCompanyId,
                    userId: contaDestino.id,
                    role: "OWNER",
                    status: "ACTIVE",
                  },
                  update: { role: "OWNER", status: "ACTIVE" },
                });
                // ⚠ SÓ O VÍNCULO DESTA EMPRESA SAI, e pelo `id` do vínculo — nunca por `userId`,
                // que alcançaria as outras empresas da conta antiga. Mesmo cuidado do
                // `CRIAR_ACESSO_PROPRIO`.
                await tx.companyClientUser.update({
                  where: { id: ownerLink.id },
                  data: { status: "REMOVED" },
                });
                // ⚠⚠ O NOME DA CONTA DESTINO NÃO É TOCADO, nem com `ownerName` no payload.
                // Renomear uma conta que atende OUTRAS empresas é exatamente o arrasto de
                // 19/08/2026 — o defeito que `acessoDoResponsavel.js` existe para impedir, aqui
                // por outra porta. Quem quiser corrigir o nome do responsável usa a tela da
                // conta, não a edição de UMA empresa.
                acessoVinculado = {
                  userId: contaDestino.id,
                  email: contaDestino.email,
                  nome: contaDestino.name || null,
                  // A conta já existe e já tem senha: nada a definir, e a tela não deve oferecer.
                  semSenha: false,
                };
              }

              if (decisao === DECISAO.PEDIR_CONFIRMACAO) {
                // ⚠ RECUSA ANTES DO ATO, não um desfazer depois: o `throw` aborta a transação
                // inteira, então nem o cadastro da empresa é salvo. O contador reenvia o mesmo
                // formulário com `confirmarNovoAcesso: true` depois de ler o aviso.
                const outras = await tx.companyClientUser.findMany({
                  where: {
                    userId: ownerLink.userId,
                    status: "ACTIVE",
                    companyId: { not: portalCompanyId },
                  },
                  select: { companyId: true },
                  take: 50,
                });
                const empresas = outras.length
                  ? await tx.portalClient.findMany({
                      where: { id: { in: outras.map((o) => o.companyId) } },
                      select: { id: true, razao: true, cnpj: true },
                      orderBy: { razao: "asc" },
                    })
                  : [];
                const err = new Error("owner_email_conta_compartilhada");
                err.code = "OWNER_EMAIL_CONTA_COMPARTILHADA";
                err.detalhes = {
                  emailAtual: contaAtual?.email || null,
                  nomeAtual: contaAtual?.name || null,
                  emailNovo: ownerEmailInput,
                  empresasDaConta: vinculosDaConta,
                  outrasEmpresas: vinculosDaConta - 1,
                  // ⚠ A LISTA PODE SER MENOR QUE A CONTAGEM (o `take` acima). Quem manda é
                  // `outrasEmpresas`; a lista é para a tela NOMEAR, não para ela contar.
                  outras: empresas,
                  // ⚠ A TELA PRECISA DIZER ISTO. Sem esta linha o contador troca o e-mail e o
                  // cliente fica sem conseguir entrar, sem ninguém saber por quê.
                  contaNovaSemSenha: true,
                };
                throw err;
              }

              if (decisao === DECISAO.CRIAR_ACESSO_PROPRIO) {
                const contaNova = await tx.user.create({
                  data: {
                    email: ownerEmailInput,
                    // O nome do responsável não muda só porque o e-mail mudou: sem `ownerName` no
                    // payload, a conta nova herda o nome que esta empresa já exibia.
                    name: ownerNameInput || contaAtual?.name || null,
                    passwordHash: await hashDeSenhaInutilizavel(),
                    role: "user",
                    status: STATUS_DA_CONTA_NOVA,
                    accountType: "CLIENT",
                  },
                });
                await tx.companyClientUser.create({
                  data: {
                    companyId: portalCompanyId,
                    userId: contaNova.id,
                    role: "OWNER",
                    status: "ACTIVE",
                  },
                });
                // ⚠ SÓ O VÍNCULO DESTA EMPRESA SAI, e pelo `id` do vínculo — nunca por `userId`,
                // que alcançaria as outras e seria o mesmo arrasto em outra direção. Sem esta
                // linha o login ANTIGO continuaria enxergando a empresa editada: o defeito
                // consertado pela metade.
                await tx.companyClientUser.update({
                  where: { id: ownerLink.id },
                  data: { status: "REMOVED" },
                });
                acessoNovo = {
                  userId: contaNova.id,
                  email: ownerEmailInput,
                  // A tela aponta para a ação que JÁ existe (Credenciais → Acesso ao portal).
                  semSenha: true,
                };
              } else if (decisao === DECISAO.MANTER_CONTA) {
                // ⚠⚠ O E-MAIL NÃO MUDOU (02/09/2026) — nada a fazer com a conta, e o salvar SEGUE.
                // Era aqui que o cadastro inteiro morria: com o mesmo e-mail e conta de 2+
                // empresas, a decisão pedia confirmação de uma troca que não existia.
                // ⚠ O NOME só é atualizado em conta de UMA empresa: renomear uma conta que atende
                //   outras é o arrasto de 19/08/2026 (defeito de produção) por outra porta. Numa
                //   conta compartilhada o nome fica como está — e o salvar do resto não é
                //   bloqueado por isso.
                if (ownerNameInput && Number(vinculosDaConta) <= 1) {
                  await tx.user.update({ where: { id: ownerLink.userId }, data: { name: ownerNameInput } });
                }
              } else if (decisao === DECISAO.RENOMEAR) {
                // RENOMEAR — o caminho de sempre, intacto.
                //
                // ⚠⚠ A CONDIÇÃO É EXPLÍCITA, e antes era um `else` solto. Com a saída nova
                // (`VINCULAR_CONTA_EXISTENTE`) o `else` passaria a alcançá-la e faria
                // `user.update({ email })` sobre a conta ANTIGA com o e-mail de uma conta que JÁ
                // EXISTE — colisão no `@unique` de `User.email`, e a empresa recém-vinculada
                // voltaria como `unique_constraint_violation`. Ramo novo tem de entrar bloqueado
                // por construção, nunca herdar o `else` de quem veio antes.
                const userData = {};
                if (ownerEmailInput) userData.email = ownerEmailInput;
                if (ownerNameInput) userData.name = ownerNameInput;
                if (Object.keys(userData).length) {
                  await tx.user.update({ where: { id: ownerLink.userId }, data: userData });
                }
              }
            }
            if (ownerEmailInput && updatedLegacy?.clientId) {
              // ⚠ MESMA CLASSE DE DEFEITO NA TABELA LEGADA. `Client` tem `companies Company[]` e
              // `CompanyProvisioningService` REUSA o `Client` por e-mail — N empresas podem
              // apontar para um `Client` só, e este `update` renomeava o de todas elas.
              // ⚠ Medido: NADA em `routes/auth.js` autentica contra `Client` (a única leitura é
              // `ClientRepository`), então isto é DADO, não login — mas dado errado para N-1
              // empresas. Compartilhado, fica como está; a conta do portal, que é o login, já foi
              // separada acima.
              const companiesDoClient = await tx.company.count({
                where: { clientId: updatedLegacy.clientId },
              });
              // ⚠⚠ E ELE DERRUBAVA A TROCA DE RESPONSAVEL INTEIRA — defeito medido em producao,
              // 02/09/2026, e relatado pelo dono como *"nao consigo alterar o responsavel das
              // empresas"*.
              //
              // `Client.email` e `Client.login` sao os DOIS `@unique`. Este update roda na MESMA
              // transacao, DEPOIS de o vinculo ja ter sido gravado: batendo no `@unique` ele
              // estoura P2002 e a transacao INTEIRA volta atras. O contador confirma o vinculo,
              // recebe um erro tecnico, e nada muda — inclusive o cadastro, que tambem e desfeito.
              //
              // ⚠ Nao e caso de borda: medido, 22 dos 24 e-mails de responsavel da carteira JA
              // existem como `Client`, e 20 das 34 empresas entram neste `if`. Vincular a conta de
              // alguem que ja e dono de outra empresa — que e exatamente o pedido do dono,
              // *"damos o acesso da mesma pessoa a todas as suas empresas"* — batia SEMPRE.
              //
              // ⚠ A saida e PULAR, nao repontar `Company.clientId`: o `Client` legado carrega
              // `invoices` e `serviceInvoices`, e mover a empresa de dono legado arrastaria nota
              // fiscal junto. E ele NAO e login (o comentario acima ja mede isso: nada em
              // `routes/auth.js` autentica contra `Client`), entao o dado ficar com o e-mail
              // antigo e uma imprecisao — perder a troca do responsavel e o defeito.
              const clientComEsseEmail = await tx.client.findFirst({
                where: {
                  OR: [{ email: ownerEmailInput }, { login: ownerEmailInput }],
                  NOT: { id: updatedLegacy.clientId },
                },
                select: { id: true },
              });
              if (companiesDoClient <= 1 && !clientComEsseEmail) {
                await tx.client.update({
                  where: { id: updatedLegacy.clientId },
                  data: { email: ownerEmailInput, login: ownerEmailInput },
                });
              }
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
                select: { email: true, name: true },
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
            ownerName: ownerLinkAfter?.user?.name || null,
          });
        }, {
          // ⚠ ESTA TRANSAÇÃO FAZ ~18 IDAS AO BANCO (portal, company, sócios, histórico, o bloco do
          //   responsável com até 6 consultas, os dois `findFirst`, a releitura). O padrão do Prisma
          //   é `timeout: 5000` / `maxWait: 2000` — contra o Postgres do Railway isso estoura como
          //   P2028, que a rota devolve como `internal_error` SEM NOME: "não salva nada", de novo,
          //   por outro caminho. Apontado na auditoria de 02/09/2026.
          timeout: 20_000,
          maxWait: 5_000,
        });
        const [comCompliance] = await attachGuideComplianceToCompaniesList([result]);
        const [company] = await anexarQuemLiberouEmissao([comCompliance]);
        // ⚠ `acessoNovo` só existe quando um acesso PRÓPRIO foi criado. A tela usa a presença dele
        // para mandar o contador definir a senha ANTES de avisar o cliente — a conta nasce sem
        // senha utilizável, e sem esse aviso o cliente descobre isso tentando entrar.
        return res.json({
          ok: true,
          company,
          ...(acessoNovo ? { acessoNovo } : {}),
          // ⚠ `acessoVinculado` e `acessoNovo` sao MUTUAMENTE EXCLUSIVOS e dizem coisas
          // diferentes: um acesso foi CRIADO (nasce sem senha) x esta empresa passou a pertencer
          // a uma conta que JA EXISTIA (e ja tem a senha dela). Colapsar os dois faria a tela
          // oferecer "definir senha" para quem nao precisa.
          ...(acessoVinculado ? { acessoVinculado } : {}),
        });
      } catch (err) {
        if (err?.code === "PORTAL_COMPANY_NOT_FOUND") {
          return res.status(404).json({ error: "portal_company_not_found" });
        }
        if (err?.code === "OWNER_EMAIL_CONTA_EXISTENTE") {
          // ⚠⚠ SUBSTITUI o antigo `owner_email_already_in_use`, que era RECUSA FINAL.
          // Hoje isto e PEDIDO DE CONFIRMACAO: o contador reenvia o mesmo formulario com
          // `confirmarNovoAcesso: true` e a empresa e vinculada a conta que ja existe.
          // Decisao do dono, 30/08/2026.
          // ⚠ ESPALHADO no corpo, exatamente como o `owner_email_conta_compartilhada` acima:
          // `detalhesDaContaCompartilhada` (front) le os campos NO TOPO do payload. Aninhar em
          // `detalhes` faria a tela receber o 409 e nao achar nada — confirmacao que nunca abre.
          return res.status(409).json({
            error: "owner_email_conta_existente",
            ...(err.detalhes || {}),
          });
        }
        // ⚠ 409 com os DADOS DO ATO, não um erro seco: é este corpo que a tela repete ao contador
        // (quais empresas o e-mail atende, o que acontece com cada lado, e que a conta nova nasce
        // sem senha). Sem ele a confirmação viraria "tem certeza?", que se aprende a clicar sem ler.
        if (err?.code === "OWNER_EMAIL_CONTA_COMPARTILHADA") {
          return res.status(409).json({
            error: "owner_email_conta_compartilhada",
            ...(err.detalhes || {}),
          });
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

  // Módulo Fiscal M2 — SPIKE read-only por CNPJ direto (não depende da empresa estar no banco).
  // Serviço /Consultar (leitura, SEM ato fiscal). Só descobre PDF vs estruturado. Não persiste.
  // Gated: admin/contador + flag SERPRO_DCTFWEB_LP_PROBE_ENABLED. Body: { cnpj, competencia, idServico?, categoria?, dados? }
  router.post("/serpro/dctfweb/probe", requireAccountType("FIRM"), async (req, res) => {
    if (!SERPRO_DCTFWEB_LP_PROBE_ENABLED) {
      return res.status(403).json({ ok: false, error: "probe_disabled", message: "Ligue SERPRO_DCTFWEB_LP_PROBE_ENABLED=1 para rodar o spike." });
    }
    const appRole = String(req.auth?.user?.role || "").toLowerCase();
    if (!["admin", "contador"].includes(appRole)) {
      return res.status(403).json({ ok: false, error: "forbidden_admin_or_contador_only" });
    }
    const cnpj = String(req.body?.cnpj || "").replace(/\D+/g, "");
    const competencia = String(req.body?.competencia || "").trim();
    const idServico = req.body?.idServico ? String(req.body.idServico).trim() : undefined;
    const categoria = req.body?.categoria ? String(req.body.categoria).trim() : undefined;
    const dadosOverride = req.body?.dados && typeof req.body.dados === "object" ? req.body.dados : undefined;
    if (cnpj.length !== 14) return res.status(400).json({ ok: false, error: "cnpj_invalido", message: "cnpj com 14 dígitos" });
    if (!/^\d{4}-\d{2}$/.test(competencia)) return res.status(400).json({ ok: false, error: "competencia_required", message: "competencia YYYY-MM" });
    try {
      const out = await probeConsultarDeclaracaoCompleta({ contribuinteCnpj: cnpj, competencia, idServico, categoria, dadosOverride });
      log.warn({ cnpj: cnpj.slice(0, 5) + "***", competencia, idServico: out.idServico, httpStatus: out.httpStatus, temPdf: out.temPdf, temDados: out.temDadosEstruturados }, "SPIKE DCTFWeb probe (cnpj direto)");
      return res.json({ ok: true, ...out });
    } catch (err) {
      const code = err?.code || "SERPRO_DCTFWEB_PROBE_FAILED";
      log.error({ err: err?.message || err, code, competencia }, "Falha no probe DCTFWeb (cnpj direto)");
      return res.status(502).json({ ok: false, error: code, reason: err?.message || "Erro", retryable: Boolean(err?.retryable) });
    }
  });

  // Módulo Fiscal M2 — SPIKE: probe do Emitir DARF DCTFWeb (GERARGUIA31) por CNPJ direto.
  // /Emitir deriva da declaração já transmitida (não envia info, não paga). NÃO persiste.
  // Gated: admin/contador + flag. Body: { cnpj, competencia, categoria?, idServico?, dados? }
  router.post("/serpro/dctfweb/probe-darf", requireAccountType("FIRM"), async (req, res) => {
    if (!SERPRO_DCTFWEB_LP_PROBE_ENABLED) {
      return res.status(403).json({ ok: false, error: "probe_disabled", message: "Ligue SERPRO_DCTFWEB_LP_PROBE_ENABLED=1 para rodar o spike." });
    }
    const appRole = String(req.auth?.user?.role || "").toLowerCase();
    if (!["admin", "contador"].includes(appRole)) {
      return res.status(403).json({ ok: false, error: "forbidden_admin_or_contador_only" });
    }
    const cnpj = String(req.body?.cnpj || "").replace(/\D+/g, "");
    const competencia = String(req.body?.competencia || "").trim();
    const categoria = req.body?.categoria ? String(req.body.categoria).trim() : undefined;
    const idServico = req.body?.idServico ? String(req.body.idServico).trim() : undefined;
    const dadosOverride = req.body?.dados && typeof req.body.dados === "object" ? req.body.dados : undefined;
    if (cnpj.length !== 14) return res.status(400).json({ ok: false, error: "cnpj_invalido", message: "cnpj com 14 dígitos" });
    if (!/^\d{4}-\d{2}$/.test(competencia)) return res.status(400).json({ ok: false, error: "competencia_required", message: "competencia YYYY-MM" });
    try {
      const out = await probeEmitirDarfDctfweb({ contribuinteCnpj: cnpj, competencia, categoria, idServico, dadosOverride });
      log.warn({ cnpj: cnpj.slice(0, 5) + "***", competencia, idServico: out.idServico, httpStatus: out.httpStatus, temPdf: out.temPdf, valor: out.parsed?.valor }, "SPIKE DCTFWeb probe-darf");
      return res.json({ ok: true, ...out });
    } catch (err) {
      const code = err?.code || "SERPRO_DCTFWEB_DARF_PROBE_FAILED";
      log.error({ err: err?.message || err, code, competencia }, "Falha no probe-darf DCTFWeb");
      return res.status(502).json({ ok: false, error: code, reason: err?.message || "Erro", retryable: Boolean(err?.retryable) });
    }
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
        // Agenda por rotina — re-hidrata a página Rotinas com o valor recém-salvo.
        rotinas: settings.rotinas,
        certificate: settings.certificate,
        source: settings.source,
      },
    });
  });

  // ── Rotinas: QUEM (empresa × rotina) + QUANDO (agenda global por rotina) ──
  // A agenda vive em SerproRuntimeSettings.rotinas; a seleção por empresa, no model
  // CompanyRotina. O GET semeia a partir da regra implícita que os workers usavam
  // (Simples→DAS+extrato+parcelamento, LP→presumido, INSS→todas), então a primeira
  // abertura da tela já reflete o que o sistema faz hoje.
  router.get("/rotinas", requireAccountType("FIRM"), async (req, res) => {
    const appRole = String(req.auth?.user?.role || "").toLowerCase();
    if (!["admin", "contador"].includes(appRole)) {
      return res.status(403).json({ error: "forbidden_admin_or_contador_only" });
    }
    const [empresas, settings] = await Promise.all([
      listCompanyRotinas(),
      getSerproRuntimeSettings(),
    ]);
    return res.json({
      ok: true,
      rotinas: ROTINA_KEYS.map((key) => ({ key, label: ROTINA_LABELS[key] })),
      agenda: settings.rotinas,
      empresas,
    });
  });

  router.put("/rotinas", requireAccountType("FIRM"), async (req, res) => {
    const appRole = String(req.auth?.user?.role || "").toLowerCase();
    if (!["admin", "contador"].includes(appRole)) {
      return res.status(403).json({ error: "forbidden_admin_or_contador_only" });
    }
    const { empresas, agenda } = req.body || {};
    const resultado = { atualizadas: 0 };
    if (Array.isArray(empresas) && empresas.length > 0) {
      const r = await saveCompanyRotinas(empresas);
      resultado.atualizadas = r.atualizadas;
    }
    // Só os campos de agenda — updateSerproRuntimeSettings faz merge e preserva credenciais.
    let settings = null;
    if (agenda && typeof agenda === "object") {
      settings = await updateSerproRuntimeSettings({ rotinas: agenda });
    } else {
      settings = await getSerproRuntimeSettings();
    }
    return res.json({ ok: true, ...resultado, agenda: settings.rotinas });
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
              // ⚠ Dizia "colocada na fila. O envio automático será tentado depois." — duas frases
              // falsas na mesma linha desde a Q55: não há fila e não há envio automático.
              message: GUIA_AGUARDA_ENVIO_MANUAL,
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
        // ⚠⚠ O PÚBLICO decide o VALOR mostrado desde 30/08/2026: o escritório vê o do extrato do
        // PGDAS-D (com o de cobrança no badge "↻"); o cliente vê o que ele PAGA. O default da
        // função é o público estreito, então esta linha não é cerimônia — sem ela o contador perde
        // o enriquecimento que esta tela existe para mostrar.
        publico: PUBLICO.ESCRITORIO,
      });
      return res.json({
        // ⚠⚠ NUNCA `.map(toGuideResponse)` CRU: o `map` passa o ÍNDICE como 2º argumento, e o 2º
        // argumento agora é `{ publico }` — a guia 0 seria serializada com `publico: 0`.
        data: result.items.map((g) => toGuideResponse(g, { publico: PUBLICO.ESCRITORIO })),
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
          guide: toGuideResponse(result.guide, { publico: PUBLICO.ESCRITORIO }),
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

  // ⚠ AS LITERAIS `/guides/vazio` VÊM ANTES DO CURINGA `/guides/:guideId` — ORDEM, NÃO ESTILO.
  //
  // O Express casa na ORDEM DE REGISTRO. Com o curinga registrado antes, todo
  // `DELETE /firm/guides/vazio` caía nele com `guideId="vazio"`, não achava guia nenhuma e
  // respondia `404 guide_not_found` — o handler do curinga responde, nunca chama `next()`.
  // Ou seja: MARCAR funcionava e DESMARCAR nunca funcionou, com um 404 que falava de uma guia
  // inexistente em vez de dizer que a rota não fora alcançada.
  //
  // O estrago não parava no botão: o marcador VAZIO ficava preso, `computeGuideComplianceMap`
  // seguia devolvendo `ok: true` para aquele tributo, a empresa sumia do filtro de pendências e o
  // card podia condensar em "✓ Guias concluídas" — enquanto a guia que faltava de verdade nunca era
  // cobrada. A guarda `mes_fechado` da rota de desfazer também nunca chegava a rodar.
  //
  // Mesmo defeito, mesmo conserto e mesmo espírito de teste de `parcelamentosRotasLiterais.test.js`
  // (`/parcelamentos/contas-provisao` engolida por `/parcelamentos/:parcId`). A ordem está travada
  // por `guidesVazioRotasLiterais.test.js` — reintroduzir o curinga na frente deixa ele vermelho.
  //
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

      // ⚠ AVISA CONTRA A EVIDÊNCIA — NÃO RECUSA MAIS. Decisão do dono, 18/08/2026:
      //
      //   "nas empresas presumidas ele não permite marcar as guias faltantes como vazia, por conta
      //    do faturamento, mas às vezes não teremos guias mesmo com faturamento, o contador deve
      //    poder marcar vazio"
      //
      // A recusa dura confundia DUAS coisas: "houve receita" e "logo existe guia". No Simples elas
      // andam juntas; no LUCRO PRESUMIDO, não — IRPJ e CSLL são trimestrais (nos dois primeiros
      // meses do trimestre há faturamento e não há DARF), o valor pode ficar abaixo do mínimo de
      // recolhimento, e a retenção na fonte pode cobrir o tributo. A guarda bloqueava trabalho
      // legítimo, e não havia saída pela tela.
      //
      // O que ela protegia continua protegido, por EVIDÊNCIA em vez de parede — é o padrão que
      // este módulo já usa em `avisosDeDuplicidade` ("DUPLICIDADE AVISA, NUNCA RECUSA"):
      //   1. a evidência volta para a tela e a confirmação a repete;
      //   2. o `confirmado` tem de vir explícito — não é o clique normal que passa;
      //   3. o MOTIVO passa a ser OBRIGATÓRIO neste caminho (fora dele segue opcional).
      // Sem o motivo, "por que o contador afirmou ausência havendo nota?" não teria resposta numa
      // fiscalização — e essa pergunta é a razão de a guarda ter existido.
      const faturamento = await faturamentoEmitDaCompetencia(portalClientId, competencia).catch(() => 0);
      const motivoInformado = String(req.body?.motivo || "").trim();
      if (faturamento > 0) {
        const valorFmt = faturamento.toLocaleString("pt-BR", { minimumFractionDigits: 2 });
        if (req.body?.confirmado !== true) {
          return res.status(409).json({
            ok: false,
            error: "GUIA_VAZIA_COM_FATURAMENTO",
            // ⚠ O CÓDIGO É O MESMO, mas o significado mudou de "não dá" para "confirme".
            // `precisaConfirmar` é o que distingue os dois para quem lê a resposta.
            precisaConfirmar: true,
            faturamento,
            message: `A competência tem R$ ${valorFmt} em notas emitidas autorizadas. Marcar esta guia como sem movimento afirma que, mesmo assim, não há guia a pagar — confirme e diga o motivo.`,
          });
        }
        if (!motivoInformado) {
          return res.status(400).json({
            ok: false,
            error: "GUIA_VAZIA_MOTIVO_OBRIGATORIO",
            faturamento,
            message: `Com R$ ${valorFmt} em notas na competência, o motivo é obrigatório.`,
          });
        }
      }

      // Auditoria em campos PRÓPRIOS. `reviewedAt`/`reviewedByUserId` seguem sendo escritos por
      // compatibilidade, mas o registro manual de guia também os usa — não davam para distinguir
      // "marquei vazio" de "registrei guia à mão", e nem apareciam no contrato.
      const auditoria = {
        vazioEm: new Date(),
        vazioPor: req.auth?.user?.id || null,
        vazioMotivo: motivoInformado || null,
      };
      const guide = existing
        ? await prisma.guide.update({
            where: { id: existing.id },
            data: {
              status: "VAZIO", source: "MANUAL",
              reviewedByUserId: req.auth?.user?.id || null, reviewedAt: new Date(),
              ...auditoria,
            },
          })
        : await prisma.guide.create({
            data: {
              portalClientId, tipo, competencia,
              status: "VAZIO", source: "MANUAL",
              reviewedByUserId: req.auth?.user?.id || null, reviewedAt: new Date(),
              ...auditoria,
            },
          });
      return res.json({
        ok: true, guideId: guide.id, status: guide.status,
        vazioEm: guide.vazioEm, vazioPor: guide.vazioPor, vazioMotivo: guide.vazioMotivo,
      });
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
    // Simétrico ao POST: se o mês está fechado, não se marca NEM se desmarca. A assimetria antiga
    // deixava desfazer uma afirmação fiscal dentro de um mês já fechado, sem reabertura.
    if (await isMonthClosed(portalClientId, competencia)) {
      return res.status(409).json({ ok: false, error: "mes_fechado", message: "Mês fechado — reabra a empresa para alterar guias desta competência." });
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

  // ⚠ REGISTRADO DEPOIS DAS LITERAIS `/guides/vazio` — E A ORDEM É O CONSERTO, ver acima.
  router.delete("/guides/:guideId", requireAccountType("FIRM"), async (req, res) => {
    const appRole = String(req.auth?.user?.role || "").toLowerCase();
    if (!["admin", "contador"].includes(appRole)) {
      return res.status(403).json({ error: "forbidden_admin_or_contador_only" });
    }
    const { guideId } = req.params;
    try {
      const guide = await prisma.guide.findFirst({
        where: { id: String(guideId) },
        select: { id: true, portalClientId: true, competencia: true, extracted: true },
      });
      if (!guide) {
        return res.status(404).json({ ok: false, error: "guide_not_found" });
      }

      // Q61: excluir a guia deve fazê-la SUMIR da Circular — remove as provisões derivadas + reverte o
      // split de acréscimos. Só remove o SEGURO (não exportado, não pago, sem baixa); se houver
      // lançamento pago/baixado/exportado, BLOQUEIA (integridade contábil — desfaça a baixa antes).
      const derivadas = await prisma.accountingEntry.findMany({
        where: { sourceGuideId: guide.id, tipo: { in: ["PROVISAO", "BAIXA"] } },
        select: { id: true, tipo: true, status: true, statusPagamento: true, baixas: { select: { id: true }, take: 1 } },
      });
      const bloqueia = derivadas.some(
        (e) => e.tipo === "BAIXA" || e.status === "EXPORTADO" || e.statusPagamento === "PAGO" || (e.baixas && e.baixas.length),
      );
      if (bloqueia) {
        return res.status(409).json({
          ok: false, error: "GUIA_COM_LANCAMENTO",
          message: "Há lançamento pago/baixado/exportado vinculado a esta guia. Desfaça a baixa antes de excluir.",
        });
      }

      // Tributos desta guia (composição LP) pra limpar do split de acréscimos da circular.
      const CODIGO_TRIBUTO = { "8109": "PIS", "2172": "COFINS", "2089": "IRPJ", "2372": "CSLL" };
      const composicao = Array.isArray(guide.extracted?.composicao) ? guide.extracted.composicao : [];
      const tributos = new Set();
      for (const c of composicao) {
        const t = c?.tributo || CODIGO_TRIBUTO[String(c?.codigo || "")];
        if (t) tributos.add(t);
      }

      await prisma.$transaction(async (tx) => {
        for (const e of derivadas) {
          await tx.accountingEntryLine.deleteMany({ where: { entryId: e.id } });
          await tx.accountingEntry.delete({ where: { id: e.id } });
        }
        if (tributos.size && guide.competencia) {
          const where = { portalClientId_competencia: { portalClientId: guide.portalClientId, competencia: guide.competencia } };
          const circ = await tx.companyMonthlyCircular.findUnique({ where, select: { acrescimos: true } }).catch(() => null);
          if (circ?.acrescimos && typeof circ.acrescimos === "object") {
            const next = { ...circ.acrescimos };
            for (const t of tributos) delete next[t];
            await tx.companyMonthlyCircular.update({ where, data: { acrescimos: next } });
          }
        }
        await tx.guide.delete({ where: { id: guide.id } });
      });

      return res.json({ ok: true, guideId: guide.id, provisoesRemovidas: derivadas.length });
    } catch (err) {
      log.error({ err }, "Falha ao excluir guia");
      return res.status(500).json({ ok: false, error: "guide_delete_failed", message: err?.message });
    }
  });

  // ─── CONTATOS DE WHATSAPP ──────────────────────────────────────────────────────────────────
  // Pré-requisito do envio pelo canal. Sem contato com opt-in, a empresa cai para e-mail no lote.

  router.get("/companies/:companyId/contatos-whatsapp", requireFirmCompanyAccess(), async (req, res) => {
    try {
      return res.json({ ok: true, contatos: await listarContatos(req.params.companyId) });
    } catch (err) {
      log.error({ err }, "Falha ao listar contatos de WhatsApp");
      return res.status(500).json({ ok: false, error: "contatos_list_failed", message: err?.message });
    }
  });

  router.post("/companies/:companyId/contatos-whatsapp", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    try {
      // ⚠ A EMPRESA VEM DEPOIS DO SPREAD, e a ordem é a garantia: com o `portalClientId` antes, um
      // `portalClientId` no CORPO sobrescrevia o do path — o corpo escolhendo o tenant que a
      // autorização já havia decidido.
      const contato = await salvarContato({ ...(req.body || {}), portalClientId: req.params.companyId });
      return res.json({ ok: true, contato });
    } catch (err) {
      // Erro de validação é do USUÁRIO e tem conserto na tela — 400 com a mensagem pronta, não 500.
      if (err instanceof ContatoWhatsappError) {
        return res.status(400).json({ ok: false, error: err.code, message: err.message });
      }
      log.error({ err }, "Falha ao salvar contato de WhatsApp");
      return res.status(500).json({ ok: false, error: "contato_save_failed", message: err?.message });
    }
  });

  router.delete("/companies/:companyId/contatos-whatsapp/:contatoId", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    try {
      // ⚠ A empresa do PATH viaja junto: é ela que a autorização conferiu, e sem ela o alvo seria
      // escolhido só pelo id — um contato de outra empresa cairia dentro do acesso deste chamador.
      await removerContato(req.params.companyId, req.params.contatoId);
      return res.json({ ok: true });
    } catch (err) {
      log.error({ err }, "Falha ao remover contato de WhatsApp");
      return res.status(500).json({ ok: false, error: "contato_delete_failed", message: err?.message });
    }
  });

  // A CARTEIRA INTEIRA × contato — é a tela de importação assistida.
  //
  // ⚠ Sem ela o primeiro lote nasce manco: o contador teria que abrir empresa por empresa para
  // descobrir quais têm contato. Aqui ele vê as trinta de uma vez, com as vazias em destaque.
  router.get("/contatos-whatsapp", async (req, res) => {
    try {
      const portalIds = await empresasVisiveis(req);
      const [empresas, contatos] = await Promise.all([
        prisma.portalClient.findMany({
          where: { id: { in: portalIds } },
          select: { id: true, razao: true, cnpj: true, canalPadraoEnvio: true, guideNotificationEmail: true },
          orderBy: { razao: "asc" },
        }),
        prisma.contatoWhatsapp.findMany({
          where: { portalClientId: { in: portalIds } },
          orderBy: { createdAt: "asc" },
        }),
      ]);
      const porEmpresa = new Map();
      for (const c of contatos) {
        if (!porEmpresa.has(c.portalClientId)) porEmpresa.set(c.portalClientId, []);
        porEmpresa.get(c.portalClientId).push(c);
      }
      return res.json({
        ok: true,
        empresas: empresas.map((e) => {
          const lista = porEmpresa.get(e.id) || [];
          const comOptIn = lista.find((c) => c.optInEm && c.ativo);
          return {
            ...e,
            contatos: lista,
            // Os três estados que a tela precisa distinguir — e que o contador conserta de formas
            // diferentes: cadastrar, pedir autorização, ou nada.
            situacao: !lista.length ? "sem_contato" : !comOptIn ? "sem_optin" : "ok",
          };
        }),
      });
    } catch (err) {
      log.error({ err }, "Falha ao listar contatos da carteira");
      return res.status(500).json({ ok: false, error: "contatos_carteira_failed", message: err?.message });
    }
  });

  router.patch("/companies/:companyId/canal-envio", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const canal = String(req.body?.canalPadraoEnvio || "").toUpperCase();
    if (!CANAL_PADRAO.includes(canal)) {
      return res.status(400).json({ ok: false, error: "canal_invalido", message: `Canal deve ser um de: ${CANAL_PADRAO.join(", ")}` });
    }
    try {
      await prisma.portalClient.update({ where: { id: String(req.params.companyId) }, data: { canalPadraoEnvio: canal } });
      return res.json({ ok: true, canalPadraoEnvio: canal });
    } catch (err) {
      log.error({ err }, "Falha ao definir canal de envio");
      return res.status(500).json({ ok: false, error: "canal_update_failed", message: err?.message });
    }
  });

  // ⚠ A PORTA DO CONTADOR PARA O PORTÃO DA EMISSÃO — decisão do dono, 18/08/2026:
  // *"o acesso a emissão deve ser liberado para o cliente pelo portal do contador"*.
  //
  // Quem consome a chave gravada aqui é `routes/middlewares/emissaoNfseGate.js`, nos dois atos
  // fiscais (`POST /nfse/issue` e `POST /nfse/:chave/eventos`). LIGAR aqui faz usuários
  // `CLIENT_ADMIN`/`OWNER` desta empresa passarem a emitir NFS-e **em produção, em nome dela** —
  // por isso `minRole: "ACCOUNTANT"`, o mesmo gate de `canal-envio` e dos contatos de WhatsApp.
  router.patch(
    "/companies/:companyId/emissao-cliente",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId || "").trim();
      // ⚠ `Boolean(req.body?.liberada)` aceitaria "false" (string) como TRUE e ligaria o portão
      // por erro de digitação de um chamador. Ato de consequência recebe booleano de verdade.
      const liberada = req.body?.liberada;
      if (typeof liberada !== "boolean") {
        return res.status(400).json({
          ok: false,
          error: "liberada_invalida",
          message: "O campo `liberada` deve ser booleano (true para liberar, false para revogar).",
        });
      }
      const userId = String(req.auth?.user?.id || "") || null;
      try {
        // ⚠ DESLIGAR VOLTA `Em`/`Por` A NULO. As duas colunas respondem "quem autorizou este
        // cliente a emitir?" — guardar nelas o instante da REVOGAÇÃO daria dois significados a uma
        // coluna só (o erro documentado em "TRÊS NÚMEROS DE DAS, TRÊS COLUNAS"). Quem revogou fica
        // no log abaixo. É o mesmo desenho do `reabrir` do fechamento contábil, que também zera
        // `fechadoContabilEm`/`Por`.
        const atualizado = await prisma.portalClient.update({
          where: { id: portalClientId },
          data: liberada
            ? {
                emissaoClienteLiberada: true,
                emissaoClienteLiberadaEm: new Date(),
                emissaoClienteLiberadaPor: userId,
              }
            : {
                emissaoClienteLiberada: false,
                emissaoClienteLiberadaEm: null,
                emissaoClienteLiberadaPor: null,
              },
          select: {
            id: true,
            razao: true,
            emissaoClienteLiberada: true,
            emissaoClienteLiberadaEm: true,
            emissaoClienteLiberadaPor: true,
          },
        });
        log.info(
          { portalClientId, liberada, userId, razao: atualizado.razao },
          liberada
            ? "Emissão de NFS-e pelo cliente LIBERADA pelo escritório"
            : "Emissão de NFS-e pelo cliente REVOGADA pelo escritório"
        );
        // O nome sai na resposta para a tela poder dizer "liberado por Fulano em …" sem uma
        // segunda chamada; a coluna continua guardando o userId.
        const autor = atualizado.emissaoClienteLiberadaPor
          ? await prisma.user
              .findUnique({
                where: { id: atualizado.emissaoClienteLiberadaPor },
                select: { name: true, email: true },
              })
              .catch(() => null)
          : null;
        return res.json({
          ok: true,
          emissaoCliente: {
            liberada: atualizado.emissaoClienteLiberada,
            liberadaEm: atualizado.emissaoClienteLiberadaEm,
            liberadaPor: atualizado.emissaoClienteLiberadaPor,
            liberadaPorNome: autor?.name || autor?.email || null,
          },
        });
      } catch (err) {
        if (err?.code === "P2025") {
          return res.status(404).json({ ok: false, error: "portal_company_not_found" });
        }
        log.error({ err }, "Falha ao alterar a liberação de emissão de NFS-e pelo cliente");
        return res.status(500).json({ ok: false, error: "emissao_cliente_update_failed" });
      }
    }
  );

  // ⚠ A ABA PRÓPRIA DE CONFIGURAÇÃO DA EMISSÃO — decisão do dono, 19/08/2026:
  // *"configuração de notas na aba do contador está ficando muito grande, vamos separar ela em uma
  // aba própria"* … *"ele ganha o próprio salvar"*.
  //
  // ⚠ POR QUE ESTA ROTA EXISTE, e por que ela NÃO é o `PATCH` do cadastro com menos campos.
  // `PATCH /firm/companies/:id` é um salvar da EMPRESA INTEIRA: `validateAndNormalizeCompanyProfile`
  // exige `cnpj`, `razaoSocial`, `cnaePrincipal` e endereço, e o `tx.company.update` de lá escreve
  // ~30 colunas de uma vez. Mandar só os campos de emissão por lá é recusado com 400 — e isso é o
  // comportamento CERTO, que fica como está: afrouxá-lo abriria a porta para meia empresa ser
  // salva por qualquer chamador. Daí uma rota que aceita SÓ estes campos, no molde da
  // `emissao-cliente` logo acima (mesmo lugar, mesmo gate `ACCOUNTANT`+).
  //
  // ⚠ `undefined` = NÃO MEXER · `null` = APAGAR. É a regra que o commit `11187501` já fixou nestes
  // mesmos campos, e aqui ela é a diferença entre "salvei a série" e "apaguei a carga tributária
  // que o contador tinha acabado de configurar". Campo que não veio no corpo NÃO ENTRA no `data`
  // do Prisma — é o `hasOwnProperty` abaixo, não um `?? null`.
  //
  // ⚠ A NORMALIZAÇÃO É A MESMA do cadastro (`normalizeCamposEmissaoNfse`), importada e não
  // reescrita: duas normalizações dos mesmos campos divergiriam na primeira correção, e o mesmo
  // valor seria aceito por uma porta e recusado pela outra.
  //
  // ⚠ A LIBERAÇÃO DE EMISSÃO PELO CLIENTE NÃO ENTRA AQUI. Ela tem a rota dela
  // (`PATCH .../emissao-cliente`), com confirmação e auditoria de quem/quando — é ato fiscal, não
  // configuração. Duas rotas para o mesmo ato é o começo de duas regras.
  const CAMPOS_EMISSAO_NFSE = [
    "codigoServicoNacional",
    "codigosServicoNacional",
    "codigoServicoMunicipal",
    "rpsSerie",
    "pTotTribFed",
    "pTotTribEst",
    "pTotTribMun",
    // ⚠ O BENEFÍCIO MUNICIPAL ENTRA NA MESMA PORTA que os demais campos da configuração de
    // emissão — é configuração fiscal da `Company`, salva pela mesma aba. Fora desta lista a rota
    // RECUSA nomeando o campo, e o cadastro nunca chegaria a existir.
    "beneficioMunicipalNumero",
    "beneficioMunicipalTipoReducao",
    "beneficioMunicipalPRedBC",
  ];

  router.patch(
    "/companies/:companyId/emissao-nfse",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId || "").trim();
      const body = req.body && typeof req.body === "object" ? req.body : {};

      // ⚠ CAMPO DE FORA É RECUSADO, NOMEANDO-O — não ignorado em silêncio. Aceitar e descartar é o
      // defeito que esta base já pagou caro (`codigoServicoNacional` chegava no corpo, passava pelo
      // Zod e morria na lista de colunas: 200 na resposta e campo vazio na recarga). Quem quiser
      // salvar telefone continua tendo a rota do cadastro.
      const intrusos = Object.keys(body).filter((k) => !CAMPOS_EMISSAO_NFSE.includes(k));
      if (intrusos.length) {
        return res.status(400).json({
          ok: false,
          error: "campos_nao_aceitos",
          campos: intrusos,
          message:
            `Esta rota salva apenas a configuração de emissão de NFS-e (${CAMPOS_EMISSAO_NFSE.join(", ")}). `
            + `Recebeu também: ${intrusos.join(", ")}. O restante do cadastro é salvo em PATCH /firm/companies/:id.`,
        });
      }
      const enviados = CAMPOS_EMISSAO_NFSE.filter((c) =>
        Object.prototype.hasOwnProperty.call(body, c)
      );
      if (!enviados.length) {
        return res.status(400).json({
          ok: false,
          error: "nenhum_campo_de_emissao",
          message: "Nenhum campo de configuração de emissão veio no corpo — não há o que salvar.",
        });
      }

      const normalizado = normalizeCamposEmissaoNfse(body);
      if (!normalizado.ok) return res.status(400).json({ ok: false, error: normalizado.error });
      const {
        codigoServicoNacionalFinal,
        codigosServicoNacional,
        codigoServicoMunicipal,
        rpsSerie,
        percentuais,
        beneficio,
      } = normalizado.data;

      try {
        const portal = await prisma.portalClient.findUnique({
          where: { id: portalClientId },
          select: { id: true, razao: true, companyId: true },
        });
        if (!portal?.id) {
          return res.status(404).json({ ok: false, error: "portal_company_not_found" });
        }
        // ⚠ SEM LINHA LEGADA NÃO HÁ ONDE GRAVAR, e a resposta DIZ ISSO. As sete colunas vivem em
        // `Company`, não em `PortalClient`. Responder 200 aqui seria o pior desfecho: o contador
        // configuraria a empresa, a tela diria "salvo" e a emissão continuaria recusando.
        if (!portal.companyId) {
          return res.status(409).json({
            ok: false,
            error: "company_legada_ausente",
            message:
              "Esta empresa não tem cadastro legado (Company) — não há onde gravar a configuração de "
              + "emissão de NFS-e. Salve o cadastro da empresa antes.",
          });
        }

        // ⚠ AQUI ESTÁ A REGRA INTEIRA: só entra no `data` o que veio no corpo. Um `data` montado
        // com os sete campos sempre apagaria, a cada salvar desta aba, tudo que a tela não tivesse
        // enviado — inclusive a carga tributária, e a empresa pararia de emitir em silêncio.
        const data = {};
        if (Object.prototype.hasOwnProperty.call(body, "codigoServicoNacional")
          || Object.prototype.hasOwnProperty.call(body, "codigosServicoNacional")) {
          // O singular é conferido CONTRA a lista pelo normalizador (é o `Final`): com um código só
          // na lista, ele é esse código; com vários e nenhum marcado, o normalizador já recusou.
          data.codigoServicoNacional = codigoServicoNacionalFinal;
        }
        if (codigosServicoNacional !== undefined) {
          data.codigosServicoNacional = codigosServicoNacional;
        }
        if (Object.prototype.hasOwnProperty.call(body, "codigoServicoMunicipal")) {
          data.codigoServicoMunicipal = codigoServicoMunicipal || null;
        }
        if (Object.prototype.hasOwnProperty.call(body, "rpsSerie")) {
          data.rpsSerie = rpsSerie;
        }
        for (const campo of ["pTotTribFed", "pTotTribEst", "pTotTribMun"]) {
          if (percentuais[campo] !== undefined) data[campo] = percentuais[campo];
        }
        // ⚠ O `beneficio` já vem com SÓ as chaves que o corpo trouxe (o normalizador é quem separa
        // "não mexer" de "apagar"), mais a cascata: apagar o número apaga o tipo e o percentual,
        // senão o banco ficaria com um tipo apontando para benefício que não existe mais.
        Object.assign(data, beneficio);

        const atualizada = await prisma.company.update({
          where: { id: portal.companyId },
          data,
          select: {
            id: true,
            codigoServicoNacional: true,
            codigosServicoNacional: true,
            codigoServicoMunicipal: true,
            rpsSerie: true,
            pTotTribFed: true,
            pTotTribEst: true,
            pTotTribMun: true,
            beneficioMunicipalNumero: true,
            beneficioMunicipalTipoReducao: true,
            beneficioMunicipalPRedBC: true,
          },
        });
        log.info(
          { portalClientId, companyId: portal.companyId, campos: Object.keys(data), razao: portal.razao },
          "Configuração de emissão de NFS-e atualizada pela aba própria"
        );
        return res.json({
          ok: true,
          emissaoNfse: {
            codigoServicoNacional: atualizada.codigoServicoNacional,
            codigosServicoNacional: atualizada.codigosServicoNacional,
            codigoServicoMunicipal: atualizada.codigoServicoMunicipal,
            rpsSerie: atualizada.rpsSerie,
            // Decimal do Prisma não é JSON — vai como string, a mesma forma que o
            // `legacyCompanySelect` já entrega à tela.
            pTotTribFed: atualizada.pTotTribFed != null ? String(atualizada.pTotTribFed) : null,
            pTotTribEst: atualizada.pTotTribEst != null ? String(atualizada.pTotTribEst) : null,
            pTotTribMun: atualizada.pTotTribMun != null ? String(atualizada.pTotTribMun) : null,
            beneficioMunicipalNumero: atualizada.beneficioMunicipalNumero,
            beneficioMunicipalTipoReducao: atualizada.beneficioMunicipalTipoReducao,
            // Decimal do Prisma não é JSON — string, a mesma forma do `legacyCompanySelect`.
            beneficioMunicipalPRedBC:
              atualizada.beneficioMunicipalPRedBC != null
                ? String(atualizada.beneficioMunicipalPRedBC)
                : null,
          },
        });
      } catch (err) {
        if (err?.code === "P2025") {
          return res.status(404).json({ ok: false, error: "portal_company_not_found" });
        }
        log.error({ err }, "Falha ao salvar a configuração de emissão de NFS-e");
        return res.status(500).json({ ok: false, error: "emissao_nfse_update_failed" });
      }
    }
  );

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
        // ⚠ O MOTIVO DA FALHA ENTRA NA MATRIZ. `emailStatus:"ERROR"` já vinha, mas a célula pintava
        // ERROR igual a PENDING ("📄 guia") — a tentativa que falhou ficava indistinguível da que
        // nunca foi feita, na única tela onde o contador decide o que enviar. Sem `emailLastError`
        // a distinção seria "falhou, não sei por quê", que manda ele procurar em outro lugar.
        // `emailAttempts` diz se foi um tropeço ou uma falha teimosa.
        emailLastError: true, emailAttempts: true,
        // A parcela de parcelamento também é `tipo:"SIMPLES"` — é este campo que a separa do DAS.
        parcelamentoId: true,
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
      // ⚠ E a PARCELA de parcelamento também é "SIMPLES" — vai para a coluna PARC_DAS, não DAS.
      // A regra mora em `guideContract` porque o compliance do dashboard precisa da MESMA, e duas
      // cópias fariam as duas telas discordarem sobre a mesma guia.
      const upper = colunaMatrizDaGuia(g);
      const isVazio = g.status === "VAZIO";
      const stamp = {
        guideId: g.id,
        valor: g.valor != null ? Number(g.valor) : null,
        vencimento: g.vencimento,
        // Q17: vazio = ausência confirmada (sem PDF). Frontend mostra amarelo "vazio".
        vazio: isVazio,
        emailStatus: g.emailStatus || null,
        emailSentAt: g.emailSentAt || null,
        // A pergunta "a última tentativa falhou?" vem do `guideContract` — a MESMA que o chip do
        // dashboard usa. Duas leituras de `emailStatus` fariam as duas telas discordarem sobre a
        // mesma guia, que é exatamente como o `parcelamentoId` divergiu.
        falhou: envioDeEmailFalhou(g),
        emailLastError: g.emailLastError || null,
        emailAttempts: Number(g.emailAttempts || 0),
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
      // A GUIA da parcela (tem PDF, é enviável) vence a linha leve de rastreio do V1 — senão o
      // carimbo da guia era sobrescrito por um marcador sem documento e a parcela deixava de poder
      // ser selecionada no envio.
      if (row && !row.tiposGuias.PARC_DAS) row.tiposGuias.PARC_DAS = { entryId: p.id, isParcelamento: true };
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

  // Portal Cliente (#3.1): POST /guides/liberar-cliente
  // Libera as guias da competência para o app do cliente (+ dispara o e-mail). Molde do batch-send.
  // Body: { items: [{ portalClientId, competencia }] }
  router.post("/guides/liberar-cliente", requireAccountType("FIRM"), async (req, res) => {
    const appRole = String(req.auth?.user?.role || "").toLowerCase();
    if (!["admin", "contador"].includes(appRole)) {
      return res.status(403).json({ error: "forbidden_admin_or_contador_only" });
    }
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ ok: false, error: "items_required" });
    const userId = req.auth?.user?.id || null;
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
        const r = await liberarGuiasCliente({ portalClientId, competencia, userId });
        results.push({ portalClientId, competencia, ok: true, ...r });
      } catch (err) {
        log.error({ err: err?.message || err, portalClientId, competencia }, "Falha ao liberar guias ao cliente");
        results.push({ portalClientId, competencia, ok: false, error: err?.code || "GUIDE_LIBERAR_FAILED", message: err?.message });
      }
    }
    return res.json({ ok: true, total: items.length, results });
  });

  // Portal Cliente (#3.1): POST /guides/revogar-cliente — desfaz a liberação (sem e-mail).
  router.post("/guides/revogar-cliente", requireAccountType("FIRM"), async (req, res) => {
    const appRole = String(req.auth?.user?.role || "").toLowerCase();
    if (!["admin", "contador"].includes(appRole)) {
      return res.status(403).json({ error: "forbidden_admin_or_contador_only" });
    }
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ ok: false, error: "items_required" });
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
        const r = await revogarLiberacaoCliente({ portalClientId, competencia });
        results.push({ portalClientId, competencia, ok: true, ...r });
      } catch (err) {
        log.error({ err: err?.message || err, portalClientId, competencia }, "Falha ao revogar liberação de guias");
        results.push({ portalClientId, competencia, ok: false, error: err?.code || "GUIDE_REVOGAR_FAILED", message: err?.message });
      }
    }
    return res.json({ ok: true, total: items.length, results });
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
      return res.json({ ok: true, guide: toGuideResponse(updated, { publico: PUBLICO.ESCRITORIO }), emailDispatch: null });
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

      return res.json({ ok: true, guide: toGuideResponse(updated, { publico: PUBLICO.ESCRITORIO }) });
    }
  );

  // BUSCAR PAGAMENTO — consulta o comprovante no SERPRO e apenas REGISTRA o que encontrou.
  // NÃO gera lançamento contábil: a baixa continua sendo ato deliberado do contador (que depois
  // abre "Dar baixa" já pré-preenchido com a data e a quebra reais). Separar as duas coisas evita
  // lançamento automático a partir de um dado que ainda não foi conferido por gente.
  router.post(
    "/guides/:guideId/buscar-pagamento",
    requireAccountType("FIRM"),
    async (req, res) => {
      const { guideId } = req.params || {};
      const scoped = await getGuideWithFirmAccess({ guideId, user: req.auth.user });
      if (!scoped.guide) return res.status(scoped.status).json({ error: scoped.error });

      const numeroDoc = String(scoped.guide.extracted?.numeroDocumento || "").trim();
      if (!numeroDoc) {
        return res.json({
          ok: true, encontrado: false,
          motivo: "Guia sem número de documento — o comprovante é localizado por ele.",
        });
      }

      try {
        const { confirmarPagamento } = await import(
          "../../application/fiscal/serpro/SerproPagtoWebService.js"
        );
        const r = await confirmarPagamento({
          contribuinteCnpj: scoped.guide.cnpj,
          numeroDocumento: numeroDoc,
          logger: log,
        });
        if (!r?.pago) {
          return res.json({
            ok: true, encontrado: false,
            motivo: r?.mensagem || "Pagamento ainda não localizado no SERPRO.",
          });
        }

        const c = r.comprovante || null;
        // Guarda a leitura do comprovante na própria guia — é o que pré-preenche a baixa depois.
        const extractedAtual = (scoped.guide.extracted && typeof scoped.guide.extracted === "object")
          ? scoped.guide.extracted
          : {};
        await prisma.guide.update({
          where: { id: scoped.guide.id },
          data: {
            // PAID aqui = "pagamento localizado no SERPRO". A baixa contábil é o passo seguinte
            // (guide.baixada/lancamentoId continuam vazios até o contador lançar).
            paymentStatus: "PAID",
            paymentStatusSource: "SERPRO",
            paymentConfirmedAt: new Date(),
            serproLastCheckedAt: new Date(),
            serproLastCheckResult: "COMPROVANTE_LOCALIZADO",
            extracted: {
              ...extractedAtual,
              comprovante: c
                ? {
                    dataArrecadacao: c.dataArrecadacaoBR || null,
                    principal: c.principal, juros: c.juros, multa: c.multa, total: c.total,
                    meioPagamento: c.meioPagamento, confiavel: c.confiavel,
                  }
                : { confiavel: false },
            },
          },
        });

        return res.json({
          ok: true,
          encontrado: true,
          comprovante: c
            ? {
                dataArrecadacao: c.dataArrecadacaoBR, principal: c.principal,
                juros: c.juros, multa: c.multa, total: c.total,
                meioPagamento: c.meioPagamento, confiavel: c.confiavel,
              }
            : null,
        });
      } catch (err) {
        log.error({ err: err?.message, guideId: scoped.guide.id }, "Falha ao buscar pagamento (PAGTOWEB)");
        return res.status(502).json({ ok: false, error: err?.code || "PAGTOWEB_FALHOU", reason: err?.message });
      }
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

      // Busca o COMPROVANTE no SERPRO (PAGTOWEB) pra usar a DATA e os VALORES reais do pagamento
      // em vez de "hoje" + valor devido da guia. Decisão do dono: baixa automática SÓ quando o
      // comprovante é confiável E o total bate com a guia; havendo divergência (juros/multa,
      // pagamento parcial), a guia é marcada como paga mas o lançamento fica pro contador conferir.
      // Best-effort: falha na consulta não impede a confirmação manual.
      let comprovante = null;
      let comprovanteAviso = null;
      try {
        const { confirmarPagamento } = await import(
          "../../application/fiscal/serpro/SerproPagtoWebService.js"
        );
        const numeroDoc = String(scoped.guide.extracted?.numeroDocumento || "").trim();
        if (numeroDoc) {
          const r = await confirmarPagamento({
            contribuinteCnpj: scoped.guide.cnpj,
            numeroDocumento: numeroDoc,
            logger: log,
          });
          if (r?.pago && r?.comprovante) comprovante = r.comprovante;
          else if (!r?.pago) comprovanteAviso = r?.mensagem || "Comprovante não localizado no SERPRO.";
        } else {
          comprovanteAviso = "Guia sem número de documento — não dá pra buscar o comprovante.";
        }
      } catch (err) {
        comprovanteAviso = `Não foi possível consultar o comprovante: ${err?.message || err}`;
        log.warn({ err: err?.message, guideId: scoped.guide.id }, "PAGTOWEB: consulta falhou (segue com confirmação manual)");
      }

      // O comprovante só COMANDA a baixa quando é confiável e o total confere com a guia.
      const totalGuia = Number(scoped.guide.valor || 0);
      const batendo = Boolean(
        comprovante?.confiavel
        && comprovante?.total != null
        && Math.abs(Number(comprovante.total) - totalGuia) <= 0.01,
      );
      if (comprovante && !batendo) {
        comprovanteAviso = comprovante.total != null
          ? `Comprovante encontrado com total R$ ${Number(comprovante.total).toFixed(2)}, diferente da guia (R$ ${totalGuia.toFixed(2)}) — confira antes de lançar.`
          : "Comprovante encontrado, mas não foi possível ler os valores com segurança — confira antes de lançar.";
      }
      /**
       * ⚠⚠ A DATA DO PAGAMENTO: a da ARRECADAÇÃO do comprovante — e desde 30/08/2026 ela É USADA.
       *
       * ⚠⚠ **Esta variável era calculada AQUI e nunca lida em lugar nenhum**, enquanto
       * `markGuidePaidManual` carimbava `new Date()`. O comentário dela ainda dizia *"senão o dia
       * da confirmação"*, descrevendo um comportamento que morava em outro arquivo. Medido antes do
       * conserto: das 20 guias com comprovante guardado, **20** tinham `paymentConfirmedAt`
       * diferente da arrecadação — a LENTE com INSS de 04/2026 arrecadado em **16/07** e gravado
       * em **27/08**, dois meses adiante, num campo que decide o MÊS do fluxo.
       *
       * ⚠ `batendo` continua sendo o portão: comprovante cujo total não confere com a guia não
       * comanda nada, e aí a data fica **nula** — "pago, dia desconhecido" é uma resposta; um
       * carimbo do relógio não é.
       */
      const dataPagamentoReal = batendo && comprovante?.dataArrecadacao ? comprovante.dataArrecadacao : null;

      // Esta rota não cria mais NENHUM lançamento — logo, não há mês contábil a proteger aqui.
      // A trava de mês fechado vive junto do lançamento: na Circular (tributos) e na aba
      // Parcelamento (parcelas). Bloquear a marcação de "pago" impediria registrar um fato que
      // já aconteceu só porque o mês foi fechado.

      const updated = await markGuidePaidManual({
        guideId: scoped.guide.id,
        userId: req.auth.user.id,
        pagoEm: dataPagamentoReal,
      });

      // ⚠⚠ SEM DATA, O CONTADOR PRECISA SABER — senão a guia fica paga "em lugar nenhum" no fluxo
      // e ninguém descobre por quê. A saída já existe e está nomeada: "Dar baixa" na Circular pede
      // a data. ⚠ A frase entra no aviso que a tela já mostra, em vez de um canal novo.
      if (!dataPagamentoReal) {
        const semData = "Marcada como paga, mas SEM a data do pagamento — o comprovante não trouxe "
          + "a data da arrecadação. Ela é o dia em que o dinheiro saiu, e o fluxo depende dela: "
          + "informe-a ao dar baixa na Circular.";
        comprovanteAviso = comprovanteAviso ? `${comprovanteAviso} ${semData}` : semData;
      }

      // Parcela também NÃO lança aqui: o lançamento foi para a aba Parcelamento, onde as
      // parcelas são acompanhadas. Confirmar pagamento só marca e guarda o comprovante.
      const parcelaBaixa = null;

      // O LANÇAMENTO da baixa não acontece mais aqui: confirmar pagamento apenas MARCA a guia e
      // guarda o comprovante. O contador lança pela Circular ("Dar baixa", já pré-preenchido com a
      // data da arrecadação e a quebra principal/juros/multa). Um único lugar para o ato contábil
      // evita lançamento em duplicidade e mantém a revisão humana antes de mexer no razão.
      // (Parcelamento segue com baixa própria: parcelas vivem na aba Parcelamento, não na Circular.)
      const inssBaixa = null;
      const normalBaixa = null;

      // A guia foi marcada como paga com sucesso (por isso ok:true), mas a baixa/Circular é
      // best-effort e pode ter sido pulada. Diz explicitamente o que aconteceu do lado da
      // Circular — antes a resposta era um "ok" liso e o contador ficava sem saber por que a
      // célula não tinha ficado verde.
      const baixa = parcelaBaixa || inssBaixa || normalBaixa || null;
      const circularAtualizada = Boolean(baixa?.ok) || Number(baixa?.provisoesMarcadas || 0) > 0;
      return res.json({
        ok: true,
        guide: toGuideResponse(updated, { publico: PUBLICO.ESCRITORIO }),
        parcelaBaixa, inssBaixa, normalBaixa,
        // Dados do comprovante do SERPRO (quando localizado). `aplicado` diz se eles COMANDARAM
        // a baixa — se false, a guia foi marcada como paga mas o lançamento precisa de conferência.
        comprovante: comprovante
          ? {
              dataArrecadacao: comprovante.dataArrecadacaoBR || null,
              principal: comprovante.principal, juros: comprovante.juros,
              multa: comprovante.multa, total: comprovante.total,
              meioPagamento: comprovante.meioPagamento,
              aplicado: batendo,
            }
          : null,
        comprovanteAviso,
        circular: {
          atualizada: circularAtualizada,
          provisoesMarcadas: Number(baixa?.provisoesMarcadas || 0),
          motivo: circularAtualizada ? null : (baixa?.reason || "sem_provisao_correspondente"),
        },
      });
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

      const especie = especieDoRecalculo(scoped.guide);
      const vencida = isGuideOverdue(scoped.guide, new Date());

      try {
        // ⚠⚠ ESTA ROTA NÃO ESTAVA ENVOLVIDA POR `comContextoSerpro` — medido em 27/08/2026. O gasto
        // mais visível do contador era o ÚNICO que não se identificava em `serpro_chamadas`:
        // `origem` gravava `null`, sem `userId`, e o ADMIN não conseguia `?forcar=1` aqui. Com o
        // CLIENTE também podendo disparar isto, deixou de ser detalhe de diagnóstico.
        const contexto = {
          origem: "guias:recalcular",
          userId: req.auth?.user?.id,
          forcar: podeForcarSerpro(req),
        };

        // ⚠⚠ A DARF DO PRESUMIDO ENTROU (decisão do dono, 27/08/2026) e tem OUTRO caminho: uma
        // chamada só (`GERARGUIA31`), sem reconsultar a declaração — recalcular pede a GUIA de
        // novo, e a apuração declarada não mudou.
        if (especie === ESPECIE_RECALCULO.DARF_PRESUMIDO) {
          const darf = await comContextoSerpro(contexto, () => reemitirDarfLp({
            portalClientId: scoped.guide.portalClientId,
            competencia: scoped.guide.competencia,
            guideId: scoped.guide.id,
          }));
          await markGuideOpenBySerpro({ guideId: scoped.guide.id });
          const emailResult = await runGuideEmailWorkerSelected({ guideIds: [scoped.guide.id] });
          return res.json({
            ok: true,
            especie,
            vencida,
            result: { guide: { guideId: scoped.guide.id }, darf: { valor: darf.valor, vencimento: darf.vencimento, numeroDocumento: darf.numeroDocumento } },
            // ⚠⚠ A FALHA VISÍVEL. Não está confirmado que o `GERARGUIA31` gere a DARF COM juros e
            // multa quando ela está vencida — o PGDAS-D tem serviço próprio para isso; a DCTFWeb,
            // até onde este repositório sabe, tem um só. Então a tela recebe o que se VIU na
            // composição do documento, com três respostas — e "não deu para ler" nunca vira "veio
            // sem acréscimos".
            acrescimos: leituraDosAcrescimos(darf.composicao),
            emailDispatch: emailResult,
          });
        }

        // Q29: vencida → DAS de cobrança (juros/multa); em aberto → DAS normal.
        const serviceId = vencida ? SERPRO_PGDASD_SERVICE_COBRANCA : SERPRO_PGDASD_SERVICE_NORMAL;
        const result = await comContextoSerpro(contexto, () => capturePgdasGuideForCompany({
          portalClientId: scoped.guide.portalClientId,
          competencia: scoped.guide.competencia,
          existingGuideId: scoped.guide.id,
          serviceId,
        }));
        await markGuideOpenBySerpro({ guideId: result.guide.guideId });

        const emailResult = await runGuideEmailWorkerSelected({
          guideIds: [result.guide.guideId],
        });

        return res.json({
          ok: true,
          especie,
          vencida,
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
        if (result?.skipped) {
          return res.json({
            ok: true,
            guideId: updated.id,
            emailStatus: updated.emailStatus || null,
            sent: false,
            envio: { feito: false, motivo: "envio_ocupado", podeTentarNovamente: true },
            message: mensagemEnvioNaoFeitoPorLock(),
          });
        }
        // ⚠ O worker devolve `results`, NÃO `guides` — isto lia `result.guides[0]` e obtinha
        // `undefined` SEMPRE. Consequências: `sent` nunca era true (reenvio bem-sucedido dizia
        // "Tentativa de reenvio realizada. Verifique o status.") e o motivo da falha nunca chegava
        // à tela. Uma rota que nunca sabe o que aconteceu é o mesmo defeito das mensagens de fila,
        // por outro caminho: o contador fica sem saber se saiu.
        const item = Array.isArray(result?.results) ? result.results[0] : null;
        const sent = item?.status === "SENT";
        return res.json({
          ok: true,
          guideId: updated.id,
          emailStatus: item?.status || null,
          sent,
          envio: sent ? { feito: true } : { feito: false, motivo: item?.code || "envio_falhou", podeTentarNovamente: true },
          message: sent
            ? "Guia reenviada com sucesso."
            : mensagemEnvioFalhou(item?.reason || "o envio não foi confirmado"),
        });
      } catch (err) {
        log.warn({ err: err?.message || err, guideId: updated.id }, "Falha no reenvio síncrono");
        return res.json({
          ok: true,
          guideId: updated.id,
          emailStatus: "ERROR",
          sent: false,
          envio: { feito: false, motivo: "envio_falhou", podeTentarNovamente: true },
          message: mensagemEnvioFalhou(err?.message),
        });
      }
    }
  );

  // Portal Cliente: POST /guides/:guideId/liberar-cliente — libera SÓ esta guia e envia SÓ ela
  // por e-mail (worker por-guia). O empacotamento DAS+INSS fica exclusivo do envio em lote da
  // página principal (batch-send / emails/send-pending|send-selected). Molde da rota de resend.
  router.post(
    "/guides/:guideId/liberar-cliente",
    requireAccountType("FIRM"),
    async (req, res) => {
      const appRole = String(req.auth?.user?.role || "").toLowerCase();
      if (!["admin", "contador"].includes(appRole)) {
        return res.status(403).json({ error: "forbidden_admin_or_contador_only" });
      }
      const { guideId } = req.params || {};
      const scoped = await getGuideWithFirmAccess({ guideId, user: req.auth.user });
      if (!scoped.guide) return res.status(scoped.status).json({ error: scoped.error });
      const guide = scoped.guide;
      if (guide.status !== "PROCESSED") {
        return res.status(400).json({
          error: "guide_not_processed",
          reason: "Só é possível liberar guias com status PROCESSED",
        });
      }
      if (!guide.portalClientId) {
        return res.status(400).json({ error: "guide_has_no_company", reason: "Guia sem empresa vinculada" });
      }

      const userId = req.auth?.user?.id || null;
      // 1) marca esta guia como liberada ao cliente (no-op se já liberada)
      const lib = await liberarGuiaCliente({ guideId: guide.id, userId });
      // 2) envia SÓ esta guia por e-mail — síncrono, feedback imediato ao contador
      //
      // ⚠ A LIBERAÇÃO E O E-MAIL SÃO DUAS COISAS, E PODEM TERMINAR DIFERENTE. A guia fica liberada
      // ao app do cliente mesmo quando o e-mail não sai — por isso `ok: true` com `sent: false`, e
      // por isso a mensagem precisa dizer QUAL das duas falhou. Dizer só "Guia liberada" seria
      // reportar sucesso sobre metade do trabalho.
      const prefixo = "Guia liberada ao cliente, mas ";
      try {
        const result = await runGuideEmailWorkerSelected({ guideIds: [guide.id] });
        if (result?.skipped) {
          // ⚠ Aqui dizia "ficará em fila". NÃO EXISTE FILA (Q55: o laço automático foi removido e
          // nada drena `emailNextRetryAt`). O contador lia a promessa, fechava a tela, e a guia
          // nunca saía. Ver `guideEmailCopy.js`.
          return res.json({
            ok: true,
            guideId: guide.id,
            liberadas: lib.liberadas,
            // O `emailStatus` da guia NÃO foi tocado — o worker nem chegou a rodar. Devolvê-lo como
            // "PENDING" era a segunda mentira da mesma resposta: uma guia que estava em ERROR
            // aparecia como se tivesse voltado a ser uma pendência limpa.
            emailStatus: guide.emailStatus || null,
            sent: false,
            envio: { feito: false, motivo: "envio_ocupado", podeTentarNovamente: true },
            message: mensagemEnvioNaoFeitoPorLock(prefixo),
          });
        }
        const item = Array.isArray(result?.results) ? result.results[0] : null;
        const sent = item?.status === "SENT";
        return res.json({
          ok: true,
          guideId: guide.id,
          liberadas: lib.liberadas,
          emailStatus: item?.status || null,
          sent,
          envio: sent
            ? { feito: true }
            : { feito: false, motivo: item?.code || "envio_falhou", podeTentarNovamente: true },
          message: sent
            ? "Guia liberada e enviada ao cliente."
            // Sem item não há como afirmar "em processamento": nada processa em segundo plano.
            : mensagemEnvioFalhou(item?.reason || "o envio não foi confirmado", prefixo),
        });
      } catch (err) {
        log.warn({ err: err?.message || err, guideId: guide.id }, "Falha no envio síncrono ao liberar guia");
        return res.json({
          ok: true, guideId: guide.id, liberadas: lib.liberadas, emailStatus: null, sent: false,
          envio: { feito: false, motivo: "envio_falhou", podeTentarNovamente: true },
          message: mensagemEnvioFalhou(err?.message, prefixo),
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

  // Módulo Fiscal M2 — SPIKE read-only: probe da Consultar Declaração Completa DCTFWeb.
  // Serviço /Consultar (leitura, SEM ato fiscal). Só descobre se os débitos vêm estruturados
  // ou em PDF. NÃO persiste. Gated: admin/contador + flag SERPRO_DCTFWEB_LP_PROBE_ENABLED.
  router.post(
    "/companies/:companyId/serpro/dctfweb/consultar-completa",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      if (!SERPRO_DCTFWEB_LP_PROBE_ENABLED) {
        return res.status(403).json({ ok: false, error: "probe_disabled", message: "Ligue SERPRO_DCTFWEB_LP_PROBE_ENABLED=1 para rodar o spike." });
      }
      const appRole = String(req.auth?.user?.role || "").toLowerCase();
      if (!["admin", "contador"].includes(appRole)) {
        return res.status(403).json({ ok: false, error: "forbidden_admin_or_contador_only" });
      }
      const portalCompanyId = String(req.params.companyId || "").trim();
      const competencia = String(req.body?.competencia || req.query?.competencia || "").trim();
      const idServico = req.body?.idServico ? String(req.body.idServico).trim() : undefined;
      const categoria = req.body?.categoria ? String(req.body.categoria).trim() : undefined;
      const dadosOverride = req.body?.dados && typeof req.body.dados === "object" ? req.body.dados : undefined;
      if (!competencia) return res.status(400).json({ ok: false, error: "competencia_required" });
      try {
        const portal = await prisma.portalClient.findUnique({ where: { id: portalCompanyId }, select: { cnpj: true, razao: true } });
        if (!portal) return res.status(404).json({ ok: false, error: "portal_company_not_found" });
        const out = await probeConsultarDeclaracaoCompleta({
          contribuinteCnpj: portal.cnpj, competencia, idServico, categoria, dadosOverride,
        });
        log.warn({ portalCompanyId, competencia, idServico: out.idServico, httpStatus: out.httpStatus, temPdf: out.temPdf, temDados: out.temDadosEstruturados }, "SPIKE DCTFWeb consultar-completa");
        return res.json({ ok: true, empresa: portal.razao, ...out });
      } catch (err) {
        const code = err?.code || "SERPRO_DCTFWEB_PROBE_FAILED";
        log.error({ err: err?.message || err, code, portalCompanyId, competencia }, "Falha no probe DCTFWeb");
        return res.status(502).json({ ok: false, error: code, reason: err?.message || "Erro", retryable: Boolean(err?.retryable) });
      }
    }
  );

  // Módulo Fiscal M2 — captura do Lucro Presumido: consulta a Declaração Completa DCTFWeb,
  // parseia os débitos (principal) e gera a provisão por tributo + o split na circular.
  router.post(
    "/companies/:companyId/serpro/lp/capture",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId || "").trim();
      const competencia = String(req.body?.competencia || req.query?.competencia || "").trim();
      if (!portalClientId) return res.status(400).json({ ok: false, error: "company_id_required" });
      if (!/^\d{4}-\d{2}$/.test(competencia)) return res.status(400).json({ ok: false, error: "competencia_required", message: "competência YYYY-MM" });

      // ⚠ Cada chamada aqui são DUAS consultas PAGAS ao SERPRO: a declaração completa
      // (CONSDECCOMPLETA33) e a emissão do DARF (GERARGUIA31). A flag existe porque o contrato do
      // CONSDECCOMPLETA33 está marcado `verificadoTrial: false` — é spike, não foi exercido contra
      // uma empresa real. Ligar só depois de validar, como foi feito com SITFIS e PAGTOWEB.
      if (!INTEGRACAO_SERPRO_DCTFWEB_LP) {
        return res.status(409).json({
          ok: false,
          error: "INTEGRACAO_DESLIGADA",
          message: "A consulta do Lucro Presumido está desligada (INTEGRACAO_SERPRO_DCTFWEB_LP). O contrato do CONSDECCOMPLETA33 ainda não foi validado em produção.",
        });
      }

      // Grava provisões contábeis (`generateProvisionsFromGuide`), então respeita o mês fechado
      // igual ao lançamento manual. Guarda na ROTA, não no serviço: o worker segue livre.
      if (await isMonthClosed(portalClientId, competencia)) {
        return res.status(409).json({
          ok: false,
          error: "MES_FECHADO",
          message: "O mês está fechado. Reabra antes de buscar os tributos de novo.",
        });
      }

      try {
        // Duas chamadas PAGAS por clique (CONSDECCOMPLETA33 + GERARGUIA31) — a mais cara da casa.
        const result = await comContextoSerpro(
          { origem: "lancamentos:tributos-presumido", userId: req.auth?.user?.id, forcar: podeForcarSerpro(req) },
          () => capturarLpDaCompetencia({ portalClientId, competencia }),
        );
        return res.json({ ok: true, result });
      } catch (err) {
        const code = err?.code || "SERPRO_DCTFWEB_LP_CAPTURE_FAILED";
        // "Declaração não transmitida por terceiros" é estado NORMAL (não é erro do app).
        if (code === "SERPRO_DCTFWEB_LP_NAO_TRANSMITIDA") {
          return res.status(200).json({ ok: false, error: code, message: "DCTFWeb ainda não transmitida para esta competência.", mensagens: err?.mensagens || null });
        }
        // Empresa do Simples (ou regime não Presumido/Real): a consulta do LP não se aplica.
        if (code === "REGIME_INVALIDO_LP") {
          return res.status(409).json({ ok: false, error: code, message: err?.message || "Consulta do Lucro Presumido não se aplica a este regime." });
        }
        if ([
          "SERPRO_INVALID_COMPETENCIA", "SERPRO_PROCURADOR_CNPJ_NOT_CONFIGURED", "PORTAL_COMPANY_NOT_FOUND",
          "SERPRO_AUTH_URL_NOT_CONFIGURED", "SERPRO_BASE_URL_NOT_CONFIGURED", "SERPRO_CONSUMER_KEY_NOT_CONFIGURED",
          "SERPRO_CONSUMER_SECRET_NOT_CONFIGURED", "SERPRO_CERTIFICATE_NOT_CONFIGURED",
        ].includes(code)) {
          return res.status(400).json({ ok: false, error: code, reason: err?.message || "Erro" });
        }
        log.error({ err: err?.message || err, code, portalClientId, competencia }, "Falha na captura de Lucro Presumido");
        return res.status(502).json({ ok: false, error: code, reason: err?.message || "Erro", retryable: Boolean(err?.retryable) });
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
        select: {
          situacao: true, protocolo: true, relatorioPdfFileId: true, texto: true,
          checkedAt: true, ultimoRelatorioEm: true,
          // ⚠ Entrou SÓ pela leitura posicional guardada (`rawPayload.leituraPosicional`). Ele NÃO
          // sai na resposta — é desmontado logo abaixo. Deixá-lo no spread mandaria o PDF em
          // base64 (~36 KB por relatório, medido nos 24 de produção) para o navegador a cada
          // abertura da aba, sem ninguém pedir.
          rawPayload: true,
        },
      });
      if (!status) return res.json({ ok: true, status: null });
      const { rawPayload, ...statusPublico } = status;
      // C11: a aba usa isto pra saber se o botão "Consultar" já está liberado (trava de 4h).
      // Ancorado no ÚLTIMO RELATÓRIO, não na última tentativa — tentativa que voltou
      // "processando" não pode travar o contador.
      const proximaConsultaEm = status.ultimoRelatorioEm
        ? new Date(new Date(status.ultimoRelatorioEm).getTime() + SITFIS_MIN_INTERVALO_MS).toISOString()
        : null;
      // Relatório interpretado, para a aba montar a TABELA. O PDF continua servido à parte e vira
      // visualização opcional. Se o texto não estiver salvo (relatório antigo), `relatorio` vem
      // null e a tela cai no PDF — nunca numa tabela vazia sem explicação.
      //
      // ⚠ AS DUAS LEITURAS SE ENCONTRAM AQUI: `parseSitfisRelatorio` (o texto achatado) roda
      // SEMPRE e é a segunda opinião; a leitura POSICIONAL do PDF, guardada no `rawPayload` pela
      // consulta (ou pelo reprocessamento do acervo), vence ÓRGÃO A ÓRGÃO quando concorda com ela
      // no número de blocos. Sem leitura posicional gravada, a resposta é exatamente a de antes.
      // Regra e motivo: `application/fiscal/serpro/lerRelatorioSitfis.js`.
      const { relatorio, leitura, motivo } = montarRelatorioSitfis({
        texto: status.texto,
        posicional: lerLeituraPosicionalGravada(rawPayload),
      });
      return res.json({
        ok: true,
        status: {
          ...statusPublico,
          relatorio,
          // Diagnóstico: qual das duas leituras montou a tabela, e por que a outra não foi usada.
          // Não é rótulo de tela — a aba mostra o relatório, não a procedência do parser.
          leitura,
          leituraMotivo: motivo,
          proximaConsultaEm,
          podeConsultar: !proximaConsultaEm || new Date(proximaConsultaEm).getTime() <= Date.now(),
        },
      });
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

  // O EXTRATO do Simples (declaração e recibo do PGDAS-D) em PDF.
  //
  // Os arquivos já eram salvos no storage desde sempre (`saveBase64Pdf`), mas **não havia rota que
  // os servisse** — ficavam guardados e invisíveis, e por isso pareciam não estar sendo salvos.
  //
  // ⚠ Serve pelo `*FileId` (chave do storage), NUNCA pelo `*FileUrl`: com o provider LOCAL a URL
  // gravada é `file:///…`, inútil no browser.
  //
  // Molde idêntico ao do SITFIS logo acima, inclusive no tratamento de arquivo ausente: o Railway
  // apaga o filesystem a cada deploy sem volume montado, então "registro existe, arquivo não" é um
  // caso REAL e não pode quebrar a tela.
  router.get(
    "/companies/:companyId/pgdas/:competencia/pdf",
    requireFirmCompanyAccess(),
    async (req, res) => {
      const portalCompanyId = String(req.params.companyId || "").trim();
      const competencia = String(req.params.competencia || "").trim();
      const tipo = String(req.query?.tipo || "declaracao").toLowerCase();
      if (!/^\d{4}-\d{2}$/.test(competencia)) return res.status(400).json({ error: "competencia_required" });
      if (tipo !== "declaracao" && tipo !== "recibo") return res.status(400).json({ error: "tipo_invalido" });

      const circular = await prisma.companyMonthlyCircular.findUnique({
        where: { portalClientId_competencia: { portalClientId: portalCompanyId, competencia } },
        select: { pgdasDeclaracaoFileId: true, pgdasReciboFileId: true },
      });
      const key = tipo === "recibo" ? circular?.pgdasReciboFileId : circular?.pgdasDeclaracaoFileId;
      if (!key) return res.status(404).json({ error: "pdf_not_available" });

      try {
        const buf = await GuideStorageService.create().downloadBuffer({ key });
        if (!buf?.length) return res.status(404).json({ error: "pdf_not_available" });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${sanitizeFilename(`pgdas-${tipo}-${competencia}.pdf`)}"`);
        res.setHeader("Cache-Control", "private, max-age=300");
        return res.send(buf);
      } catch (err) {
        log.warn({ err: err?.message, portalCompanyId, competencia, tipo }, "PGDAS: falha ao ler PDF do storage");
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

        // C11: TRAVA DE 4h. Consultar o SITFIS é caro (chamada paga) e o limite AV02 do /Apoiar é
        // por CONTRATANTE — uma consulta desnecessária de uma empresa atrapalha todas as outras.
        // Dentro da janela devolvemos o que já está gravado (com o PDF), sem tocar no SERPRO.
        // `force` existe só para quebra manual consciente, não é usado pela UI.
        const prevStatus = await prisma.companyFiscalStatus.findUnique({
          where: { portalClientId: portal.id },
          select: {
            situacao: true, protocolo: true, relatorioPdfFileId: true, texto: true,
            checkedAt: true, ultimoRelatorioEm: true,
          },
        });
        const forcar = String(req.query.force || "") === "1";
        // A trava é ancorada em ultimoRelatorioEm (consulta que TROUXE relatório), NÃO em checkedAt:
        // checkedAt sobe em toda tentativa, inclusive nas que voltam "processando" sem relatório —
        // usar ele deixava a empresa 4h travada por causa de uma tentativa que não trouxe nada.
        if (!forcar && prevStatus?.ultimoRelatorioEm) {
          const proxima = new Date(new Date(prevStatus.ultimoRelatorioEm).getTime() + SITFIS_MIN_INTERVALO_MS);
          if (proxima.getTime() > Date.now()) {
            return res.json({
              ok: true,
              processando: false,
              throttled: true,
              situacao: prevStatus.situacao || null,
              protocolo: prevStatus.protocolo || null,
              relatorioPdfFileId: prevStatus.relatorioPdfFileId || null,
              relatorioTexto: prevStatus.texto || null,
              checkedAt: prevStatus.checkedAt,
              proximaConsultaEm: proxima.toISOString(),
              mensagem: "Situação fiscal consultada há pouco — mostrando o último relatório salvo.",
            });
          }
        }

        // Q43.7: reusa o protocolo salvo — vai direto ao /Emitir e NÃO consome o limite AV02
        // (quem consome é o /Apoiar, e o limite é por CONTRATANTE).
        //
        // Tenta reusar mesmo se for de outro dia: antes só reusávamos o protocolo do MESMO dia, o
        // que criava um impasse — o SERPRO nega protocolo novo enquanto existe solicitação em
        // processamento pra aquele contribuinte, e nós descartávamos o único protocolo capaz de
        // concluir o /Emitir. Reusar é seguro: se estiver expirado, o SERPRO responde "inicie nova
        // solicitação" e o próprio loop do /Emitir re-solicita.
        const protocoloExistente = prevStatus?.protocolo || null;
        if (protocoloExistente) {
          log.warn({ portalCompanyId, checkedAt: prevStatus?.checkedAt }, "SITFIS: reusando protocolo salvo (pula /Apoiar)");
        }

        const result = await obterSitfisRelatorio({
          contribuinteCnpj: portal.cnpj,
          tipo: 2,
          protocoloExistente,
          logger: log,
          // Persiste o protocolo NA HORA em que o /Apoiar o devolve, antes de qualquer /Emitir.
          // Antes ele só era gravado no fim (linha ~3690): se o /Emitir falhasse — rede, timeout,
          // aba fechada, protocolo recusado — o protocolo se perdia e a solicitação ficava ABERTA
          // no SERPRO sem dono, ocupando um lugar do limite por contratante que ninguém mais
          // conseguia consumir. Cada tentativa interrompida entupia a fila mais um pouco, e
          // nenhuma espera resolvia, porque o que ocupa o lugar é a solicitação, não o tempo.
          onProtocolo: async (proto) => {
            await prisma.companyFiscalStatus.upsert({
              where: { portalClientId: portalCompanyId },
              update: { protocolo: proto, checkedAt: new Date() },
              create: { portalClientId: portalCompanyId, tipo: 2, protocolo: proto, checkedAt: new Date() },
            });
          },
        });
        // Q43.5: o relatório SITFIS vem só como PDF (dados.pdf) — extrai o texto para a heurística
        // de pendência funcionar (senão a situação cairia sempre em REGULAR por falta de texto).
        const pdfText = result.relatorioTexto ? "" : await extractSitfisPdfText(result.relatorioPdfBuffer);
        // Q41: deriva a situação fiscal por palavra-chave (best-effort — verificadoTrial:false).
        const situacao = deriveSituacaoFiscal(result, pdfText);
        // Guarda o texto extraído (trunca para não inflar a linha) — alimenta a página Pendências.
        const textoRelatorio = result.relatorioTexto || (pdfText ? pdfText.slice(0, 20000) : null);

        // ⚠ A SEGUNDA LEITURA, pela GEOMETRIA do PDF (serviço `pdf-reader`, o MESMO caminho das
        // guias). Ela NÃO substitui o parser de texto acima — o texto continua sendo gravado e
        // continua sendo a segunda opinião com que ela é confrontada na hora de exibir.
        // ⚠ NUNCA LANÇA: falha do pdf-reader devolve `null` e a aba mostra o que mostrava antes.
        // ⚠ ZERO chamada ao SERPRO — é o PDF que acabou de chegar, relido localmente.
        const { relatorio: relatorioPosicional } = await lerSitfisPosicional({
          pdfBuffer: result.relatorioPdfBuffer,
          filename: `sitfis-${portal.id}.pdf`,
          requestId: req.get("x-request-id") || undefined,
          logger: log,
        });

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
        // ⚠ A leitura posicional é guardada DENTRO do `rawPayload` (que já é `JSONB`), porque não
        // se faz DDL em produção. O envelope do SERPRO fica intacto: a chave é acrescentada ao
        // lado dele, nunca no lugar. Sem leitura posicional, o valor é o de antes, letra por letra.
        const rawPayloadParaGravar = (result.rawPayload || relatorioPosicional)
          ? montarRawPayloadComLeitura(result.rawPayload, relatorioPosicional)
          : undefined;
        const updateData = {
          tipo: 2,
          // protocolo: só sobrescreve quando temos um novo; senão mantém o salvo (|| undefined = não altera).
          protocolo: result.protocolo || undefined,
          checkedAt: new Date(),
        };
        // SÓ sobrescreve o relatório quando veio um NOVO. Antes a condição era
        // `temRelatorioNovo || !result.processando`, e o segundo termo era uma armadilha: uma
        // consulta que voltasse sem relatório E sem a marca de "processando" — erro, protocolo
        // recusado, resposta inesperada — gravava `relatorioPdfFileId: null` e APAGAVA o PDF que
        // já estava salvo. O contador perdia o relatório por causa de uma tentativa fracassada.
        //
        // Relatório salvo é a única cópia que temos: consultar de novo custa chamada paga e pode
        // esbarrar no limite do SERPRO. Na dúvida, preserva.
        if (temRelatorioNovo) {
          updateData.situacao = situacao;
          updateData.relatorioPdfFileId = relatorioPdfFileId;
          updateData.texto = textoRelatorio;
          updateData.rawPayload = rawPayloadParaGravar;
        }
        // (sem relatório novo → não toca em situacao/pdf/texto: mantém o último conhecido)
        // Só uma consulta que TROUXE relatório inicia a janela de 4h.
        if (temRelatorioNovo) updateData.ultimoRelatorioEm = new Date();

        const salvo = await prisma.companyFiscalStatus.upsert({
          where: { portalClientId: portal.id },
          create: {
            portalClientId: portal.id,
            tipo: 2,
            situacao,
            protocolo: result.protocolo || null,
            relatorioPdfFileId,
            texto: textoRelatorio,
            rawPayload: rawPayloadParaGravar,
            checkedAt: new Date(),
            ultimoRelatorioEm: temRelatorioNovo ? new Date() : null,
          },
          update: updateData,
        });

        return res.json({
          ok: true,
          processando: Boolean(result.processando),
          throttled: false,
          situacao,
          protocolo: result.protocolo || null,
          // Ainda "processando" não gera PDF novo — devolve o último salvo, que é o que a aba mostra.
          relatorioPdfFileId: relatorioPdfFileId || salvo.relatorioPdfFileId || null,
          relatorioTexto: textoRelatorio,
          checkedAt: salvo.checkedAt,
          // C11: quando libera a próxima consulta (a UI desabilita o botão até lá). Null quando a
          // consulta não trouxe relatório — aí o botão continua liberado pra tentar de novo.
          proximaConsultaEm: salvo.ultimoRelatorioEm
            ? new Date(new Date(salvo.ultimoRelatorioEm).getTime() + SITFIS_MIN_INTERVALO_MS).toISOString()
            : null,
          mensagem: result.mensagem || null,
          // Quanto o SERPRO pediu pra aguardar (limite AV02). A consulta em lote usa isso pra se
          // espaçar em vez de queimar a cota do contratante empresa após empresa.
          tempoEsperaSegundos: result.tempoEsperaSegundos || null,
          // Mensagem CRUA do SERPRO. O texto de "limite momentâneo" é inferência nossa — sem isto
          // não dá pra distinguir limite de conta de procuração/certificado/contribuinte inválido.
          mensagemSerpro: result.mensagemSerpro || null,
          verificadoTrial: result.verificadoTrial,
        });
      } catch (err) {
        const code = err?.code || "SERPRO_SITFIS_FAILED";
        const message = err?.message || "Falha ao consultar a situação fiscal (SITFIS).";
        if (code === "SERPRO_SITFIS_DISABLED") {
          return res.status(400).json({ ok: false, error: code, reason: "Situação fiscal (SITFIS) desabilitada. Ligue INTEGRACAO_SERPRO_SITFIS após validar no sandbox." });
        }
        // Limpa o protocolo salvo APENAS quando o SERPRO disse que ele é inválido. Não limpar em
        // PROTOCOLO_NOT_FOUND: esse erro é sobre não conseguir um protocolo NOVO no /Apoiar — o
        // que já estava salvo pode continuar bom, e apagá-lo cria um impasse (o SERPRO nega novo
        // protocolo enquanto há solicitação em processamento, e nós jogamos fora o único que
        // tínhamos pra concluir o /Emitir).
        if (code === "SERPRO_SITFIS_PROTOCOLO_INVALIDO") {
          await prisma.companyFiscalStatus
            .updateMany({ where: { portalClientId: portalCompanyId }, data: { protocolo: null } })
            .catch(() => null);
        }
        log.error({ err: err?.message || err, code, details: err?.details, portalCompanyId }, "Falha na consulta SITFIS");
        // Devolve a MENSAGEM DO SERPRO junto (err.details já é um preview sanitizado — sem PDF nem
        // dado sensível). Antes o contador recebia só o código seco ("serpro_sitfis_protocolo_not
        // _found") e o motivo real ficava enterrado no log do servidor.
        const doSerpro = extrairMensagemSerpro(err?.details);
        return res.status(502).json({
          ok: false,
          error: code,
          reason: doSerpro ? `${message} — SERPRO: ${doSerpro}` : message,
          detalhes: err?.details || null,
        });
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

  // A fila de conferencia de lancamentos (a nota vira despesa, o extrato vira o pagamento dela).
  // ⚠ Montado DEPOIS do de lancamentos, e isso nao e acaso: os dois usam `/companies/:companyId`,
  // e nenhuma rota deste colide com as de la (`/conferencia*` nao existe naquele arquivo).
  const conferenciaRouter = createConferenciaRouter({ log });
  router.use("/companies/:companyId", conferenciaRouter);

  // As recorrencias (a serie que volta, e com que valor). ⚠ Nenhuma rota daqui colide com as de
  // cima: `/recorrencia*` nao existe em nenhum outro router montado neste prefixo.
  const recorrenciaRouter = createRecorrenciaRouter({ log });
  router.use("/companies/:companyId", recorrenciaRouter);

  // Q12.A.3: módulo Notas Fiscais (procurações, competências, pendências)
  const notasRouter = createNotasRouter({ log });
  router.use("/companies/:companyId", notasRouter);

  // Q14.2.d: Apuração v2 — cadastro fiscal, produtos/serviços, pendências, classificar v2
  const apuracaoV2Router = createApuracaoV2Router({ log });
  router.use("/companies/:companyId", apuracaoV2Router);

  // Planejamento tributário — SÓ LEITURA. Monta os campos da empresa (com a procedência de cada
  // um) que a tela de simulação de regime pré-preenche. Não grava nada.
  const planejamentoRouter = createPlanejamentoRouter({ log });
  router.use("/companies/:companyId", planejamentoRouter);

  // Documentos societários + anotações da empresa (grupo "Cadastro" na UI).
  const companyDocumentsRouter = createCompanyDocumentsRouter({ log });
  router.use("/companies/:companyId", companyDocumentsRouter);

  // Cofre de senhas + "outras informações" da empresa (grupo "Empresa" na UI).
  // ⚠ Router PRÓPRIO, com gate de papel próprio — é a única superfície que devolve senha de cliente.
  const companyCredentialsRouter = createCompanyCredentialsRouter({ log });
  router.use("/companies/:companyId", companyCredentialsRouter);

  // Acesso do CLIENTE ao portal — quem é o usuário daquela empresa e a troca da senha dele.
  // ⚠ Router PRÓPRIO e SEPARADO do cofre acima, apesar de as duas seções dividirem a mesma aba: o
  // cofre guarda senha de terceiro de forma RECUPERÁVEL, de propósito; esta é bcrypt e NÃO É
  // recuperável, nem pode passar a ser. Ver o cabeçalho de `portalAccess.js`.
  const portalAccessRouter = createPortalAccessRouter({ log });
  router.use("/companies/:companyId", portalAccessRouter);

  // Calendário fiscal — do ESCRITÓRIO, não por empresa: monta no nível raiz de /firm.
  router.use("/", createCalendarioRouter({ log }));

  // Obrigações — também do ESCRITÓRIO (a pergunta é "o que EU preciso entregar, em toda a
  // carteira"), então monta na raiz de /firm com filtro de empresa opcional.
  router.use("/", createObrigacoesRouter({ log }));

  // Onboarding — funil PRÉ-cadastro. Monta na RAIZ de /firm, não sob `/companies/:companyId`:
  // a ficha existe justamente porque a empresa ainda NÃO existe.
  router.use("/", createOnboardingsRouter({ log }));

  // Envio de guias por WhatsApp (Entrega 1). Monta na raiz porque o LOTE é da carteira inteira; o
  // envio individual, que é por empresa, traz o próprio `requireFirmCompanyAccess` no caminho.
  // ⚠ Só a SAÍDA. O webhook é público e vive fora deste roteador (é o único sem `requireAuth`).
  router.use("/", createWhatsappGuiasRouter({ log }));

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

    const companiesRaw = await prisma.portalClient.findMany({
      where: companiesWhere,
      orderBy: { razao: "asc" },
      select: { id: true, razao: true, cnpj: true, companyId: true },
      take: 500,
    });

    // Regime tributário (da Company legada). Lucro Presumido e Lucro Real apuram em fluxo
    // SEPARADO — não entram na aba de Apuração (que é do Simples Nacional / PGDAS-D).
    const REGIMES_FORA_APURACAO = new Set(["LUCRO_PRESUMIDO", "LUCRO_REAL"]);
    const legacyIds = companiesRaw.map((c) => c.companyId).filter(Boolean);
    const regimes = legacyIds.length
      ? await prisma.company.findMany({ where: { id: { in: legacyIds } }, select: { id: true, regimeTributario: true } })
      : [];
    const regimeByCompanyId = new Map(regimes.map((r) => [r.id, r.regimeTributario || null]));
    const regimeDe = (c) => (c.companyId ? regimeByCompanyId.get(c.companyId) || null : null);
    const companies = companiesRaw.filter((c) => !REGIMES_FORA_APURACAO.has(regimeDe(c)));

    const ids = companies.map((c) => c.id);
    if (ids.length === 0) return res.json({ ok: true, competencia, items: [] });

    // Q15: estado/DAS vêm do ApuracaoSnapshot (fluxo novo). Circular fica só pra rb12 legado.
    const snapshots = await prisma.apuracaoSnapshot.findMany({
      where: { portalClientId: { in: ids }, competencia },
      select: {
        portalClientId: true, estado: true, dasCalculadoLocal: true, dasRetornadoSerpro: true,
        dasSimuladoSerpro: true,
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
        regime: regimeDe(c),
        // Q15: estado vem do snapshot (aberta/configurando/calculada/fechada/transmitida)
        estado: snap?.estado || "aberta",
        // ⚠ TRÊS CAMPOS PORQUE SÃO TRÊS FATOS. Até a separação das colunas, o valor que esta tabela
        // exibia como "DAS" numa empresa `calculada` vinha de `dasCalculadoLocal` — mas era, quase
        // sempre, a SIMULAÇÃO da RFB gravada ali dentro. Agora ela chega em `dasSimulado`, com
        // nome. Sem este campo a coluna DAS da tela esvaziaria para toda competência calculada e
        // não transmitida, que é a maioria.
        dasCalculado: snap?.dasCalculadoLocal != null ? Number(snap.dasCalculadoLocal) : null,
        dasSimulado: snap?.dasSimuladoSerpro != null ? Number(snap.dasSimuladoSerpro) : null,
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
  //
  // ⚠ O ESCOPO É INTERSEÇÃO, NUNCA UNIÃO — o mesmo idioma de `whatsappGuias.js` (`escopoDoLote`).
  // O corpo pode PEDIR empresas; quem decide quais existem para este usuário é a carteira. Aqui a
  // interseção é `idsDaCarteira` (a função deste arquivo, definida abaixo), pelo mesmo motivo que
  // as três rotas de lote a usam: escrever a cláusula inline é como as cópias divergem.
  //
  // ⚠ O QUE ESTAVA ABERTO: `portalClientIds` ia CRU do corpo para `criarBatchJob`, e o worker
  // (`apuracaoBatchWorker`) só confere `apuracaoSnapshot.estado === "fechada"` — ele valida o
  // ESTADO da apuração, nunca DE QUEM é a empresa. Um usuário mandando ids de outro escritório
  // enfileirava — e o `run-now` abaixo TRANSMITE (`indicadorTransmissao: true`) — declaração
  // PGDAS-D de empresa que ele não pode nem listar. Ato fiscal irreversível, em CNPJ alheio.
  //
  // ⚠ Silencioso de propósito, como `idsDaCarteira`: id fora da carteira é DESCARTADO, não vira
  // erro. Pedindo só empresas alheias sobra lista vazia e a resposta é o `NO_COMPANIES` que já
  // existia — a mesma que quem não selecionou nada recebe.
  router.post("/apuracao/batch", async (req, res) => {
    if (!somenteAdminOuContador(req, res)) return undefined;
    const { portalClientIds, competencia } = req.body || {};
    if (!/^\d{4}-\d{2}$/.test(String(competencia || ""))) {
      return res.status(400).json({ ok: false, error: "invalid_competencia" });
    }
    try {
      const result = await criarBatchJob({
        portalClientIds: await idsDaCarteira(req, portalClientIds),
        competencia,
        userId: req.auth?.user?.id,
      });
      return res.json({ ok: true, ...result });
    } catch (err) {
      log.warn({ err: err?.message }, "Falha ao criar batch de apuração");
      return res.status(err?.code === "NO_COMPANIES" || err?.code === "NONE_CLOSED" ? 400 : 500)
        .json({ ok: false, error: err?.code || "batch_failed", message: err?.message });
    }
  });

  // GET /firm/apuracao/batch/:jobId — progresso (polling)
  //
  // ⚠ A resposta traz razão social e número de declaração empresa por empresa: ler o lote é ler a
  // carteira de quem o disparou. Escopo pelo MESMO critério da criação — ver `jobDaCarteira`.
  router.get("/apuracao/batch/:jobId", async (req, res) => {
    const jobId = String(req.params.jobId);
    try {
      const job = await prisma.apuracaoBatchJob.findUnique({ where: { id: jobId } });
      if (!job) return res.status(404).json({ ok: false, error: "job_not_found" });
      const items = await prisma.apuracaoBatchItem.findMany({
        where: { jobId },
        select: { portalClientId: true, status: true, dasValor: true, numeroDeclaracao: true, erroMensagem: true },
      });
      if (!(await jobDaCarteira(req, items.map((i) => i.portalClientId)))) {
        return res.status(404).json({ ok: false, error: "job_not_found" });
      }
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
  //
  // ⚠ É AQUI QUE A DECLARAÇÃO SAI. Duas guardas, e nenhuma delas substitui a outra: o gate
  // `admin|contador` (o mesmo de `/guides/batch-send`, `/guides/liberar-cliente` e `/guides/vazio`,
  // que já tratavam ato de consequência assim) e o escopo do lote (`jobDaCarteira`) — buscar o job
  // só pelo id deixava qualquer jobId conhecido rodar, e rodar aqui é transmitir à Receita.
  router.post("/apuracao/batch/:jobId/run-now", async (req, res) => {
    if (!somenteAdminOuContador(req, res)) return undefined;
    const jobId = String(req.params.jobId);
    try {
      const job = await prisma.apuracaoBatchJob.findUnique({ where: { id: jobId } });
      if (!job) return res.status(404).json({ ok: false, error: "job_not_found" });
      const doLote = await prisma.apuracaoBatchItem.findMany({ where: { jobId }, select: { portalClientId: true } });
      if (!(await jobDaCarteira(req, doLote.map((i) => i.portalClientId)))) {
        return res.status(404).json({ ok: false, error: "job_not_found" });
      }

      const deadline = Date.now() + 20000; // teto inline; o front continua o polling/run-now se sobrar
      let ciclos = 0;
      for (;;) {
        const pendentes = await prisma.apuracaoBatchItem.count({
          where: { jobId, status: { in: ["pendente", "processando"] } },
        });
        if (pendentes === 0) break;
        if (Date.now() >= deadline || ciclos >= 50) break;
        // Q55: escopado ao jobId — nunca toca itens de outro lote/escritório.
        // eslint-disable-next-line no-await-in-loop
        const { processados } = await runApuracaoBatchOnce(jobId);
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

  /**
   * ⚠ AS EMPRESAS DO PEDIDO QUE SÃO MESMO DA CARTEIRA DE QUEM PEDIU.
   *
   * As três rotas de lote abaixo (`/notas-download`, `/notas-captura`, `/sitfis-download`) filtravam
   * `companyIds` por `{ id: { in: ids } }` — o que só prova que a empresa **existe no banco**, não
   * que ela é do escritório de quem está pedindo. Duas delas ainda traziam o comentário "só entram
   * ids que EXISTEM na carteira", que era a intenção certa com a query errada.
   *
   * Consequência real: um usuário do escritório A, mandando ids do escritório B, disparava consulta
   * ao ADN e **baixava os XMLs** de empresas que não são dele. Multi-tenancy por `firmAccess` é
   * inegociável neste projeto, e este era o furo.
   *
   * A cláusula correta já existia 250 linhas acima, em `/firm/apuracao` — mas escrita inline, e a
   * cópia inline é como as três de baixo divergiram. Aqui é uma função só, e as três a chamam.
   *
   * ⚠ Silencioso de propósito: id fora da carteira é DESCARTADO, não vira erro. Responder "essa
   * empresa não é sua" confirmaria a existência do id para quem está sondando.
   */
  async function idsDaCarteira(req, companyIds) {
    const ids = Array.isArray(companyIds) ? companyIds.map(String).filter(Boolean) : [];
    if (!ids.length) return [];
    const userId = String(req.auth?.user?.id || "");
    const where = { id: { in: ids } };
    // admin/contador enxergam a carteira toda — mesma regra de `/companies` e `/firm/apuracao`.
    if (!isAdminLikeUser(req.auth?.user)) where.firmAccess = { some: { userId } };
    const existentes = await prisma.portalClient.findMany({ where, select: { id: true } });
    return existentes.map((c) => c.id);
  }

  /** Normaliza a lista de empresas gravada no job (`companyIds` é `Json`, então chega solta). */
  function idsDoJob(companyIds) {
    return [...new Set((Array.isArray(companyIds) ? companyIds : []).map((v) => String(v || "")).filter(Boolean))];
  }

  /**
   * ⚠ A CONTRAPARTIDA DE LEITURA DE `idsDaCarteira`. A guarda da criação não vale nada sozinha.
   *
   * `idsDaCarteira` protege quem ENTRA no job. Mas `GET /notas-download` listava
   * `findMany({ orderBy, take: 10 })` **sem nenhum `where`** (os 10 jobs mais recentes do sistema
   * inteiro — a assinatura era `(_req, res)`, a rota nem tinha como se escopar) e `/arquivo` fazia
   * `findUnique({ where: { id } })`, servindo o ZIP a quem conhecesse o jobId. O escopo já era
   * GRAVADO (`companyIds`, `triggeredBy`) e nunca era consultado: a leitura desfazia a escrita.
   *
   * ⚠ CONTENÇÃO, NÃO INTERSEÇÃO — e a diferença é o ponto. Na criação, id fora da carteira é
   * descartado e o resto do lote segue. Aqui o objeto é UM SÓ (o ZIP, o progresso do lote): basta
   * uma empresa alheia dentro dele para o arquivo carregar XML que não é de quem baixa. Então o job
   * só é visível quando TODAS as suas empresas são.
   *
   * ⚠ RECUSA É 404, NUNCA 403. 403 confirmaria que aquele jobId existe — a mesma discrição do
   * "descarte silencioso" de `idsDaCarteira`.
   *
   * Admin/contador enxergam a carteira toda (`isAdminLikeUser`), e o curto-circuito é o que mantém
   * o caminho legítimo intacto — inclusive para job de empresa já removida, cujo id não voltaria de
   * `portalClient.findMany`.
   */
  async function permitidosParaLeitura(req, ids) {
    if (isAdminLikeUser(req.auth?.user)) return new Set(ids);
    return new Set(await idsDaCarteira(req, ids));
  }

  async function jobDaCarteira(req, companyIds) {
    const ids = idsDoJob(companyIds);
    // Job sem empresa nenhuma não é criável por rota nenhuma (todas recusam com
    // `COMPANIES_REQUIRED`/`NO_COMPANIES`); se aparecer, não há carteira que o contenha.
    if (!ids.length) return false;
    const permitidas = await permitidosParaLeitura(req, ids);
    return ids.every((id) => permitidas.has(id));
  }

  /** A mesma contenção sobre uma LISTA, com uma consulta só (a união dos ids de todos os jobs). */
  async function jobsDaCarteira(req, jobs, companyIdsDoJob = (j) => j.companyIds) {
    const porJob = jobs.map((job) => ({ job, ids: idsDoJob(companyIdsDoJob(job)) }));
    const permitidas = await permitidosParaLeitura(req, [...new Set(porJob.flatMap((x) => x.ids))]);
    return porJob.filter((x) => x.ids.length && x.ids.every((id) => permitidas.has(id))).map((x) => x.job);
  }

  // POST /firm/notas-download  body: { companyIds:[], competenciaDe, competenciaAte, tipo?, papel? }
  router.post("/notas-download", async (req, res) => {
    const { companyIds, competenciaDe, competenciaAte, tipo, papel } = req.body || {};
    try {
      const validIds = await idsDaCarteira(req, companyIds);
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

  // ===========================================================================
  // CONSULTA DE NOTAS EM LOTE — a captura de verdade (ADN/SEFAZ).
  //
  // ⚠ NÃO é `/notas-download`. Aquele zipa o XML que JÁ está no banco e conclui "com sucesso" mesmo
  // quando a captura nunca rodou — foi o que escondeu a rotina automática quebrada. Este chama o
  // ADN e a SEFAZ e traz nota nova, devolvendo UMA LINHA POR EMPRESA (inclusive as puladas, com o
  // motivo), que é o ponto todo.
  // ===========================================================================

  // POST /firm/notas-captura  body: { companyIds: [], alvos: ["NFSE","NFE"] }
  router.post("/notas-captura", async (req, res) => {
    const { companyIds, alvos } = req.body || {};
    try {
      // ⚠ Isolamento multi-tenant: só entram ids da carteira DE QUEM PEDIU — ver `idsDaCarteira`.
      // Esta rota chama o ADN de verdade, então o furo aqui era consulta externa em nome de empresa
      // alheia, não só leitura.
      const result = await criarNotasCapturaJob({
        portalClientIds: await idsDaCarteira(req, companyIds),
        alvos,
        triggeredBy: req.auth?.user?.id || null,
      });
      return res.json({ ok: true, job: result });
    } catch (err) {
      const badCodes = ["NO_COMPANIES", "NO_TARGETS"];
      log.warn({ err: err?.message }, "Falha ao criar consulta de notas em lote");
      return res.status(badCodes.includes(err?.code) ? 400 : 500)
        .json({ ok: false, error: err?.code || "notas_captura_failed", message: err?.message });
    }
  });

  // GET /firm/notas-captura — últimas consultas ("Consultas recentes"): sair da página e voltar
  // não pode perder o resultado, senão o contador dispara de novo (e gasta chamada de novo).
  //
  // ⚠ Busca 50 e mostra 10 DEPOIS de filtrar: filtrar 10 já cortados deixaria a lista vazia para
  // quem tem carteira parcial, que é o oposto do que a rota existe para fazer.
  router.get("/notas-captura", async (req, res) => {
    try {
      const jobs = await jobsDaCarteira(req, await listNotasCapturaJobs(50));
      return res.json({ ok: true, jobs: jobs.slice(0, 10) });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "notas_captura_list_failed", message: err?.message });
    }
  });

  // GET /firm/notas-captura/:jobId — polling (traz os itens por empresa)
  //
  // ⚠ Os itens trazem razão social e CNPJ de cada empresa do lote — buscar o job só pelo id
  // entregava a carteira de outro escritório. 404 (não 403) para não confirmar o jobId.
  router.get("/notas-captura/:jobId", async (req, res) => {
    try {
      const job = await getNotasCapturaJob(req.params.jobId);
      if (!job || !(await jobDaCarteira(req, job.companyIds))) {
        return res.status(404).json({ ok: false, error: "job_not_found" });
      }
      return res.json({ ok: true, job });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "notas_captura_get_failed", message: err?.message });
    }
  });

  // C9: resumo dos processos rodando em segundo plano — alimenta o selo "N processos" do dashboard.
  // Só CONTAGEM + progresso agregado (2 counts curtos), pra poder ser chamado em polling barato.
  // Envio de e-mails em lote NÃO entra: é chamada bloqueante, não job de fundo.
  // Consumo do mês das chamadas PAGAS ao SERPRO + o teto vigente.
  // Existe para o teto ser VISTO chegando: um bloqueio que aparece de surpresa no fim do mês é o
  // mesmo que travar o app. Em erro devolve vazio — isto é informação, não pode derrubar tela.
  router.get("/serpro/consumo", async (_req, res) => {
    try {
      return res.json({ ok: true, ...(await consumoDoMes()) });
    } catch (err) {
      log?.warn?.({ err: err?.message }, "Falha ao consultar consumo SERPRO");
      return res.json({ ok: false });
    }
  });

  router.get("/jobs/ativos", async (_req, res) => {
    try {
      const emAndamento = {
        where: { status: "processando" },
        select: { id: true, totalEmpresas: true, processadas: true },
      };
      const [notas, sitfis, captura] = await Promise.all([
        prisma.notasDownloadJob.findMany(emAndamento),
        prisma.sitfisDownloadJob.findMany(emAndamento),
        // A consulta em lote é a mais demorada das três (chama ADN/SEFAZ empresa por empresa) —
        // é justamente a que o contador precisa ver rodando ao sair da página.
        prisma.notasCapturaJob.findMany(emAndamento),
      ]);
      const mapa = (arr, tipo) => arr.map((j) => ({
        tipo,
        jobId: j.id,
        total: Number(j.totalEmpresas || 0),
        processadas: Number(j.processadas || 0),
      }));
      const jobs = [...mapa(notas, "notas"), ...mapa(sitfis, "sitfis"), ...mapa(captura, "captura-notas")];
      return res.json({ ok: true, total: jobs.length, jobs });
    } catch (err) {
      // Nunca derruba o dashboard por causa do selo — devolve vazio.
      return res.json({ ok: false, total: 0, jobs: [], message: err?.message });
    }
  });

  // GET /firm/notas-download — últimos jobs ("Downloads recentes")
  //
  // ⚠ `(_req, res)` era o sintoma: a rota nem tinha o usuário em mãos, e o `findMany` saía sem
  // `where` nenhum — os 10 jobs mais recentes DO SISTEMA INTEIRO, com o jobId de cada um, que é a
  // chave do `/arquivo` logo abaixo. Busca 50 e mostra 10 depois de filtrar (ver `/notas-captura`).
  router.get("/notas-download", async (req, res) => {
    try {
      await cleanupNotasDownloadJobs();
      const jobs = await prisma.notasDownloadJob.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      const visiveis = await jobsDaCarteira(req, jobs);
      return res.json({ ok: true, jobs: visiveis.slice(0, 10).map(notasDownloadJobToResponse) });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "notas_download_list_failed", message: err?.message });
    }
  });

  // GET /firm/notas-download/:jobId — progresso (polling)
  router.get("/notas-download/:jobId", async (req, res) => {
    try {
      const job = await prisma.notasDownloadJob.findUnique({ where: { id: String(req.params.jobId) } });
      if (!job || !(await jobDaCarteira(req, job.companyIds))) {
        return res.status(404).json({ ok: false, error: "job_not_found" });
      }
      return res.json({ ok: true, job: notasDownloadJobToResponse(job) });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "notas_download_status_failed", message: err?.message });
    }
  });

  // GET /firm/notas-download/:jobId/arquivo — stream do ZIP pronto
  //
  // ⚠ AQUI SAEM OS XMLs. Conferir só que o job existe é exatamente o furo que `idsDaCarteira`
  // fechou na criação, reaberto pelo lado da leitura.
  router.get("/notas-download/:jobId/arquivo", async (req, res) => {
    try {
      const job = await prisma.notasDownloadJob.findUnique({ where: { id: String(req.params.jobId) } });
      if (!job || !(await jobDaCarteira(req, job.companyIds))) {
        return res.status(404).json({ ok: false, error: "job_not_found" });
      }
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

  // Q62 — Download em lote das situações fiscais (SITFIS): job + ZIP dos PDFs armazenados.
  // POST /firm/sitfis-download  body: { companyIds:[] }
  router.post("/sitfis-download", async (req, res) => {
    try {
      const result = await criarSitfisDownloadJob({
        companyIds: await idsDaCarteira(req, req.body?.companyIds),
        userId: req.auth?.user?.id,
      });
      return res.json(result);
    } catch (err) {
      log.warn({ err: err?.message }, "Falha ao criar download de SITFIS");
      return res.status(err?.code === "COMPANIES_REQUIRED" ? 400 : 500)
        .json({ ok: false, error: err?.code || "sitfis_download_failed", message: err?.message });
    }
  });

  // GET /firm/sitfis-download/:jobId — progresso (polling)
  // ⚠ Gêmea de `/notas-download/:jobId`, mesmo furo, mesmo conserto — ver `jobDaCarteira`.
  router.get("/sitfis-download/:jobId", async (req, res) => {
    try {
      const job = await prisma.sitfisDownloadJob.findUnique({ where: { id: String(req.params.jobId) } });
      if (!job || !(await jobDaCarteira(req, job.companyIds))) {
        return res.status(404).json({ ok: false, error: "job_not_found" });
      }
      return res.json({ ok: true, job: sitfisJobToResponse(job) });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "sitfis_download_status_failed", message: err?.message });
    }
  });

  // GET /firm/sitfis-download/:jobId/arquivo — stream do ZIP pronto
  // ⚠ Este ZIP são os relatórios de SITUAÇÃO FISCAL (débitos, dívida ativa) das empresas do lote.
  router.get("/sitfis-download/:jobId/arquivo", async (req, res) => {
    try {
      const job = await prisma.sitfisDownloadJob.findUnique({ where: { id: String(req.params.jobId) } });
      if (!job || !(await jobDaCarteira(req, job.companyIds))) {
        return res.status(404).json({ ok: false, error: "job_not_found" });
      }
      if (job.status === "expirado") return res.status(410).json({ ok: false, error: "expirado" });
      if (job.status !== "concluido" || !job.arquivoPath) return res.status(409).json({ ok: false, error: "nao_concluido", status: job.status });
      if (job.expiresAt && new Date(job.expiresAt) < new Date()) return res.status(410).json({ ok: false, error: "expirado" });
      if (!fsNotasDownload.existsSync(job.arquivoPath)) return res.status(410).json({ ok: false, error: "arquivo_removido" });
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFilename(job.arquivoNome || `situacao-fiscal-${job.id}.zip`)}"`);
      if (job.arquivoBytes) res.setHeader("Content-Length", String(job.arquivoBytes));
      const stream = fsNotasDownload.createReadStream(job.arquivoPath);
      stream.on("error", () => { if (!res.headersSent) res.status(500).end(); else res.end(); });
      return stream.pipe(res);
    } catch (err) {
      log.warn({ err: err?.message }, "Falha no download do zip de SITFIS");
      if (!res.headersSent) return res.status(500).json({ ok: false, error: "sitfis_download_file_failed" });
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
    // A "conta mãe": o código COMPLETO do ERP. Opcional — sem ele a conta nasce sem resposta sobre
    // sintética × analítica, que é a verdade.
    const codigoCompleto = String(body.codigoCompleto || "").trim() || null;

    if (!codigo) return res.status(400).json({ error: "codigo_required" });
    if (!nome) return res.status(400).json({ error: "nome_required" });
    if (!VALID_TIPOS.includes(tipo)) return res.status(400).json({ error: "tipo_invalido" });

    // Override semantic: empresa sempre vence sobre global. Não bloqueamos
    // criação global mesmo que alguma empresa já tenha o mesmo código —
    // a empresa simplesmente não verá esta conta global enquanto a sua existir.
    try {
      const account = await prisma.chartOfAccount.create({
        data: { portalClientId: null, codigo, nome, tipo, natureza, codigoCompleto, status: "PENDENTE_ERP" },
      });
      // ⚠ A conta nova pode ser a FILHA que torna outra sintética — a derivação é do escopo
      // inteiro, não da linha. Sem isto, cadastrar `111010001` deixaria `11101` sugerível.
      if (codigoCompleto) await rederivarAnaliticaDoEscopo(null);
      return res.status(201).json({ ok: true, account: await prisma.chartOfAccount.findUnique({ where: { id: account.id } }) });
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
    // ⚠ `codigo` NÃO é editável por aqui, e nunca foi: `AccountingEntryLine.conta` aponta para ele
    // em texto, sem FK. `codigoCompleto` é o que se edita — a conta mãe, para análise.
    if (body.codigoCompleto !== undefined) data.codigoCompleto = String(body.codigoCompleto).trim() || null;
    if (body.status !== undefined && ["CONFIRMADA", "PENDENTE_ERP"].includes(String(body.status))) {
      data.status = String(body.status);
    }

    const updated = await prisma.chartOfAccount.update({
      where: { id: existing.id },
      data,
    });
    if (data.codigoCompleto !== undefined) await rederivarAnaliticaDoEscopo(null);
    return res.json({ ok: true, account: await prisma.chartOfAccount.findUnique({ where: { id: existing.id } }) });
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
    // Excluir a ÚLTIMA filha devolve a mãe à condição de analítica — a derivação é do escopo.
    if (existing.codigoCompleto) await rederivarAnaliticaDoEscopo(null);
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

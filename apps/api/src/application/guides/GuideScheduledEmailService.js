import { prisma } from "../../infrastructure/db/prisma.js";
import { sendLatestGuidesEmailByCompany } from "./GuideCompanyEmailService.js";
import { releaseGuideLock, tryAcquireGuideLock } from "./GuideLockService.js";
import { destinatariosDeEnvio } from "../whatsapp/ContatoWhatsappService.js";

const SCHEDULE_LOCK_ID = "guides_email_schedule_lock";
const SCHEDULE_LOCK_TTL_MS = 45 * 60 * 1000;

function normalizeScheduleDays(inputDays) {
  const raw = Array.isArray(inputDays) ? inputDays : [13];
  const days = [...new Set(raw.map((value) => Number(value)).filter((value) => value >= 1 && value <= 31))]
    .sort((a, b) => a - b);
  return days.length ? days : [13];
}

async function acquireScheduleLock() {
  return tryAcquireGuideLock(SCHEDULE_LOCK_ID, SCHEDULE_LOCK_TTL_MS);
}

async function releaseScheduleLock() {
  await releaseGuideLock(SCHEDULE_LOCK_ID);
}

export function isAdminLikeUser(user) {
  const appRole = String(user?.role || "").toLowerCase();
  return appRole === "admin" || appRole === "contador";
}

export async function getCompanyGuideEmailSchedule(portalCompanyId) {
  const key = `guide_email_schedule:${String(portalCompanyId)}`;
  const setting = await prisma.appSetting.findUnique({ where: { key } });
  const value = setting?.value && typeof setting.value === "object" ? setting.value : {};
  return {
    days: normalizeScheduleDays(value?.days),
    updatedBy: value?.updatedBy || null,
    updatedAt: value?.updatedAt || null,
  };
}

export async function setCompanyGuideEmailSchedule({ portalCompanyId, days, updatedBy }) {
  const key = `guide_email_schedule:${String(portalCompanyId)}`;
  const payload = {
    days: normalizeScheduleDays(days),
    updatedBy: String(updatedBy || ""),
    updatedAt: new Date().toISOString(),
  };
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: payload },
    update: { value: payload },
  });
  return payload;
}

/**
 * OS DESTINATÁRIOS DA GUIA — e não existe outro lugar de onde eles saiam (05/09/2026).
 *
 * > Dono, depois de ver uma guia sair para um endereço que ninguém escolheu: *"a guia só vai para
 * > e-mail ou número cadastrado na aba de guias, fora isso não sai e mostra por que não foi"*.
 *
 * Quem cadastra é a gaveta **Configuração de envio**, dentro de Guias (`contatos_whatsapp.email`).
 * Lista vazia devolve VAZIO, e o chamador **recusa nomeando** — a guia não sai.
 *
 * ⚠⚠ A CASCATA (`guideNotificationEmail` → `Company.email` → e-mail do sócio) FOI REMOVIDA DAQUI, e
 * esta é a reversão de uma decisão anterior MINHA, tomada no mesmo dia. Eu a mantive como "rede
 * para não calar a carteira"; o que ela produziu foi pior que o silêncio: a guia da KLAUS NIGRO
 * saiu para o login do portal do cliente — endereço que não aparece em tela nenhuma —, e a
 * interface disse **"e-mail enviado"** sobre um destino que o contador não podia conferir.
 * ⚠ Envio sem destinatário visível não é entrega: é uma afirmação que ninguém pode auditar.
 *
 * ⚠ MEDIDO ANTES DE APERTAR (05/09/2026, produção): 32 das 34 empresas já têm e-mail cadastrado (o
 * backfill do mesmo dia), 2 não têm, e **zero** guias pendentes ficariam paradas. A guarda nasce
 * quase inerte — de propósito. Apertar antes do backfill teria calado a carteira.
 *
 * ⚠ A CASCATA CONTINUA VIVA FORA DA GUIA (`resolveCompanyNotificationEmail`, abaixo): ela é o
 * endereço de contato da empresa, e dois caminhos dependem dela por motivos que NÃO são "para quem
 * mando a guia" — o envio de DOCUMENTOS e, mais delicado, o filtro de elegibilidade dos workers do
 * SERPRO (`if (!email) continue`), que decide quem é CAPTURADO. Apertar lá pararia a captura de
 * guia das duas empresas sem e-mail — o oposto do pedido.
 *
 * ⚠ O OPT-IN NÃO ENTRA AQUI. Ele é exigência da Meta para o WhatsApp; e-mail nunca dependeu dele.
 *
 * @returns {Promise<string[]>} sem repetição, minúsculas. Vazio = ninguém, e a guia NÃO sai.
 */
export async function resolveCompanyNotificationEmails(portalCompanyId) {
  const { emails } = await destinatariosDeEnvio(portalCompanyId);
  return emails;
}

/** A frase da recusa — uma só, para as três portas que enviam guia dizerem a MESMA coisa. */
export const SEM_DESTINATARIO_DE_GUIA = Object.freeze({
  codigo: "GUIDE_EMAIL_RECIPIENT_NOT_FOUND",
  erro: "company_email_not_found",
  motivo:
    "Esta empresa não tem e-mail cadastrado em Configuração de envio (aba Guias). "
    + "Cadastre o destinatário e envie de novo — a guia não sai para endereço não cadastrado.",
});

/**
 * O e-mail de CONTATO da empresa — a cascata antiga.
 *
 * ⚠⚠ NÃO É O DESTINATÁRIO DA GUIA desde 05/09/2026 (ver acima). Quem envia guia usa
 * `resolveCompanyNotificationEmails`, e há teste varrendo os arquivos de envio de guia para que
 * esta função não volte a ser importada por eles.
 */
export async function resolveCompanyNotificationEmail(portalCompanyId) {
  const portal = await prisma.portalClient.findUnique({
    where: { id: String(portalCompanyId) },
    select: { companyId: true, guideNotificationEmail: true },
  });
  const guideOnly = String(portal?.guideNotificationEmail || "")
    .trim()
    .toLowerCase();
  if (guideOnly) return guideOnly;
  if (!portal?.companyId) return null;
  const legacyCompany = await prisma.company.findUnique({
    where: { id: portal.companyId },
    select: { email: true },
  });
  const directEmail = String(legacyCompany?.email || "")
    .trim()
    .toLowerCase();
  if (directEmail) return directEmail;
  const ownerLink = await prisma.companyClientUser.findFirst({
    where: {
      companyId: String(portalCompanyId),
      role: "OWNER",
      status: "ACTIVE",
    },
    include: {
      user: { select: { email: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const ownerEmail = String(ownerLink?.user?.email || "")
    .trim()
    .toLowerCase();
  return ownerEmail || null;
}

export async function listEligiblePortalCompaniesForUser({ userId, adminLike }) {
  if (adminLike) {
    return prisma.portalClient.findMany({
      select: { id: true, razao: true, cnpj: true },
      orderBy: { razao: "asc" },
    });
  }
  const links = await prisma.companyFirmAccess.findMany({
    where: { userId: String(userId), status: "ACTIVE" },
    include: {
      company: { select: { id: true, razao: true, cnpj: true } },
    },
  });
  return links.map((link) => link.company);
}

export async function runScheduledGuideEmailDispatch({
  companies,
  referenceDay,
  dryRun = false,
  maxFilesPerCompany = 15,
}) {
  const locked = await acquireScheduleLock();
  if (!locked) {
    return {
      ok: false,
      skipped: true,
      reason: "lock_active",
      error: "guide_email_schedule_busy",
    };
  }
  const startedAt = Date.now();
  try {
    const today = Number(referenceDay);
    const results = [];
    for (const company of companies) {
      // eslint-disable-next-line no-await-in-loop
      const schedule = await getCompanyGuideEmailSchedule(company.id);
      const isEligible = schedule.days.includes(today);
      if (!isEligible) {
        results.push({
          companyId: company.id,
          razao: company.razao,
          cnpj: company.cnpj,
          scheduleDays: schedule.days,
          eligible: false,
          status: "skipped_by_schedule",
        });
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const destinos = await resolveCompanyNotificationEmails(company.id);
      const to = destinos.join(", ");
      if (!to) {
        results.push({
          companyId: company.id,
          razao: company.razao,
          cnpj: company.cnpj,
          scheduleDays: schedule.days,
          eligible: true,
          status: "error",
          error: SEM_DESTINATARIO_DE_GUIA.erro,
          reason: SEM_DESTINATARIO_DE_GUIA.motivo,
        });
        continue;
      }

      if (dryRun) {
        results.push({
          companyId: company.id,
          razao: company.razao,
          cnpj: company.cnpj,
          scheduleDays: schedule.days,
          eligible: true,
          to,
          status: "dry_run_ready",
        });
        continue;
      }

      try {
        // eslint-disable-next-line no-await-in-loop
        const sendResult = await sendLatestGuidesEmailByCompany({
          portalClientId: company.id,
          to,
          maxFilesPerRun: maxFilesPerCompany,
        });
        results.push({
          companyId: company.id,
          razao: company.razao,
          cnpj: company.cnpj,
          scheduleDays: schedule.days,
          eligible: true,
          to,
          status: sendResult?.status || "sent",
          result: sendResult,
        });
      } catch (err) {
        results.push({
          companyId: company.id,
          razao: company.razao,
          cnpj: company.cnpj,
          scheduleDays: schedule.days,
          eligible: true,
          to,
          status: "error",
          error: err?.code || "GUIDE_EMAIL_SEND_FAILED",
          reason: err?.message || "Falha ao enviar guias da empresa.",
          meta: err?.meta || null,
        });
      }
    }

    const eligibleCompanies = results.filter((item) => item.eligible).length;
    const failedCompanies = results.filter((item) => item.status === "error").length;
    const sentCompanies = results.filter(
      (item) => item.status === "sent" || item.status === "sent_with_marker_warnings"
    ).length;
    const nothingToSend = results.filter((item) => item.status === "nothing_to_send").length;
    const attachmentsCount = results.reduce(
      (acc, item) => acc + Number(item?.result?.attachmentsCount || 0),
      0
    );
    const attachmentsBytes = results.reduce(
      (acc, item) => acc + Number(item?.result?.attachmentsBytes || 0),
      0
    );
    const durationMs = Date.now() - startedAt;

    return {
      ok: failedCompanies === 0,
      skipped: false,
      dryRun,
      referenceDay: today,
      totalCompanies: companies.length,
      eligibleCompanies,
      sentCompanies,
      nothingToSend,
      failedCompanies,
      attachmentsCount,
      attachmentsBytes,
      durationMs,
      results,
    };
  } finally {
    await releaseScheduleLock();
  }
}


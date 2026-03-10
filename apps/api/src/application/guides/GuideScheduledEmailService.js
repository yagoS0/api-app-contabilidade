import { prisma } from "../../infrastructure/db/prisma.js";
import { sendLatestGuidesEmailByCompany } from "./GuideCompanyEmailService.js";
import { releaseGuideLock, tryAcquireGuideLock } from "./GuideLockService.js";

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

export async function resolveCompanyNotificationEmail(portalCompanyId) {
  const portal = await prisma.portalClient.findUnique({
    where: { id: String(portalCompanyId) },
    select: { companyId: true },
  });
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
      const to = await resolveCompanyNotificationEmail(company.id);
      if (!to) {
        results.push({
          companyId: company.id,
          razao: company.razao,
          cnpj: company.cnpj,
          scheduleDays: schedule.days,
          eligible: true,
          status: "error",
          error: "company_email_not_found",
          reason: "Empresa sem e-mail de notificação (Company.email ou OWNER.email).",
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


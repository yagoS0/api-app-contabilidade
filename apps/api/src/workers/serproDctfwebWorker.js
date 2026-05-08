import { log } from "../config.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { tryAcquireGuideLock, releaseGuideLock } from "../application/guides/GuideLockService.js";
import { getReferenceCompetencia } from "../application/guides/guideCompliance.js";
import { resolveCompanyNotificationEmail } from "../application/guides/GuideScheduledEmailService.js";
import { getSerproRuntimeSettings } from "../application/fiscal/serpro/SerproRuntimeSettings.js";
import { SerproProcurationService } from "../application/fiscal/serpro/SerproProcurationService.js";
import { syncSerproInssForCompany } from "../application/fiscal/serpro/SerproDctfwebService.js";
import { createSerproExecutionLog } from "../application/fiscal/serpro/SerproExecutionLogService.js";

const LOCK_ID = "serpro_dctfweb_capture_lock";
const LOCK_TTL_MS = 30 * 60 * 1000;
const LOOP_INTERVAL_MS = 60 * 1000;

function parseCronField(field, value, min, max) {
  const raw = String(field || "*").trim();
  if (raw === "*") return true;

  return raw.split(",").some((part) => {
    const token = String(part || "").trim();
    if (!token) return false;

    const stepMatch = token.match(/^(\*|\d+-\d+|\d+)\/(\d+)$/);
    if (stepMatch) {
      const base = stepMatch[1];
      const step = Number(stepMatch[2]);
      if (!Number.isFinite(step) || step <= 0) return false;
      if (base === "*") return value >= min && value <= max && (value - min) % step === 0;
      if (base.includes("-")) {
        const [start, end] = base.split("-").map(Number);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
        return value >= start && value <= end && (value - start) % step === 0;
      }
      const start = Number(base);
      return value === start;
    }

    if (token.includes("-")) {
      const [start, end] = token.split("-").map(Number);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
      return value >= start && value <= end;
    }

    const numeric = Number(token);
    return Number.isFinite(numeric) && numeric === value;
  });
}

function matchesCron(cronExpression, now = new Date()) {
  const parts = String(cronExpression || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 5) return false;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  return (
    parseCronField(minute, now.getMinutes(), 0, 59) &&
    parseCronField(hour, now.getHours(), 0, 23) &&
    parseCronField(dayOfMonth, now.getDate(), 1, 31) &&
    parseCronField(month, now.getMonth() + 1, 1, 12) &&
    parseCronField(dayOfWeek, now.getDay(), 0, 6)
  );
}

async function listEligiblePortalCompanies() {
  // INSS via DCTFWeb se aplica a qualquer empresa com CNPJ válido e procuração SERPRO ativa.
  // syncSerproInssForCompany trata "não transmitida" graciosamente.
  const companies = await prisma.portalClient.findMany({
    where: {
      cnpj: { not: null },
    },
    select: {
      id: true,
      razao: true,
      cnpj: true,
      guideNotificationEmail: true,
    },
    orderBy: { razao: "asc" },
  });

  const eligible = [];
  for (const company of companies) {
    // eslint-disable-next-line no-await-in-loop
    const email = await resolveCompanyNotificationEmail(company.id);
    if (!email) continue;
    eligible.push({
      id: company.id,
      razao: company.razao,
      cnpj: company.cnpj,
      email,
    });
  }
  return eligible;
}

// Lista guias INSS OPEN cujo vencimento ainda não passou (para re-fetch diário)
async function listOpenInssGuidesUntilVencimento(portalClientId, todayDate) {
  return prisma.guide.findMany({
    where: {
      portalClientId,
      source: "SERPRO",
      tipo: "INSS",
      status: "PROCESSED",
      paymentStatus: "OPEN",
      OR: [{ vencimento: null }, { vencimento: { gte: todayDate } }],
    },
    select: { id: true, portalClientId: true, competencia: true, vencimento: true, paymentStatus: true },
  });
}

function startOfTodayLocal(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function isSameLocalDay(d1, d2) {
  if (!d1 || !d2) return false;
  return d1.getFullYear() === d2.getFullYear()
    && d1.getMonth() === d2.getMonth()
    && d1.getDate() === d2.getDate();
}

export async function runSerproDctfwebWorkerOnce(options = {}) {
  const locked = await tryAcquireGuideLock(LOCK_ID, LOCK_TTL_MS);
  if (!locked) return { skipped: true, reason: "lock_active" };

  try {
    const settings = await getSerproRuntimeSettings();
    if (!settings.enabled) {
      return { skipped: true, reason: "serpro_disabled" };
    }

    const competencia = options.competencia || getReferenceCompetencia();
    const companies = await listEligiblePortalCompanies();
    const procurationService = new SerproProcurationService();
    const results = [];
    const recheckResults = [];
    const startedAt = Date.now();

    const now = new Date();
    const todayStart = startOfTodayLocal(now);
    const fetchDay = settings.fetchDay ?? 5;
    const isCaptureWindow = now.getDate() >= fetchDay;

    for (const company of companies) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const procuration = await procurationService.checkCompanyProcuration({ portalClientId: company.id });
        if (procuration.status !== "ATIVA") {
          results.push({
            companyId: company.id, razao: company.razao, cnpj: company.cnpj, email: company.email,
            competencia,
            status: "skipped_procuration_inactive",
            procurationStatus: procuration.status,
          });
          continue;
        }

        // Stage 1 — Captura inicial
        // eslint-disable-next-line no-await-in-loop
        const existingForCompetencia = await prisma.guide.findFirst({
          where: {
            portalClientId: company.id,
            source: "SERPRO",
            tipo: "INSS",
            competencia,
            status: "PROCESSED",
          },
          select: { id: true },
        });

        if (isCaptureWindow && !existingForCompetencia) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const sync = await syncSerproInssForCompany({ portalClientId: company.id, competencia });
            results.push({
              companyId: company.id, razao: company.razao, cnpj: company.cnpj, email: company.email,
              competencia,
              status: sync.inss?.status === "NOT_TRANSMITTED" ? "not_transmitted" : "captured",
              guideId: sync.guide?.guideId || null,
              inssTotal: sync.inss?.inssTotal || null,
              inssVencimento: sync.inss?.inssVencimento || null,
            });
          } catch (err) {
            results.push({
              companyId: company.id, razao: company.razao, cnpj: company.cnpj, email: company.email,
              competencia,
              status: "error",
              error: err?.code || "SERPRO_DCTFWEB_CAPTURE_FAILED",
              reason: err?.message || "serpro_dctfweb_capture_failed",
              retryable: Boolean(err?.retryable),
            });
          }
        }

        // Stage 2 — Re-fetch diário das INSS OPEN cujo vencimento ainda não passou
        // eslint-disable-next-line no-await-in-loop
        const openGuides = await listOpenInssGuidesUntilVencimento(company.id, todayStart);
        for (const guide of openGuides) {
          const vencDate = guide.vencimento ? new Date(guide.vencimento) : null;
          const isVencimentoHoje = vencDate ? isSameLocalDay(vencDate, now) : false;
          try {
            // eslint-disable-next-line no-await-in-loop
            const sync = await syncSerproInssForCompany({
              portalClientId: guide.portalClientId,
              competencia: guide.competencia,
              emailStatusOverride: isVencimentoHoje ? "PENDING" : "PRESERVE",
            });
            recheckResults.push({
              guideId: guide.id, companyId: guide.portalClientId,
              competencia: guide.competencia,
              status: isVencimentoHoje ? "rechecked_due_today" : "rechecked_silent",
              inssTotal: sync.inss?.inssTotal || null,
            });
          } catch (err) {
            recheckResults.push({
              guideId: guide.id, companyId: guide.portalClientId,
              competencia: guide.competencia,
              status: "error",
              error: err?.code || "SERPRO_DCTFWEB_RECHECK_FAILED",
              reason: err?.message || "serpro_dctfweb_recheck_failed",
            });
          }
        }
      } catch (err) {
        results.push({
          companyId: company.id, razao: company.razao, cnpj: company.cnpj, email: company.email,
          competencia,
          status: "error",
          error: err?.code || "SERPRO_DCTFWEB_CYCLE_FAILED",
          reason: err?.message || "serpro_dctfweb_cycle_failed",
        });
      }
    }

    const summary = {
      skipped: false,
      competencia,
      fetchDay,
      isCaptureWindow,
      totalCompanies: companies.length,
      captured: results.filter((item) => item.status === "captured").length,
      notTransmitted: results.filter((item) => item.status === "not_transmitted").length,
      failed: results.filter((item) => item.status === "error").length,
      skippedByProcuration: results.filter((item) => item.status === "skipped_procuration_inactive").length,
      recheckedSilent: recheckResults.filter((item) => item.status === "rechecked_silent").length,
      recheckedDueToday: recheckResults.filter((item) => item.status === "rechecked_due_today").length,
      recheckFailures: recheckResults.filter((item) => item.status === "error").length,
      durationMs: Date.now() - startedAt,
      results,
      recheckResults,
    };
    await createSerproExecutionLog({
      worker: "serpro_dctfweb",
      createdAt: new Date().toISOString(),
      competencia,
      settings: {
        enabled: settings.enabled,
        environment: settings.environment,
        fetchCron: settings.fetchCron,
      },
      summary,
    });
    return summary;
  } finally {
    await releaseGuideLock(LOCK_ID);
  }
}

export async function runSerproDctfwebWorkerLoop() {
  let lastTickKey = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const settings = await getSerproRuntimeSettings();
      const now = new Date();
      const tickKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

      if (settings.enabled && matchesCron(settings.fetchCron, now) && tickKey !== lastTickKey) {
        lastTickKey = tickKey;
        const result = await runSerproDctfwebWorkerOnce();
        log.info({ result, tickKey }, "Ciclo do serproDctfwebWorker concluído");
      }
    } catch (err) {
      log.error({ err: err?.message || err }, "Erro no ciclo do serproDctfwebWorker");
    }

    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, LOOP_INTERVAL_MS));
  }
}

if (process.argv[1] && process.argv[1].endsWith("serproDctfwebWorker.js")) {
  const isOnce = process.argv.includes("--once");
  if (isOnce) {
    runSerproDctfwebWorkerOnce()
      .then((result) => {
        log.info({ result }, "serproDctfwebWorker --once finalizado");
        process.exit(0);
      })
      .catch((err) => {
        log.error({ err: err?.message || err }, "serproDctfwebWorker --once falhou");
        process.exit(1);
      });
  } else {
    runSerproDctfwebWorkerLoop().catch((err) => {
      log.error({ err: err?.message || err }, "serproDctfwebWorker loop fatal");
      process.exit(1);
    });
  }
}

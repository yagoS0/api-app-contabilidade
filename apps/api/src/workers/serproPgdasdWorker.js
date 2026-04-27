import { log } from "../config.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { tryAcquireGuideLock, releaseGuideLock } from "../application/guides/GuideLockService.js";
import { getReferenceCompetencia } from "../application/guides/guideCompliance.js";
import { resolveCompanyNotificationEmail } from "../application/guides/GuideScheduledEmailService.js";
import { getSerproRuntimeSettings } from "../application/fiscal/serpro/SerproRuntimeSettings.js";
import { SerproProcurationService } from "../application/fiscal/serpro/SerproProcurationService.js";
import { capturePgdasGuideForCompany } from "../application/fiscal/serpro/CaptureSerproGuidesService.js";
import { createSerproExecutionLog } from "../application/fiscal/serpro/SerproExecutionLogService.js";

const LOCK_ID = "serpro_pgdasd_capture_lock";
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

async function acquireLock() {
  return tryAcquireGuideLock(LOCK_ID, LOCK_TTL_MS);
}

async function releaseLockSafely() {
  await releaseGuideLock(LOCK_ID);
}

async function listEligiblePortalCompanies() {
  const companies = await prisma.portalClient.findMany({
    where: {
      cnpj: { not: null },
    },
    select: {
      id: true,
      razao: true,
      cnpj: true,
      guideNotificationEmail: true,
      hasProlabore: true,
      company: {
        select: {
          regimeTributario: true,
          tipoTributario: true,
        },
      },
    },
    orderBy: { razao: "asc" },
  });

  const eligible = [];
  for (const company of companies) {
    const regime = String(company.company?.regimeTributario || company.company?.tipoTributario || "")
      .trim()
      .toUpperCase();
    if (regime !== "SIMPLES") continue;
    // eslint-disable-next-line no-await-in-loop
    const email = await resolveCompanyNotificationEmail(company.id);
    if (!email) continue;
    eligible.push({
      id: company.id,
      razao: company.razao,
      cnpj: company.cnpj,
      email,
      regimeTributario: regime,
      hasProlabore: Boolean(company.hasProlabore),
    });
  }
  return eligible;
}

export async function runSerproPgdasdWorkerOnce(options = {}) {
  const locked = await acquireLock();
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
    const startedAt = Date.now();

    for (const company of companies) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const procuration = await procurationService.checkCompanyProcuration({ portalClientId: company.id });
        if (procuration.status !== "ATIVA") {
        results.push({
          companyId: company.id,
          razao: company.razao,
          cnpj: company.cnpj,
          email: company.email,
          competencia,
          status: "skipped_procuration_inactive",
          procurationStatus: procuration.status,
          });
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        const capture = await capturePgdasGuideForCompany({ portalClientId: company.id, competencia });
        results.push({
          companyId: company.id,
          razao: company.razao,
          cnpj: company.cnpj,
          email: company.email,
          competencia,
          status: "captured",
          guideId: capture.guide.guideId,
          integration: capture.integration,
        });
      } catch (err) {
        results.push({
          companyId: company.id,
          razao: company.razao,
          cnpj: company.cnpj,
          email: company.email,
          competencia,
          status: "error",
          error: err?.code || "SERPRO_PGDASD_CAPTURE_FAILED",
          reason: err?.message || "serpro_pgdasd_capture_failed",
          retryable: Boolean(err?.retryable),
        });
      }
    }

    const summary = {
      skipped: false,
      competencia,
      totalCompanies: companies.length,
      captured: results.filter((item) => item.status === "captured").length,
      failed: results.filter((item) => item.status === "error").length,
      skippedByProcuration: results.filter((item) => item.status === "skipped_procuration_inactive").length,
      durationMs: Date.now() - startedAt,
      results,
    };
    await createSerproExecutionLog({
      worker: "serpro_pgdasd",
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
    await releaseLockSafely();
  }
}

export async function runSerproPgdasdWorkerLoop() {
  let lastTickKey = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const settings = await getSerproRuntimeSettings();
      const now = new Date();
      const tickKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

      if (settings.enabled && matchesCron(settings.fetchCron, now) && tickKey !== lastTickKey) {
        lastTickKey = tickKey;
        const result = await runSerproPgdasdWorkerOnce();
        log.info({ result, tickKey }, "Ciclo do serproPgdasdWorker concluído");
      }
    } catch (err) {
      log.error({ err: err?.message || err }, "Erro no ciclo do serproPgdasdWorker");
    }

    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, LOOP_INTERVAL_MS));
  }
}

if (process.argv[1] && process.argv[1].endsWith("serproPgdasdWorker.js")) {
  const isOnce = process.argv.includes("--once");
  if (isOnce) {
    runSerproPgdasdWorkerOnce()
      .then((result) => {
        log.info({ result }, "serproPgdasdWorker --once finalizado");
        process.exit(0);
      })
      .catch((err) => {
        log.error({ err: err?.message || err }, "serproPgdasdWorker --once falhou");
        process.exit(1);
      });
  } else {
    runSerproPgdasdWorkerLoop().catch((err) => {
      log.error({ err: err?.message || err }, "serproPgdasdWorker loop fatal");
      process.exit(1);
    });
  }
}

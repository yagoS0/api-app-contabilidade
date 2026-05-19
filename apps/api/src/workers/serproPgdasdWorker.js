import { log } from "../config.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { tryAcquireGuideLock, releaseGuideLock } from "../application/guides/GuideLockService.js";
import { getReferenceCompetencia } from "../application/guides/guideCompliance.js";
import { resolveCompanyNotificationEmail } from "../application/guides/GuideScheduledEmailService.js";
import { getSerproRuntimeSettings } from "../application/fiscal/serpro/SerproRuntimeSettings.js";
import { SerproProcurationService } from "../application/fiscal/serpro/SerproProcurationService.js";
import { capturePgdasGuideForCompany } from "../application/fiscal/serpro/CaptureSerproGuidesService.js";
import { createSerproExecutionLog } from "../application/fiscal/serpro/SerproExecutionLogService.js";
import { markGuidePaidBySerpro } from "../application/guides/GuidePaymentStatusService.js";

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
  // `cnpj` no schema é String não-nulo + único — então não precisa filtrar nulls.
  // Filtramos apenas strings vazias (caso algum registro antigo tenha "").
  const companies = await prisma.portalClient.findMany({
    where: {
      cnpj: { not: "" },
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

// Lista guias OPEN cujo vencimento ainda não passou (para re-fetch diário)
async function listOpenGuidesUntilVencimento(portalClientId, todayDate) {
  // todayDate = Date no início do dia local
  return prisma.guide.findMany({
    where: {
      portalClientId,
      source: "SERPRO",
      tipo: "SIMPLES",
      status: "PROCESSED",
      paymentStatus: "OPEN",
      OR: [{ vencimento: null }, { vencimento: { gte: todayDate } }],
    },
    select: {
      id: true,
      portalClientId: true,
      competencia: true,
      vencimento: true,
      paymentStatus: true,
    },
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
    const recheckResults = [];
    const startedAt = Date.now();

    const now = new Date();
    const todayStart = startOfTodayLocal(now);
    const fetchDay = settings.fetchDay ?? 5;
    const isCaptureWindow = now.getDate() >= fetchDay; // a partir do dia configurado

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

        // Stage 1: Captura inicial (apenas no/após fetchDay e se ainda não houver guia para a competência)
        // eslint-disable-next-line no-await-in-loop
        const existingForCompetencia = await prisma.guide.findFirst({
          where: {
            portalClientId: company.id,
            source: "SERPRO",
            tipo: "SIMPLES",
            competencia,
            status: "PROCESSED",
          },
          select: { id: true },
        });

        if (isCaptureWindow && !existingForCompetencia) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const capture = await capturePgdasGuideForCompany({
              portalClientId: company.id,
              competencia,
              // emailStatusOverride padrão = PENDING (envia email da captura inicial)
            });
            results.push({
              companyId: company.id, razao: company.razao, cnpj: company.cnpj, email: company.email,
              competencia,
              status: "captured",
              guideId: capture.guide.guideId,
              integration: capture.integration,
              serviceId: capture.integration?.servico || null,
            });
          } catch (err) {
            results.push({
              companyId: company.id, razao: company.razao, cnpj: company.cnpj, email: company.email,
              competencia,
              status: "error",
              error: err?.code || "SERPRO_PGDASD_CAPTURE_FAILED",
              reason: err?.message || "serpro_pgdasd_capture_failed",
              retryable: Boolean(err?.retryable),
            });
          }
        }

        // Stage 2: Re-fetch diário das guias OPEN cujo vencimento ainda não passou
        // eslint-disable-next-line no-await-in-loop
        const openGuides = await listOpenGuidesUntilVencimento(company.id, todayStart);
        for (const guide of openGuides) {
          const vencDate = guide.vencimento ? new Date(guide.vencimento) : null;
          const isVencimentoHoje = vencDate ? isSameLocalDay(vencDate, now) : false;
          try {
            // eslint-disable-next-line no-await-in-loop
            await capturePgdasGuideForCompany({
              portalClientId: guide.portalClientId,
              competencia: guide.competencia,
              existingGuideId: guide.id,
              // No vencimento → reset PENDING (resend); intermediário → PRESERVE (silencioso)
              emailStatusOverride: isVencimentoHoje ? "PENDING" : "PRESERVE",
            });
            recheckResults.push({
              guideId: guide.id, companyId: guide.portalClientId,
              competencia: guide.competencia,
              status: isVencimentoHoje ? "rechecked_due_today" : "rechecked_silent",
            });
          } catch (err) {
            // SERPRO pode retornar "no debts" para guias já pagas — marca como pago
            if (err?.code === "SERPRO_PGDASD_NO_DEBTS_FOUND") {
              // eslint-disable-next-line no-await-in-loop
              await markGuidePaidBySerpro({ guideId: guide.id });
              recheckResults.push({
                guideId: guide.id, companyId: guide.portalClientId,
                competencia: guide.competencia, status: "paid",
              });
              continue;
            }
            recheckResults.push({
              guideId: guide.id, companyId: guide.portalClientId,
              competencia: guide.competencia,
              status: "error",
              error: err?.code || "SERPRO_PGDASD_RECHECK_FAILED",
              reason: err?.message || "serpro_pgdasd_recheck_failed",
            });
          }
        }
      } catch (err) {
        results.push({
          companyId: company.id, razao: company.razao, cnpj: company.cnpj, email: company.email,
          competencia,
          status: "error",
          error: err?.code || "SERPRO_PGDASD_CYCLE_FAILED",
          reason: err?.message || "serpro_pgdasd_cycle_failed",
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
      failed: results.filter((item) => item.status === "error").length,
      skippedByProcuration: results.filter((item) => item.status === "skipped_procuration_inactive").length,
      recheckedSilent: recheckResults.filter((item) => item.status === "rechecked_silent").length,
      recheckedDueToday: recheckResults.filter((item) => item.status === "rechecked_due_today").length,
      markedPaid: recheckResults.filter((item) => item.status === "paid").length,
      recheckFailures: recheckResults.filter((item) => item.status === "error").length,
      durationMs: Date.now() - startedAt,
      results,
      recheckResults,
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

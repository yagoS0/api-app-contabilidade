import cron from "node-cron";
import {
  GUIDE_SCHEDULE_CRON,
  GUIDE_SCHEDULE_MAX_FILES_PER_COMPANY,
  log,
} from "../config.js";
import {
  listEligiblePortalCompaniesForUser,
  runScheduledGuideEmailDispatch,
} from "../application/guides/GuideScheduledEmailService.js";

export async function runGuideScheduledEmailWorkerOnce(options = {}) {
  const referenceDay = Number(options.referenceDay || new Date().getDate());
  const dryRun = options.dryRun === true;
  const maxFilesPerCompany = Math.min(
    100,
    Math.max(1, Number(options.maxFilesPerCompany || GUIDE_SCHEDULE_MAX_FILES_PER_COMPANY))
  );
  const companies = await listEligiblePortalCompaniesForUser({
    userId: "system",
    adminLike: true,
  });
  return runScheduledGuideEmailDispatch({
    companies,
    referenceDay,
    dryRun,
    maxFilesPerCompany,
  });
}

export async function runGuideScheduledEmailWorkerLoop() {
  cron.schedule(
    GUIDE_SCHEDULE_CRON,
    async () => {
      try {
        const result = await runGuideScheduledEmailWorkerOnce();
        log.info({ result, GUIDE_SCHEDULE_CRON }, "Ciclo do guideScheduledEmailWorker concluído");
      } catch (err) {
        log.error({ err: err?.message || err }, "Erro no guideScheduledEmailWorker");
      }
    },
    { timezone: process.env.TZ || "America/Sao_Paulo" }
  );
  log.info({ GUIDE_SCHEDULE_CRON }, "guideScheduledEmailWorker aguardando cron");
}

if (process.argv[1] && process.argv[1].endsWith("guideScheduledEmailWorker.js")) {
  const isOnce = process.argv.includes("--once");
  const isDryRun = process.argv.includes("--dry-run");
  const dayArg = process.argv.find((arg) => arg.startsWith("--day="));
  const referenceDay = dayArg ? Number(dayArg.split("=")[1]) : undefined;
  if (isOnce) {
    runGuideScheduledEmailWorkerOnce({ dryRun: isDryRun, referenceDay })
      .then((result) => {
        log.info({ result }, "guideScheduledEmailWorker --once finalizado");
        process.exit(0);
      })
      .catch((err) => {
        log.error({ err: err?.message || err }, "guideScheduledEmailWorker --once falhou");
        process.exit(1);
      });
  } else {
    runGuideScheduledEmailWorkerLoop().catch((err) => {
      log.error({ err: err?.message || err }, "guideScheduledEmailWorker loop fatal");
      process.exit(1);
    });
  }
}


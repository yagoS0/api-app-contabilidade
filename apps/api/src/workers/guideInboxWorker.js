import { log } from "../config.js";

/**
 * Ingestão por Google Drive foi removida. Guias entram apenas por upload no portal;
 * o PDF é persistido no PostgreSQL (`Guide.pdfBytes`).
 */
export async function runGuideInboxWorkerOnce() {
  log.info({}, "guideInboxWorker: drive ingestion desativada");
  return {
    skipped: true,
    reason: "drive_ingestion_removed",
    message: "Use o upload de PDF pelo portal. Ingestão por pasta do Drive não está mais disponível.",
    totalFoundInInbox: 0,
    total: 0,
    processed: 0,
    errors: 0,
    skippedCount: 0,
  };
}

export async function runGuideInboxWorkerLoop() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await runGuideInboxWorkerOnce();
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 60 * 60 * 1000));
  }
}

if (process.argv[1] && process.argv[1].endsWith("guideInboxWorker.js")) {
  const isOnce = process.argv.includes("--once");
  if (isOnce) {
    runGuideInboxWorkerOnce()
      .then((result) => {
        log.info({ result }, "guideInboxWorker --once finalizado");
        process.exit(0);
      })
      .catch((err) => {
        log.error({ err: err?.message || err }, "guideInboxWorker --once falhou");
        process.exit(1);
      });
  } else {
    runGuideInboxWorkerLoop().catch((err) => {
      log.error({ err: err?.message || err }, "guideInboxWorker loop fatal");
      process.exit(1);
    });
  }
}

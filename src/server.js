// src/server.js
import express from "express";
import cron from "node-cron";
import cors from "cors";
import { run } from "./application/SendGuides.js";
import { log, API_KEYS, ADN_SYNC_CRON } from "./config.js";
import { RunLogStore } from "./infrastructure/status/RunLogStore.js";
import { UserRepository } from "./infrastructure/db/UserRepository.js";
import { AuthService } from "./application/auth/AuthService.js";
import { createEnsureAuthorized, serializeUser } from "./routes/middlewares/auth.js";
import { createAuthRouter } from "./routes/auth.js";
import { createAdminRouter } from "./routes/admin.js";
import { createPortalClientsRouter } from "./routes/portalClients.js";
import { createPortalInvoicesRouter } from "./routes/portalInvoices.js";
import { createPortalSyncRouter } from "./routes/portalSync.js";
import { createClientPortalRouter } from "./routes/client/index.js";
import { createFirmPortalRouter } from "./routes/firm/index.js";
import { createRunRouter } from "./routes/run.js";
import { createStatusRouter } from "./routes/status.js";
import { runState } from "./routes/runState.js";
import { createInvoicesRouter } from "./routes/invoices.js";
import { createNfseRouter } from "./routes/nfse.js";
import { createAdnRouter } from "./routes/adn.js";
import { AdnSyncService } from "./application/nfse/AdnSyncService.js";

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["content-type", "x-api-key", "authorization"],
  })
);

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const CRON_SCHEDULE = (process.env.CRON_SCHEDULE || "").trim(); // ex: "0 8 * * 1-5"

const USER_STATUSES = ["pending", "active", "rejected"];
const USER_ROLES = ["user", "admin", "contador"];

const ensureAuthorized = createEnsureAuthorized({ AuthService, API_KEYS, log });
app.locals.ensureAuthorized = ensureAuthorized;

const authRouter = createAuthRouter({ AuthService, UserRepository, log, ensureAuthorized });
const adminRouter = createAdminRouter({
  ensureAuthorized,
  UserRepository,
  log,
  USER_STATUSES,
  USER_ROLES,
  serializeUser,
});
const portalClientsRouter = createPortalClientsRouter({ ensureAuthorized, log });
const portalInvoicesRouter = createPortalInvoicesRouter({ ensureAuthorized, log });
const portalSyncRouter = createPortalSyncRouter({ ensureAuthorized, log });
const clientPortalRouter = createClientPortalRouter({ ensureAuthorized, log });
const firmPortalRouter = createFirmPortalRouter({ ensureAuthorized, log });
const { router: runRouter, executeRun } = createRunRouter({
  ensureAuthorized,
  RunLogStore,
  runState,
  run,
  log,
});
const statusRouter = createStatusRouter({
  ensureAuthorized,
  RunLogStore,
  runState,
  CRON_SCHEDULE,
});
const invoicesRouter = createInvoicesRouter({
  ensureAuthorized,
  log,
});
const nfseRouter = createNfseRouter({
  ensureAuthorized,
  log,
});
const adnRouter = createAdnRouter({
  ensureAuthorized,
  log,
});

app.use("/auth", authRouter);
app.use("/admin", adminRouter);
app.use("/clients", portalClientsRouter);
app.use("/clients/:clientId/invoices/sync", portalSyncRouter);
app.use("/clients/:clientId/invoices", portalInvoicesRouter);
app.use("/client", clientPortalRouter);
app.use("/firm", firmPortalRouter);
app.use("/invoices", invoicesRouter);
app.use("/nfse", nfseRouter);
app.use("/api", adnRouter);
app.use("/", statusRouter);
app.use("/", runRouter);

app.listen(PORT, HOST, () => {
  log.info({ port: PORT, host: HOST }, "Servidor iniciado");
});

if (CRON_SCHEDULE) {
  try {
    cron.schedule(
      CRON_SCHEDULE,
      async () => {
        if (runState.isRunning) {
          log.warn("Execução cron ignorada: já há um processo em andamento.");
          return;
        }
        log.info({ CRON_SCHEDULE }, "Disparando execução pelo CRON");
        try {
          await executeRun("send");
        } catch (err) {
          if (err.code === "ALREADY_RUNNING") {
            log.warn("Cron encontrou execução em andamento");
          } else {
            log.error({ err }, "Execução (cron) falhou");
          }
        }
      },
      {
        timezone: process.env.TZ || "America/Sao_Paulo",
      }
    );
    log.info({ CRON_SCHEDULE }, "CRON habilitado");
  } catch (e) {
    log.error({ err: e, CRON_SCHEDULE }, "Falha ao configurar CRON — desabilitado");
  }
}

let adnSyncRunning = false;
if (ADN_SYNC_CRON) {
  try {
    cron.schedule(
      ADN_SYNC_CRON,
      async () => {
        if (adnSyncRunning) {
          log.warn("Sincronização ADN ignorada: já há execução em andamento.");
          return;
        }
        adnSyncRunning = true;
        log.info({ ADN_SYNC_CRON }, "Disparando sincronização ADN (cron)");
        try {
          await AdnSyncService.syncUntilEmpty({ maxIterations: 50 });
        } catch (err) {
          log.error({ err }, "Sincronização ADN falhou");
        } finally {
          adnSyncRunning = false;
        }
      },
      {
        timezone: process.env.TZ || "America/Sao_Paulo",
      }
    );
    log.info({ ADN_SYNC_CRON }, "CRON ADN habilitado");
  } catch (e) {
    log.error({ err: e, ADN_SYNC_CRON }, "Falha ao configurar CRON ADN — desabilitado");
  }
}



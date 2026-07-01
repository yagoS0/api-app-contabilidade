// src/server.js
import express from "express";
import cors from "cors";
import { log, API_KEYS, GUIDE_EMAIL_WORKER_ENABLED, SERPRO_PGDASD_WORKER_ENABLED, SERPRO_DCTFWEB_WORKER_ENABLED, SERPRO_PAYMENT_CONFIRMATION_WORKER_ENABLED, DFE_NOTAS_WORKER_ENABLED, APURACAO_BATCH_WORKER_ENABLED, CERT_SECRET_KEY, CERT_SECRET_KEY_MIN_LENGTH } from "./config.js";
import { runApuracaoBatchLoop } from "./workers/apuracaoBatchWorker.js";
import { runSerproPaymentConfirmationWorkerLoop } from "./workers/serproPaymentConfirmationWorker.js";
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
import { createStatusRouter } from "./routes/status.js";
import { createInvoicesRouter } from "./routes/invoices.js";
import { createNfseRouter } from "./routes/nfse.js";
import { createAdnRouter } from "./routes/adn.js";
import { createInternalRouter } from "./routes/internal.js";
import { runGuideEmailWorkerLoop } from "./workers/guideEmailWorker.js";
import { runSerproPgdasdWorkerLoop } from "./workers/serproPgdasdWorker.js";
import { runSerproDctfwebWorkerLoop } from "./workers/serproDctfwebWorker.js";
import { runDfeNotasWorkerLoop } from "./workers/dfeNotasWorker.js";
import { backfillProvisionsFromExistingGuides } from "./application/accounting/GuideToProvisionBackfill.js";
import { seedParcelamentoFunctions } from "./application/accounting/ParcelamentoSeeds.js";
import { seedMapaContaTributoGlobal } from "./application/accounting/parcelamento/MapaContaTributoSeeds.js";
import { seedDeparaAnexoGlobal } from "./application/notas/apuracao/DeparaAnexoSeeds.js";
// Q14 — Refundação da apuração: novos seeders (alíquotas SN, CNAEs, regras v2)
import { seedAliquotaSimplesNacional } from "./application/notas/apuracao/v2/seeds/AliquotaSimplesNacionalSeeds.js";
import { seedCnaeAnexo } from "./application/notas/apuracao/v2/seeds/CnaeAnexoSeeds.js";
import { seedRegraClassificacaoGlobal } from "./application/notas/apuracao/v2/seeds/RegraClassificacaoSeeds.js";
import { seedAtividadePgdasd } from "./application/notas/apuracao/v2/seeds/AtividadePgdasdSeeds.js";
import { prisma } from "./infrastructure/db/prisma.js";

const app = express();
app.use(express.json());

// Q8.A.2: CORS — em produção exige whitelist via env CORS_ALLOWED_ORIGINS (CSV).
// Em dev (NODE_ENV !== "production") aceita qualquer origem (vite + ferramentas).
// Exemplo de var: CORS_ALLOWED_ORIGINS=https://app.dominio.com,https://staging.dominio.com
const isProd = process.env.NODE_ENV === "production";
const allowedOrigins = String(process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const corsOriginPolicy = isProd
  ? (origin, cb) => {
      // origin === undefined em chamadas server-to-server / mesma origem — liberar
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS bloqueado: origem "${origin}" não está em CORS_ALLOWED_ORIGINS`));
    }
  : true;
if (isProd && allowedOrigins.length === 0) {
  log.warn(
    { hint: "Defina CORS_ALLOWED_ORIGINS=https://seu-dominio.com no .env de produção" },
    "Q8.A.2: NODE_ENV=production mas CORS_ALLOWED_ORIGINS está vazio — todas as origens com cabeçalho Origin serão bloqueadas"
  );
}
app.use(
  cors({
    origin: corsOriginPolicy,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "x-api-key", "authorization"],
    credentials: true,
  })
);

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

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
const statusRouter = createStatusRouter({ ensureAuthorized });
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
const internalRouter = createInternalRouter({ ensureAuthorized, log });

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
app.use("/internal", internalRouter);
app.use("/", statusRouter);

// Q30 Fase 1: fail-fast — a API não sobe sem uma CERT_SECRET_KEY dedicada e forte (>= 32 chars).
// Sem ela, os certificados não podem ser cifrados/lidos com segurança. (Antes caía no JWT_SECRET.)
if (!CERT_SECRET_KEY || CERT_SECRET_KEY.length < CERT_SECRET_KEY_MIN_LENGTH) {
  log.error(
    `CERT_SECRET_KEY ausente ou curta (< ${CERT_SECRET_KEY_MIN_LENGTH} chars). `
    + "Defina-a no ambiente (ex.: openssl rand -base64 48). A API não vai subir sem ela.",
  );
  process.exit(1);
}

app.listen(PORT, HOST, () => {
  log.info({ port: PORT, host: HOST }, "Servidor iniciado");
  // Q5 backfill: cria AccountingEntry para Guides PROCESSED que ainda não têm.
  backfillProvisionsFromExistingGuides({ logger: log }).catch((err) => {
    log.warn({ err: err?.message || err }, "Backfill GuideToProvision falhou");
  });
  // Q9 seeds: cria/atualiza templates globais de parcelamento (Simples, INSS, ...).
  seedParcelamentoFunctions({ logger: log }).catch((err) => {
    log.warn({ err: err?.message || err }, "Seed de funções de parcelamento falhou");
  });
  // Q21 seeds: contas sugeridas (global) por papel de linha do parcelamento (MapaContaTributo).
  seedMapaContaTributoGlobal(prisma, { log }).catch((err) => {
    log.warn({ err: err?.message || err }, "Seed MapaContaTributo falhou");
  });
  // Q12.C.1 seeds: tabela De/Para Anexo Simples Nacional (LC116 → III/IV/V) [LEGADO]
  seedDeparaAnexoGlobal(prisma, { log }).catch((err) => {
    log.warn({ err: err?.message || err }, "Seed DeparaAnexo falhou");
  });
  // Q14.1.b seeds: tabela de alíquotas SN (5 anexos × 6 faixas, vigência LC 155/16)
  seedAliquotaSimplesNacional(prisma, { log }).catch((err) => {
    log.warn({ err: err?.message || err }, "Seed AliquotaSimplesNacional falhou");
  });
  // Q14.1.c seeds: tabela CNAE → TipoReceita sugerido (apoio pro cadastro fiscal)
  seedCnaeAnexo(prisma, { log }).catch((err) => {
    log.warn({ err: err?.message || err }, "Seed CnaeAnexo falhou");
  });
  // Q14.1.d seeds: regras de classificação GLOBAL (LC116 itens + capítulos)
  seedRegraClassificacaoGlobal(prisma, { log }).catch((err) => {
    log.warn({ err: err?.message || err }, "Seed RegraClassificacao falhou");
  });
  // Q15.2 seeds: de-para idAtividade do PGDAS-D (⚠ confirmar IDs no trial)
  seedAtividadePgdasd(prisma, { log }).catch((err) => {
    log.warn({ err: err?.message || err }, "Seed AtividadePgdasd falhou");
  });
});

if (GUIDE_EMAIL_WORKER_ENABLED) {
  runGuideEmailWorkerLoop().catch((err) => {
    log.error({ err: err?.message || err }, "guideEmailWorker loop fatal");
  });
}

if (SERPRO_PGDASD_WORKER_ENABLED) {
  runSerproPgdasdWorkerLoop().catch((err) => {
    log.error({ err: err?.message || err }, "serproPgdasdWorker loop fatal");
  });
}

if (SERPRO_DCTFWEB_WORKER_ENABLED) {
  runSerproDctfwebWorkerLoop().catch((err) => {
    log.error({ err: err?.message || err }, "serproDctfwebWorker loop fatal");
  });
}

// Q40: worker do cron próprio de confirmação de pagamento (PAGTOWEB). Opt-in via env;
// dentro do loop ainda respeita paymentConfirmationEnabled + o cron configurado nas settings.
if (SERPRO_PAYMENT_CONFIRMATION_WORKER_ENABLED) {
  runSerproPaymentConfirmationWorkerLoop().catch((err) => {
    log.error({ err: err?.message || err }, "serproPaymentConfirmationWorker loop fatal");
  });
}

// Q12.B+++.5: worker automático de captura DFe (NF-e SEFAZ + NFS-e ADN).
// Opt-in via DFE_NOTAS_WORKER_ENABLED=1. Intervalo entre ciclos por CNPJ
// configurável via DFE_NOTAS_WORKER_INTERVAL_MIN (default 60 = 1h conforme NT).
if (DFE_NOTAS_WORKER_ENABLED) {
  runDfeNotasWorkerLoop().catch((err) => {
    log.error({ err: err?.message || err }, "dfeNotasWorker loop fatal");
  });
}

// Q15.6: worker da fila de transmissão de apurações ao SERPRO (opt-in).
if (APURACAO_BATCH_WORKER_ENABLED) {
  runApuracaoBatchLoop().catch((err) => {
    log.error({ err: err?.message || err }, "apuracaoBatchWorker loop fatal");
  });
}

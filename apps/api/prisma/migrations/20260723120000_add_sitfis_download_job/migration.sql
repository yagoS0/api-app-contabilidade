-- Q62 — Download em lote das situações fiscais (SITFIS): job + ZIP. Aditivo (CREATE TABLE).

CREATE TABLE "sitfis_download_jobs" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processando',
    "companyIds" JSONB NOT NULL,
    "totalEmpresas" INTEGER NOT NULL,
    "processadas" INTEGER NOT NULL DEFAULT 0,
    "comPdf" INTEGER NOT NULL DEFAULT 0,
    "arquivoPath" TEXT,
    "arquivoNome" TEXT,
    "arquivoBytes" INTEGER,
    "erroMensagem" TEXT,
    "triggeredBy" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sitfis_download_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sitfis_download_jobs_status_createdAt_idx" ON "sitfis_download_jobs"("status", "createdAt");

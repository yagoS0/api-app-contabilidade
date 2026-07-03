-- Q48: job de download de notas em lote (ZIP em segundo plano).
-- Aditiva e não-destrutiva: só cria a tabela nova.
CREATE TABLE "notas_download_jobs" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processando',
    "competenciaDe" TEXT NOT NULL,
    "competenciaAte" TEXT NOT NULL,
    "tipo" TEXT,
    "papel" TEXT,
    "companyIds" JSONB NOT NULL,
    "totalEmpresas" INTEGER NOT NULL,
    "processadas" INTEGER NOT NULL DEFAULT 0,
    "totalNotas" INTEGER NOT NULL DEFAULT 0,
    "arquivoPath" TEXT,
    "arquivoNome" TEXT,
    "arquivoBytes" INTEGER,
    "erroMensagem" TEXT,
    "triggeredBy" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notas_download_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notas_download_jobs_status_createdAt_idx" ON "notas_download_jobs"("status", "createdAt");

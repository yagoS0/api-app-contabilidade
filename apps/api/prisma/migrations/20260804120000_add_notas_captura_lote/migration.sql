-- Consulta de notas em lote (captura ADN/SEFAZ). Aditiva: nenhuma tabela existente é tocada.
--
-- O item por empresa existe para que empresa PULADA apareça com o motivo, em vez de sumir da
-- contagem — o defeito que deixou a rotina automática quebrada passar despercebida.

CREATE TABLE "notas_captura_jobs" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processando',
    "alvos" JSONB NOT NULL,
    "companyIds" JSONB NOT NULL,
    "totalEmpresas" INTEGER NOT NULL,
    "processadas" INTEGER NOT NULL DEFAULT 0,
    "totalNotas" INTEGER NOT NULL DEFAULT 0,
    "erroMensagem" TEXT,
    "triggeredBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notas_captura_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notas_captura_items" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "razao" TEXT,
    "cnpj" TEXT,
    "alvo" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "motivo" TEXT,
    "totalDocs" INTEGER NOT NULL DEFAULT 0,
    "novos" INTEGER NOT NULL DEFAULT 0,
    "cursorAntes" TEXT,
    "cursorDepois" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notas_captura_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notas_captura_jobs_status_createdAt_idx" ON "notas_captura_jobs"("status", "createdAt");

CREATE INDEX "notas_captura_items_jobId_idx" ON "notas_captura_items"("jobId");

ALTER TABLE "notas_captura_items" ADD CONSTRAINT "notas_captura_items_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "notas_captura_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
